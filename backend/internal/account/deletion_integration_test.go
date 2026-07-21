//go:build integration

package account_test

// deletion_integration_test.go — HTTP integration tests for account deletion
// and log upload endpoints (Phase 11).

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/snapshot"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

func postDeletion(t *testing.T, client *http.Client, rawURL string, body any) *http.Response {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(http.MethodPost, rawURL, r)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "fetch")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

func readDeletionBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return b
}

// signInDeletion signs in via POST /v1/auth/google using the env's primary client.
func signInDeletion(t *testing.T, env *testenv.Env) {
	t.Helper()
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Test Phone",
		"userAgent":   "TestAgent/1.0",
	})
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in: %s", body)
}

// sessionClientDeletion creates an independent HTTP client pre-seeded with the
// given session cookie value.
func sessionClientDeletion(t *testing.T, env *testenv.Env, cookieValue string) *http.Client {
	t.Helper()
	client := env.NewClient()
	u, err := url.Parse(env.Server.URL)
	require.NoError(t, err)
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	jar.SetCookies(u, []*http.Cookie{
		{
			Name:   "__Host-session",
			Value:  cookieValue,
			Path:   "/",
			Secure: true,
		},
	})
	client.Jar = jar
	return client
}

// seedAdminForDeletion inserts a user and promotes it to admin directly in DB.
func seedAdminForDeletion(t *testing.T, db *sql.DB, promoterID, email string) string {
	t.Helper()
	ctx := t.Context()
	q := gen.New(db)
	now := time.Now().UTC().Format(time.RFC3339)
	id, err := uuid.NewV7()
	require.NoError(t, err)
	user, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           id.String(),
		Email:        email,
		DisplayName:  email,
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	require.NoError(t, q.PromoteUserToAdmin(ctx, gen.PromoteUserToAdminParams{
		PromoterID: sql.NullString{String: promoterID, Valid: true},
		ID:         user.ID,
	}))
	return user.ID
}

// --------------------------------------------------------------------------
// TestRequestDeletion_Idempotent
// --------------------------------------------------------------------------

func TestRequestDeletion_Idempotent(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email:         "root@example.com",
		Sub:           "sub-root",
		Name:          "Root",
		EmailVerified: true,
	}
	signInDeletion(t, env)

	// First call — should set deleteAfter ~14 days out.
	resp1 := postDeletion(t, env.Client, env.Server.URL+"/v1/account/request-deletion", nil)
	body1 := readDeletionBody(t, resp1)
	require.Equal(t, http.StatusOK, resp1.StatusCode, "first request: %s", body1)

	var r1 map[string]string
	require.NoError(t, json.Unmarshal(body1, &r1))
	require.NotEmpty(t, r1["deleteAfter"])

	// Second call — idempotent, same deleteAfter returned.
	resp2 := postDeletion(t, env.Client, env.Server.URL+"/v1/account/request-deletion", nil)
	body2 := readDeletionBody(t, resp2)
	require.Equal(t, http.StatusOK, resp2.StatusCode, "second request: %s", body2)

	var r2 map[string]string
	require.NoError(t, json.Unmarshal(body2, &r2))
	assert.Equal(t, r1["deleteAfter"], r2["deleteAfter"], "idempotent: deleteAfter must be unchanged")
}

// --------------------------------------------------------------------------
// TestCancelDeletion_Happy
// --------------------------------------------------------------------------

func TestCancelDeletion_Happy(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email:         "root@example.com",
		Sub:           "sub-root",
		Name:          "Root",
		EmailVerified: true,
	}
	signInDeletion(t, env)

	// Request deletion.
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/account/request-deletion", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	readDeletionBody(t, resp)

	// Cancel deletion — should succeed.
	resp2 := postDeletion(t, env.Client, env.Server.URL+"/v1/account/cancel-deletion", nil)
	body2 := readDeletionBody(t, resp2)
	require.Equal(t, http.StatusNoContent, resp2.StatusCode, "cancel: %s", body2)

	// Verify DB: delete_after should be NULL.
	q := gen.New(env.DB)
	u, err := q.GetUserByEmail(t.Context(), "root@example.com")
	require.NoError(t, err)
	assert.False(t, u.DeleteAfter.Valid, "delete_after must be cleared after cancel")
}

// --------------------------------------------------------------------------
// TestCancelDeletion_NotPending
// --------------------------------------------------------------------------

func TestCancelDeletion_NotPending(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email:         "root@example.com",
		Sub:           "sub-root",
		Name:          "Root",
		EmailVerified: true,
	}
	signInDeletion(t, env)

	// Cancel without a pending request — should return 400.
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/account/cancel-deletion", nil)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode, "cancel-not-pending: %s", body)
}

// --------------------------------------------------------------------------
// TestSendLogs_Happy
// --------------------------------------------------------------------------

func TestSendLogs_Happy(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email:         "root@example.com",
		Sub:           "sub-root",
		Name:          "Root",
		EmailVerified: true,
	}
	signInDeletion(t, env)

	payload := map[string]any{
		"logs":        []any{"log line 1", "log line 2"},
		"userConsent": true,
	}
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/logs/send", payload)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusNoContent, resp.StatusCode, "send-logs: %s", body)
}

// --------------------------------------------------------------------------
// TestSendLogs_ConsentRequired
// --------------------------------------------------------------------------

func TestSendLogs_ConsentRequired(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email:         "root@example.com",
		Sub:           "sub-root",
		Name:          "Root",
		EmailVerified: true,
	}
	signInDeletion(t, env)

	payload := map[string]any{
		"logs":        []any{"log line 1"},
		"userConsent": false,
	}
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/logs/send", payload)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode, "no-consent: %s", body)
}

// --------------------------------------------------------------------------
// TestAdminDeleteImmediate_Self
// --------------------------------------------------------------------------

func TestAdminDeleteImmediate_Self(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	// Sign in as root (bootstrap admin).
	env.Verifier.Claims = &authpkg.Claims{
		Email:         "root@example.com",
		Sub:           "sub-root",
		Name:          "Root",
		EmailVerified: true,
	}
	signInDeletion(t, env)

	// Verify user exists.
	q := gen.New(env.DB)
	u, err := q.GetUserByEmail(t.Context(), "root@example.com")
	require.NoError(t, err)
	rootID := u.ID

	// Admin self-delete.
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/admin/account/delete-immediate", nil)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "delete-immediate: %s", body)

	// User should no longer exist in DB.
	_, err = q.GetUserByID(t.Context(), rootID)
	require.ErrorIs(t, err, sql.ErrNoRows, "user must be hard-deleted after delete-immediate")
}

// --------------------------------------------------------------------------
// purge test helpers
// --------------------------------------------------------------------------

// initFamilyForDeletion calls POST /v1/family/init using client and returns the familyId.
func initFamilyForDeletion(t *testing.T, client *http.Client, base string) string {
	t.Helper()
	familyID := newUUIDForDeletion(t)
	body := map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64Zeros(80),
		"recovery": map[string]any{
			"wrap":     base64Zeros(49),
			"phraseCt": base64Zeros(49),
			"salt":     base64Zeros(16),
		},
	}
	resp := postDeletion(t, client, base+"/v1/family/init", body)
	respBody := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "family/init: %s", respBody)
	return familyID
}

// pushOneRecordForDeletion pushes a single, minimally-valid record via client
// and returns its recordId.
func pushOneRecordForDeletion(t *testing.T, client *http.Client, base string) string {
	t.Helper()
	recordID := newUUIDForDeletion(t)
	blob := make([]byte, 73+8)
	blob[0] = 0x01
	rec := map[string]any{
		"recordId":           recordID,
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob),
		"updatedAtMap":       map[string]string{"amount": "2024-01-01T00:00:00.000Z"},
		"parentVersion":      0,
		"plaintextByteCount": int64(8),
	}
	resp := postDeletion(t, client, base+"/v1/sync/push", map[string]any{"records": []any{rec}})
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "push: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	accepted, _ := result["accepted"].([]any)
	require.Len(t, accepted, 1, "push must accept the record: %s", body)
	return recordID
}

// addToAllowlistForDeletion inserts (or upserts) a user and adds them to the allowlist.
func addToAllowlistForDeletion(t *testing.T, db *sql.DB, email string) {
	t.Helper()
	ctx := t.Context()
	now := time.Now().UTC().Format(time.RFC3339)
	q := gen.New(db)
	user, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           newUUIDForDeletion(t),
		Email:        email,
		DisplayName:  email,
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	require.NoError(t, q.AddAllowlistEntry(ctx, gen.AddAllowlistEntryParams{
		Email:   email,
		AddedBy: user.ID,
		AddedAt: now,
	}))
}

func newUUIDForDeletion(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

func base64Zeros(n int) string {
	return base64.RawURLEncoding.EncodeToString(make([]byte, n))
}

// --------------------------------------------------------------------------
// TestPurge_SoloFamilyFullyDeleted
// --------------------------------------------------------------------------

// TestPurge_SoloFamilyFullyDeleted verifies that purging a user whose only
// family is a solo family (no other active members) hard-deletes the user
// row AND cascade-deletes the now-empty family (with its record_meta/blobs) —
// E2E ciphertext for a family with no surviving members must not be kept
// forever.
func TestPurge_SoloFamilyFullyDeleted(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	email := "root@example.com"
	env.Verifier.Claims = &authpkg.Claims{
		Email: email, Sub: "sub-root", Name: "Solo Purge", EmailVerified: true,
	}
	signInDeletion(t, env)
	familyID := initFamilyForDeletion(t, env.Client, env.Server.URL)
	recordID := pushOneRecordForDeletion(t, env.Client, env.Server.URL)

	q := gen.New(env.DB)
	u, err := q.GetUserByEmail(t.Context(), email)
	require.NoError(t, err)
	userID := u.ID

	// Admin self-delete (bootstrap email auto-promotes to root/admin on
	// first sign-in, so this user can call delete-immediate on themselves).
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/admin/account/delete-immediate", nil)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "delete-immediate: %s", body)

	// User row must be hard-deleted.
	_, err = q.GetUserByID(t.Context(), userID)
	assert.ErrorIs(t, err, sql.ErrNoRows, "user must be hard-deleted")

	// The now-empty solo family must be cascade-deleted.
	_, err = q.GetFamilyByID(t.Context(), familyID)
	assert.ErrorIs(t, err, sql.ErrNoRows, "empty solo family must be cascade-deleted")

	// Its record_meta row must be gone too (cascaded via the family delete).
	var recordCount int
	require.NoError(t, env.DB.QueryRowContext(t.Context(),
		`SELECT COUNT(*) FROM record_meta WHERE record_id = ?`, recordID,
	).Scan(&recordCount))
	assert.Equal(t, 0, recordCount, "record_meta for the deleted family must be gone")
}

// --------------------------------------------------------------------------
// TestPurge_SharedFamilyScrubsPII
// --------------------------------------------------------------------------

// TestPurge_SharedFamilyScrubsPII verifies that purging a user who still has
// record_meta references in a SHARED family (2+ active members) does NOT
// hard-delete the user row — record_meta.added_by_user/edited_by_user have no
// ON DELETE clause, and rewriting them would break the AAD binding on the
// referenced blob. Instead the user row survives as a PII-scrubbed
// tombstone, and the family + its records remain intact and functional for
// the other member.
func TestPurge_SharedFamilyScrubsPII(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	emailA := "root@example.com"
	env.Verifier.Claims = &authpkg.Claims{
		Email: emailA, Sub: "sub-root", Name: "Shared A", EmailVerified: true,
	}
	signInDeletion(t, env)
	familyID := initFamilyForDeletion(t, env.Client, env.Server.URL)
	recordID := pushOneRecordForDeletion(t, env.Client, env.Server.URL)

	q := gen.New(env.DB)
	userA, err := q.GetUserByEmail(t.Context(), emailA)
	require.NoError(t, err)

	// Add a second, active member B to the SAME family directly (bypassing
	// the invite flow — we only need "2 active members", not to exercise
	// invite/accept here).
	emailB := "shared-purge-b@example.com"
	addToAllowlistForDeletion(t, env.DB, emailB)
	now := time.Now().UTC().Format(time.RFC3339)
	userB, err := q.UpsertUserByEmail(t.Context(), gen.UpsertUserByEmailParams{
		ID:           newUUIDForDeletion(t),
		Email:        emailB,
		DisplayName:  "Shared B",
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	require.NoError(t, q.InsertFamilyMember(t.Context(), gen.InsertFamilyMemberParams{
		FamilyID: familyID,
		UserID:   userB.ID,
		JoinedAt: now,
	}))

	// Purge A. A is admin/root (bootstrap email), so delete-immediate targets self.
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/admin/account/delete-immediate", nil)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "delete-immediate: %s", body)

	// A's user row must SURVIVE (scrubbed), because record_meta still
	// references A as added_by_user/edited_by_user in the surviving family.
	scrubbedA, err := q.GetUserByID(t.Context(), userA.ID)
	require.NoError(t, err, "A's row must survive as a scrubbed tombstone, not be hard-deleted")
	assert.NotEqual(t, emailA, scrubbedA.Email, "email must be scrubbed")
	assert.NotEqual(t, "Shared A", scrubbedA.DisplayName, "display name must be scrubbed")
	assert.False(t, scrubbedA.DeleteAfter.Valid, "delete_after must be cleared on the tombstone")

	// The family must still exist and be functional: B remains an active
	// member and the record is still intact (not rewritten/corrupted).
	_, err = q.GetFamilyByID(t.Context(), familyID)
	require.NoError(t, err, "shared family must survive")

	memberCount, err := q.CountActiveFamilyMembers(t.Context(), familyID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), memberCount, "B must remain the sole active member")

	rm, err := q.GetRecordMeta(t.Context(), gen.GetRecordMetaParams{RecordID: recordID, FamilyID: familyID})
	require.NoError(t, err, "the record must remain intact in the surviving family")
	assert.Equal(t, userA.ID, rm.AddedByUser, "added_by_user must NOT be rewritten (AAD binding)")
	assert.Equal(t, userA.ID, rm.EditedByUser, "edited_by_user must NOT be rewritten (AAD binding)")
}

// --------------------------------------------------------------------------
// TestPurge_SnapshotEntryRefForcesScrub
// --------------------------------------------------------------------------

// TestPurge_SnapshotEntryRefForcesScrub covers the FK gap fixed alongside
// CountSnapshotEntryRefsForUser: a shared-family user whose record_meta refs
// are gone (another member re-edited the record after them) but who is
// still named as the historical editor on a live snapshot_entries row must
// be scrubbed, not hard-deleted -- and the purge transaction must succeed,
// not roll back on the snapshot_entries FK.
//
// added_by_user is set once at record creation and never rewritten, so to
// get A fully out of record_meta the record must be created by B, edited by
// A (captured into a snapshot), then edited again by B -- leaving
// record_meta pointing only at B while the snapshot_entries row taken
// mid-sequence still names A as edited_by_user verbatim.
func TestPurge_SnapshotEntryRefForcesScrub(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	emailA := "root@example.com"
	env.Verifier.Claims = &authpkg.Claims{
		Email: emailA, Sub: "sub-root", Name: "Snapshot Purge A", EmailVerified: true,
	}
	signInDeletion(t, env)
	familyID := initFamilyForDeletion(t, env.Client, env.Server.URL)

	q := gen.New(env.DB)
	userA, err := q.GetUserByEmail(t.Context(), emailA)
	require.NoError(t, err)

	// Second, active member B of the same family (direct DB insert, same
	// pattern as TestPurge_SharedFamilyScrubsPII).
	emailB := "snapshot-purge-b@example.com"
	addToAllowlistForDeletion(t, env.DB, emailB)
	now := time.Now().UTC().Format(time.RFC3339)
	userB, err := q.UpsertUserByEmail(t.Context(), gen.UpsertUserByEmailParams{
		ID:           newUUIDForDeletion(t),
		Email:        emailB,
		DisplayName:  "Snapshot Purge B",
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	require.NoError(t, q.InsertFamilyMember(t.Context(), gen.InsertFamilyMemberParams{
		FamilyID: familyID,
		UserID:   userB.ID,
		JoinedAt: now,
	}))

	// Seed a record added by B and edited by A.
	recordID := newUUIDForDeletion(t)
	blobID1 := newUUIDForDeletion(t)
	require.NoError(t, q.InsertBlob(t.Context(), gen.InsertBlobParams{
		ID: blobID1, FamilyID: familyID, Ciphertext: []byte("ciphertext-a"), ByteCount: 12, CreatedAt: now,
	}))
	seq1, err := q.AdvanceFamilySeq(t.Context(), familyID)
	require.NoError(t, err)
	require.NoError(t, q.InsertRecordMeta(t.Context(), gen.InsertRecordMetaParams{
		RecordID:       recordID,
		FamilyID:       familyID,
		RecordType:     "transaction",
		BlobID:         blobID1,
		Version:        2,
		AddedByUser:    userB.ID,
		EditedByUser:   userA.ID,
		UpdatedAtMap:   `{"amount":"2024-01-01T00:00:00.000Z"}`,
		FamilySeq:      seq1,
		CreatedAt:      now,
		LastModifiedAt: now,
	}))

	// Snapshot the family while A's edit is the live state -- this captures
	// added_by_user=B, edited_by_user=A verbatim into snapshot_entries.
	snapshotID, err := snapshot.NewService(env.DB).CreateSnapshot(t.Context(), familyID, "2024-06-01")
	require.NoError(t, err)

	// B re-edits the record after the snapshot: record_meta.edited_by_user
	// now overwrites to B, so record_meta no longer references A at all --
	// but the live snapshot_entries row above still names A as the
	// historical editor.
	blobID2 := newUUIDForDeletion(t)
	require.NoError(t, q.InsertBlob(t.Context(), gen.InsertBlobParams{
		ID: blobID2, FamilyID: familyID, Ciphertext: []byte("ciphertext-b"), ByteCount: 12, CreatedAt: now,
	}))
	seq2, err := q.AdvanceFamilySeq(t.Context(), familyID)
	require.NoError(t, err)
	require.NoError(t, q.UpdateRecordMeta(t.Context(), gen.UpdateRecordMetaParams{
		RecordID:       recordID,
		FamilyID:       familyID,
		BlobID:         blobID2,
		Version:        3,
		EditedByUser:   userB.ID,
		UpdatedAtMap:   `{"amount":"2024-01-02T00:00:00.000Z"}`,
		FamilySeq:      seq2,
		LastModifiedAt: now,
	}))

	// Sanity: record_meta no longer references A at all.
	rm, err := q.GetRecordMeta(t.Context(), gen.GetRecordMetaParams{RecordID: recordID, FamilyID: familyID})
	require.NoError(t, err)
	require.NotEqual(t, userA.ID, rm.AddedByUser, "added_by_user must now point at B")
	require.NotEqual(t, userA.ID, rm.EditedByUser, "edited_by_user must now point at B")

	// Purge A. Before the fix, CountRecordMetaRefsForUser(A) == 0 sends A
	// down the hard-delete path, and HardDeleteUser violates the
	// snapshot_entries.edited_by_user FK (still pointing at A), rolling back
	// the whole purge transaction (the caller would see a 500 here, and A
	// would remain fully un-purged). It must succeed and scrub instead.
	resp := postDeletion(t, env.Client, env.Server.URL+"/v1/admin/account/delete-immediate", nil)
	body := readDeletionBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "delete-immediate: %s", body)

	scrubbedA, err := q.GetUserByID(t.Context(), userA.ID)
	require.NoError(t, err, "A's row must survive as a scrubbed tombstone, not be hard-deleted")
	assert.NotEqual(t, emailA, scrubbedA.Email, "email must be scrubbed")
	assert.False(t, scrubbedA.DeleteAfter.Valid, "delete_after must be cleared on the tombstone")

	// The snapshot entry itself must be untouched -- it still names A
	// verbatim; rewriting it would break the AAD binding on its ciphertext.
	entries, err := q.ListSnapshotEntries(t.Context(), snapshotID)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, userA.ID, entries[0].EditedByUser.String, "snapshot_entries.edited_by_user must NOT be rewritten")
}

//go:build integration

package snapshot_test

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/snapshot"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// newSnapshotService builds a snapshot.Service wired to the test env's DB.
func newSnapshotService(env *testenv.Env) *snapshot.Service {
	return snapshot.NewService(env.DB)
}

// --------------------------------------------------------------------------
// HTTP helpers (same shape as other integration test packages)
// --------------------------------------------------------------------------

func postJSON(t *testing.T, client *http.Client, rawURL string, body any) *http.Response {
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

func getReq(t *testing.T, client *http.Client, rawURL string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	require.NoError(t, err)
	req.Header.Set("X-Requested-With", "fetch")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

func readBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return b
}

func problemTitle(t *testing.T, body []byte) string {
	t.Helper()
	var p map[string]any
	require.NoError(t, json.Unmarshal(body, &p))
	v, _ := p["title"].(string)
	return v
}

// --------------------------------------------------------------------------
// Setup helpers
// --------------------------------------------------------------------------

func addToAllowlist(t *testing.T, env *testenv.Env, email string) {
	t.Helper()
	_, err := env.DB.ExecContext(t.Context(),
		`INSERT OR IGNORE INTO users (id, email, display_name, is_admin, is_root, created_at)
		 VALUES (lower(hex(randomblob(16))), ?, ?, 0, 0, datetime('now'))`,
		email, email,
	)
	require.NoError(t, err)

	var userID string
	require.NoError(t, env.DB.QueryRowContext(t.Context(), `SELECT id FROM users WHERE email = ?`, email).Scan(&userID))

	_, err = env.DB.ExecContext(t.Context(),
		`INSERT OR IGNORE INTO allowlist (email, added_by, added_at) VALUES (?, ?, datetime('now'))`,
		email, userID,
	)
	require.NoError(t, err)
}

func signIn(t *testing.T, env *testenv.Env, email string) {
	t.Helper()
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Test Device",
		"userAgent":   "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in: %s", body)
}

func initFamily(t *testing.T, env *testenv.Env) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	familyID := id.String()

	body := map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64.RawURLEncoding.EncodeToString(make([]byte, 80)),
		"recovery": map[string]any{
			"wrap":     base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"phraseCt": base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"salt":     base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
	}
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/family/init", body)
	respBody := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "family/init: %s", respBody)
	return familyID
}

// validBlob builds a structurally valid blob: version byte 0x01, 24-byte nonce,
// 32-byte commit, 16-byte AEAD tag = 73 overhead + payloadLen extra bytes.
func validBlob(payloadLen int) []byte {
	b := make([]byte, 73+payloadLen)
	b[0] = 0x01
	return b
}

func newUUIDStr(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

func validRecord(t *testing.T, payloadLen int) map[string]any {
	t.Helper()
	blob := validBlob(payloadLen)
	return map[string]any{
		"recordId":           newUUIDStr(t),
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob),
		"updatedAtMap":       map[string]string{"amount": "2024-01-01T00:00:00.000Z"},
		"parentVersion":      0,
		"plaintextByteCount": int64(payloadLen),
	}
}

func pushRecords(t *testing.T, env *testenv.Env, records []any) map[string]any {
	t.Helper()
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": records,
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "push: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

// countRows runs a COUNT(*) query and returns the result.
func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRowContext(t.Context(), query, args...).Scan(&n))
	return n
}

// createSnapshotForFamily creates a snapshot for the given family using the
// snapshot.Service (which handles everything atomically).
func createSnapshotForFamily(t *testing.T, env *testenv.Env, familyID, date string) string {
	t.Helper()
	svc := newSnapshotService(env)
	snapID, err := svc.CreateSnapshot(t.Context(), familyID, date)
	require.NoError(t, err)
	return snapID
}

// --------------------------------------------------------------------------
// SSE helpers
// --------------------------------------------------------------------------

type sseEvent struct {
	Type string
	Data string
}

func openSSE(t *testing.T, client *http.Client, rawURL string) (<-chan sseEvent, func()) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	require.NoError(t, err)
	req.Header.Set("X-Requested-With", "fetch")

	resp, err := client.Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "SSE connect failed")

	evCh := make(chan sseEvent, 32)
	go func() {
		defer close(evCh)
		scanner := bufio.NewScanner(resp.Body)
		var currentType, currentData string
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event: ") {
				currentType = strings.TrimPrefix(line, "event: ")
			} else if strings.HasPrefix(line, "data: ") {
				currentData = strings.TrimPrefix(line, "data: ")
			} else if line == "" && (currentType != "" || currentData != "") {
				evCh <- sseEvent{Type: currentType, Data: currentData}
				currentType = ""
				currentData = ""
			}
		}
	}()

	return evCh, func() { resp.Body.Close() }
}

func receiveEvent(t *testing.T, evCh <-chan sseEvent, wantType string, deadline time.Duration) sseEvent {
	t.Helper()
	timer := time.NewTimer(deadline)
	defer timer.Stop()
	for {
		select {
		case ev, ok := <-evCh:
			if !ok {
				t.Fatalf("SSE channel closed before receiving event of type %q", wantType)
			}
			if ev.Type == wantType {
				return ev
			}
		case <-timer.C:
			t.Fatalf("timeout waiting for SSE event of type %q", wantType)
		}
	}
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

// TestSnapshot_CreateAndList pushes 3 records, creates a snapshot via the
// service, then verifies GET /v1/snapshots returns the snapshot with the date
// and that snapshot_entries count matches.
func TestSnapshot_CreateAndList(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "snap-list@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-snap-list", Name: "SnapList"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	familyID := initFamily(t, env)

	// Push 3 records.
	recs := []any{validRecord(t, 10), validRecord(t, 10), validRecord(t, 10)}
	pushResult := pushRecords(t, env, recs)
	accepted, _ := pushResult["accepted"].([]any)
	require.Len(t, accepted, 3, "all 3 records must be accepted")

	// Create snapshot via service (atomically captures all 3 records).
	today := time.Now().UTC().Format("2006-01-02")
	snapID := createSnapshotForFamily(t, env, familyID, today)
	require.NotEmpty(t, snapID)

	// GET /v1/snapshots → should return the snapshot.
	resp := getReq(t, env.Client, env.Server.URL+"/v1/snapshots")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "list snapshots: %s", body)

	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	snapshots, _ := result["snapshots"].([]any)
	require.Len(t, snapshots, 1, "expect exactly 1 snapshot")

	snap := snapshots[0].(map[string]any)
	assert.Equal(t, today, snap["date"])

	// Verify snapshot_entries count in DB matches pushed records.
	dbCount := countRows(t, env.DB,
		`SELECT COUNT(*) FROM snapshot_entries WHERE snapshot_id = ?`, snapID,
	)
	assert.Equal(t, 3, dbCount, "snapshot_entries count must match pushed records")
}

// TestSnapshot_RestoreFromSnapshot pushes records A, B, C → snapshot →
// pushes D, E → restore → only A, B, C visible; D, E tombstoned.
func TestSnapshot_RestoreFromSnapshot(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "snap-restore@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-snap-restore", Name: "SnapRestore"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	familyID := initFamily(t, env)

	// Push A, B, C.
	recs := []any{validRecord(t, 8), validRecord(t, 8), validRecord(t, 8)}
	firstPush := pushRecords(t, env, recs)
	accepted1, _ := firstPush["accepted"].([]any)
	require.Len(t, accepted1, 3, "A/B/C must be accepted")

	// Create snapshot capturing A, B, C.
	today := time.Now().UTC().Format("2006-01-02")
	snapID := createSnapshotForFamily(t, env, familyID, today)
	require.NotEmpty(t, snapID)

	// Push D, E (additional records after snapshot).
	moreRecs := []any{validRecord(t, 8), validRecord(t, 8)}
	secondPush := pushRecords(t, env, moreRecs)
	accepted2, _ := secondPush["accepted"].([]any)
	require.Len(t, accepted2, 2, "D/E must be accepted")

	// Total before restore: 5 live records.
	liveCount := countRows(t, env.DB, `SELECT COUNT(*) FROM record_meta WHERE deleted_at IS NULL`)
	assert.Equal(t, 5, liveCount)

	// Restore via POST /v1/snapshots/{date}/restore?confirm=true.
	restoreResp := postJSON(t, env.Client,
		env.Server.URL+fmt.Sprintf("/v1/snapshots/%s/restore?confirm=true", today),
		nil,
	)
	restoreBody := readBody(t, restoreResp)
	require.Equal(t, http.StatusOK, restoreResp.StatusCode, "restore: %s", restoreBody)

	var restoreResult map[string]any
	require.NoError(t, json.Unmarshal(restoreBody, &restoreResult))
	assert.NotNil(t, restoreResult["newCursor"], "newCursor must be present")

	// After restore: only A,B,C live; D,E tombstoned.
	liveAfter := countRows(t, env.DB, `SELECT COUNT(*) FROM record_meta WHERE deleted_at IS NULL`)
	assert.Equal(t, 3, liveAfter, "only A/B/C should be live after restore")

	tombstoned := countRows(t, env.DB, `SELECT COUNT(*) FROM record_meta WHERE deleted_at IS NOT NULL`)
	assert.Equal(t, 2, tombstoned, "D/E should be tombstoned")

	// Pull from cursor 0: tombstoned records appear in pull (clients wipe them locally).
	pullReq, err := http.NewRequest(http.MethodGet, env.Server.URL+"/v1/sync/pull", nil)
	require.NoError(t, err)
	pullReq.Header.Set("X-Requested-With", "fetch")
	pullResp, err := env.Client.Do(pullReq)
	require.NoError(t, err)
	pullBody := readBody(t, pullResp)
	require.Equal(t, http.StatusOK, pullResp.StatusCode, "pull: %s", pullBody)

	var pullResult map[string]any
	require.NoError(t, json.Unmarshal(pullBody, &pullResult))
	records, _ := pullResult["records"].([]any)

	var liveInPull, deletedInPull int
	for _, r := range records {
		rec := r.(map[string]any)
		if rec["deletedAt"] != nil {
			deletedInPull++
		} else {
			liveInPull++
		}
	}
	assert.Equal(t, 3, liveInPull, "pull must show 3 live records")
	assert.Equal(t, 2, deletedInPull, "pull must show 2 tombstoned records")
}

// TestSnapshot_PruneExpiredSnapshots inserts a snapshot with expires_at < now,
// calls PruneExpiredSnapshots, and verifies it (and its entries) are removed.
func TestSnapshot_PruneExpiredSnapshots(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "snap-prune@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-snap-prune", Name: "SnapPrune"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	familyID := initFamily(t, env)

	// Push 1 record.
	pushRecords(t, env, []any{validRecord(t, 10)})

	// Insert an expired snapshot and its entry directly in DB.
	expiredID := newUUIDStr(t)
	expiredDate := "2020-01-01"
	_, err := env.DB.ExecContext(t.Context(),
		`INSERT INTO snapshots (id, family_id, snapshot_date, created_at, expires_at)
		 VALUES (?, ?, ?, datetime('now', '-1 year'), datetime('now', '-1 day'))`,
		expiredID, familyID, expiredDate,
	)
	require.NoError(t, err)

	// Snapshot entry for the expired snapshot (INSERT...SELECT avoids concurrent-cursor issue).
	_, err = env.DB.ExecContext(t.Context(),
		`INSERT INTO snapshot_entries (snapshot_id, record_id, blob_id, record_type, version, updated_at_map)
		 SELECT ?, record_id, blob_id, record_type, version, updated_at_map
		 FROM record_meta WHERE deleted_at IS NULL LIMIT 1`,
		expiredID,
	)
	require.NoError(t, err)

	// Verify they exist.
	require.Equal(t, 1, countRows(t, env.DB, `SELECT COUNT(*) FROM snapshots WHERE id = ?`, expiredID),
		"expired snapshot should exist before prune")
	require.Equal(t, 1, countRows(t, env.DB, `SELECT COUNT(*) FROM snapshot_entries WHERE snapshot_id = ?`, expiredID),
		"snapshot entry should exist before prune")

	// Insert a non-expired snapshot so we confirm it is NOT deleted.
	nonExpiredID := newUUIDStr(t)
	_, err = env.DB.ExecContext(t.Context(),
		`INSERT INTO snapshots (id, family_id, snapshot_date, created_at, expires_at)
		 VALUES (?, ?, '2099-01-01', datetime('now'), datetime('now', '+30 days'))`,
		nonExpiredID, familyID,
	)
	require.NoError(t, err)

	// Call PruneExpiredSnapshots via service directly.
	svc := newSnapshotService(env)
	require.NoError(t, svc.PruneExpiredSnapshots(t.Context()))

	// Expired snapshot and its entries must be gone.
	assert.Equal(t, 0, countRows(t, env.DB, `SELECT COUNT(*) FROM snapshots WHERE id = ?`, expiredID),
		"expired snapshot must be deleted")
	assert.Equal(t, 0, countRows(t, env.DB, `SELECT COUNT(*) FROM snapshot_entries WHERE snapshot_id = ?`, expiredID),
		"expired snapshot entries must be cascade-deleted")

	// Non-expired snapshot must remain.
	assert.Equal(t, 1, countRows(t, env.DB, `SELECT COUNT(*) FROM snapshots WHERE id = ?`, nonExpiredID),
		"non-expired snapshot must remain")
}

// TestSnapshot_PruneOrphanBlobs inserts a blob not referenced by record_meta
// or snapshot_entries, then verifies PruneOrphanBlobs removes it.
func TestSnapshot_PruneOrphanBlobs(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "snap-orphan@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-snap-orphan", Name: "SnapOrphan"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// Get family ID.
	var familyID string
	require.NoError(t, env.DB.QueryRowContext(t.Context(), `SELECT id FROM families LIMIT 1`).Scan(&familyID))

	// Push a real record (its blob must NOT be pruned).
	pushResult := pushRecords(t, env, []any{validRecord(t, 10)})
	accepted, _ := pushResult["accepted"].([]any)
	require.Len(t, accepted, 1)

	// Grab the referenced blob ID.
	var referencedBlobID string
	require.NoError(t, env.DB.QueryRowContext(t.Context(),
		`SELECT blob_id FROM record_meta WHERE deleted_at IS NULL LIMIT 1`,
	).Scan(&referencedBlobID))

	// Insert an orphan blob (not referenced by any record_meta or snapshot_entries).
	orphanBlobID := newUUIDStr(t)
	_, err := env.DB.ExecContext(t.Context(),
		`INSERT INTO blobs (id, family_id, ciphertext, byte_count, created_at)
		 VALUES (?, ?, ?, ?, datetime('now'))`,
		orphanBlobID, familyID, validBlob(10), 10,
	)
	require.NoError(t, err)

	// Verify it exists.
	require.Equal(t, 1, countRows(t, env.DB, `SELECT COUNT(*) FROM blobs WHERE id = ?`, orphanBlobID),
		"orphan blob should exist before prune")

	// Prune orphan blobs.
	svc := newSnapshotService(env)
	require.NoError(t, svc.PruneOrphanBlobs(t.Context()))

	// Orphan blob must be gone.
	assert.Equal(t, 0, countRows(t, env.DB, `SELECT COUNT(*) FROM blobs WHERE id = ?`, orphanBlobID),
		"orphan blob must be pruned")

	// Referenced blob must remain.
	assert.Equal(t, 1, countRows(t, env.DB, `SELECT COUNT(*) FROM blobs WHERE id = ?`, referencedBlobID),
		"referenced blob must not be pruned")
}

// TestSnapshot_RestoreEmitsBarrier opens an SSE stream, triggers a snapshot
// restore, and asserts a sync.barrier event arrives within 2 seconds.
func TestSnapshot_RestoreEmitsBarrier(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "snap-barrier@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-snap-barrier", Name: "SnapBarrier"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	familyID := initFamily(t, env)

	// Push a record and create a snapshot.
	pushRecords(t, env, []any{validRecord(t, 10)})
	today := time.Now().UTC().Format("2006-01-02")
	snapID := createSnapshotForFamily(t, env, familyID, today)
	require.NotEmpty(t, snapID)

	// Open SSE stream.
	evCh, closeSSE := openSSE(t, env.Client, env.Server.URL+"/v1/sync/live")
	defer closeSSE()

	// Give the SSE connection a moment to register in the hub.
	time.Sleep(50 * time.Millisecond)

	// Trigger restore.
	restoreResp := postJSON(t, env.Client,
		env.Server.URL+fmt.Sprintf("/v1/snapshots/%s/restore?confirm=true", today),
		nil,
	)
	restoreBody := readBody(t, restoreResp)
	require.Equal(t, http.StatusOK, restoreResp.StatusCode, "restore: %s", restoreBody)

	// Assert sync.barrier arrives within 2s.
	ev := receiveEvent(t, evCh, "sync.barrier", 2*time.Second)

	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(ev.Data), &payload))
	assert.Greater(t, payload["cursor"].(float64), float64(0), "sync.barrier cursor must be > 0")
}

// TestSnapshot_RestoreRequiresConfirm verifies that POST without ?confirm=true
// returns 400.
func TestSnapshot_RestoreRequiresConfirm(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "snap-noconfirm@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-snap-noconfirm", Name: "SnapNoConfirm"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	today := time.Now().UTC().Format("2006-01-02")

	// POST without ?confirm=true → must get 400.
	resp := postJSON(t, env.Client,
		env.Server.URL+fmt.Sprintf("/v1/snapshots/%s/restore", today),
		nil,
	)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "body: %s", body)
	assert.Equal(t, "confirm-required", problemTitle(t, body))
}

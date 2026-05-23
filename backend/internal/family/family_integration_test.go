//go:build integration

package family_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// --------------------------------------------------------------------------
// HTTP helpers (copied from auth integration_test.go pattern)
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

func getJSON(t *testing.T, client *http.Client, rawURL string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	require.NoError(t, err)
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

// addToAllowlist inserts email into the allowlist, creating a stub user first
// to satisfy the FK constraint.
func addToAllowlist(t *testing.T, db *sql.DB, email string) {
	t.Helper()
	ctx := context.Background()
	q := gen.New(db)
	now := time.Now().UTC().Format(time.RFC3339)

	user, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           newUUIDStr(t),
		Email:        email,
		DisplayName:  email,
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)

	allowed, err := q.IsEmailAllowed(ctx, email)
	require.NoError(t, err)
	if !allowed {
		require.NoError(t, q.AddAllowlistEntry(ctx, gen.AddAllowlistEntryParams{
			Email:   email,
			AddedBy: user.ID,
			AddedAt: now,
		}))
	}
}

func newUUIDStr(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

// validInitBody constructs a POST /v1/family/init request body with
// cryptographically valid-length (but random) blobs.
func validInitBody(t *testing.T) map[string]any {
	t.Helper()

	familyID := newUUIDStr(t)

	// 80-byte sealed-box envelope (libsodium constant).
	envelope := make([]byte, 80)
	// 49-byte minimum AEAD blobs.
	recoveryWrap := make([]byte, 49)
	phraseCt := make([]byte, 49)
	// 16-byte salt.
	salt := make([]byte, 16)

	return map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64.RawURLEncoding.EncodeToString(envelope),
		"recovery": map[string]any{
			"wrap":     base64.RawURLEncoding.EncodeToString(recoveryWrap),
			"phraseCt": base64.RawURLEncoding.EncodeToString(phraseCt),
			"salt":     base64.RawURLEncoding.EncodeToString(salt),
		},
	}
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

// TestFamilyInit_HappyPath exercises the full sign-in → /v1/family/init → /me
// flow and verifies DB rows and response shapes.
func TestFamilyInit_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice", Name: "Alice",
	}
	addToAllowlist(t, env.DB, "alice@example.com")

	base := env.Server.URL

	// 1. Sign in — brand-new user → needsFamilyInit must be true.
	signInResp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Alice Phone",
		"userAgent":   "TestAgent/1.0",
	})
	signInBody := readBody(t, signInResp)
	require.Equal(t, http.StatusOK, signInResp.StatusCode, "sign-in body: %s", signInBody)

	var signIn map[string]any
	require.NoError(t, json.Unmarshal(signInBody, &signIn))
	assert.Equal(t, true, signIn["needsFamilyInit"], "brand-new user must need family init")

	// 2. POST /v1/family/init with valid body → 200, echoes familyId.
	initBody := validInitBody(t)
	initResp := postJSON(t, env.Client, base+"/v1/family/init", initBody)
	initRespBody := readBody(t, initResp)
	require.Equal(t, http.StatusOK, initResp.StatusCode, "family init body: %s", initRespBody)

	var initResult map[string]any
	require.NoError(t, json.Unmarshal(initRespBody, &initResult))
	assert.Equal(t, initBody["familyId"], initResult["familyId"], "familyId must be echoed")

	// 3. Verify DB rows exist.
	ctx := context.Background()
	q := gen.New(env.DB)

	familyID := initBody["familyId"].(string)

	// families row.
	f, err := q.GetFamilyByID(ctx, familyID)
	require.NoError(t, err, "families row must exist")
	assert.Equal(t, familyID, f.ID)

	// family_members row with left_at IS NULL.
	signInUser, _ := signIn["user"].(map[string]any)
	userID, _ := signInUser["id"].(string)
	member, err := q.GetActiveFamilyMember(ctx, userID)
	require.NoError(t, err, "family_members row must exist")
	assert.Equal(t, familyID, member.FamilyID)
	assert.False(t, member.LeftAt.Valid, "left_at must be NULL")

	// device_envelopes row.
	row := env.DB.QueryRowContext(ctx, "SELECT device_id, family_id, version FROM device_envelopes WHERE family_id = ?", familyID)
	var devID, famID string
	var version int64
	require.NoError(t, row.Scan(&devID, &famID, &version))
	assert.Equal(t, familyID, famID)
	assert.Equal(t, int64(1), version, "envelope version must be 0x01")

	// family_recovery_envelopes row.
	recRow := env.DB.QueryRowContext(ctx, "SELECT family_id, version FROM family_recovery_envelopes WHERE family_id = ?", familyID)
	var recFamID string
	var recVersion int64
	require.NoError(t, recRow.Scan(&recFamID, &recVersion))
	assert.Equal(t, familyID, recFamID)
	assert.Equal(t, int64(1), recVersion, "recovery envelope version must be 0x01")

	// family_seq row.
	seqRow := env.DB.QueryRowContext(ctx, "SELECT family_id, next_seq FROM family_seq WHERE family_id = ?", familyID)
	var seqFamID string
	var nextSeq int64
	require.NoError(t, seqRow.Scan(&seqFamID, &nextSeq))
	assert.Equal(t, familyID, seqFamID)
	assert.Equal(t, int64(1), nextSeq, "next_seq must be seeded to 1")

	// 4. POST /v1/family/init again with the SAME familyId → 409.
	dupResp := postJSON(t, env.Client, base+"/v1/family/init", initBody)
	dupBody := readBody(t, dupResp)
	assert.Equal(t, http.StatusConflict, dupResp.StatusCode, "duplicate init must return 409: %s", dupBody)

	// 5. Sign in again — now needsFamilyInit must be false.
	authpkg.ClearSessionCache()
	signIn2Resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token-2",
		"deviceLabel": "Alice Phone 2",
		"userAgent":   "TestAgent/2.0",
	})
	signIn2Body := readBody(t, signIn2Resp)
	require.Equal(t, http.StatusOK, signIn2Resp.StatusCode, "second sign-in body: %s", signIn2Body)

	var signIn2 map[string]any
	require.NoError(t, json.Unmarshal(signIn2Body, &signIn2))
	assert.Equal(t, false, signIn2["needsFamilyInit"], "after family init, needsFamilyInit must be false")
}

// TestFamilyInit_GarbageBody verifies that a malformed JSON body returns 400.
func TestFamilyInit_GarbageBody(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob",
	}
	addToAllowlist(t, env.DB, "bob@example.com")

	base := env.Server.URL

	// Sign in first.
	signIn := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken": "tok", "deviceLabel": "Phone", "userAgent": "UA",
	})
	_ = readBody(t, signIn)
	require.Equal(t, http.StatusOK, signIn.StatusCode)

	// Send garbage body.
	req, err := http.NewRequest(http.MethodPost, base+"/v1/family/init", bytes.NewBufferString("not-json!!!"))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "fetch")
	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "garbage body: %s", body)
}

// TestFamilyInit_BadEnvelopeLength verifies that a deviceEnvelope of wrong
// length returns 400.
func TestFamilyInit_BadEnvelopeLength(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email: "carol@example.com", EmailVerified: true, Sub: "sub-carol",
	}
	addToAllowlist(t, env.DB, "carol@example.com")

	base := env.Server.URL

	// Sign in.
	signIn := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken": "tok", "deviceLabel": "Phone", "userAgent": "UA",
	})
	_ = readBody(t, signIn)
	require.Equal(t, http.StatusOK, signIn.StatusCode)

	// 32-byte envelope (too short — should be 80).
	shortEnvelope := make([]byte, 32)
	body := validInitBody(t)
	body["deviceEnvelope"] = base64.RawURLEncoding.EncodeToString(shortEnvelope)

	resp := postJSON(t, env.Client, base+"/v1/family/init", body)
	respBody := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "short envelope: %s", respBody)
}

//go:build integration

package sync_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// --------------------------------------------------------------------------
// HTTP helpers (same shape as family/auth integration tests)
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
// Test setup helpers
// --------------------------------------------------------------------------

// signIn signs in a user via POST /v1/auth/google and returns the parsed body.
func signIn(t *testing.T, env *testenv.Env, email string) map[string]any {
	t.Helper()
	base := env.Server.URL
	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Test Device",
		"userAgent":   "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

// initFamily calls POST /v1/family/init with a stub valid body.
func initFamily(t *testing.T, env *testenv.Env) string {
	t.Helper()
	base := env.Server.URL
	familyID := newUUIDStr(t)
	body := map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64.RawURLEncoding.EncodeToString(make([]byte, 80)),
		"recovery": map[string]any{
			"wrap":     base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"phraseCt": base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"salt":     base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
	}
	resp := postJSON(t, env.Client, base+"/v1/family/init", body)
	respBody := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "family/init: %s", respBody)
	return familyID
}

// addToAllowlist upserts the user and adds email to the allowlist.
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

func newUUIDStr(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

// validBlob builds a structurally valid blob: version byte 0x01, 24-byte nonce,
// 32-byte commit, 16-byte AEAD tag = 73 overhead + payloadLen extra bytes.
func validBlob(payloadLen int) []byte {
	b := make([]byte, 73+payloadLen)
	b[0] = 0x01 // version
	// remaining bytes stay zero — structurally valid, not cryptographically valid
	return b
}

// validRecord builds one pushRecord map with a fresh recordId.
// parentVersion=0 → new insert.
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

// pushRecords sends POST /v1/sync/push and returns the parsed response map.
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

// pullRecords calls GET /v1/sync/pull with since and limit params.
func pullRecords(t *testing.T, env *testenv.Env, since string, limit int) map[string]any {
	t.Helper()
	u := env.Server.URL + "/v1/sync/pull"
	if since != "" || limit > 0 {
		u += "?"
		if since != "" {
			u += "since=" + since
		}
		if limit > 0 {
			if since != "" {
				u += "&"
			}
			u += fmt.Sprintf("limit=%d", limit)
		}
	}
	resp := getReq(t, env.Client, u)
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "pull: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

// TestSync_RoundTrip_HappyPath signs in, inits a family, pushes 3 records,
// then pulls from cursor 0 and expects all 3 back in order with a valid cursor.
func TestSync_RoundTrip_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "alice@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-alice", Name: "Alice"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// Push 3 records.
	recs := []any{validRecord(t, 10), validRecord(t, 10), validRecord(t, 10)}
	pushResult := pushRecords(t, env, recs)

	accepted, _ := pushResult["accepted"].([]any)
	require.Len(t, accepted, 3, "all 3 records must be accepted")
	conflicts, _ := pushResult["conflicts"].([]any)
	assert.Len(t, conflicts, 0)

	// Each accepted record has version=1 and a positive familySeq.
	for i, a := range accepted {
		acc := a.(map[string]any)
		assert.Equal(t, float64(1), acc["version"], "record %d: version must be 1", i)
		assert.Greater(t, acc["familySeq"].(float64), float64(0), "record %d: familySeq must be > 0", i)
	}

	// Pull from cursor 0 → all 3 records, ordered by familySeq.
	pullResult := pullRecords(t, env, "", 0)

	records, _ := pullResult["records"].([]any)
	require.Len(t, records, 3, "pull must return 3 records")
	assert.Equal(t, false, pullResult["hasMore"], "hasMore must be false")

	nextCursor, _ := pullResult["nextCursor"].(string)
	assert.NotEmpty(t, nextCursor, "nextCursor must be non-empty")

	// Verify records come back with blob and version fields.
	for i, rec := range records {
		r := rec.(map[string]any)
		assert.NotEmpty(t, r["recordId"], "record %d: recordId missing", i)
		assert.Equal(t, float64(1), r["version"], "record %d: version must be 1", i)
		assert.NotEmpty(t, r["blob"], "record %d: blob missing", i)
		assert.Greater(t, r["familySeq"].(float64), float64(0), "record %d: familySeq must be > 0", i)
	}
}

// TestSync_CursorPagination pushes 6 records and verifies two paginated pulls.
func TestSync_CursorPagination(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "bob@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-bob", Name: "Bob"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// Push 6 records.
	recs := make([]any, 6)
	for i := range recs {
		recs[i] = validRecord(t, 5)
	}
	pushResult := pushRecords(t, env, recs)
	accepted, _ := pushResult["accepted"].([]any)
	require.Len(t, accepted, 6, "all 6 must be accepted")

	// Pull first page: limit=3.
	page1 := pullRecords(t, env, "", 3)
	page1Records, _ := page1["records"].([]any)
	require.Len(t, page1Records, 3, "first page must have 3 records")
	assert.Equal(t, true, page1["hasMore"], "first page: hasMore must be true")
	cursor1, _ := page1["nextCursor"].(string)
	require.NotEmpty(t, cursor1, "cursor after first page must not be empty")

	// Pull second page using cursor from first page.
	page2 := pullRecords(t, env, cursor1, 3)
	page2Records, _ := page2["records"].([]any)
	require.Len(t, page2Records, 3, "second page must have 3 records")
	assert.Equal(t, false, page2["hasMore"], "second page: hasMore must be false")

	// Verify no overlap: all familySeq values from page2 > all from page1.
	var page1Seqs, page2Seqs []float64
	for _, r := range page1Records {
		page1Seqs = append(page1Seqs, r.(map[string]any)["familySeq"].(float64))
	}
	for _, r := range page2Records {
		page2Seqs = append(page2Seqs, r.(map[string]any)["familySeq"].(float64))
	}
	maxPage1 := page1Seqs[len(page1Seqs)-1]
	minPage2 := page2Seqs[0]
	assert.Greater(t, minPage2, maxPage1, "page 2 sequences must be strictly after page 1")
}

// TestSync_ConflictOnStaleParentVersion pushes a record (version=1), then
// pushes the same recordId with parentVersion=0 → conflict.
func TestSync_ConflictOnStaleParentVersion(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "carol@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-carol", Name: "Carol"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// Push record (version 1).
	rec := validRecord(t, 8)
	recordID := rec["recordId"].(string)
	firstPush := pushRecords(t, env, []any{rec})
	accepted, _ := firstPush["accepted"].([]any)
	require.Len(t, accepted, 1)
	require.Equal(t, float64(1), accepted[0].(map[string]any)["version"])

	// Push same recordId again with parentVersion=0 (stale).
	blob2 := validBlob(12)
	staleRec := map[string]any{
		"recordId":           recordID,
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob2),
		"updatedAtMap":       map[string]string{"amount": "2024-02-01T00:00:00.000Z"},
		"parentVersion":      0, // stale — server has version=1
		"plaintextByteCount": int64(12),
	}
	conflictPush := pushRecords(t, env, []any{staleRec})

	accepted2, _ := conflictPush["accepted"].([]any)
	assert.Len(t, accepted2, 0, "stale push must not be accepted")
	conflicts, _ := conflictPush["conflicts"].([]any)
	require.Len(t, conflicts, 1, "must get 1 conflict")

	conflict := conflicts[0].(map[string]any)
	assert.Equal(t, recordID, conflict["recordId"])
	assert.Equal(t, float64(1), conflict["currentVersion"], "currentVersion must be 1")
	assert.NotEmpty(t, conflict["currentBlob"], "conflict must include current blob")
}

// TestSync_SuccessfulUpdate pushes a record then updates it with parentVersion=1.
func TestSync_SuccessfulUpdate(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "dave@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-dave", Name: "Dave"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// Insert record (version 1).
	rec := validRecord(t, 8)
	recordID := rec["recordId"].(string)
	firstPush := pushRecords(t, env, []any{rec})
	accepted, _ := firstPush["accepted"].([]any)
	require.Len(t, accepted, 1)
	seq1 := accepted[0].(map[string]any)["familySeq"].(float64)

	// Update with correct parentVersion=1.
	blob2 := validBlob(16)
	updateRec := map[string]any{
		"recordId":           recordID,
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob2),
		"updatedAtMap":       map[string]string{"amount": "2024-03-01T00:00:00.000Z"},
		"parentVersion":      1, // correct
		"plaintextByteCount": int64(16),
	}
	updatePush := pushRecords(t, env, []any{updateRec})

	accepted2, _ := updatePush["accepted"].([]any)
	require.Len(t, accepted2, 1, "update must be accepted")
	conflicts2, _ := updatePush["conflicts"].([]any)
	assert.Len(t, conflicts2, 0)

	result := accepted2[0].(map[string]any)
	assert.Equal(t, recordID, result["recordId"])
	assert.Equal(t, float64(2), result["version"], "version must advance to 2")
	seq2 := result["familySeq"].(float64)
	assert.Greater(t, seq2, seq1, "familySeq must advance after update")
}

// TestSync_BadBlobLength pushes a blob shorter than 73 bytes → 400.
func TestSync_BadBlobLength(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "eve@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-eve", Name: "Eve"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// 50-byte blob — below 73-byte overhead floor.
	shortBlob := make([]byte, 50)
	shortBlob[0] = 0x01
	rec := map[string]any{
		"recordId":           newUUIDStr(t),
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(shortBlob),
		"updatedAtMap":       map[string]string{},
		"parentVersion":      0,
		"plaintextByteCount": int64(0),
	}

	resp := postJSON(t, env.Client, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": []any{rec},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "body: %s", body)
	assert.Equal(t, "bad-request", problemTitle(t, body))
}

// TestSync_BadVersionByte pushes a blob whose first byte is not 0x01 → 400.
func TestSync_BadVersionByte(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "frank@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-frank", Name: "Frank"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// 73-byte blob with wrong version byte (0x02).
	badBlob := make([]byte, 73)
	badBlob[0] = 0x02
	rec := map[string]any{
		"recordId":           newUUIDStr(t),
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(badBlob),
		"updatedAtMap":       map[string]string{},
		"parentVersion":      0,
		"plaintextByteCount": int64(0),
	}

	resp := postJSON(t, env.Client, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": []any{rec},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "body: %s", body)
	assert.Equal(t, "bad-request", problemTitle(t, body))
}

// TestSync_QuotaExceeded bumps usage_bytes to just below the 200 MiB cap then
// pushes a small blob that crosses the limit → 413.
func TestSync_QuotaExceeded(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "grace@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-grace", Name: "Grace"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	familyID := initFamily(t, env)

	// Quota cap = 200 * 1024 * 1024 = 209715200.
	// Set usage_bytes to cap - 1 so a single 73-byte blob exceeds it.
	const quotaCap = 200 * 1024 * 1024
	_, err := env.DB.ExecContext(t.Context(),
		`UPDATE families SET usage_bytes = ? WHERE id = ?`,
		quotaCap-1, familyID,
	)
	require.NoError(t, err)

	// Push one minimal valid blob (73 bytes).
	blob := validBlob(0)
	rec := map[string]any{
		"recordId":           newUUIDStr(t),
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob),
		"updatedAtMap":       map[string]string{},
		"parentVersion":      0,
		"plaintextByteCount": int64(0),
	}

	resp := postJSON(t, env.Client, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": []any{rec},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode, "body: %s", body)
	assert.Equal(t, "quota-exceeded", problemTitle(t, body))
}

// TestSync_NoFamily tries to push without calling /v1/family/init → 403.
func TestSync_NoFamily(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "henry@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-henry", Name: "Henry"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	// NOTE: no initFamily call here.

	rec := validRecord(t, 8)
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": []any{rec},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode, "body: %s", body)
	assert.Equal(t, "family-required", problemTitle(t, body))
}

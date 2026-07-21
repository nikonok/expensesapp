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

// TestSync_BadVersionByte pushes a blob whose first byte is not a supported
// cipher-suite version (0x01 or 0x02) → 400.
func TestSync_BadVersionByte(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "frank@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-frank", Name: "Frank"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// 73-byte blob with an unsupported version byte (0x03).
	badBlob := make([]byte, 73)
	badBlob[0] = 0x03
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

// TestSync_AcceptsSuiteV2Blob pushes a blob whose first byte is 0x02 (the
// current client cipher-suite version) and expects it to be accepted.
func TestSync_AcceptsSuiteV2Blob(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "frank-v2@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-frank-v2", Name: "Frank V2"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	blob := make([]byte, 73+10)
	blob[0] = 0x02
	rec := map[string]any{
		"recordId":           newUUIDStr(t),
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob),
		"updatedAtMap":       map[string]string{"amount": "2024-01-01T00:00:00.000Z"},
		"parentVersion":      0,
		"plaintextByteCount": int64(10),
	}

	pushResult := pushRecords(t, env, []any{rec})
	accepted, _ := pushResult["accepted"].([]any)
	require.Len(t, accepted, 1, "0x02 suite blob must be accepted")
	conflicts, _ := pushResult["conflicts"].([]any)
	assert.Len(t, conflicts, 0)
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

// TestSync_NewRecordWithBadParentVersion pushes a brand-new record with
// parentVersion != 0. The server has no existing row for that recordId, so
// ErrInvalidParentVersion should be treated as a synthetic conflict
// (currentVersion=0) rather than propagated as HTTP 500.
func TestSync_NewRecordWithBadParentVersion(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "ivan@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-ivan", Name: "Ivan"}
	addToAllowlist(t, env, email)
	signIn(t, env, email)
	initFamily(t, env)

	// Push a brand-new record (no existing row) with parentVersion=5 — should
	// not exist on the server, so ErrInvalidParentVersion fires.
	blob := validBlob(10)
	badRec := map[string]any{
		"recordId":           newUUIDStr(t),
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blob),
		"updatedAtMap":       map[string]string{"amount": "2024-01-01T00:00:00.000Z"},
		"parentVersion":      5, // non-zero for a new record — invalid
		"plaintextByteCount": int64(10),
	}

	resp := postJSON(t, env.Client, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": []any{badRec},
	})
	body := readBody(t, resp)

	// Must be 200, not 500.
	assert.Equal(t, http.StatusOK, resp.StatusCode, "body: %s", body)

	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))

	accepted, _ := result["accepted"].([]any)
	assert.Len(t, accepted, 0, "bad-parentVersion record must not be accepted")

	conflicts, _ := result["conflicts"].([]any)
	require.Len(t, conflicts, 1, "must get 1 synthetic conflict")

	conflict := conflicts[0].(map[string]any)
	assert.Equal(t, badRec["recordId"], conflict["recordId"])
	assert.Equal(t, float64(0), conflict["currentVersion"], "currentVersion must be 0 (no existing row)")
}

// signInAs signs in the given client as email and returns the parsed body.
func signInAs(t *testing.T, client *http.Client, base, email string) map[string]any {
	t.Helper()
	resp := postJSON(t, client, base+"/v1/auth/google", map[string]any{
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

// initFamilyAs calls POST /v1/family/init using the given client.
func initFamilyAs(t *testing.T, client *http.Client, base string) string {
	t.Helper()
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
	resp := postJSON(t, client, base+"/v1/family/init", body)
	respBody := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "family/init: %s", respBody)
	return familyID
}

// pushRecordsAs sends POST /v1/sync/push using the given client.
func pushRecordsAs(t *testing.T, client *http.Client, base string, records []any) map[string]any {
	t.Helper()
	resp := postJSON(t, client, base+"/v1/sync/push", map[string]any{
		"records": records,
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "push: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

// pullRecordsAs calls GET /v1/sync/pull using the given client.
func pullRecordsAs(t *testing.T, client *http.Client, base string) map[string]any {
	t.Helper()
	resp := getReq(t, client, base+"/v1/sync/pull")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "pull: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

// TestSync_CrossFamilyRecordIDConflict proves family B cannot read or modify
// family A's record by pushing with A's recordId. Both families live in the
// SAME server/DB (env) but are unrelated: family A pushes a record; family B
// then pushes a "new" record using the SAME recordId. This must be rejected
// as a clean conflict — with no echo of family A's data — rather than either
// succeeding (data corruption/takeover) or leaking family A's currentBlob
// (data exfiltration).
func TestSync_CrossFamilyRecordIDConflict(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()
	base := env.Server.URL

	// Family A.
	clientA := env.Client
	emailA := "family-a@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: emailA, EmailVerified: true, Sub: "sub-family-a", Name: "Family A"}
	addToAllowlist(t, env, emailA)
	signInAs(t, clientA, base, emailA)
	initFamilyAs(t, clientA, base)

	// Family A pushes a record and remembers its recordId.
	recA := validRecord(t, 16)
	recordID := recA["recordId"].(string)
	pushA := pushRecordsAs(t, clientA, base, []any{recA})
	acceptedA, _ := pushA["accepted"].([]any)
	require.Len(t, acceptedA, 1)

	// Family B: a completely separate family/user in the SAME server/DB.
	clientB := env.NewClient()
	emailB := "family-b@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: emailB, EmailVerified: true, Sub: "sub-family-b", Name: "Family B"}
	addToAllowlist(t, env, emailB)
	signInAs(t, clientB, base, emailB)
	initFamilyAs(t, clientB, base)

	// Family B pushes a "new" record reusing family A's recordId.
	blobB := validBlob(20)
	hostileRec := map[string]any{
		"recordId":           recordID,
		"recordType":         "transaction",
		"blob":               base64.RawURLEncoding.EncodeToString(blobB),
		"updatedAtMap":       map[string]string{"amount": "2024-05-01T00:00:00.000Z"},
		"parentVersion":      0,
		"plaintextByteCount": int64(20),
	}
	pushB := pushRecordsAs(t, clientB, base, []any{hostileRec})

	acceptedB, _ := pushB["accepted"].([]any)
	assert.Len(t, acceptedB, 0, "family B must never be able to claim family A's recordId")
	conflictsB, _ := pushB["conflicts"].([]any)
	require.Len(t, conflictsB, 1)

	conflict := conflictsB[0].(map[string]any)
	assert.Equal(t, recordID, conflict["recordId"])
	assert.Equal(t, float64(0), conflict["currentVersion"], "must not echo family A's real version")
	assert.Empty(t, conflict["currentBlob"], "must NEVER echo family A's ciphertext to family B")

	// Confirm family A's record is untouched: family A can still pull it at version 1.
	pullA := pullRecordsAs(t, clientA, base)
	pulledRecords, _ := pullA["records"].([]any)
	require.Len(t, pulledRecords, 1, "family A's record must be unaffected")
	assert.Equal(t, float64(1), pulledRecords[0].(map[string]any)["version"], "family A's record version must be unchanged")
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

// TestSync_PendingDeviceCannotPushOrPull signs in a second device for a user
// who already has an active family — the new device is created 'pending'
// (awaiting an existing device to upload the family-key envelope) — and
// verifies both push and pull are rejected with 403, while the device's
// session itself remains otherwise valid.
func TestSync_PendingDeviceCannotPushOrPull(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	email := "pending-device@example.com"
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: "sub-pending-device", Name: "Pending Device"}
	addToAllowlist(t, env, email)

	// First device: active, initializes the family.
	signIn(t, env, email)
	initFamily(t, env)

	// Second device for the SAME user: created 'pending' because the user
	// already has an active family (see auth.PostGoogle).
	secondClient := env.NewClient()
	resp := postJSON(t, secondClient, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Second Device",
		"userAgent":   "TestAgent/2.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "second sign-in: %s", body)
	var signInResult map[string]any
	require.NoError(t, json.Unmarshal(body, &signInResult))
	assert.Equal(t, true, signInResult["awaitingEnvelope"], "second device must be pending, awaiting envelope")

	// Pending device: push must be rejected.
	rec := validRecord(t, 8)
	pushResp := postJSON(t, secondClient, env.Server.URL+"/v1/sync/push", map[string]any{
		"records": []any{rec},
	})
	pushBody := readBody(t, pushResp)
	assert.Equal(t, http.StatusForbidden, pushResp.StatusCode, "push body: %s", pushBody)
	assert.Equal(t, "device-not-active", problemTitle(t, pushBody))

	// Pending device: pull must be rejected.
	pullResp := getReq(t, secondClient, env.Server.URL+"/v1/sync/pull")
	pullBody := readBody(t, pullResp)
	assert.Equal(t, http.StatusForbidden, pullResp.StatusCode, "pull body: %s", pullBody)
	assert.Equal(t, "device-not-active", problemTitle(t, pullBody))

	// Pending device: snapshot restore must also be rejected — a device
	// still awaiting its family-key envelope must not be able to trigger a
	// restore that rolls back the whole family's live record state.
	restoreResp := postJSON(t, secondClient, env.Server.URL+"/v1/snapshots/2024-01-01/restore?confirm=true", nil)
	restoreBody := readBody(t, restoreResp)
	assert.Equal(t, http.StatusForbidden, restoreResp.StatusCode, "restore body: %s", restoreBody)
	assert.Equal(t, "device-not-active", problemTitle(t, restoreBody))
}

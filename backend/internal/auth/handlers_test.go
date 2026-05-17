package auth

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

// postJSON builds a POST request with a JSON body and the required CSRF header.
func postJSON(t *testing.T, path string, body any) *http.Request {
	t.Helper()
	b, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "fetch")
	return req
}

// problemTitle extracts the "title" field from an RFC 9457 body.
func problemTitleH(t *testing.T, body []byte) string {
	t.Helper()
	var p map[string]any
	require.NoError(t, json.Unmarshal(body, &p))
	v, _ := p["title"].(string)
	return v
}

// seedBootstrap writes a bootstrap_state row for email and adds it to the allowlist
// (using a minimal user stub so the FK on allowlist.added_by is satisfied).
func seedBootstrapAndAllowlist(t *testing.T, ctx context.Context, db *sql.DB, email string) {
	t.Helper()
	q := gen.New(db)
	now := time.Now().UTC().Format(time.RFC3339)

	require.NoError(t, q.UpsertBootstrapState(ctx, gen.UpsertBootstrapStateParams{
		BootstrapEmail: email,
		AppliedAt:      now,
	}))

	// Insert a stub user so the allowlist FK is satisfied.
	stub, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           mustUUID(t),
		Email:        email,
		DisplayName:  email,
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)

	require.NoError(t, q.AddAllowlistEntry(ctx, gen.AddAllowlistEntryParams{
		Email:   email,
		AddedBy: stub.ID,
		AddedAt: now,
	}))
}

// auditCountByAction returns the number of audit_log rows for the given action.
func auditCountByAction(t *testing.T, ctx context.Context, db *sql.DB, action string) int {
	t.Helper()
	row := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM audit_log WHERE action = ?", action)
	var n int
	require.NoError(t, row.Scan(&n))
	return n
}

// --------------------------------------------------------------------------
// TestPostGoogle_HappyPath
// --------------------------------------------------------------------------

func TestPostGoogle_HappyPath(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	seedBootstrapAndAllowlist(t, ctx, db, "user@example.com")

	v := &fakeVerifier{claims: &Claims{
		Email: "user@example.com", EmailVerified: true, Sub: "sub1", Name: "Test User",
	}}
	h := NewHandler(db, v)

	req := postJSON(t, "/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "My Phone",
		"userAgent":   "TestAgent/1.0",
	})
	rr := httptest.NewRecorder()
	h.PostGoogle(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.NotEmpty(t, rr.Header().Get("Set-Cookie"), "Set-Cookie must be present")

	var resp map[string]any
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))
	user, _ := resp["user"].(map[string]any)
	assert.Equal(t, "user@example.com", user["email"])
	assert.Equal(t, "Test User", user["displayName"])

	assert.Equal(t, 1, auditCountByAction(t, ctx, db, "auth.signin.success"))
}

// --------------------------------------------------------------------------
// TestPostGoogle_NotAllowed
// --------------------------------------------------------------------------

func TestPostGoogle_NotAllowed(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	// Bootstrap email is different — "notallowed@example.com" is not on allowlist.
	q := gen.New(db)
	require.NoError(t, q.UpsertBootstrapState(ctx, gen.UpsertBootstrapStateParams{
		BootstrapEmail: "root@example.com",
		AppliedAt:      time.Now().UTC().Format(time.RFC3339),
	}))

	v := &fakeVerifier{claims: &Claims{
		Email: "notallowed@example.com", EmailVerified: true, Sub: "sub2",
	}}
	h := NewHandler(db, v)

	req := postJSON(t, "/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Phone",
		"userAgent":   "Agent/1",
	})
	rr := httptest.NewRecorder()
	h.PostGoogle(rr, req)

	assert.Equal(t, http.StatusForbidden, rr.Code)
	assert.Equal(t, "email-not-allowed", problemTitleH(t, rr.Body.Bytes()))
	assert.Equal(t, 1, auditCountByAction(t, ctx, db, "auth.signin.fail"))
}

// --------------------------------------------------------------------------
// TestPostGoogle_InvalidIDToken
// --------------------------------------------------------------------------

func TestPostGoogle_InvalidIDToken(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	v := &fakeVerifier{err: ErrInvalidIDToken}
	h := NewHandler(db, v)

	req := postJSON(t, "/v1/auth/google", map[string]any{
		"idToken":     "bad-token",
		"deviceLabel": "Phone",
		"userAgent":   "Agent/1",
	})
	rr := httptest.NewRecorder()
	h.PostGoogle(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Equal(t, "invalid-id-token", problemTitleH(t, rr.Body.Bytes()))
	_ = ctx
}

// --------------------------------------------------------------------------
// TestPostGoogle_FirstUserBecomesRoot
// --------------------------------------------------------------------------

func TestPostGoogle_FirstUserBecomesRoot(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	bootstrapEmail := "founder@example.com"
	// bootstrap_state written — no allowlist entry yet (deferred per spec).
	q := gen.New(db)
	require.NoError(t, q.UpsertBootstrapState(ctx, gen.UpsertBootstrapStateParams{
		BootstrapEmail: bootstrapEmail,
		AppliedAt:      time.Now().UTC().Format(time.RFC3339),
	}))

	v := &fakeVerifier{claims: &Claims{
		Email: bootstrapEmail, EmailVerified: true, Sub: "sub-root",
	}}
	h := NewHandler(db, v)

	req := postJSON(t, "/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Founder Phone",
		"userAgent":   "Agent/1",
	})
	rr := httptest.NewRecorder()
	h.PostGoogle(rr, req)

	require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())

	// User should have is_root = 1.
	user, err := q.GetUserByEmail(ctx, bootstrapEmail)
	require.NoError(t, err)
	assert.Equal(t, int64(1), user.IsRoot)
	assert.Equal(t, int64(1), user.IsAdmin)

	// Email should have been auto-added to allowlist.
	allowed, err := q.IsEmailAllowed(ctx, bootstrapEmail)
	require.NoError(t, err)
	assert.True(t, allowed)

	// Response body should reflect root status.
	var resp map[string]any
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))
	u, _ := resp["user"].(map[string]any)
	assert.Equal(t, true, u["isRoot"])
}

// --------------------------------------------------------------------------
// TestPostSignout_RevokesSession
// --------------------------------------------------------------------------

func TestPostSignout_RevokesSession(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	seedBootstrapAndAllowlist(t, ctx, db, "user@example.com")

	// Sign in first to get a cookie + session.
	v := &fakeVerifier{claims: &Claims{
		Email: "user@example.com", EmailVerified: true, Sub: "sub-so",
	}}
	h := NewHandler(db, v)

	signInReq := postJSON(t, "/v1/auth/google", map[string]any{
		"idToken": "tok", "deviceLabel": "Phone", "userAgent": "UA",
	})
	signInRR := httptest.NewRecorder()
	h.PostGoogle(signInRR, signInReq)
	require.Equal(t, http.StatusOK, signInRR.Code)

	// Extract the session cookie.
	cookieHdr := signInRR.Header().Get("Set-Cookie")
	require.NotEmpty(t, cookieHdr)

	// Parse cookie value from the "Set-Cookie" header.
	cookieVal := ""
	for _, c := range signInRR.Result().Cookies() {
		if c.Name == "__Host-session" {
			cookieVal = c.Value
		}
	}
	require.NotEmpty(t, cookieVal, "session cookie must be present after sign-in")

	// Validate the session to get SessionInfo.
	now := time.Now().UTC()
	info, err := Validate(ctx, db, cookieVal, now)
	require.NoError(t, err)
	require.NotNil(t, info)

	// Build a signout request with the session context pre-populated (as if SessionMiddleware ran).
	signoutCtx := httpx.WithUserID(ctx, info.UserID)
	signoutCtx = httpx.WithDeviceID(signoutCtx, info.DeviceID)
	signoutCtx = httpx.WithSessionID(signoutCtx, info.SessionID)

	signoutReq := postJSON(t, "/v1/auth/signout", nil)
	signoutReq = signoutReq.WithContext(signoutCtx)
	signoutRR := httptest.NewRecorder()
	h.PostSignout(signoutRR, signoutReq)
	assert.Equal(t, http.StatusNoContent, signoutRR.Code)

	// Session must be invalid now.
	clearCache()
	_, err = Validate(ctx, db, cookieVal, now.Add(time.Second))
	assert.ErrorIs(t, err, ErrInvalidSession)
}

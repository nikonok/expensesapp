//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"database/sql"
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

	"github.com/nikonok/expensesapp/backend/internal/admin"
	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// --------------------------------------------------------------------------
// Shared HTTP helpers
// --------------------------------------------------------------------------

// postJSON sends a POST request with a JSON body and the CSRF header required
// by the server's CSRFHeaderGate middleware.
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

// getJSON sends a GET request.
func getJSON(t *testing.T, client *http.Client, rawURL string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	require.NoError(t, err)
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

// readBody reads and closes the response body.
func readBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return b
}

// problemTitle extracts the "title" field from an RFC 9457 problem body.
func problemTitle(t *testing.T, body []byte) string {
	t.Helper()
	var p map[string]any
	require.NoError(t, json.Unmarshal(body, &p))
	v, _ := p["title"].(string)
	return v
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

// auditCount returns the number of audit_log rows matching action.
func auditCount(t *testing.T, db *sql.DB, action string) int {
	t.Helper()
	row := db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM audit_log WHERE action = ?", action)
	var n int
	require.NoError(t, row.Scan(&n))
	return n
}

// newUUIDStr generates a UUID v7 string.
func newUUIDStr(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

// sessionClientFor creates a fresh independent HTTP client pre-seeded with
// the given session cookie value. Uses env.NewClient() so each call gets an
// isolated *http.Client (not the shared singleton from httptest.Server.Client()).
func sessionClientFor(t *testing.T, env *testenv.Env, cookieValue string) *http.Client {
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

// --------------------------------------------------------------------------
// Integration Tests
// --------------------------------------------------------------------------

// TestAuthFlow_SignInToMeToSignout exercises the full sign-in → GET /v1/me →
// sign-out flow end-to-end over a real HTTPS test server.
func TestAuthFlow_SignInToMeToSignout(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email: "a@b.com", EmailVerified: true, Sub: "google-sub-1", Name: "Alice",
	}
	addToAllowlist(t, env.DB, "a@b.com")

	base := env.Server.URL

	// 1. POST /v1/auth/google → 200, needsFamilyInit=true.
	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "My Phone",
		"userAgent":   "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in body: %s", body)

	var signInResp map[string]any
	require.NoError(t, json.Unmarshal(body, &signInResp))
	user, _ := signInResp["user"].(map[string]any)
	assert.Equal(t, "a@b.com", user["email"])
	assert.Equal(t, true, signInResp["needsFamilyInit"])

	// 2. GET /v1/me → 200 (cookie jar carries session cookie automatically).
	meResp := getJSON(t, env.Client, base+"/v1/me")
	meBody := readBody(t, meResp)
	require.Equal(t, http.StatusOK, meResp.StatusCode, "GET /v1/me body: %s", meBody)

	var me map[string]any
	require.NoError(t, json.Unmarshal(meBody, &me))
	meUser, _ := me["user"].(map[string]any)
	assert.Equal(t, "a@b.com", meUser["email"])

	// 3. POST /v1/auth/signout → 204.
	signoutResp := postJSON(t, env.Client, base+"/v1/auth/signout", nil)
	_ = readBody(t, signoutResp)
	assert.Equal(t, http.StatusNoContent, signoutResp.StatusCode)

	// Clear cache so the next Validate hits the DB and sees the revoked session.
	authpkg.ClearSessionCache()

	// 4. GET /v1/me → 401.
	me2Resp := getJSON(t, env.Client, base+"/v1/me")
	me2Body := readBody(t, me2Resp)
	assert.Equal(t, http.StatusUnauthorized, me2Resp.StatusCode, "body: %s", me2Body)
}

// TestAuthFlow_BootstrapEmailUserIsRoot verifies that signing in with the
// bootstrap email auto-promotes the user to root without a pre-existing allowlist entry.
func TestAuthFlow_BootstrapEmailUserIsRoot(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root", Name: "Root",
	}

	base := env.Server.URL

	// Sign in — the handler auto-creates the allowlist entry for the bootstrap email.
	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Root Phone",
		"userAgent":   "Agent/1",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in body: %s", body)

	ctx := context.Background()
	q := gen.New(env.DB)

	// DB: is_root = 1.
	dbUser, err := q.GetUserByEmail(ctx, "root@example.com")
	require.NoError(t, err)
	assert.Equal(t, int64(1), dbUser.IsRoot)

	// DB: allowlist entry exists.
	allowed, err := q.IsEmailAllowed(ctx, "root@example.com")
	require.NoError(t, err)
	assert.True(t, allowed)
}

// TestAuthFlow_NotOnAllowlist verifies that signing in with an email not on
// the allowlist returns 403 and writes an auth.signin.fail audit entry.
func TestAuthFlow_NotOnAllowlist(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Claims = &authpkg.Claims{
		Email: "stranger@example.com", EmailVerified: true, Sub: "sub-stranger",
	}

	base := env.Server.URL

	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Phone",
		"userAgent":   "Agent/1",
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	assert.Equal(t, "email-not-allowed", problemTitle(t, body))
	assert.Equal(t, 1, auditCount(t, env.DB, "auth.signin.fail"))
}

// TestAuthFlow_InvalidIDToken verifies that an invalid ID token returns 401
// with title "invalid-id-token".
func TestAuthFlow_InvalidIDToken(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	env.Verifier.Err = authpkg.ErrInvalidIDToken

	base := env.Server.URL

	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken":     "bad-token",
		"deviceLabel": "Phone",
		"userAgent":   "Agent/1",
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	assert.Equal(t, "invalid-id-token", problemTitle(t, body))
}

// TestSignoutAll_RevokesAllDevices verifies that POST /v1/auth/signout-all
// revokes sessions from all devices, including cookies from other devices.
func TestSignoutAll_RevokesAllDevices(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	// Mint two separate sessions for the same user email.
	cookieA, _, _ := env.MintSession(t, "multi@example.com")
	cookieB, _, _ := env.MintSession(t, "multi@example.com")

	base := env.Server.URL

	clientA := sessionClientFor(t, env, cookieA)
	clientB := sessionClientFor(t, env, cookieB)

	// Confirm clientA can reach /v1/me.
	meResp := getJSON(t, clientA, base+"/v1/me")
	meBody := readBody(t, meResp)
	require.Equal(t, http.StatusOK, meResp.StatusCode, "GET /v1/me body: %s", meBody)

	// POST /v1/auth/signout-all with clientA → 204.
	signoutAllResp := postJSON(t, clientA, base+"/v1/auth/signout-all", nil)
	_ = readBody(t, signoutAllResp)
	assert.Equal(t, http.StatusNoContent, signoutAllResp.StatusCode)

	// Clear cache so the DB state is authoritative on the next validate.
	authpkg.ClearSessionCache()

	// clientB's session should also be revoked → 401.
	me2Resp := getJSON(t, clientB, base+"/v1/me")
	me2Body := readBody(t, me2Resp)
	assert.Equal(t, http.StatusUnauthorized, me2Resp.StatusCode, "body: %s", me2Body)
}

// TestRevokeMyDevice verifies that one device can revoke another, causing
// the revoked device's session to become invalid.
func TestRevokeMyDevice(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	// Two devices for the same user.
	cookieA, _, _ := env.MintSession(t, "twodev@example.com")
	cookieB, _, deviceBID := env.MintSession(t, "twodev@example.com")

	base := env.Server.URL

	clientA := sessionClientFor(t, env, cookieA)
	clientB := sessionClientFor(t, env, cookieB)

	// Confirm clientA is authenticated.
	meResp := getJSON(t, clientA, base+"/v1/me")
	meBody := readBody(t, meResp)
	require.Equal(t, http.StatusOK, meResp.StatusCode, "GET /v1/me body: %s", meBody)

	// clientA revokes deviceB.
	revokeResp := postJSON(t, clientA, base+"/v1/me/devices/"+deviceBID+"/revoke", nil)
	revokeBody := readBody(t, revokeResp)
	assert.Equal(t, http.StatusNoContent, revokeResp.StatusCode, "revoke body: %s", revokeBody)

	// Clear session cache so Validate hits DB and sees the revoked session.
	authpkg.ClearSessionCache()

	// clientB should now be unauthorised.
	me2Resp := getJSON(t, clientB, base+"/v1/me")
	me2Body := readBody(t, me2Resp)
	assert.Equal(t, http.StatusUnauthorized, me2Resp.StatusCode, "body: %s", me2Body)
}

// TestBootstrap_Handoff verifies §8.13: calling EnsureBootstrap with a new email
// demotes the old root and promotes the new one, and writes a bootstrap.email.change
// audit entry.
func TestBootstrap_Handoff(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("a@x.com"))
	defer env.Close()

	ctx := context.Background()
	base := env.Server.URL

	// Sign in user A — A becomes root because env was bootstrapped with a@x.com.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "a@x.com", EmailVerified: true, Sub: "sub-a", Name: "UserA",
	}
	respA := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken": "tok-a", "deviceLabel": "Phone A", "userAgent": "UA",
	})
	bodyA := readBody(t, respA)
	require.Equal(t, http.StatusOK, respA.StatusCode, "sign-in A body: %s", bodyA)

	q := gen.New(env.DB)

	// Verify A is root.
	userA, err := q.GetUserByEmail(ctx, "a@x.com")
	require.NoError(t, err)
	require.Equal(t, int64(1), userA.IsRoot, "user A must be root after first sign-in")

	// Insert user B and add to allowlist so the handoff can promote B.
	now := time.Now().UTC().Format(time.RFC3339)
	userB, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           newUUIDStr(t),
		Email:        "b@x.com",
		DisplayName:  "UserB",
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	allowed, err := q.IsEmailAllowed(ctx, "b@x.com")
	require.NoError(t, err)
	if !allowed {
		require.NoError(t, q.AddAllowlistEntry(ctx, gen.AddAllowlistEntryParams{
			Email:   "b@x.com",
			AddedBy: userA.ID,
			AddedAt: now,
		}))
	}
	_ = userB

	// Simulate handoff by calling EnsureBootstrap with the new email.
	require.NoError(t, admin.EnsureBootstrap(ctx, env.DB, "b@x.com"))

	// A.is_root=0, A.is_admin=0.
	userAAfter, err := q.GetUserByEmail(ctx, "a@x.com")
	require.NoError(t, err)
	assert.Equal(t, int64(0), userAAfter.IsRoot, "user A must no longer be root after handoff")
	assert.Equal(t, int64(0), userAAfter.IsAdmin, "user A must no longer be admin after handoff")

	// B.is_root=1.
	userBAfter, err := q.GetUserByEmail(ctx, "b@x.com")
	require.NoError(t, err)
	assert.Equal(t, int64(1), userBAfter.IsRoot, "user B must be root after handoff")

	// Audit log has bootstrap.email.change row.
	assert.GreaterOrEqual(t, auditCount(t, env.DB, "bootstrap.email.change"), 1)
}

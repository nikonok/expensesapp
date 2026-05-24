//go:build integration

package admin_test

// admin_integration_test.go — HTTP integration tests for admin endpoints (Phase 10f).

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

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// --------------------------------------------------------------------------
// HTTP helpers (mirrors auth/integration_test.go)
// --------------------------------------------------------------------------

// postJSON sends a POST with a JSON body and the CSRF header.
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

// sessionClientFor creates an independent HTTP client pre-seeded with the
// given session cookie value.
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
// Shared helpers (mirrors auth integration_test.go helpers)
// --------------------------------------------------------------------------

// signInAdmin signs in a user with admin privileges. The caller must have
// already set env.Verifier.Claims to the correct values, and the user must
// already be on the allowlist (or be the bootstrap root).
func signInAdmin(t *testing.T, env *testenv.Env, email string) {
	t.Helper()
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Admin Phone",
		"userAgent":   "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in body: %s", body)
}

// signInUser signs in a non-admin user via the sign-in endpoint.
// The allowlist entry and verifier must be pre-configured by the caller.
func signInUser(t *testing.T, env *testenv.Env, client *http.Client, email string) {
	t.Helper()
	resp := postJSON(t, client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "User Phone",
		"userAgent":   "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in body: %s", body)
}

// seedAdminUser inserts a user row and promotes it to admin directly in the DB.
// Returns the user ID.
func seedAdminUser(t *testing.T, db *sql.DB, promoterID, email string) string {
	t.Helper()
	ctx := context.Background()
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

// addToAllowlistAdmin is a package-level helper for creating an allowlist entry.
func addToAllowlistAdmin(t *testing.T, db *sql.DB, email string) {
	t.Helper()
	ctx := context.Background()
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

// --------------------------------------------------------------------------
// TestAdmin_NonAdminGets403
// --------------------------------------------------------------------------

// TestAdmin_NonAdminGets403 verifies that a regular (non-admin) user hitting
// GET /v1/admin/users receives 403.
func TestAdmin_NonAdminGets403(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	// Sign in as a plain user (on allowlist, not admin).
	addToAllowlistAdmin(t, env.DB, "plain@example.com")
	env.Verifier.Claims = &authpkg.Claims{
		Email: "plain@example.com", EmailVerified: true, Sub: "sub-plain",
	}
	signInUser(t, env, env.Client, "plain@example.com")

	resp := getJSON(t, env.Client, env.Server.URL+"/v1/admin/users")
	body := readBody(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode, "body: %s", body)
}

// --------------------------------------------------------------------------
// TestAdmin_SuspendedAdminGets403
// --------------------------------------------------------------------------

// TestAdmin_SuspendedAdminGets403 verifies that an admin with suspended_at set
// is blocked before reaching the admin handler. The session middleware sees the
// suspended flag and returns 401 (ErrInvalidSession), which is enforced before
// RequireAdmin runs.
func TestAdmin_SuspendedAdminGets403(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	ctx := context.Background()
	q := gen.New(env.DB)

	// Sign in as root (bootstrap email auto-promotes).
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	// Find root user in DB.
	rootUser, err := q.GetUserByEmail(ctx, "root@example.com")
	require.NoError(t, err)

	// Seed a second user and promote them to admin.
	addToAllowlistAdmin(t, env.DB, "admin2@example.com")
	admin2ID := seedAdminUser(t, env.DB, rootUser.ID, "admin2@example.com")

	// Mint a session for admin2.
	cookie, _, _ := env.MintSession(t, "admin2@example.com")
	clientAdmin2 := sessionClientFor(t, env, cookie)

	// Verify admin2 can access the endpoint while active.
	resp := getJSON(t, clientAdmin2, env.Server.URL+"/v1/admin/users")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body: %s", body)

	// Suspend admin2 directly in DB.
	now := time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, q.MarkUserSuspended(ctx, gen.MarkUserSuspendedParams{
		SuspendedAt: sql.NullString{String: now, Valid: true},
		ID:          admin2ID,
	}))
	authpkg.ClearSessionCache()

	// Now admin2 must be blocked. The session middleware catches suspended_at before
	// RequireAdmin, so the response is 401 (session invalidated by suspended_at).
	resp2 := getJSON(t, clientAdmin2, env.Server.URL+"/v1/admin/users")
	body2 := readBody(t, resp2)
	assert.True(t, resp2.StatusCode == http.StatusForbidden || resp2.StatusCode == http.StatusUnauthorized,
		"suspended admin must get 4xx; got %d body: %s", resp2.StatusCode, body2)
	_ = admin2ID
}

// --------------------------------------------------------------------------
// TestAdmin_ListUsers
// --------------------------------------------------------------------------

// TestAdmin_ListUsers verifies that the bootstrap admin can GET /v1/admin/users
// and the response includes at least themselves with the required §8.14 fields.
func TestAdmin_ListUsers(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root", Name: "Root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	resp := getJSON(t, env.Client, env.Server.URL+"/v1/admin/users")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body: %s", body)

	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))

	items, ok := result["items"].([]any)
	require.True(t, ok, "response must have 'items' array")
	require.NotEmpty(t, items, "items must not be empty")

	// Find the root user entry.
	var rootEntry map[string]any
	for _, item := range items {
		u, _ := item.(map[string]any)
		if u["email"] == "root@example.com" {
			rootEntry = u
			break
		}
	}
	require.NotNil(t, rootEntry, "root user must appear in list")

	// Verify §8.14 required fields are present.
	for _, field := range []string{"id", "email", "displayName", "isAdmin", "isRoot",
		"storageUsagePct", "familyMemberCount", "deviceCount", "hasRecoveryCode", "deletePending"} {
		_, exists := rootEntry[field]
		assert.True(t, exists, "field %q must be present", field)
	}
	assert.Equal(t, true, rootEntry["isRoot"], "bootstrap user must be root")
}

// --------------------------------------------------------------------------
// TestAdmin_SuspendUnsuspend
// --------------------------------------------------------------------------

// TestAdmin_SuspendUnsuspend verifies that an admin can suspend user B (causing
// B's sessions to be revoked), and then unsuspend B (restoring access).
func TestAdmin_SuspendUnsuspend(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	// Mint a session for user B and confirm B can reach /v1/me.
	cookieB, userBID, _ := env.MintSession(t, "userb@example.com")
	clientB := sessionClientFor(t, env, cookieB)

	meResp := getJSON(t, clientB, env.Server.URL+"/v1/me")
	meBody := readBody(t, meResp)
	require.Equal(t, http.StatusOK, meResp.StatusCode, "pre-suspend /v1/me body: %s", meBody)

	// Admin suspends user B.
	suspendResp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/users/"+userBID+"/suspend", nil)
	suspendBody := readBody(t, suspendResp)
	assert.Equal(t, http.StatusNoContent, suspendResp.StatusCode, "suspend body: %s", suspendBody)

	// B's session must be revoked — /v1/me returns 401.
	authpkg.ClearSessionCache()
	meResp2 := getJSON(t, clientB, env.Server.URL+"/v1/me")
	meBody2 := readBody(t, meResp2)
	assert.Equal(t, http.StatusUnauthorized, meResp2.StatusCode, "post-suspend /v1/me body: %s", meBody2)

	// Admin unsuspends user B.
	unsuspendResp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/users/"+userBID+"/unsuspend", nil)
	unsuspendBody := readBody(t, unsuspendResp)
	assert.Equal(t, http.StatusNoContent, unsuspendResp.StatusCode, "unsuspend body: %s", unsuspendBody)

	// B needs a fresh session after unsuspend (old one was revoked during suspend).
	cookieB2, _, _ := env.MintSession(t, "userb@example.com")
	clientB2 := sessionClientFor(t, env, cookieB2)
	authpkg.ClearSessionCache()

	meResp3 := getJSON(t, clientB2, env.Server.URL+"/v1/me")
	meBody3 := readBody(t, meResp3)
	assert.Equal(t, http.StatusOK, meResp3.StatusCode, "post-unsuspend /v1/me body: %s", meBody3)
}

// --------------------------------------------------------------------------
// TestAdmin_AllowlistAdd
// --------------------------------------------------------------------------

// TestAdmin_AllowlistAdd verifies that an admin can add an email to the allowlist
// via POST /v1/admin/allowlist, that it appears in GET /v1/admin/allowlist, and
// that a new user with that email can subsequently sign in.
func TestAdmin_AllowlistAdd(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	const newEmail = "newbie@example.com"

	// POST /v1/admin/allowlist to add the email.
	addResp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/allowlist", map[string]any{
		"email": newEmail,
		"note":  "added in test",
	})
	addBody := readBody(t, addResp)
	assert.Equal(t, http.StatusNoContent, addResp.StatusCode, "add allowlist body: %s", addBody)

	// GET /v1/admin/allowlist — email must appear.
	listResp := getJSON(t, env.Client, env.Server.URL+"/v1/admin/allowlist")
	listBody := readBody(t, listResp)
	require.Equal(t, http.StatusOK, listResp.StatusCode, "list allowlist body: %s", listBody)

	var listResult map[string]any
	require.NoError(t, json.Unmarshal(listBody, &listResult))
	items, _ := listResult["items"].([]any)
	found := false
	for _, item := range items {
		entry, _ := item.(map[string]any)
		if entry["email"] == newEmail {
			found = true
			break
		}
	}
	assert.True(t, found, "new email must appear in allowlist items; got: %s", listBody)

	// A new user with that email can sign in.
	env.Verifier.Claims = &authpkg.Claims{
		Email: newEmail, EmailVerified: true, Sub: "sub-newbie",
	}
	newClient := env.NewClient()
	signInUser(t, env, newClient, newEmail)
}

// --------------------------------------------------------------------------
// TestAdmin_PromoteDemote
// --------------------------------------------------------------------------

// TestAdmin_PromoteDemote verifies that the bootstrap root can promote user B
// to admin, and then demote B back to a regular user.
func TestAdmin_PromoteDemote(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	ctx := context.Background()
	q := gen.New(env.DB)

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	// Seed user B (not admin).
	addToAllowlistAdmin(t, env.DB, "userb@example.com")
	_, userBID, _ := env.MintSession(t, "userb@example.com")

	// Promote B.
	promoteResp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/admins/"+userBID+"/promote", nil)
	promoteBody := readBody(t, promoteResp)
	assert.Equal(t, http.StatusNoContent, promoteResp.StatusCode, "promote body: %s", promoteBody)

	// Verify B is admin in DB.
	userB, err := q.GetUserByID(ctx, userBID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), userB.IsAdmin, "B must be admin after promote")

	// Demote B.
	demoteResp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/admins/"+userBID+"/demote", nil)
	demoteBody := readBody(t, demoteResp)
	assert.Equal(t, http.StatusNoContent, demoteResp.StatusCode, "demote body: %s", demoteBody)

	// Verify B is no longer admin.
	userBAfter, err := q.GetUserByID(ctx, userBID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), userBAfter.IsAdmin, "B must not be admin after demote")
}

// --------------------------------------------------------------------------
// TestAdmin_DemoteOutsideSubtree
// --------------------------------------------------------------------------

// TestAdmin_DemoteOutsideSubtree verifies §8.13: admin Z cannot demote admin Y
// when Y is not in Z's subtree.
func TestAdmin_DemoteOutsideSubtree(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	ctx := context.Background()
	q := gen.New(env.DB)

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	// Get root user ID.
	rootUser, err := q.GetUserByEmail(ctx, "root@example.com")
	require.NoError(t, err)

	// Promote X (admin X will be in root's subtree, promoter = root).
	addToAllowlistAdmin(t, env.DB, "adminx@example.com")
	adminXID := seedAdminUser(t, env.DB, rootUser.ID, "adminx@example.com")

	// Promote Y (admin Y also in root's subtree, promoter = root).
	addToAllowlistAdmin(t, env.DB, "adminy@example.com")
	adminYID := seedAdminUser(t, env.DB, rootUser.ID, "adminy@example.com")

	// Mint a session for admin X and sign in.
	cookieX, _, _ := env.MintSession(t, "adminx@example.com")
	clientX := sessionClientFor(t, env, cookieX)

	// Admin X tries to demote Y — Y is NOT in X's subtree (Y was promoted by root,
	// not by X), so this must return 403.
	demoteResp := postJSON(t, clientX, env.Server.URL+"/v1/admin/admins/"+adminYID+"/demote", nil)
	demoteBody := readBody(t, demoteResp)
	assert.Equal(t, http.StatusForbidden, demoteResp.StatusCode,
		"X must not demote Y (outside subtree); body: %s", demoteBody)

	_ = adminXID
}

// --------------------------------------------------------------------------
// TestAdmin_AuditList
// --------------------------------------------------------------------------

// TestAdmin_AuditList verifies that after the bootstrap admin performs an action
// (adding to allowlist), GET /v1/admin/audit returns at least one entry ordered
// by recency.
func TestAdmin_AuditList(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	// Perform an admin action to generate an audit entry.
	addResp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/allowlist", map[string]any{
		"email": "audit-target@example.com",
	})
	_ = readBody(t, addResp)
	require.Equal(t, http.StatusNoContent, addResp.StatusCode)

	// GET /v1/admin/audit.
	auditResp := getJSON(t, env.Client, env.Server.URL+"/v1/admin/audit")
	auditBody := readBody(t, auditResp)
	require.Equal(t, http.StatusOK, auditResp.StatusCode, "audit body: %s", auditBody)

	var auditResult map[string]any
	require.NoError(t, json.Unmarshal(auditBody, &auditResult))

	items, ok := auditResult["items"].([]any)
	require.True(t, ok, "response must have 'items' array")
	require.NotEmpty(t, items, "audit log must have at least one entry")

	// The most recent entry should be for the allowlist.add action.
	first, _ := items[0].(map[string]any)
	assert.Equal(t, "allowlist.add", first["action"], "first item must be the allowlist.add action")

	// Verify required fields.
	for _, field := range []string{"id", "action", "createdAt"} {
		_, exists := first[field]
		assert.True(t, exists, "audit entry must have %q field", field)
	}
}

// --------------------------------------------------------------------------
// TestAdmin_CannotSuspendSelf
// --------------------------------------------------------------------------

// TestAdmin_CannotSuspendSelf verifies that an admin cannot suspend themselves.
func TestAdmin_CannotSuspendSelf(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t, testenv.WithBootstrapEmail("root@example.com"))
	defer env.Close()

	// Sign in as root.
	env.Verifier.Claims = &authpkg.Claims{
		Email: "root@example.com", EmailVerified: true, Sub: "sub-root",
	}
	signInAdmin(t, env, "root@example.com")
	authpkg.ClearSessionCache()

	// Get root user ID.
	ctx := context.Background()
	q := gen.New(env.DB)
	rootUser, err := q.GetUserByEmail(ctx, "root@example.com")
	require.NoError(t, err)

	// Root tries to suspend themselves — must return 400 cannot-suspend-self.
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/admin/users/"+rootUser.ID+"/suspend", nil)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode,
		"admin must not suspend self; body: %s", body)

	var errResp map[string]any
	require.NoError(t, json.Unmarshal(body, &errResp))
	assert.Equal(t, "cannot-suspend-self", errResp["title"], "error title must be cannot-suspend-self")
}

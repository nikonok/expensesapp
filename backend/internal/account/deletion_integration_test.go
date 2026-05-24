//go:build integration

package account_test

// deletion_integration_test.go — HTTP integration tests for account deletion
// and log upload endpoints (Phase 11).

import (
	"bytes"
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
	require.Equal(t, http.StatusOK, resp2.StatusCode, "cancel: %s", body2)

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

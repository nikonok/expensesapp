//go:build integration

package push_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

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

func patchJSON(t *testing.T, client *http.Client, rawURL string, body any) *http.Response {
	t.Helper()
	b, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPatch, rawURL, bytes.NewReader(b))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "fetch")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

func deleteReq(t *testing.T, client *http.Client, rawURL string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, rawURL, nil)
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

// addToAllowlist inserts a user stub and allowlist entry so sign-in succeeds.
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

// signIn drives the Google sign-in flow to set the session cookie in the client's jar.
func signIn(t *testing.T, env *testenv.Env, client *http.Client, email string) {
	t.Helper()
	env.Verifier.Claims = &authpkg.Claims{
		Email:         email,
		EmailVerified: true,
		Sub:           "sub-" + email,
		Name:          email,
	}
	env.Verifier.Err = nil
	resp := postJSON(t, client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "fake-token",
		"deviceLabel": "Test Device",
		"userAgent":   "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in failed: %s", body)
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

func TestPushSubscribe(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env, "alice@example.com")

	client := env.NewClient()
	signIn(t, env, client, "alice@example.com")

	base := env.Server.URL

	t.Run("subscribe and get id", func(t *testing.T) {
		body := map[string]string{
			"endpoint": "https://fcm.example.com/push/sub1",
			"p256dh":   "BGa0YJeaVoRZvCE9oaRTgXNa3B3Ixgh1AAx2dOaOe5OqkKvBRkBNWTIHblsUjyFyVKYPfQvLyuTLV8E9BdnSf7M",
			"auth":     "zqbxT6JKstKSY9JKibZLSA",
		}
		resp := postJSON(t, client, base+"/v1/push/subscribe", body)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusCreated, resp.StatusCode)

		var out map[string]string
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
		assert.NotEmpty(t, out["id"])
	})

	t.Run("subscribe requires auth", func(t *testing.T) {
		unauthClient := env.NewClient()
		body := map[string]string{
			"endpoint": "https://fcm.example.com/push/sub2",
			"p256dh":   "BGa0YJeaVoRZvCE9oaRTgXNa3B3Ixgh1AAx2dOaOe5OqkKvBRkBNWTIHblsUjyFyVKYPfQvLyuTLV8E9BdnSf7M",
			"auth":     "zqbxT6JKstKSY9JKibZLSA",
		}
		resp := postJSON(t, unauthClient, base+"/v1/push/subscribe", body)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})
}

func TestPushSubscribeDelete(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env, "bob@example.com")
	client := env.NewClient()
	signIn(t, env, client, "bob@example.com")

	base := env.Server.URL

	// Create a subscription.
	body := map[string]string{
		"endpoint": "https://fcm.example.com/push/sub-del",
		"p256dh":   "BGa0YJeaVoRZvCE9oaRTgXNa3B3Ixgh1AAx2dOaOe5OqkKvBRkBNWTIHblsUjyFyVKYPfQvLyuTLV8E9BdnSf7M",
		"auth":     "zqbxT6JKstKSY9JKibZLSA",
	}
	resp := postJSON(t, client, base+"/v1/push/subscribe", body)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var out map[string]string
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	resp.Body.Close()
	subID := out["id"]
	require.NotEmpty(t, subID)

	// Delete it.
	delResp := deleteReq(t, client, base+"/v1/push/subscribe/"+subID)
	delResp.Body.Close()
	assert.Equal(t, http.StatusNoContent, delResp.StatusCode)
}

func TestNotificationSettings(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env, "carol@example.com")
	client := env.NewClient()
	signIn(t, env, client, "carol@example.com")

	base := env.Server.URL

	t.Run("GET creates defaults", func(t *testing.T) {
		resp := getReq(t, client, base+"/v1/notifications/settings")
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var out map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
		resp.Body.Close()
		assert.Equal(t, "UTC", out["tz"])
		assert.Equal(t, "23:00", out["quietStart"])
		assert.Equal(t, "07:00", out["quietEnd"])
		assert.Equal(t, true, out["dailyReminder"])
		assert.Equal(t, false, out["familyDigest"])
	})

	t.Run("PATCH updates fields", func(t *testing.T) {
		patch := map[string]any{
			"tz":           "Europe/London",
			"reminderTime": "08:30",
			"familyDigest": true,
		}
		resp := patchJSON(t, client, base+"/v1/notifications/settings", patch)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var out map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
		resp.Body.Close()
		assert.Equal(t, "Europe/London", out["tz"])
		assert.Equal(t, "08:30", out["reminderTime"])
		assert.Equal(t, true, out["familyDigest"])
	})

	t.Run("PATCH persists and re-reads", func(t *testing.T) {
		resp := getReq(t, client, base+"/v1/notifications/settings")
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var out map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
		resp.Body.Close()
		assert.Equal(t, "Europe/London", out["tz"])
		assert.Equal(t, "08:30", out["reminderTime"])
	})

	t.Run("PATCH rejects invalid tz", func(t *testing.T) {
		patch := map[string]any{"tz": "NotATimezone"}
		resp := patchJSON(t, client, base+"/v1/notifications/settings", patch)
		resp.Body.Close()
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("PATCH rejects invalid reminderTime", func(t *testing.T) {
		patch := map[string]any{"reminderTime": "9:5"}
		resp := patchJSON(t, client, base+"/v1/notifications/settings", patch)
		resp.Body.Close()
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("PATCH allows empty reminderTime to disable", func(t *testing.T) {
		patch := map[string]any{"reminderTime": ""}
		resp := patchJSON(t, client, base+"/v1/notifications/settings", patch)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var out map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
		resp.Body.Close()
		assert.Equal(t, "", out["reminderTime"])
	})
}

func TestPushSubscribeDelete_OtherUserBlocked(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env, "owner@example.com")
	addToAllowlist(t, env, "other@example.com")

	ownerClient := env.NewClient()
	signIn(t, env, ownerClient, "owner@example.com")

	otherClient := env.NewClient()
	signIn(t, env, otherClient, "other@example.com")

	base := env.Server.URL

	// Owner creates a subscription.
	body := map[string]string{
		"endpoint": "https://fcm.example.com/push/owner-sub",
		"p256dh":   "BGa0YJeaVoRZvCE9oaRTgXNa3B3Ixgh1AAx2dOaOe5OqkKvBRkBNWTIHblsUjyFyVKYPfQvLyuTLV8E9BdnSf7M",
		"auth":     "zqbxT6JKstKSY9JKibZLSA",
	}
	resp := postJSON(t, ownerClient, base+"/v1/push/subscribe", body)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var out map[string]string
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	resp.Body.Close()
	subID := out["id"]
	require.NotEmpty(t, subID)

	// Other user attempts to delete owner's subscription — must get 404.
	delResp := deleteReq(t, otherClient, base+"/v1/push/subscribe/"+subID)
	delResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, delResp.StatusCode)

	// Owner can still delete their own subscription.
	ownerDelResp := deleteReq(t, ownerClient, base+"/v1/push/subscribe/"+subID)
	ownerDelResp.Body.Close()
	assert.Equal(t, http.StatusNoContent, ownerDelResp.StatusCode)
}

func TestNotificationDismiss(t *testing.T) {
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env, "dave@example.com")
	client := env.NewClient()
	signIn(t, env, client, "dave@example.com")

	base := env.Server.URL

	body := map[string]string{"notificationId": "ntf-abc-123"}
	resp := postJSON(t, client, base+"/v1/notifications/dismiss", body)
	resp.Body.Close()
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
}

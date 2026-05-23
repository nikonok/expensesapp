//go:build integration

package auth_test

// reauth_integration_test.go — integration tests for the reauth challenge/verify
// endpoints (POST /v1/reauth/challenge, POST /v1/reauth/verify).

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// signInAndGetBase returns a signed-in env with base URL, using a fresh client.
func signInUserForReauth(t *testing.T, env *testenv.Env, email, sub string) {
	t.Helper()
	addToAllowlist(t, env.DB, email)
	env.Verifier.Claims = &authpkg.Claims{
		Email: email, EmailVerified: true, Sub: sub, Name: "Test User",
	}
	resp := postJSON(t, env.Client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken":     "tok",
		"deviceLabel": "Phone",
		"userAgent":   "UA/1",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in body: %s", body)
}

// TestReauthChallenge_HappyPath verifies that a signed-in user can obtain a nonce.
func TestReauthChallenge_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	signInUserForReauth(t, env, "alice@example.com", "sub-alice")

	resp := postJSON(t, env.Client, env.Server.URL+"/v1/reauth/challenge", nil)
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "challenge body: %s", body)

	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	nonce, _ := result["nonce"].(string)
	expiresAt, _ := result["expiresAt"].(string)
	assert.NotEmpty(t, nonce, "nonce must be non-empty")
	assert.NotEmpty(t, expiresAt, "expiresAt must be non-empty")
}

// TestReauthChallenge_Unauthenticated verifies that missing session → 401.
func TestReauthChallenge_Unauthenticated(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	// Use a fresh client with no cookie.
	client := env.NewClient()
	resp := postJSON(t, client, env.Server.URL+"/v1/reauth/challenge", nil)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode, "body: %s", body)
}

// TestReauthVerify_HappyPath verifies the full challenge → verify flow, including
// that the grant is returned and a second verify with the same nonce fails.
func TestReauthVerify_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const email = "bob@example.com"
	const sub = "sub-bob"
	signInUserForReauth(t, env, email, sub)

	base := env.Server.URL

	// Set verifier for upcoming verify call.
	env.Verifier.Claims = &authpkg.Claims{
		Email: email, EmailVerified: true, Sub: sub,
	}

	// 1. Obtain a nonce.
	challengeResp := postJSON(t, env.Client, base+"/v1/reauth/challenge", nil)
	challengeBody := readBody(t, challengeResp)
	require.Equal(t, http.StatusOK, challengeResp.StatusCode, "challenge body: %s", challengeBody)

	var challenge map[string]any
	require.NoError(t, json.Unmarshal(challengeBody, &challenge))
	nonce := challenge["nonce"].(string)

	// 2. Verify with valid nonce + fresh idToken → 200, returns grantId.
	verifyResp := postJSON(t, env.Client, base+"/v1/reauth/verify", map[string]any{
		"nonce":   nonce,
		"idToken": "fresh-id-token",
	})
	verifyBody := readBody(t, verifyResp)
	require.Equal(t, http.StatusOK, verifyResp.StatusCode, "verify body: %s", verifyBody)

	var verifyResult map[string]any
	require.NoError(t, json.Unmarshal(verifyBody, &verifyResult))
	grantID, _ := verifyResult["grantId"].(string)
	assert.NotEmpty(t, grantID, "grantId must be non-empty")
	assert.NotEmpty(t, verifyResult["expiresAt"], "expiresAt must be non-empty")

	// 3. A second verify with the same (now used) nonce → 401.
	authpkg.ClearSessionCache()
	verifyResp2 := postJSON(t, env.Client, base+"/v1/reauth/verify", map[string]any{
		"nonce":   nonce,
		"idToken": "fresh-id-token-2",
	})
	verifyBody2 := readBody(t, verifyResp2)
	assert.Equal(t, http.StatusUnauthorized, verifyResp2.StatusCode, "second verify body: %s", verifyBody2)
}

// TestReauthVerify_WrongSub verifies that a token whose sub doesn't match the
// user's google_sub returns 401 with "invalid-id-token".
func TestReauthVerify_WrongSub(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const email = "carol@example.com"
	signInUserForReauth(t, env, email, "sub-carol")

	base := env.Server.URL

	// Obtain nonce.
	challengeResp := postJSON(t, env.Client, base+"/v1/reauth/challenge", nil)
	challengeBody := readBody(t, challengeResp)
	require.Equal(t, http.StatusOK, challengeResp.StatusCode)

	var challenge map[string]any
	require.NoError(t, json.Unmarshal(challengeBody, &challenge))
	nonce := challenge["nonce"].(string)

	// Set verifier to return a DIFFERENT sub.
	env.Verifier.Claims = &authpkg.Claims{
		Email: email, EmailVerified: true, Sub: "sub-evil-twin",
	}

	verifyResp := postJSON(t, env.Client, base+"/v1/reauth/verify", map[string]any{
		"nonce":   nonce,
		"idToken": "fake-token",
	})
	verifyBody := readBody(t, verifyResp)
	assert.Equal(t, http.StatusUnauthorized, verifyResp.StatusCode, "body: %s", verifyBody)
	assert.Equal(t, "invalid-id-token", problemTitle(t, verifyBody))
}

// TestReauthVerify_UnknownNonce verifies that an unknown nonce returns 401.
func TestReauthVerify_UnknownNonce(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	signInUserForReauth(t, env, "dave@example.com", "sub-dave")

	env.Verifier.Claims = &authpkg.Claims{
		Email: "dave@example.com", EmailVerified: true, Sub: "sub-dave",
	}

	resp := postJSON(t, env.Client, env.Server.URL+"/v1/reauth/verify", map[string]any{
		"nonce":   "00000000-0000-0000-0000-000000000000",
		"idToken": "tok",
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode, "body: %s", body)
}

// TestReauthVerify_MissingFields verifies that missing nonce or idToken → 400.
func TestReauthVerify_MissingFields(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	signInUserForReauth(t, env, "eve@example.com", "sub-eve")
	base := env.Server.URL

	resp := postJSON(t, env.Client, base+"/v1/reauth/verify", map[string]any{
		"nonce": "some-nonce",
		// idToken is missing
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "body: %s", body)
}

// TestRecoveryReveal_HappyPath tests the full reauth → reveal flow:
// 1. Sign in, init a family.
// 2. Reauth challenge + verify → grantId.
// 3. POST /v1/account/recovery/reveal with X-Reauth-Grant → 200 with phraseCt + saltB64.
// 4. A second reveal with the same (used) grantId → 401.
func TestRecoveryReveal_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const email = "frank@example.com"
	const sub = "sub-frank"

	addToAllowlist(t, env.DB, email)
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: sub, Name: "Frank"}

	base := env.Server.URL

	// 1. Sign in.
	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken": "tok", "deviceLabel": "Phone", "userAgent": "UA",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = readBody(t, resp)

	// 2. POST /v1/family/init to create a recovery envelope.
	recoveryWrap := make([]byte, 49)
	phraseCt := make([]byte, 49)
	salt := make([]byte, 16)
	deviceEnv := make([]byte, 80)

	familyID := newUUIDStr(t)
	initResp := postJSON(t, env.Client, base+"/v1/family/init", map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64.RawURLEncoding.EncodeToString(deviceEnv),
		"recovery": map[string]any{
			"wrap":     base64.RawURLEncoding.EncodeToString(recoveryWrap),
			"phraseCt": base64.RawURLEncoding.EncodeToString(phraseCt),
			"salt":     base64.RawURLEncoding.EncodeToString(salt),
		},
	})
	initBody := readBody(t, initResp)
	require.Equal(t, http.StatusOK, initResp.StatusCode, "family init body: %s", initBody)

	// 3. Reauth: challenge.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: sub}
	challengeResp := postJSON(t, env.Client, base+"/v1/reauth/challenge", nil)
	challengeBody := readBody(t, challengeResp)
	require.Equal(t, http.StatusOK, challengeResp.StatusCode, "challenge body: %s", challengeBody)

	var challengeResult map[string]any
	require.NoError(t, json.Unmarshal(challengeBody, &challengeResult))
	nonce := challengeResult["nonce"].(string)

	// 4. Reauth: verify.
	verifyResp := postJSON(t, env.Client, base+"/v1/reauth/verify", map[string]any{
		"nonce":   nonce,
		"idToken": "fresh-tok",
	})
	verifyBody := readBody(t, verifyResp)
	require.Equal(t, http.StatusOK, verifyResp.StatusCode, "verify body: %s", verifyBody)

	var verifyResult map[string]any
	require.NoError(t, json.Unmarshal(verifyBody, &verifyResult))
	grantID := verifyResult["grantId"].(string)

	// 5. POST /v1/account/recovery/reveal with grant header → 200.
	revealReq, err := http.NewRequest(http.MethodPost, base+"/v1/account/recovery/reveal", nil)
	require.NoError(t, err)
	revealReq.Header.Set("X-Requested-With", "fetch")
	revealReq.Header.Set("X-Reauth-Grant", grantID)
	revealResp, err := env.Client.Do(revealReq)
	require.NoError(t, err)
	revealBody := readBody(t, revealResp)
	require.Equal(t, http.StatusOK, revealResp.StatusCode, "reveal body: %s", revealBody)

	var revealResult map[string]any
	require.NoError(t, json.Unmarshal(revealBody, &revealResult))
	assert.NotEmpty(t, revealResult["phraseCt"], "phraseCt must be present")
	assert.NotEmpty(t, revealResult["saltB64"], "saltB64 must be present")

	// Audit log must contain a recovery.phrase.reveal entry.
	assert.Equal(t, 1, auditCount(t, env.DB, "recovery.phrase.reveal"))

	// 6. Reusing the same grantId → 401.
	authpkg.ClearSessionCache()
	revealReq2, err := http.NewRequest(http.MethodPost, base+"/v1/account/recovery/reveal", nil)
	require.NoError(t, err)
	revealReq2.Header.Set("X-Requested-With", "fetch")
	revealReq2.Header.Set("X-Reauth-Grant", grantID)
	revealResp2, err := env.Client.Do(revealReq2)
	require.NoError(t, err)
	revealBody2 := readBody(t, revealResp2)
	assert.Equal(t, http.StatusUnauthorized, revealResp2.StatusCode, "second reveal body: %s", revealBody2)
}

// TestRecoveryReveal_MissingGrant verifies that omitting X-Reauth-Grant → 401.
func TestRecoveryReveal_MissingGrant(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	signInUserForReauth(t, env, "gina@example.com", "sub-gina")

	req, err := http.NewRequest(http.MethodPost, env.Server.URL+"/v1/account/recovery/reveal", nil)
	require.NoError(t, err)
	req.Header.Set("X-Requested-With", "fetch")
	// No X-Reauth-Grant header.
	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode, "body: %s", body)
	assert.Equal(t, "reauth-required", problemTitle(t, body))
}

// TestRecoveryRegenerate_HappyPath verifies the full reauth → regenerate flow.
func TestRecoveryRegenerate_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const email = "henry@example.com"
	const sub = "sub-henry"

	addToAllowlist(t, env.DB, email)
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: sub}
	base := env.Server.URL

	// 1. Sign in.
	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken": "tok", "deviceLabel": "Phone", "userAgent": "UA",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = readBody(t, resp)

	// 2. Family init.
	familyID := newUUIDStr(t)
	initResp := postJSON(t, env.Client, base+"/v1/family/init", map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64.RawURLEncoding.EncodeToString(make([]byte, 80)),
		"recovery": map[string]any{
			"wrap":     base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"phraseCt": base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"salt":     base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
	})
	require.Equal(t, http.StatusOK, initResp.StatusCode)
	_ = readBody(t, initResp)

	// 3. Reauth challenge.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: sub}
	challengeResp := postJSON(t, env.Client, base+"/v1/reauth/challenge", nil)
	require.Equal(t, http.StatusOK, challengeResp.StatusCode)
	var ch map[string]any
	require.NoError(t, json.Unmarshal(readBody(t, challengeResp), &ch))

	// 4. Reauth verify.
	verifyResp := postJSON(t, env.Client, base+"/v1/reauth/verify", map[string]any{
		"nonce":   ch["nonce"],
		"idToken": "fresh-tok",
	})
	require.Equal(t, http.StatusOK, verifyResp.StatusCode)
	var vr map[string]any
	require.NoError(t, json.Unmarshal(readBody(t, verifyResp), &vr))
	grantID := vr["grantId"].(string)

	// 5. POST /v1/account/recovery/regenerate.
	newRecoveryWrap := make([]byte, 49)
	newRecoveryWrap[0] = 0xAB // differ from original
	newPhraseCt := make([]byte, 49)
	newPhraseCt[0] = 0xCD
	newSalt := make([]byte, 16)
	newSalt[0] = 0xEF

	regenReq, err := http.NewRequest(http.MethodPost, base+"/v1/account/recovery/regenerate",
		mustJSONReader(t, map[string]any{
			"recoveryWrap": base64.RawURLEncoding.EncodeToString(newRecoveryWrap),
			"phraseCt":     base64.RawURLEncoding.EncodeToString(newPhraseCt),
			"salt":         base64.RawURLEncoding.EncodeToString(newSalt),
			"version":      1,
		}),
	)
	require.NoError(t, err)
	regenReq.Header.Set("Content-Type", "application/json")
	regenReq.Header.Set("X-Requested-With", "fetch")
	regenReq.Header.Set("X-Reauth-Grant", grantID)
	regenResp, err := env.Client.Do(regenReq)
	require.NoError(t, err)
	regenBody := readBody(t, regenResp)
	assert.Equal(t, http.StatusNoContent, regenResp.StatusCode, "regen body: %s", regenBody)

	// Audit log must contain recovery.code.regenerate.
	assert.Equal(t, 1, auditCount(t, env.DB, "recovery.code.regenerate"))
}

// TestFamilyRecoveryEnvelope_HappyPath verifies GET /v1/family/recovery-envelope.
func TestFamilyRecoveryEnvelope_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const email = "ivy@example.com"
	const sub = "sub-ivy"

	addToAllowlist(t, env.DB, email)
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: sub}
	base := env.Server.URL

	// Sign in.
	resp := postJSON(t, env.Client, base+"/v1/auth/google", map[string]any{
		"idToken": "tok", "deviceLabel": "Phone", "userAgent": "UA",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = readBody(t, resp)

	// Family init.
	recoveryWrap := make([]byte, 49)
	recoveryWrap[0] = 0x99
	salt := make([]byte, 16)
	salt[0] = 0x42

	familyID := newUUIDStr(t)
	initResp := postJSON(t, env.Client, base+"/v1/family/init", map[string]any{
		"familyId":       familyID,
		"deviceEnvelope": base64.RawURLEncoding.EncodeToString(make([]byte, 80)),
		"recovery": map[string]any{
			"wrap":     base64.RawURLEncoding.EncodeToString(recoveryWrap),
			"phraseCt": base64.RawURLEncoding.EncodeToString(make([]byte, 49)),
			"salt":     base64.RawURLEncoding.EncodeToString(salt),
		},
	})
	require.Equal(t, http.StatusOK, initResp.StatusCode)
	_ = readBody(t, initResp)

	// GET /v1/family/recovery-envelope → 200.
	authpkg.ClearSessionCache()
	envResp := getJSON(t, env.Client, base+"/v1/family/recovery-envelope")
	envBody := readBody(t, envResp)
	require.Equal(t, http.StatusOK, envResp.StatusCode, "body: %s", envBody)

	var result map[string]any
	require.NoError(t, json.Unmarshal(envBody, &result))
	assert.NotEmpty(t, result["recoveryWrap"], "recoveryWrap must be present")
	assert.NotEmpty(t, result["salt"], "salt must be present")
	assert.NotNil(t, result["version"], "version must be present")
	assert.Equal(t, familyID, result["familyId"], "familyId must match the family used during init")
	assert.NotEmpty(t, result["createdAt"], "createdAt must be present for AAD derivation")
}

// TestFamilyRecoveryEnvelope_NoFamily verifies that a user without a family → 403.
func TestFamilyRecoveryEnvelope_NoFamily(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	signInUserForReauth(t, env, "jack@example.com", "sub-jack")

	resp := getJSON(t, env.Client, env.Server.URL+"/v1/family/recovery-envelope")
	body := readBody(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode, "body: %s", body)
}

// ---- helpers ----------------------------------------------------------------

// mustJSONReader marshals v to JSON and returns an io.Reader for it.
func mustJSONReader(t *testing.T, v any) *bytes.Reader {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return bytes.NewReader(b)
}

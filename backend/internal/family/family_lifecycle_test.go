//go:build integration

package family_test

// family_lifecycle_test.go — integration tests for Phase 7 lifecycle endpoints:
// invite, accept, decline, migrate-solo, leave, remove.
//
// Helpers (postJSON, getJSON, readBody, addToAllowlist, newUUIDStr, validInitBody)
// are shared from family_integration_test.go in the same package.

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/testenv"
)

// --------------------------------------------------------------------------
// SSE helpers (mirrors pattern from live/live_integration_test.go)
// --------------------------------------------------------------------------

type sseEvent struct {
	Type string
	Data string
}

// openSSE starts a long-poll GET to the SSE endpoint using client. Returns a
// buffered event channel and a closer function. The caller should defer closeSSE().
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
		var curType, curData string
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event: ") {
				curType = strings.TrimPrefix(line, "event: ")
			} else if strings.HasPrefix(line, "data: ") {
				curData = strings.TrimPrefix(line, "data: ")
			} else if line == "" && (curType != "" || curData != "") {
				evCh <- sseEvent{Type: curType, Data: curData}
				curType = ""
				curData = ""
			}
		}
	}()

	closeSSE := func() { resp.Body.Close() }
	return evCh, closeSSE
}

// receiveSSEEvent reads from evCh waiting for an event with the given type.
// Fails the test if deadline elapses before the event arrives.
func receiveSSEEvent(t *testing.T, evCh <-chan sseEvent, wantType string, deadline time.Duration) sseEvent {
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
// Test helpers
// --------------------------------------------------------------------------

// signInUser signs a user into the test server and returns the parsed response body.
// The caller must set env.Verifier.Claims before calling this.
func signInUser(t *testing.T, env *testenv.Env, client *http.Client) map[string]any {
	t.Helper()
	resp := postJSON(t, client, env.Server.URL+"/v1/auth/google", map[string]any{
		"idToken": "fake-token", "deviceLabel": "Test Phone", "userAgent": "TestAgent/1.0",
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "sign-in: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

// initFamilyForUser signs in the given user (setting verifier claims) and calls
// POST /v1/family/init. Returns the familyID.
func initFamilyForUser(t *testing.T, env *testenv.Env, client *http.Client, email, sub string) string {
	t.Helper()
	env.Verifier.Claims = &authpkg.Claims{Email: email, EmailVerified: true, Sub: sub, Name: email}
	signInUser(t, env, client)

	initBody := validInitBody(t)
	resp := postJSON(t, client, env.Server.URL+"/v1/family/init", initBody)
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "family/init: %s", body)
	return initBody["familyId"].(string)
}

// sendInvite sends a POST /v1/family/invites from client and returns the inviteId.
func sendInvite(t *testing.T, env *testenv.Env, client *http.Client, inviteeEmail string) string {
	t.Helper()
	resp := postJSON(t, client, env.Server.URL+"/v1/family/invites", map[string]any{
		"inviteeEmail": inviteeEmail,
	})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "send invite: %s", body)
	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	return result["inviteId"].(string)
}

// directInsertInvite inserts an invite row directly into the DB. Useful for
// setting up edge-case scenarios (expired, etc.) without going through HTTP.
func directInsertInvite(t *testing.T, db *sql.DB, inviteID, familyID, invitedBy, inviteeEmail, status, expiresAt string) {
	t.Helper()
	q := gen.New(db)
	require.NoError(t, q.InsertFamilyInvite(context.Background(), gen.InsertFamilyInviteParams{
		ID:           inviteID,
		FamilyID:     familyID,
		InvitedBy:    invitedBy,
		InviteeEmail: inviteeEmail,
		CreatedAt:    httpx.FormatTime(time.Now().UTC()),
		ExpiresAt:    expiresAt,
	}))
	if status != "pending" {
		nowStr := httpx.FormatTime(time.Now().UTC())
		require.NoError(t, q.UpdateInviteStatus(context.Background(), gen.UpdateInviteStatusParams{
			Status:    status,
			DecidedAt: sql.NullString{String: nowStr, Valid: true},
			ID:        inviteID,
		}))
	}
}

// getUserIDByEmail returns the user ID for the given email, failing if not found.
func getUserIDByEmail(t *testing.T, db *sql.DB, email string) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(), `SELECT id FROM users WHERE email = ?`, email).Scan(&id)
	require.NoError(t, err, "user not found for email %q", email)
	return id
}

// --------------------------------------------------------------------------
// TestInvite_CreateAndList
// --------------------------------------------------------------------------

// TestInvite_CreateAndList verifies that after Alice invites Bob, Bob (signed in)
// sees the invite in GET /v1/family/invites/incoming.
func TestInvite_CreateAndList(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	// Alice: sign in and init family.
	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-list")

	// Alice: send invite to Bob.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-list",
	}
	inviteID := sendInvite(t, env, clientA, "bob@example.com")
	assert.NotEmpty(t, inviteID)

	// Bob: sign in (brand new user, no family yet).
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-list",
	}
	signInUser(t, env, clientB)

	// Bob: GET /v1/family/invites/incoming — must contain Alice's invite.
	resp := getJSON(t, clientB, env.Server.URL+"/v1/family/invites/incoming")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "incoming invites: %s", body)

	var result map[string]any
	require.NoError(t, json.Unmarshal(body, &result))
	invites, ok := result["invites"].([]any)
	require.True(t, ok, "invites field must be an array")
	require.Len(t, invites, 1, "Bob must see exactly 1 invite")

	inv, _ := invites[0].(map[string]any)
	assert.Equal(t, inviteID, inv["inviteId"])
	assert.Equal(t, "bob@example.com", inv["inviteeEmail"])
}

// --------------------------------------------------------------------------
// TestInvite_AcceptHappyPath
// --------------------------------------------------------------------------

// TestInvite_AcceptHappyPath verifies that Bob can accept Alice's invite:
// invite status transitions to "accepted" and a family_members row is created.
func TestInvite_AcceptHappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-accept")

	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-accept",
	}
	inviteID := sendInvite(t, env, clientA, "bob@example.com")

	// Bob: sign in.
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-accept",
	}
	signInUser(t, env, clientB)

	// Bob: accept invite.
	resp := postJSON(t, clientB, env.Server.URL+"/v1/family/invites/"+inviteID+"/accept", nil)
	body := readBody(t, resp)
	require.Equal(t, http.StatusNoContent, resp.StatusCode, "accept: %s", body)

	// Verify invite status in DB.
	q := gen.New(env.DB)
	inv, err := q.GetFamilyInvite(context.Background(), inviteID)
	require.NoError(t, err)
	assert.Equal(t, "accepted", inv.Status)

	// Verify family_members row for Bob.
	bobID := getUserIDByEmail(t, env.DB, "bob@example.com")
	member, err := q.GetActiveFamilyMember(context.Background(), bobID)
	require.NoError(t, err, "Bob must have an active family_members row")
	assert.False(t, member.LeftAt.Valid, "left_at must be NULL")
}

// --------------------------------------------------------------------------
// TestInvite_AcceptNeedsMigrationDecision
// --------------------------------------------------------------------------

// TestInvite_AcceptNeedsMigrationDecision verifies that if the invitee already
// has a solo family, accept returns 409 needs-migration-decision.
func TestInvite_AcceptNeedsMigrationDecision(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	// Alice: init family.
	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-mig")

	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-mig",
	}
	inviteID := sendInvite(t, env, clientA, "bob@example.com")

	// Bob: sign in AND init his own (solo) family.
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	initFamilyForUser(t, env, clientB, "bob@example.com", "sub-bob-mig")

	// Bob: accept Alice's invite — must return 409 (has solo family).
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-mig",
	}
	resp := postJSON(t, clientB, env.Server.URL+"/v1/family/invites/"+inviteID+"/accept", nil)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusConflict, resp.StatusCode, "expected 409: %s", body)

	var errBody map[string]any
	_ = json.Unmarshal(body, &errBody)
	assert.Contains(t, errBody["title"], "needs-migration-decision")
}

// --------------------------------------------------------------------------
// TestInvite_AcceptMemberCap
// --------------------------------------------------------------------------

// TestInvite_AcceptMemberCap verifies that when a family already has 6 members,
// a 7th invite accept returns 409 family-full.
func TestInvite_AcceptMemberCap(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const adminEmail = "cap-admin@example.com"
	const inviteeEmail = "cap-extra@example.com"
	addToAllowlist(t, env.DB, adminEmail)
	addToAllowlist(t, env.DB, inviteeEmail)

	// Admin: init family.
	clientA := env.Client
	familyID := initFamilyForUser(t, env, clientA, adminEmail, "sub-cap-admin")

	// Directly insert 5 more members to reach the cap of 6.
	now := httpx.FormatTime(time.Now().UTC())
	q := gen.New(env.DB)
	for i := 0; i < 5; i++ {
		extraEmail := "cap-filler" + string(rune('1'+i)) + "@example.com"
		addToAllowlist(t, env.DB, extraEmail)

		// Upsert the user; use the returned ID (addToAllowlist may have created the
		// user already, so ON CONFLICT returns the existing ID, not our generated one).
		user, err := q.UpsertUserByEmail(context.Background(), gen.UpsertUserByEmailParams{
			ID:           newUUIDStr(t),
			Email:        extraEmail,
			DisplayName:  extraEmail,
			CreatedAt:    now,
			LastSigninAt: sql.NullString{String: now, Valid: true},
		})
		require.NoError(t, err)

		// Insert family member directly (no HTTP sign-in needed).
		require.NoError(t, q.InsertFamilyMember(context.Background(), gen.InsertFamilyMemberParams{
			FamilyID: familyID,
			UserID:   user.ID,
			JoinedAt: now,
		}))
	}

	// Confirm the family now has 6 active members.
	count, err := q.CountActiveFamilyMembers(context.Background(), familyID)
	require.NoError(t, err)
	assert.Equal(t, int64(6), count)

	// Insert an invite directly — the HTTP handler also checks the member cap on
	// invite-send, so we bypass it here to specifically test the accept-time cap.
	adminID := getUserIDByEmail(t, env.DB, adminEmail)
	inviteID := newUUIDStr(t)
	expiresAt := httpx.FormatTime(time.Now().UTC().Add(30 * 24 * time.Hour))
	directInsertInvite(t, env.DB, inviteID, familyID, adminID, inviteeEmail, "pending", expiresAt)

	// Extra user: sign in and try to accept.
	authpkg.ClearSessionCache()
	clientExtra := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: inviteeEmail, EmailVerified: true, Sub: "sub-cap-extra",
	}
	signInUser(t, env, clientExtra)

	resp := postJSON(t, clientExtra, env.Server.URL+"/v1/family/invites/"+inviteID+"/accept", nil)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusConflict, resp.StatusCode, "expected 409 family-full: %s", body)

	var errBody map[string]any
	_ = json.Unmarshal(body, &errBody)
	assert.Contains(t, errBody["title"], "family-full")
}

// --------------------------------------------------------------------------
// TestInvite_AcceptExpired
// --------------------------------------------------------------------------

// TestInvite_AcceptExpired verifies that accepting an expired invite returns 409
// invite-expired.
func TestInvite_AcceptExpired(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	const aliceEmail = "alice-exp@example.com"
	const bobEmail = "bob-exp@example.com"
	addToAllowlist(t, env.DB, aliceEmail)
	addToAllowlist(t, env.DB, bobEmail)

	clientA := env.Client
	familyID := initFamilyForUser(t, env, clientA, aliceEmail, "sub-alice-exp")
	aliceID := getUserIDByEmail(t, env.DB, aliceEmail)

	// Insert an already-expired invite directly.
	expiredInviteID := newUUIDStr(t)
	expiredAt := httpx.FormatTime(time.Now().UTC().Add(-1 * time.Hour)) // 1 hour ago
	directInsertInvite(t, env.DB, expiredInviteID, familyID, aliceID, bobEmail, "pending", expiredAt)

	// Bob: sign in.
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: bobEmail, EmailVerified: true, Sub: "sub-bob-exp",
	}
	signInUser(t, env, clientB)

	// Bob: try to accept the expired invite.
	resp := postJSON(t, clientB, env.Server.URL+"/v1/family/invites/"+expiredInviteID+"/accept", nil)
	body := readBody(t, resp)
	// The service checks expiry and returns ErrInviteExpired → 409 invite-expired.
	assert.Equal(t, http.StatusConflict, resp.StatusCode, "expected 409 invite-expired: %s", body)

	var errBody map[string]any
	_ = json.Unmarshal(body, &errBody)
	assert.Contains(t, errBody["title"], "invite-expired")
}

// --------------------------------------------------------------------------
// TestInvite_Decline
// --------------------------------------------------------------------------

// TestInvite_Decline verifies that Bob can decline Alice's invite and the invite
// status transitions to "declined".
func TestInvite_Decline(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-dec")

	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-dec",
	}
	inviteID := sendInvite(t, env, clientA, "bob@example.com")

	// Bob: sign in and decline.
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-dec",
	}
	signInUser(t, env, clientB)

	resp := postJSON(t, clientB, env.Server.URL+"/v1/family/invites/"+inviteID+"/decline", nil)
	body := readBody(t, resp)
	require.Equal(t, http.StatusNoContent, resp.StatusCode, "decline: %s", body)

	// Verify invite status.
	q := gen.New(env.DB)
	inv, err := q.GetFamilyInvite(context.Background(), inviteID)
	require.NoError(t, err)
	assert.Equal(t, "declined", inv.Status)
}

// --------------------------------------------------------------------------
// TestMigrateSolo_Idempotent
// --------------------------------------------------------------------------

// TestMigrateSolo_Idempotent verifies that posting the same migrationId twice
// returns 200 both times and records are only inserted once.
//
// The idempotency guard lives inside the service transaction. The HTTP handler
// requires the caller to have an active family when the endpoint is called.
// After the first migrate-solo succeeds, Bob's source family has left_at set.
// To exercise the idempotency path via HTTP we re-insert a stub family row for
// Bob before the second call so the handler guard passes, letting the service
// reach the cached-result early-exit.
func TestMigrateSolo_Idempotent(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	// Alice: init family (target family for migration).
	clientA := env.Client
	targetFamilyID := initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-mig2")

	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-mig2",
	}
	// sendInvite is kept for completeness but not needed by migrate-solo itself.
	_ = sendInvite(t, env, clientA, "bob@example.com")

	// Bob: sign in and init his own (solo) family.
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	bobSoloFamilyID := initFamilyForUser(t, env, clientB, "bob@example.com", "sub-bob-mig2")
	bobID := getUserIDByEmail(t, env.DB, "bob@example.com")

	// Re-auth Bob so clientB's session is current.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-mig2",
	}
	_ = signInUser(t, env, clientB)

	// Build migrate-solo request body (Bob's source family → Alice's target family).
	migrationID := newUUIDStr(t)
	migrateBody := map[string]any{
		"migrationId":    migrationID,
		"targetFamilyId": targetFamilyID,
		"records":        []any{},
	}

	// First call: migrate-solo succeeds; Bob leaves his solo family.
	resp1 := postJSON(t, clientB, env.Server.URL+"/v1/family/migrate-solo", migrateBody)
	body1 := readBody(t, resp1)
	require.Equal(t, http.StatusOK, resp1.StatusCode, "migrate-solo first call: %s", body1)

	var result1 map[string]any
	require.NoError(t, json.Unmarshal(body1, &result1))
	committedAt1, _ := result1["committedAt"].(string)
	assert.NotEmpty(t, committedAt1)

	// Bob no longer has an active family after the first call (source family's
	// left_at is set). Re-insert a stub active membership so the handler guard
	// allows the second call to reach the idempotency check inside the service.
	stubFamilyID := newUUIDStr(t)
	now := httpx.FormatTime(time.Now().UTC())
	q := gen.New(env.DB)
	require.NoError(t, q.InsertFamily(context.Background(), gen.InsertFamilyParams{
		ID: stubFamilyID, CreatedAt: now,
	}))
	require.NoError(t, q.InsertFamilySeq(context.Background(), stubFamilyID))
	require.NoError(t, q.InsertFamilyMember(context.Background(), gen.InsertFamilyMemberParams{
		FamilyID: stubFamilyID, UserID: bobID, JoinedAt: now,
	}))

	// Second call (same migrationId, same body) — service finds the cached migration
	// record and returns 200 with the original committedAt without doing any DB work.
	resp2 := postJSON(t, clientB, env.Server.URL+"/v1/family/migrate-solo", migrateBody)
	body2 := readBody(t, resp2)
	require.Equal(t, http.StatusOK, resp2.StatusCode, "migrate-solo second call (idempotent): %s", body2)

	var result2 map[string]any
	require.NoError(t, json.Unmarshal(body2, &result2))
	committedAt2, _ := result2["committedAt"].(string)

	// Both calls must return the same committedAt (cached result from first call).
	assert.Equal(t, committedAt1, committedAt2, "idempotent calls must return the same committedAt")

	// Only one migration record must exist in DB.
	var count int
	require.NoError(t, env.DB.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM migrations WHERE id = ?`, migrationID).Scan(&count))
	assert.Equal(t, 1, count, "idempotent call must not insert a second migrations row")

	// Suppress unused variable for bobSoloFamilyID.
	_ = bobSoloFamilyID
}

// --------------------------------------------------------------------------
// TestLeave
// --------------------------------------------------------------------------

// TestLeave verifies that POST /v1/family/leave sets left_at and publishes a
// you.removed SSE event to the leaving user's scope.
func TestLeave(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")

	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-leave")

	// Open Alice's SSE stream before leaving so the you.removed event can be caught.
	evCh, closeSSE := openSSE(t, clientA, env.Server.URL+"/v1/sync/live")
	defer closeSSE()
	time.Sleep(50 * time.Millisecond)

	// POST /v1/family/leave (re-auth as Alice to reuse session cookie).
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-leave",
	}
	resp := postJSON(t, clientA, env.Server.URL+"/v1/family/leave", map[string]any{"takeCopy": false})
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "leave: %s", body)

	// Alice should receive you.removed SSE event.
	ev := receiveSSEEvent(t, evCh, "you.removed", 2*time.Second)

	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(ev.Data), &payload))
	assert.Equal(t, "left", payload["reason"])

	// Verify DB: left_at must be set.
	aliceID := getUserIDByEmail(t, env.DB, "alice@example.com")
	var leftAt sql.NullString
	require.NoError(t, env.DB.QueryRowContext(context.Background(),
		`SELECT left_at FROM family_members WHERE user_id = ?`, aliceID).Scan(&leftAt))
	assert.True(t, leftAt.Valid, "left_at must be set after leaving")
}

// --------------------------------------------------------------------------
// TestRemove_HappyPath
// --------------------------------------------------------------------------

// TestRemove_HappyPath verifies that Alice (who joined first) can remove Bob and
// that Bob's SSE stream receives you.removed with reason "kicked".
func TestRemove_HappyPath(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	// Alice: init family (joined first = tie-break winner).
	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-rem")

	// Send invite to Bob.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-rem",
	}
	inviteID := sendInvite(t, env, clientA, "bob@example.com")

	// Bob: sign in and accept the invite.
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-rem",
	}
	signInUser(t, env, clientB)

	resp := postJSON(t, clientB, env.Server.URL+"/v1/family/invites/"+inviteID+"/accept", nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode, "Bob accept")
	_ = readBody(t, resp)

	// Open Bob's SSE stream before Alice removes him.
	evCh, closeSSE := openSSE(t, clientB, env.Server.URL+"/v1/sync/live")
	defer closeSSE()
	time.Sleep(50 * time.Millisecond)

	// Alice: remove Bob.
	bobID := getUserIDByEmail(t, env.DB, "bob@example.com")
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-rem",
	}
	removeResp := postJSON(t, clientA,
		env.Server.URL+"/v1/family/members/"+bobID+"/remove", nil)
	removeBody := readBody(t, removeResp)
	require.Equal(t, http.StatusNoContent, removeResp.StatusCode, "remove: %s", removeBody)

	// Bob must receive you.removed SSE event with reason "kicked".
	ev := receiveSSEEvent(t, evCh, "you.removed", 2*time.Second)

	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(ev.Data), &payload))
	assert.Equal(t, "kicked", payload["reason"])

	// Verify DB: Bob's left_at and last_removed_at must be set.
	var leftAt, lastRemovedAt sql.NullString
	require.NoError(t, env.DB.QueryRowContext(context.Background(),
		`SELECT left_at, last_removed_at FROM family_members WHERE user_id = ?`, bobID).
		Scan(&leftAt, &lastRemovedAt))
	assert.True(t, leftAt.Valid, "left_at must be set after removal")
	assert.True(t, lastRemovedAt.Valid, "last_removed_at must be set after removal")
}

// --------------------------------------------------------------------------
// TestRemove_CoolDown
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// TestDeclineInvite_NotInvitee
// --------------------------------------------------------------------------

// TestDeclineInvite_NotInvitee verifies that a user who is not the invitee
// cannot decline the invite — must return 403.
func TestDeclineInvite_NotInvitee(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")
	addToAllowlist(t, env.DB, "carol@example.com")

	// Alice: init family and invite Bob.
	clientA := env.Client
	initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-ni")

	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-ni",
	}
	inviteID := sendInvite(t, env, clientA, "bob@example.com")

	// Carol: sign in (not the invitee) and try to decline Bob's invite.
	authpkg.ClearSessionCache()
	clientC := env.NewClient()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "carol@example.com", EmailVerified: true, Sub: "sub-carol-ni",
	}
	signInUser(t, env, clientC)

	resp := postJSON(t, clientC, env.Server.URL+"/v1/family/invites/"+inviteID+"/decline", nil)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode, "expected 403: %s", body)

	// Invite status must still be pending.
	q := gen.New(env.DB)
	inv, err := q.GetFamilyInvite(context.Background(), inviteID)
	require.NoError(t, err)
	assert.Equal(t, "pending", inv.Status, "invite must remain pending after unauthorized decline attempt")
}

// --------------------------------------------------------------------------
// TestMigrateSolo_NotInTargetFamily
// --------------------------------------------------------------------------

// TestMigrateSolo_NotInTargetFamily verifies that supplying a targetFamilyId
// the caller does not belong to returns 403 not-in-target-family.
func TestMigrateSolo_NotInTargetFamily(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	// Alice: init her own family (caller does NOT belong here).
	clientA := env.Client
	aliceFamilyID := initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-ntf")
	_ = aliceFamilyID

	// Bob: sign in and init his own solo family (this is his source family).
	authpkg.ClearSessionCache()
	clientB := env.NewClient()
	initFamilyForUser(t, env, clientB, "bob@example.com", "sub-bob-ntf")

	// Re-auth Bob so his session cookie is current.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "bob@example.com", EmailVerified: true, Sub: "sub-bob-ntf",
	}
	_ = signInUser(t, env, clientB)

	// Bob tries to migrate into Alice's family — he is NOT a member there.
	migrateBody := map[string]any{
		"migrationId":    newUUIDStr(t),
		"targetFamilyId": aliceFamilyID,
		"records":        []any{},
	}
	resp := postJSON(t, clientB, env.Server.URL+"/v1/family/migrate-solo", migrateBody)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode, "expected 403 not-in-target-family: %s", body)

	var errBody map[string]any
	_ = json.Unmarshal(body, &errBody)
	assert.Contains(t, errBody["title"], "not-in-target-family")
}

// --------------------------------------------------------------------------
// TestRemove_CoolDown
// --------------------------------------------------------------------------

// TestRemove_CoolDown verifies that removing a member within 24h of a previous
// removal returns 429 cool-down.
func TestRemove_CoolDown(t *testing.T) {
	authpkg.ClearSessionCache()
	env := testenv.New(t)
	defer env.Close()

	addToAllowlist(t, env.DB, "alice@example.com")
	addToAllowlist(t, env.DB, "bob@example.com")

	// Alice: init family.
	clientA := env.Client
	familyID := initFamilyForUser(t, env, clientA, "alice@example.com", "sub-alice-cd")

	// Upsert Bob as user and insert him directly into the family with
	// last_removed_at set 1 minute ago (within the 24h cool-down window).
	now := httpx.FormatTime(time.Now().UTC())
	recentlyRemovedAt := httpx.FormatTime(time.Now().UTC().Add(-1 * time.Minute))

	q := gen.New(env.DB)
	// UpsertUserByEmail preserves the existing id on conflict; use the returned row's
	// ID so we reference the actual row that will satisfy the FK constraint.
	bobUser, err := q.UpsertUserByEmail(context.Background(), gen.UpsertUserByEmailParams{
		ID:           newUUIDStr(t),
		Email:        "bob@example.com",
		DisplayName:  "Bob",
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	bobUID := bobUser.ID

	// Insert Bob directly into the family with last_removed_at set 1 minute ago
	// (within the 24h cool-down window) but left_at NULL (Bob is currently active
	// in the family). Use SetMemberLastRemoved via a helper since InsertFamilyMember
	// doesn't take last_removed_at. We insert normally first, then update via raw SQL.
	require.NoError(t, q.InsertFamilyMember(context.Background(), gen.InsertFamilyMemberParams{
		FamilyID: familyID,
		UserID:   bobUID,
		JoinedAt: now,
	}))
	_, err = env.DB.ExecContext(context.Background(),
		`UPDATE family_members SET last_removed_at = ? WHERE family_id = ? AND user_id = ?`,
		recentlyRemovedAt, familyID, bobUID,
	)
	require.NoError(t, err)

	// Alice: try to remove Bob again — must hit the cool-down.
	authpkg.ClearSessionCache()
	env.Verifier.Claims = &authpkg.Claims{
		Email: "alice@example.com", EmailVerified: true, Sub: "sub-alice-cd",
	}
	resp := postJSON(t, clientA,
		env.Server.URL+"/v1/family/members/"+bobUID+"/remove", nil)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusTooManyRequests, resp.StatusCode, "expected 429 cool-down: %s", body)

	var errBody map[string]any
	_ = json.Unmarshal(body, &errBody)
	assert.Contains(t, errBody["title"], "cool-down")
}

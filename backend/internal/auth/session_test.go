package auth

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbpkg "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
)

// newTestDB opens an in-memory SQLite DB, runs migrations via goose (via dbpkg.Open),
// and returns a *sql.DB. MaxOpenConns=1 is set by Open, so :memory: is safe
// (a single persistent connection = one in-memory database).
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := dbpkg.Open(t.Context(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// seedUserAndDevice inserts a user and device row and returns (userID, deviceID).
// Sessions have a FK on devices, so both rows must exist before Mint.
func seedUserAndDevice(t *testing.T, ctx context.Context, db *sql.DB) (userID, deviceID string) {
	t.Helper()
	q := gen.New(db)
	now := time.Now().UTC().Format(time.RFC3339)

	user, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:          mustUUID(t),
		Email:       "test@example.com",
		GoogleSub:   sql.NullString{String: "sub123", Valid: true},
		DisplayName: "Test User",
		CreatedAt:   now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)

	device, err := q.InsertDevice(ctx, gen.InsertDeviceParams{
		ID:        mustUUID(t),
		UserID:    user.ID,
		Label:     "Test Device",
		PubKey:    make([]byte, 32), // placeholder 32-byte X25519 key
		Status:    "active",
		CreatedAt: now,
	})
	require.NoError(t, err)

	return user.ID, device.ID
}

// mustUUID generates a new UUID v7 for test setup.
func mustUUID(t *testing.T) string {
	t.Helper()
	id, err := newSessionID()
	require.NoError(t, err)
	return id
}

// clearCache empties the in-process session cache between tests.
func clearCache() {
	sessionCache.Range(func(k, _ any) bool {
		sessionCache.Delete(k)
		return true
	})
}

func TestMint_RoundtripValidate(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookie, sessionID, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)
	assert.NotEmpty(t, cookie)
	assert.NotEmpty(t, sessionID)
	assert.True(t, strings.Contains(cookie, "."), "cookie must contain '.'")

	info, err := Validate(ctx, db, cookie, now)
	require.NoError(t, err)
	require.NotNil(t, info)
	assert.Equal(t, userID, info.UserID)
	assert.Equal(t, deviceID, info.DeviceID)
	assert.Equal(t, sessionID, info.SessionID)
	assert.Equal(t, "test@example.com", info.Email)
	assert.False(t, info.Suspended)
}

func TestValidate_MalformedCookie(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	now := time.Now().UTC()

	cases := []struct {
		name  string
		value string
	}{
		{"empty", ""},
		{"no dot", "nodothere"},
		{"bad base64", "sessionid.!!!notbase64!!!"},
		{"dot only", "."},
		{"missing token", "sessionid."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info, err := Validate(ctx, db, tc.value, now)
			assert.Nil(t, info)
			assert.ErrorIs(t, err, ErrInvalidSession, "expected ErrInvalidSession for %q", tc.value)
		})
	}
}

func TestValidate_RevokedSession(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookie, sessionID, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	err = Revoke(ctx, db, sessionID, now)
	require.NoError(t, err)

	// Clear cache so we hit the DB.
	clearCache()

	info, err := Validate(ctx, db, cookie, now.Add(time.Second))
	assert.Nil(t, info)
	assert.ErrorIs(t, err, ErrInvalidSession)
}

func TestValidate_SuspendedUser(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookie, _, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	// Suspend the user.
	q := gen.New(db)
	suspendedAt := now.UTC().Format(time.RFC3339)
	err = q.MarkUserSuspended(ctx, gen.MarkUserSuspendedParams{
		SuspendedAt: sql.NullString{String: suspendedAt, Valid: true},
		ID:          userID,
	})
	require.NoError(t, err)

	// Clear cache so we hit the DB and see the updated suspended_at.
	clearCache()

	info, err := Validate(ctx, db, cookie, now.Add(time.Second))
	assert.Nil(t, info)
	assert.ErrorIs(t, err, ErrInvalidSession)
}

func TestTouchAndMaybeRotate_BelowThreshold(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookie, _, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	info, err := Validate(ctx, db, cookie, now)
	require.NoError(t, err)

	// Advance 1 hour — below the 24h rotation threshold.
	laterNow := now.Add(time.Hour)
	pending, err := TouchAndMaybeRotate(ctx, db, info, laterNow)
	require.NoError(t, err)
	assert.False(t, pending.Rotated)
	assert.Empty(t, pending.NewCookieValue)
}

func TestTouchAndMaybeRotate_AboveThreshold(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookie, _, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	info, err := Validate(ctx, db, cookie, now)
	require.NoError(t, err)

	// Advance 25 hours — above the 24h rotation threshold.
	laterNow := now.Add(25 * time.Hour)
	pending, err := TouchAndMaybeRotate(ctx, db, info, laterNow)
	require.NoError(t, err)
	require.True(t, pending.Rotated)
	require.NotEmpty(t, pending.NewCookieValue)
	require.NotEqual(t, cookie, pending.NewCookieValue)
	newCookie := pending.NewCookieValue

	// Commit the rotation. Until Commit runs, the DB still has the OLD token
	// only — this is the deferred-commit guarantee that backstops a panic in
	// the wrapped handler (B4d).
	clearCache()
	oldStillValid, err := Validate(ctx, db, cookie, laterNow)
	require.NoError(t, err)
	require.NotNil(t, oldStillValid, "old cookie must still be valid before Commit")

	require.NoError(t, pending.Commit(ctx))

	// After commit, the old token continues to be tolerated for one extra
	// request via previous_token_hash, so the in-flight client doesn't 401.
	clearCache()
	oldInfo, err := Validate(ctx, db, cookie, laterNow)
	require.NoError(t, err)
	require.NotNil(t, oldInfo, "old cookie must be tolerated for one rotation grace window")

	// New cookie must also be valid.
	clearCache()
	newInfo, err := Validate(ctx, db, newCookie, laterNow)
	require.NoError(t, err)
	require.NotNil(t, newInfo)
	assert.Equal(t, info.UserID, newInfo.UserID)
}

func TestRevokeAll_RevokesAcrossDevices(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID1 := seedUserAndDevice(t, ctx, db)

	// Create a second device for the same user.
	q := gen.New(db)
	now := time.Now().UTC()
	device2, err := q.InsertDevice(ctx, gen.InsertDeviceParams{
		ID:        mustUUID(t),
		UserID:    userID,
		Label:     "Second Device",
		PubKey:    make([]byte, 32),
		Status:    "active",
		CreatedAt: now.UTC().Format(time.RFC3339),
	})
	require.NoError(t, err)

	cookie1, _, err := Mint(ctx, db, deviceID1, now)
	require.NoError(t, err)
	cookie2, _, err := Mint(ctx, db, device2.ID, now)
	require.NoError(t, err)

	err = RevokeAll(ctx, db, userID, now)
	require.NoError(t, err)

	clearCache()

	info1, err1 := Validate(ctx, db, cookie1, now.Add(time.Second))
	assert.Nil(t, info1)
	assert.ErrorIs(t, err1, ErrInvalidSession)

	info2, err2 := Validate(ctx, db, cookie2, now.Add(time.Second))
	assert.Nil(t, info2)
	assert.ErrorIs(t, err2, ErrInvalidSession)
}

func TestSetCookie_HeaderFormat(t *testing.T) {
	w := httptest.NewRecorder()
	SetCookie(w, "sessionid.tokenvalue")

	header := w.Header().Get("Set-Cookie")
	t.Logf("Set-Cookie: %s", header)
	assert.Contains(t, header, "__Host-session=sessionid.tokenvalue")
	assert.Contains(t, header, "HttpOnly")
	assert.Contains(t, header, "Secure")
	assert.Contains(t, header, "SameSite=Lax")
	assert.Contains(t, header, "Path=/")
	assert.Contains(t, header, "Max-Age=2592000")
}

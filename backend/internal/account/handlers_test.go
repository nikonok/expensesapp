package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbpkg "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// --------------------------------------------------------------------------
// test infrastructure
// --------------------------------------------------------------------------

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := dbpkg.Open(t.Context(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func mustUUID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

// seedUserDevice inserts a user and device and returns (userID, deviceID).
func seedUserDevice(t *testing.T, ctx context.Context, db *sql.DB, email string) (userID, deviceID string) {
	t.Helper()
	q := gen.New(db)
	now := time.Now().UTC().Format(time.RFC3339)

	u, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           mustUUID(t),
		Email:        email,
		DisplayName:  "Test User",
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)

	d, err := q.InsertDevice(ctx, gen.InsertDeviceParams{
		ID:        mustUUID(t),
		UserID:    u.ID,
		Label:     "Test Phone",
		PubKey:    make([]byte, 32),
		Status:    "active",
		CreatedAt: now,
		UserAgent: sql.NullString{String: "TestAgent/1", Valid: true},
	})
	require.NoError(t, err)

	return u.ID, d.ID
}

// authedGet builds a GET request with user/device IDs pre-populated in context.
func authedGet(t *testing.T, path, userID, deviceID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	ctx := httpx.WithUserID(req.Context(), userID)
	ctx = httpx.WithDeviceID(ctx, deviceID)
	return req.WithContext(ctx)
}

// --------------------------------------------------------------------------
// TestGetMe
// --------------------------------------------------------------------------

func TestGetMe(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID := seedUserDevice(t, ctx, db, "me@example.com")

	h := NewHandler(db)
	req := authedGet(t, "/v1/me", userID, deviceID)
	rr := httptest.NewRecorder()
	h.GetMe(rr, req)

	require.Equal(t, http.StatusOK, rr.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))

	user, _ := resp["user"].(map[string]any)
	assert.Equal(t, "me@example.com", user["email"])
	assert.Equal(t, "Test User", user["displayName"])

	device, _ := resp["device"].(map[string]any)
	assert.Equal(t, deviceID, device["id"])

	assert.Nil(t, resp["family"])
	assert.Nil(t, resp["notificationSettings"])
}

// --------------------------------------------------------------------------
// TestGetMyDevices
// --------------------------------------------------------------------------

func TestGetMyDevices(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID := seedUserDevice(t, ctx, db, "devs@example.com")

	h := NewHandler(db)
	req := authedGet(t, "/v1/me/devices", userID, "")
	rr := httptest.NewRecorder()
	h.GetMyDevices(rr, req)

	require.Equal(t, http.StatusOK, rr.Code)

	var items []map[string]any
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &items))
	require.Len(t, items, 1)
	assert.Equal(t, deviceID, items[0]["id"])
	assert.Equal(t, "Test Phone", items[0]["label"])
	assert.Equal(t, "active", items[0]["status"])
}

// --------------------------------------------------------------------------
// TestRevokeMyDevice_OwnDevice
// --------------------------------------------------------------------------

func TestRevokeMyDevice_OwnDevice(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID := seedUserDevice(t, ctx, db, "revoke@example.com")

	h := NewHandler(db)

	// Build a POST request with chi URL param {id}.
	req := httptest.NewRequest(http.MethodPost, "/v1/me/devices/"+deviceID+"/revoke", nil)
	req.Header.Set("X-Requested-With", "fetch")
	// Inject chi route params.
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", deviceID)
	reqCtx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	reqCtx = httpx.WithUserID(reqCtx, userID)
	req = req.WithContext(reqCtx)

	rr := httptest.NewRecorder()
	h.RevokeMyDevice(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)

	// Device should now have status="revoked".
	q := gen.New(db)
	d, err := q.GetDeviceByID(ctx, deviceID)
	require.NoError(t, err)
	assert.Equal(t, "revoked", d.Status)
}

// --------------------------------------------------------------------------
// TestRevokeMyDevice_OtherUserDevice
// --------------------------------------------------------------------------

func TestRevokeMyDevice_OtherUserDevice(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserDevice(t, ctx, db, "owner@example.com")
	otherUserID, _ := seedUserDevice(t, ctx, db, "other@example.com")

	h := NewHandler(db)

	req := httptest.NewRequest(http.MethodPost, "/v1/me/devices/"+deviceID+"/revoke", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", deviceID)
	reqCtx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	reqCtx = httpx.WithUserID(reqCtx, otherUserID) // different user
	req = req.WithContext(reqCtx)

	rr := httptest.NewRecorder()
	h.RevokeMyDevice(rr, req)

	assert.Equal(t, http.StatusForbidden, rr.Code)
}

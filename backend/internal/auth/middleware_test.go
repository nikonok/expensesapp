package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// okHandler is a trivial next handler that records the context it received.
func okHandler(t *testing.T, gotUserID, gotDeviceID *string) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if gotUserID != nil {
			*gotUserID = httpx.UserID(r.Context())
		}
		if gotDeviceID != nil {
			*gotDeviceID = httpx.DeviceID(r.Context())
		}
		w.WriteHeader(http.StatusOK)
	})
}

// problemTitle unmarshals an RFC 9457 body and returns the "title" field.
func problemTitle(t *testing.T, body []byte) string {
	t.Helper()
	var p map[string]any
	require.NoError(t, json.Unmarshal(body, &p))
	title, _ := p["title"].(string)
	return title
}

// ---------------------------------------------------------------------------
// SessionMiddleware tests
// ---------------------------------------------------------------------------

func TestSessionMiddleware_NoCookie(t *testing.T) {
	clearCache()
	db := newTestDB(t)
	mw := SessionMiddleware(db)
	handler := mw(okHandler(t, nil, nil))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Equal(t, "no-store", rr.Header().Get("Cache-Control"))
	assert.Equal(t, "unauthenticated", problemTitle(t, rr.Body.Bytes()))
}

func TestSessionMiddleware_BadCookie(t *testing.T) {
	clearCache()
	db := newTestDB(t)
	mw := SessionMiddleware(db)
	handler := mw(okHandler(t, nil, nil))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: "not-valid-at-all"})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Equal(t, "unauthenticated", problemTitle(t, rr.Body.Bytes()))
}

func TestSessionMiddleware_ValidSession_ContextPopulated(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	userID, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookieVal, _, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	var gotUserID, gotDeviceID string
	mw := SessionMiddleware(db)
	handler := mw(okHandler(t, &gotUserID, &gotDeviceID))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: cookieVal})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, userID, gotUserID)
	assert.Equal(t, deviceID, gotDeviceID)
}

func TestSessionMiddleware_RevokedSession(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookieVal, sessionID, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	err = Revoke(ctx, db, sessionID, now)
	require.NoError(t, err)
	clearCache()

	mw := SessionMiddleware(db)
	handler := mw(okHandler(t, nil, nil))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: cookieVal})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Equal(t, "unauthenticated", problemTitle(t, rr.Body.Bytes()))
}

func TestSessionMiddleware_RotatesAfter24h(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserAndDevice(t, ctx, db)

	// Mint the session 25 hours in the past so last_used_at is old enough to
	// trigger rotation when the middleware calls TouchAndMaybeRotate with
	// time.Now().
	pastTime := time.Now().UTC().Add(-25 * time.Hour)
	cookieVal, _, err := Mint(ctx, db, deviceID, pastTime)
	require.NoError(t, err)
	clearCache()

	mw := SessionMiddleware(db)
	handler := mw(okHandler(t, nil, nil))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: cookieVal})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	setCookie := rr.Header().Get("Set-Cookie")
	assert.True(t, strings.Contains(setCookie, cookieName+"="),
		"expected Set-Cookie with %s after rotation, got: %q", cookieName, setCookie)
}

// ---------------------------------------------------------------------------
// CSRFHeaderGate tests
// ---------------------------------------------------------------------------

func TestCSRFHeaderGate_AllowsRead(t *testing.T) {
	handler := CSRFHeaderGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/", nil)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			assert.Equal(t, http.StatusOK, rr.Code)
		})
	}
}

func TestCSRFHeaderGate_BlocksWriteMissingHeader(t *testing.T) {
	handler := CSRFHeaderGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/", nil)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			assert.Equal(t, http.StatusForbidden, rr.Code)
			assert.Equal(t, "forbidden", problemTitle(t, rr.Body.Bytes()))
		})
	}
}

func TestCSRFHeaderGate_AllowsWriteWithHeader(t *testing.T) {
	handler := CSRFHeaderGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/", nil)
			req.Header.Set("X-Requested-With", "fetch")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			assert.Equal(t, http.StatusOK, rr.Code)
		})
	}
}

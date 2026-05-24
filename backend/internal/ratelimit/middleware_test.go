package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/ratelimit"
)

// disableBypass ensures tests exercise real rate limiting regardless of the
// RATE_LIMIT_BYPASS env var that the integration-test harness may have set.
func disableBypass(t *testing.T) {
	t.Helper()
	orig := ratelimit.Bypass
	ratelimit.Bypass = false
	t.Cleanup(func() { ratelimit.Bypass = orig })
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestPerIP_Exhausted(t *testing.T) {
	disableBypass(t)
	// burst=2 means at most 2 immediate tokens; 3rd request must be rejected.
	mw := ratelimit.PerIP(1, 2)
	h := mw(okHandler())

	allowed := 0
	rejected := 0
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/google", nil)
		req.RemoteAddr = "192.0.2.1:1234"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code == http.StatusOK {
			allowed++
		} else {
			assert.Equal(t, http.StatusTooManyRequests, rr.Code)
			rejected++
		}
	}
	require.Equal(t, 2, allowed, "exactly burst=2 requests should pass")
	require.Equal(t, 3, rejected, "remaining requests should be rate-limited")
}

func TestPerIP_DifferentIPs(t *testing.T) {
	disableBypass(t)
	// Each IP has its own bucket; different IPs should not share limits.
	mw := ratelimit.PerIP(1, 1)
	h := mw(okHandler())

	for _, ip := range []string{"10.0.0.1:80", "10.0.0.2:80", "10.0.0.3:80"} {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = ip
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code, "first request from %s should pass", ip)
	}
}

func TestPerUser_Exhausted(t *testing.T) {
	disableBypass(t)
	// burst=2; third write from same user must be 429.
	mw := ratelimit.PerUser(30, 2)
	h := mw(okHandler())

	allowed := 0
	rejected := 0
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/sync/push", nil)
		ctx := httpx.WithUserID(req.Context(), "user-abc")
		req = req.WithContext(ctx)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code == http.StatusOK {
			allowed++
		} else {
			assert.Equal(t, http.StatusTooManyRequests, rr.Code)
			rejected++
		}
	}
	require.Equal(t, 2, allowed, "exactly burst=2 requests should pass")
	require.Equal(t, 3, rejected, "remaining requests should be rate-limited")
}

func TestPerUser_NoUserID_Passthrough(t *testing.T) {
	disableBypass(t)
	// Without a user ID in context, PerUser must pass through (let session mw handle it).
	mw := ratelimit.PerUser(1, 1)
	h := mw(okHandler())

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code)
	}
}

func TestBypass(t *testing.T) {
	orig := ratelimit.Bypass
	ratelimit.Bypass = true
	t.Cleanup(func() { ratelimit.Bypass = orig })

	// burst=0 would reject everything if bypass weren't active.
	mw := ratelimit.PerIP(1, 0)
	h := mw(okHandler())

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "1.2.3.4:80"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code, "bypass should allow all requests")
}

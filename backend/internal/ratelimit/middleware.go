// Package ratelimit provides per-IP and per-user HTTP rate-limiting middleware
// backed by golang.org/x/time/rate token buckets.
package ratelimit

import (
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// bypass holds whether rate limiting is globally disabled.
// Initialised from RATE_LIMIT_BYPASS env at init; overridable via SetBypass.
var bypass atomic.Bool

func init() {
	bypass.Store(os.Getenv("RATE_LIMIT_BYPASS") == "1")
}

// SetBypass enables or disables rate limiting at runtime. Intended for the
// integration-test harness so tests are not subject to per-IP/per-user limits.
func SetBypass(b bool) {
	bypass.Store(b)
}

// Bypass is a package-level bool kept for the unit tests that set it directly.
// The middleware checks both this var and the atomic bypass flag.
var Bypass bool

const (
	// cleanupInterval is how often the background goroutine purges stale limiters.
	cleanupInterval = 5 * time.Minute
	// staleDuration marks a limiter as stale if it has not been used within this window.
	staleDuration = 10 * time.Minute
)

// limiterEntry bundles a rate.Limiter with its last-seen timestamp.
// mu guards lastSeen to prevent the data race between allow() and cleanup().
type limiterEntry struct {
	limiter  *rate.Limiter
	mu       sync.Mutex
	lastSeen time.Time
}

// touch sets lastSeen to now under the entry's lock.
func (e *limiterEntry) touch(now time.Time) {
	e.mu.Lock()
	e.lastSeen = now
	e.mu.Unlock()
}

// seenBefore reports whether lastSeen is before cutoff, under the entry's lock.
func (e *limiterEntry) seenBefore(cutoff time.Time) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.lastSeen.Before(cutoff)
}

// store is an in-memory map from string key → limiterEntry backed by sync.Map.
// A single background goroutine evicts stale entries.
type store struct {
	m sync.Map
	r rate.Limit
	b int
}

// newStore allocates a store and starts the background cleanup goroutine.
func newStore(r rate.Limit, burst int) *store {
	s := &store{r: r, b: burst}
	go s.cleanup()
	return s
}

// allow returns true if the request is permitted, false if it should be rejected.
func (s *store) allow(key string) bool {
	now := time.Now()
	entry := &limiterEntry{
		limiter:  rate.NewLimiter(s.r, s.b),
		lastSeen: now,
	}
	v, _ := s.m.LoadOrStore(key, entry)
	e := v.(*limiterEntry)
	e.touch(now)
	return e.limiter.Allow()
}

func (s *store) cleanup() {
	t := time.NewTicker(cleanupInterval)
	defer t.Stop()
	for range t.C {
		cutoff := time.Now().Add(-staleDuration)
		s.m.Range(func(k, v any) bool {
			if v.(*limiterEntry).seenBefore(cutoff) {
				s.m.Delete(k)
			}
			return true
		})
	}
}

// isActive returns true if rate limiting should be enforced.
func isActive() bool {
	return !bypass.Load() && !Bypass
}

// PerIP returns a middleware that limits requests per remote IP to rps
// requests/second with the given burst. Keys are derived from r.RemoteAddr
// (chi's RealIP middleware must run first so this reflects the true client IP).
//
// Returns 429 ProblemDetails on exceeded limits.
// Rate limiting is disabled when Bypass is true.
func PerIP(rps int, burst int) func(http.Handler) http.Handler {
	s := newStore(rate.Limit(rps), burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isActive() {
				next.ServeHTTP(w, r)
				return
			}
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}
			if !s.allow(ip) {
				httpx.WriteError(w, r, http.StatusTooManyRequests, "rate-limit-exceeded", "too many requests from this IP")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// PerUser returns a middleware that limits requests per authenticated user to
// rpm requests/minute with the given burst.
//
// httpx.UserID(ctx) must be populated by SessionMiddleware before this runs.
// Returns 429 ProblemDetails on exceeded limits.
// Rate limiting is disabled when Bypass is true.
func PerUser(rpm int, burst int) func(http.Handler) http.Handler {
	s := newStore(rate.Every(time.Minute/time.Duration(rpm)), burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isActive() {
				next.ServeHTTP(w, r)
				return
			}
			uid := httpx.UserID(r.Context())
			if uid == "" {
				// No session yet — let the handler deal with it.
				next.ServeHTTP(w, r)
				return
			}
			if !s.allow(uid) {
				httpx.WriteError(w, r, http.StatusTooManyRequests, "rate-limit-exceeded", "too many requests from this user")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

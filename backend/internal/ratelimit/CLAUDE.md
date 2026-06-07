# internal/ratelimit

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Per-IP and per-user HTTP rate-limit middleware backed by
`golang.org/x/time/rate` token buckets. Used to protect login, reauth, and
per-user mutating endpoints.

## Key files

- `middleware.go` — `PerIP(rps, burst)` and `PerUser(rpm, burst)` middleware; an in-memory `sync.Map` of `limiterEntry`; background cleanup goroutine evicts limiters unused for ≥10 min.
- `middleware_test.go` — unit tests covering allow/deny, bypass, and cleanup eviction.

## Public surface

- `PerIP(rps int, burst int) func(http.Handler) http.Handler`.
- `PerUser(rpm int, burst int) func(http.Handler) http.Handler`.
- `SetBypass(b bool)` — toggle bypass at runtime; the integration-test harness uses this.

## Conventions

- `PerIP` keys off `r.RemoteAddr` AFTER `chimiddleware.RealIP` has run; do not register it before RealIP.
- `PerUser` keys off `httpx.UserID(ctx)`; MUST run AFTER `SessionMiddleware`. If no userID is present, the middleware passes through (the underlying handler will 401).
- Cleanup interval: 5 min. Stale threshold: 10 min. Evictions happen in a single background goroutine started per `store`.
- Bypass is read from `RATE_LIMIT_BYPASS=1` at init; tests flip it via `SetBypass` rather than env mutation.
- 429 response is RFC 9457 problem+json via `httpx.WriteError`. Title: `rate-limit-exceeded`.

## Gotchas

- Two calls to `PerIP(5, 10)` create TWO separate stores with TWO buckets per IP — they don't share state. Compose carefully.
- Bucket configuration on `/v1/auth/google` and reauth endpoints is intentionally tight (5 rps / burst 10). Don't loosen without a security review.
- The store is process-local. Behind a load balancer with sticky sessions this still works; behind a stateless LB, limits become per-instance. The current deployment is single-instance.

## Tests

- Unit tests in `middleware_test.go`. Use `SetBypass` to disable inside tests that aren't testing the limiter itself.
- For end-to-end tests, the harness in `internal/testenv` calls `SetBypass(true)` so other tests are not affected by burst limits.

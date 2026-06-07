# internal/httpx

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Shared HTTP helpers: RFC 9457 problem+json errors, JSON rendering, time
formatting, request-scoped context keys, and the logger middleware.

## Key files

- `errors.go` — `Problem` struct + `WriteError`.
- `render.go` — `WriteJSON` helper (sets content-type, encodes JSON).
- `time.go` — `FormatTime`, `ParseTime` — RFC3339 with millisecond precision.
- `ctx.go` — typed context keys: `UserID`, `DeviceID`, `SessionID`, `FamilyID`, `RequestID`; `With*` setters and getters.
- `middleware.go` — `LoggerMiddleware(*slog.Logger)`; logs method, path, status, duration, request ID.

## Public surface

- `Problem`, `WriteError(w, r, status, title, detail)`, `WriteJSON(w, status, v)`.
- `FormatTime(t time.Time) string`, `ParseTime(s string) (time.Time, error)`.
- Context: `WithRequestID/WithUserID/WithDeviceID/WithSessionID/WithFamilyID` + matching getters.
- `LoggerMiddleware(logger *slog.Logger) func(http.Handler) http.Handler`.

## Conventions

- ALL error responses go through `WriteError`. Never `http.Error` — it bypasses the problem+json contract.
- Time on the wire and in DB is always RFC3339 with `.SSS` (millisecond) precision via `FormatTime`. Parsing rejects formats without milliseconds.
- Context keys use an unexported `contextKey` type to prevent collisions across packages.
- `instance` field in `Problem` is set to `r.URL.Path`. Do not pass user input there.
- Title is a short kebab-case slug (e.g. `bad-request`, `unauthenticated`, `family-required`, `rate-limit-exceeded`). Detail is a human-readable hint; safe to surface to the client.

## Gotchas

- `WriteError` sets the response body via `json.NewEncoder(w).Encode`. The status header MUST be set before writing — `WriteError` already calls `w.WriteHeader` in the right order; if you call it after `w.Write`, the header is locked.
- `WriteJSON` does NOT set `Cache-Control`. Add `Cache-Control: no-store` explicitly on auth/session responses (see `auth/middleware.go`).
- The logger middleware reads `chimiddleware.RequestID`; if you bypass chi's RequestID, log entries will lack the correlation ID.

## Tests

- No tests in this package. Helpers are exercised end-to-end by integration tests in `internal/auth`, `internal/family`, `internal/sync`.
- If you add semantics here (e.g. richer Problem fields), add a dedicated test file at the same time.

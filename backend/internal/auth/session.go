package auth

// Opaque sessions per architecture.md §7.8.
//
// Token format on the wire: "<sessionID>.<base64urlToken>". The sessionID lets us
// fetch the row without scanning by hash; the token is the secret. Server stores
// only sha256(token) so a database breach yields nothing reusable.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// ErrInvalidSession is returned for any cookie-validation failure.
var ErrInvalidSession = errors.New("invalid session")

const (
	cookieName      = "__Host-session"
	cookieMaxAge    = 2592000 // 30 days in seconds
	cacheTTL        = 60 * time.Second
	rotateThreshold = 24 * time.Hour
	tokenBytes      = 32
	// deviceTouchThreshold caps how often devices.last_seen_at is updated per
	// device — at most once per hour, best-effort.
	deviceTouchThreshold = time.Hour
)

// SessionInfo carries the validated session data back to the caller.
type SessionInfo struct {
	SessionID        string
	UserID           string
	DeviceID         string
	DeviceStatus     string
	DeviceLastSeenAt time.Time // zero value if the device has never been touched
	Email            string
	DisplayName      string
	IsAdmin          bool
	IsRoot           bool
	LastUsedAt       time.Time
	Suspended        bool
}

// cacheEntry holds a cached SessionInfo with an expiry time.
type cacheEntry struct {
	info      *SessionInfo
	expiresAt time.Time
}

// sessionCache is a TTL-only in-process cache keyed by sha256(token).
// TODO(load): cap to 1000 entries with LRU once user count grows.
var sessionCache sync.Map // map[[32]byte]cacheEntry

// Mint creates a new session for the device. Returns the cookie value the caller
// must send to the client (HttpOnly cookie). The raw token is NEVER persisted.
func Mint(ctx context.Context, db *sql.DB, deviceID string, now time.Time) (cookieValue string, sessionID string, err error) {
	return MintWithQueries(ctx, gen.New(db), deviceID, now)
}

// MintWithQueries is the tx-aware variant of Mint. Pass a *gen.Queries bound to
// a transaction so the session row is inserted in the same atomic unit as the
// caller's other writes (e.g. user + device upsert in the sign-in handler).
//
// This avoids the previous "stranded device row, no session" failure mode
// (B4c): if the outer tx rolls back, the session insert is rolled back too.
func MintWithQueries(ctx context.Context, q *gen.Queries, deviceID string, now time.Time) (cookieValue string, sessionID string, err error) {
	rawToken, hash, err := generateToken()
	if err != nil {
		return "", "", err
	}

	sessionID, err = newSessionID()
	if err != nil {
		return "", "", err
	}

	nowStr := httpx.FormatTime(now)
	if err := q.InsertSession(ctx, gen.InsertSessionParams{
		ID:         sessionID,
		DeviceID:   deviceID,
		TokenHash:  hash[:],
		CreatedAt:  nowStr,
		LastUsedAt: nowStr,
	}); err != nil {
		return "", "", err
	}

	cookieValue = buildCookieValue(sessionID, rawToken)
	return cookieValue, sessionID, nil
}

// Validate parses the cookie value, looks up by hashed token, returns the session
// info. Cache hits are 60s old at most. Returns ErrInvalidSession on any failure
// (missing, revoked, suspended user, bad format).
func Validate(ctx context.Context, db *sql.DB, cookieValue string, now time.Time) (*SessionInfo, error) {
	_, rawToken, err := parseCookieValue(cookieValue)
	if err != nil {
		return nil, ErrInvalidSession
	}

	hash := sha256.Sum256(rawToken)

	// Check cache first.
	if v, ok := sessionCache.Load(hash); ok {
		entry := v.(cacheEntry)
		if now.Before(entry.expiresAt) {
			if entry.info.Suspended {
				return nil, ErrInvalidSession
			}
			return entry.info, nil
		}
		// Expired — remove and fall through to DB.
		sessionCache.Delete(hash)
	}

	q := gen.New(db)
	row, err := q.GetSessionByTokenHash(ctx, hash[:])
	if err != nil {
		// sql.ErrNoRows means revoked or not found — both map to ErrInvalidSession.
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidSession
		}
		return nil, err
	}

	lastUsedAt, err := httpx.ParseTime(row.LastUsedAt)
	if err != nil {
		return nil, ErrInvalidSession
	}

	// Revoked devices are flatly invalid. 'pending' devices keep a usable
	// session because they need it to subscribe to /v1/sync/live and receive
	// the device.activated SSE event from their family peer; family-scoped
	// mutating endpoints are still blocked by other guards.
	// (The original B4j proposal would block 'pending' here, but that breaks
	// the second-device-join SSE flow — see family/devices.go.)
	if row.DeviceStatus == "revoked" {
		return nil, ErrInvalidSession
	}

	var deviceLastSeenAt time.Time
	if row.DeviceLastSeenAt.Valid {
		if t, parseErr := httpx.ParseTime(row.DeviceLastSeenAt.String); parseErr == nil {
			deviceLastSeenAt = t
		}
	}

	info := &SessionInfo{
		SessionID:        row.SessionID,
		UserID:           row.UserID,
		DeviceID:         row.DeviceID,
		DeviceStatus:     row.DeviceStatus,
		DeviceLastSeenAt: deviceLastSeenAt,
		Email:            row.Email,
		DisplayName:      row.DisplayName,
		IsAdmin:          row.IsAdmin != 0,
		IsRoot:           row.IsRoot != 0,
		LastUsedAt:       lastUsedAt,
		Suspended:        row.SuspendedAt.Valid,
	}

	// Store in cache.
	sessionCache.Store(hash, cacheEntry{
		info:      info,
		expiresAt: now.Add(cacheTTL),
	})

	if info.Suspended {
		return nil, ErrInvalidSession
	}

	// The request authenticated via the CURRENT token_hash (not the
	// previous_token_hash), and a previous_token_hash is still set from an
	// earlier rotation. The client has demonstrably picked up the new
	// cookie, so drop the old token here (best-effort, once).
	//
	// This makes the real grace window much shorter than the ~24h rotation
	// cadence might suggest: previous_token_hash tolerates only the single
	// in-flight request that was already dispatched with the old cookie
	// before the client observed the rotated Set-Cookie header — once any
	// request comes in on the new token, the old one is invalidated
	// immediately. A request that still races in on the old cookie AFTER
	// this clear gets a 401; the client's global 401 interceptor (B8, see
	// src/services/auth/client.ts) covers that rare case, so we don't need
	// to widen the server-side window to compensate.
	if row.PreviousTokenHash != nil && bytes.Equal(row.TokenHash, hash[:]) {
		if err := q.ClearPreviousSessionToken(ctx, row.SessionID); err != nil {
			slog.WarnContext(ctx, "session: clear previous token hash failed", "err", err)
		}
	}

	return info, nil
}

// PendingRotation is what TouchAndMaybeRotate returns when a token rotation
// has been prepared but not yet committed. The middleware calls Commit only
// after next.ServeHTTP returns successfully, so a panic before the response
// is fully written means the rotation row is never written and the client
// keeps using its existing cookie (B4d).
//
// When Rotated is false, NewCookieValue is empty and Commit is a no-op.
type PendingRotation struct {
	Rotated        bool
	NewCookieValue string

	// commit applies the rotation against the DB; nil when Rotated is false.
	commit func(context.Context) error
}

// Commit persists the rotation. Safe to call exactly once. If err is non-nil
// the rotation was NOT applied and the caller MUST NOT have set the new cookie
// on the response.
func (p *PendingRotation) Commit(ctx context.Context) error {
	if !p.Rotated || p.commit == nil {
		return nil
	}
	return p.commit(ctx)
}

// TouchAndMaybeRotate updates last_used_at synchronously; if > 24h elapsed it
// PREPARES a token rotation but does not commit it yet. The middleware commits
// the rotation only after next.ServeHTTP returns without panic — this avoids
// the failure mode where rotation succeeded, the cookie was set, but the
// request handler panicked before writing a response, leaving the client with
// a new token bound to a half-finished request (B4d).
func TouchAndMaybeRotate(ctx context.Context, db *sql.DB, info *SessionInfo, now time.Time) (PendingRotation, error) {
	q := gen.New(db)
	nowStr := httpx.FormatTime(now)

	if now.Sub(info.LastUsedAt) > rotateThreshold {
		// Generate the new token now so the cookie can be queued for the
		// response, but defer the DB write until after the handler returns.
		rawToken, hash, err := generateToken()
		if err != nil {
			return PendingRotation{}, err
		}

		newCookie := buildCookieValue(info.SessionID, rawToken)
		sessionID := info.SessionID
		snapshot := *info // capture for cache write after commit
		snapshot.LastUsedAt = now

		commit := func(commitCtx context.Context) error {
			if err := q.RotateSessionToken(commitCtx, gen.RotateSessionTokenParams{
				TokenHash:  hash[:],
				LastUsedAt: nowStr,
				ID:         sessionID,
			}); err != nil {
				return err
			}
			// Cache the rotated token so the next request hits the fast path.
			// The old hash entry expires naturally within cacheTTL.
			sessionCache.Store(hash, cacheEntry{
				info:      &snapshot,
				expiresAt: now.Add(cacheTTL),
			})
			return nil
		}

		return PendingRotation{Rotated: true, NewCookieValue: newCookie, commit: commit}, nil
	}

	// Just touch. last_used_at maintenance is safe before the handler runs
	// because it does not change session validity, only metadata.
	if err := q.TouchSession(ctx, gen.TouchSessionParams{
		LastUsedAt: nowStr,
		ID:         info.SessionID,
	}); err != nil {
		return PendingRotation{}, err
	}

	return PendingRotation{}, nil
}

// TouchDeviceIfStale updates devices.last_seen_at when it is more than
// deviceTouchThreshold old (or never set), best-effort. Callers should not
// fail the request on error.
func TouchDeviceIfStale(ctx context.Context, db *sql.DB, info *SessionInfo, now time.Time) error {
	if !info.DeviceLastSeenAt.IsZero() && now.Sub(info.DeviceLastSeenAt) < deviceTouchThreshold {
		return nil
	}
	q := gen.New(db)
	return q.TouchDevice(ctx, gen.TouchDeviceParams{
		LastSeenAt: sql.NullString{String: httpx.FormatTime(now), Valid: true},
		ID:         info.DeviceID,
	})
}

// Revoke marks the session as revoked in the database. The in-memory cache
// (keyed by token hash) does NOT track sessionID, so it is not evicted here;
// stale entries expire within the 60s TTL window. Callers that need
// immediately-fresh validation can flush the cache via the test-only helper.
func Revoke(ctx context.Context, db *sql.DB, sessionID string, now time.Time) error {
	q := gen.New(db)
	return q.RevokeSession(ctx, gen.RevokeSessionParams{
		RevokedAt: sql.NullString{String: httpx.FormatTime(now), Valid: true},
		ID:        sessionID,
	})
}

// RevokeAll marks every session for the user as revoked in the database.
// Cache entries (keyed by token hash) are not evicted here; they expire within
// the 60s TTL window. Used on signout-all.
func RevokeAll(ctx context.Context, db *sql.DB, userID string, now time.Time) error {
	q := gen.New(db)
	return q.RevokeAllUserSessions(ctx, gen.RevokeAllUserSessionsParams{
		RevokedAt: sql.NullString{String: httpx.FormatTime(now), Valid: true},
		UserID:    userID,
	})
}

// RevokeAllForDevice marks every session bound to a specific device as revoked
// in the database. Cache entries expire within the 60s TTL window. Used on
// device sign-out (per BR §3.10) and on family kick (per BR §3.33).
func RevokeAllForDevice(ctx context.Context, db *sql.DB, deviceID string, now time.Time) error {
	q := gen.New(db)
	return q.RevokeAllDeviceSessions(ctx, gen.RevokeAllDeviceSessionsParams{
		RevokedAt: sql.NullString{String: httpx.FormatTime(now), Valid: true},
		DeviceID:  deviceID,
	})
}

// SetCookie writes the __Host-session cookie. Per architecture §7.8: HttpOnly,
// Secure, SameSite=Lax, Path=/, Max-Age=2592000.
func SetCookie(w http.ResponseWriter, cookieValue string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    cookieValue,
		Path:     "/",
		MaxAge:   cookieMaxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearCookie writes an expired __Host-session cookie.
func ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// generateToken produces 32 random bytes and returns (rawToken, sha256Hash, error).
func generateToken() ([]byte, [32]byte, error) {
	raw := make([]byte, tokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return nil, [32]byte{}, err
	}
	hash := sha256.Sum256(raw)
	return raw, hash, nil
}

// newSessionID returns a UUID v7 string.
func newSessionID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

// buildCookieValue encodes "<sessionID>.<base64urlToken>".
func buildCookieValue(sessionID string, rawToken []byte) string {
	encoded := base64.RawURLEncoding.EncodeToString(rawToken)
	return sessionID + "." + encoded
}

// parseCookieValue splits "<sessionID>.<base64urlToken>" and returns (sessionID, rawToken, error).
// Rejects empty, no-dot, or bad base64.
func parseCookieValue(cookieValue string) (string, []byte, error) {
	if cookieValue == "" {
		return "", nil, ErrInvalidSession
	}
	// Split on first dot only — sessionID may not contain dots but base64url can't either;
	// still be explicit about "first dot" to be safe.
	idx := strings.IndexByte(cookieValue, '.')
	if idx < 1 {
		return "", nil, ErrInvalidSession
	}
	sessionID := cookieValue[:idx]
	tokenStr := cookieValue[idx+1:]
	if tokenStr == "" {
		return "", nil, ErrInvalidSession
	}
	rawToken, err := base64.RawURLEncoding.DecodeString(tokenStr)
	if err != nil || len(rawToken) != tokenBytes {
		return "", nil, ErrInvalidSession
	}
	return sessionID, rawToken, nil
}

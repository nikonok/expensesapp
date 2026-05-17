//go:build integration

// Package testenv boots a fresh server backed by an in-memory SQLite for
// integration tests. Each call to New() returns an isolated environment.
package testenv

import (
	"context"
	"crypto/tls"
	"database/sql"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/nikonok/expensesapp/backend/internal/account"
	"github.com/nikonok/expensesapp/backend/internal/admin"
	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	dbpkg "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/server"
)

// clientTLSConfig extracts the TLS client config from an httptest.Server's
// singleton client. httptest.Server.Client() always returns the same pointer,
// but the TLS config embedded in its transport is safe to share read-only.
func clientTLSConfig(srv *httptest.Server) *tls.Config {
	tr, ok := srv.Client().Transport.(*http.Transport)
	if !ok || tr.TLSClientConfig == nil {
		return nil
	}
	return tr.TLSClientConfig
}

// MockVerifier is a test double for auth.Verifier.
// Set Claims to return a successful result, or set Err to return an error.
type MockVerifier struct {
	Claims *authpkg.Claims
	Err    error
}

// Verify implements auth.Verifier.
func (m *MockVerifier) Verify(_ context.Context, _ string) (*authpkg.Claims, error) {
	return m.Claims, m.Err
}

// Env is an isolated test environment with a running httptest.Server backed by
// an in-memory SQLite database.
type Env struct {
	// DB is the raw *sql.DB for direct query inspection.
	DB *sql.DB
	// Server is the httptest.Server (already started).
	Server *httptest.Server
	// Client is a pre-configured *http.Client with a cookie jar.
	// Each call to NewClient returns an independent client — use that when
	// tests need to simulate multiple concurrent sessions.
	Client *http.Client
	// Verifier is the mock verifier wired into the auth handler.
	// Tests set Verifier.Claims and Verifier.Err before each POST /v1/auth/google call.
	Verifier *MockVerifier
	// Now is the clock function used in MintSession.
	Now func() time.Time

	// tlsCfg is the TLS configuration for building independent clients.
	tlsCfg *tls.Config
}

// config holds optional overrides for New.
type config struct {
	bootstrapEmail string
}

// Option is a functional option for New.
type Option func(*config)

// WithBootstrapEmail configures the bootstrap admin email used by EnsureBootstrap.
func WithBootstrapEmail(email string) Option {
	return func(c *config) {
		c.bootstrapEmail = email
	}
}

// New boots a fresh server backed by an in-memory SQLite database.
// Caller must defer env.Close().
func New(t *testing.T, opts ...Option) *Env {
	t.Helper()

	cfg := &config{
		bootstrapEmail: "root@example.com",
	}
	for _, o := range opts {
		o(cfg)
	}

	ctx := context.Background()

	// 1. Open in-memory SQLite and run migrations.
	database, err := dbpkg.Open(ctx, ":memory:")
	require.NoError(t, err)

	// 2. Run EnsureBootstrap.
	require.NoError(t, admin.EnsureBootstrap(ctx, database, cfg.bootstrapEmail))

	// 3. Build handlers with mock verifier.
	verifier := &MockVerifier{}
	authH := authpkg.NewHandler(database, verifier)
	accountH := account.NewHandler(database)

	// 4. Build router using the shared server.NewRouter (same as production).
	r := server.NewRouter(database, authH, accountH, server.HealthConfig{}, nil)

	// 5. Start httptest.Server with TLS so that Secure cookies are honoured by the jar.
	srv := httptest.NewTLSServer(r)

	// Extract the TLS client config (with the test server's self-signed cert in its
	// RootCAs pool) from the singleton transport.  We share this read-only config
	// across all independent clients we create.
	tlsCfg := clientTLSConfig(srv)

	// 6. Create the env's primary http.Client — a fresh independent client (not the
	// shared srv.Client() singleton) with its own cookie jar.
	client := newIndependentClient(tlsCfg)

	return &Env{
		DB:       database,
		Server:   srv,
		Client:   client,
		Verifier: verifier,
		Now:      time.Now,
		tlsCfg:   tlsCfg,
	}
}

// NewClient returns a new independent *http.Client that trusts the test server's
// TLS certificate and has its own empty cookie jar. Use this when a test needs
// two or more concurrent sessions.
func (e *Env) NewClient() *http.Client {
	return newIndependentClient(e.tlsCfg)
}

// newIndependentClient builds an *http.Client with a fresh cookie jar.
// It uses the provided TLS config so it trusts the test server's cert.
func newIndependentClient(tlsCfg *tls.Config) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: tlsCfg,
		},
		Jar: jar,
	}
}

// Close releases the resources held by the environment (server + DB).
func (e *Env) Close() {
	e.Server.Close()
	_ = e.DB.Close()
}

// MintSession is a convenience that inserts a user+device+session row directly
// and returns the cookie value, userID, and deviceID.
// Use this in tests that don't need to exercise the sign-in HTTP flow.
func (e *Env) MintSession(t *testing.T, email string) (sessionCookie string, userID string, deviceID string) {
	t.Helper()
	ctx := context.Background()
	q := gen.New(e.DB)
	now := e.Now().UTC()
	nowStr := httpx.FormatTime(now)

	// Upsert user.
	user, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           mustUUID(t),
		Email:        email,
		DisplayName:  email,
		CreatedAt:    nowStr,
		LastSigninAt: sql.NullString{String: nowStr, Valid: true},
	})
	require.NoError(t, err)

	// Insert device.
	device, err := q.InsertDevice(ctx, gen.InsertDeviceParams{
		ID:         mustUUID(t),
		UserID:     user.ID,
		Label:      "test-device",
		PubKey:     make([]byte, 32),
		Status:     "active",
		CreatedAt:  nowStr,
		LastSeenAt: sql.NullString{String: nowStr, Valid: true},
	})
	require.NoError(t, err)

	// Mint session.
	cookieVal, _, err := authpkg.Mint(ctx, e.DB, device.ID, now)
	require.NoError(t, err)

	return cookieVal, user.ID, device.ID
}

// mustUUID generates a UUID v7 string, panicking on error.
func mustUUID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

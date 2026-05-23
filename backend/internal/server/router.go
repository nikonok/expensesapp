// Package server wires the chi router used by both production and integration tests.
package server

import (
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/nikonok/expensesapp/backend/internal/account"
	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/family"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/version"
)

// HealthConfig carries the data the health endpoint needs.
type HealthConfig struct {
	// Version is a human-readable build version string (e.g. "dev+unknown").
	// When empty, version.String() is used.
	Version string
}

// NewRouter wires the chi router used by both production and tests.
// Keep this in sync with the route table in architecture.md §6.2.
// If logger is nil, slog.Default() is used.
func NewRouter(db *sql.DB, authH *authpkg.Handler, accountH *account.Handler, familyH *family.Handler, cfg HealthConfig, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Recoverer)
	r.Use(httpx.LoggerMiddleware(logger))

	// Public write endpoint — CSRF-gated but no session required.
	r.Group(func(r chi.Router) {
		r.Use(authpkg.CSRFHeaderGate)
		r.Post("/v1/auth/google", authH.PostGoogle)
	})

	// Always-public health endpoint — no auth, no CSRF gate.
	r.Get("/v1/health", healthHandler(cfg))

	// Protected endpoints — CSRF-gated and session required.
	r.Group(func(r chi.Router) {
		r.Use(authpkg.CSRFHeaderGate)
		r.Use(authpkg.SessionMiddleware(db))
		r.Post("/v1/auth/signout", authH.PostSignout)
		r.Post("/v1/auth/signout-all", authH.PostSignoutAll)
		r.Get("/v1/me", accountH.GetMe)
		r.Get("/v1/me/devices", accountH.GetMyDevices)
		r.Post("/v1/me/devices/{id}/revoke", accountH.RevokeMyDevice)

		// Family endpoints (Phase 3+).
		r.Post("/v1/family/init", familyH.PostInit)
		r.Post("/v1/family/invites", familyH.PostInvite)
		r.Get("/v1/family/invites/incoming", familyH.GetIncomingInvites)
		r.Post("/v1/family/invites/{id}/accept", familyH.PostAcceptInvite)
		r.Post("/v1/family/invites/{id}/decline", familyH.PostDeclineInvite)
		r.Post("/v1/family/migrate-solo", familyH.PostMigrateSolo)
		r.Post("/v1/family/leave", familyH.PostLeave)
		r.Post("/v1/family/members/{userId}/remove", familyH.PostRemoveMember)
		r.Post("/v1/family/devices/{id}/envelope", familyH.PostDeviceEnvelope)
	})

	return r
}

func healthHandler(cfg HealthConfig) http.HandlerFunc {
	ver := cfg.Version
	if ver == "" {
		ver = version.String()
	}
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"version": ver,
			"time":    time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		})
	}
}

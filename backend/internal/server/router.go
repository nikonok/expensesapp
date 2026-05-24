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
	"github.com/nikonok/expensesapp/backend/internal/admin"
	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/family"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
	"github.com/nikonok/expensesapp/backend/internal/push"
	"github.com/nikonok/expensesapp/backend/internal/snapshot"
	syncp "github.com/nikonok/expensesapp/backend/internal/sync"
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
func NewRouter(db *sql.DB, authH *authpkg.Handler, reauthH *authpkg.ReauthHandler, accountH *account.Handler, familyH *family.Handler, syncH *syncp.Handler, liveH *live.Handler, snapshotH *snapshot.Handler, pushH *push.Handler, adminH *admin.Handler, cfg HealthConfig, logger *slog.Logger) http.Handler {
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

		// Reauth endpoints (Phase 6+).
		r.Post("/v1/reauth/challenge", reauthH.PostChallenge)
		r.Post("/v1/reauth/verify", reauthH.PostVerify)

		// Recovery endpoints (Phase 6+).
		r.Post("/v1/account/recovery/reveal", accountH.PostRecoveryReveal)
		r.Post("/v1/account/recovery/regenerate", accountH.PostRecoveryRegenerate)

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

		// Sync + live + family-envelope endpoints (Phase 4+) — require active family membership.
		r.Group(func(r chi.Router) {
			r.Use(authpkg.RequireFamilyMembership(db))
			r.Post("/v1/sync/push", syncH.PostPush)
			r.Get("/v1/sync/pull", syncH.GetPull)
			r.Get("/v1/sync/live", liveH.GetLive)
			r.Get("/v1/family/recovery-envelope", familyH.GetRecoveryEnvelope)

			// Snapshot endpoints (Phase 8+).
			r.Get("/v1/snapshots", snapshotH.GetSnapshots)
			r.Post("/v1/snapshots/{date}/restore", snapshotH.PostRestore)
		})

		// Push subscription endpoints (Phase 9+).
		r.Post("/v1/push/subscribe", pushH.PostSubscribe)
		r.Delete("/v1/push/subscribe/{id}", pushH.DeleteSubscribe)

		// Notification settings + dismiss endpoints (Phase 9+).
		r.Get("/v1/notifications/settings", pushH.GetNotificationSettings)
		r.Patch("/v1/notifications/settings", pushH.PatchNotificationSettings)
		r.Post("/v1/notifications/dismiss", pushH.PostDismiss)

		// Admin endpoints (Phase 10+) — require admin or root role.
		r.Group(func(r chi.Router) {
			r.Use(authpkg.RequireAdmin(db))
			r.Get("/v1/admin/users", adminH.GetUsers)
			r.Post("/v1/admin/users/{id}/suspend", adminH.PostSuspendUser)
			r.Post("/v1/admin/users/{id}/unsuspend", adminH.PostUnsuspendUser)
			r.Get("/v1/admin/allowlist", adminH.GetAllowlist)
			r.Post("/v1/admin/allowlist", adminH.PostAllowlist)
			r.Delete("/v1/admin/allowlist/{email}", adminH.DeleteAllowlist)
			r.Post("/v1/admin/admins/{id}/promote", adminH.PostPromoteAdmin)
			r.Post("/v1/admin/admins/{id}/demote", adminH.PostDemoteAdmin)
			r.Get("/v1/admin/audit", adminH.GetAuditLog)
			r.Post("/v1/admin/devices/{id}/revoke", adminH.PostRevokeDevice)
		})
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

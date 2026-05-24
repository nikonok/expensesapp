package account

// purge.go — PurgePendingDeletions: hard-deletes users whose grace period has elapsed.
// See architecture.md §6.2 and §6.5 for the API contract.

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// PurgePendingDeletions hard-deletes all users whose delete_after <= now.
// For each user:
//  1. Soft-leave any active family memberships.
//  2. Hard-delete the user row — CASCADE FKs sweep devices, sessions,
//     push_subscriptions, reauth_grants, reauth_challenges,
//     notification_settings, held_notifications.
//  3. Audit log: user.delete.executed.
//
// Returns the count of successfully purged users.
func PurgePendingDeletions(ctx context.Context, db *sql.DB, now time.Time) int {
	nowStr := httpx.FormatTime(now)
	q := gen.New(db)

	pending, err := q.ListUsersPendingDeletion(ctx, nowStr)
	if err != nil {
		slog.ErrorContext(ctx, "purge: list pending deletions failed", "err", err)
		return 0
	}
	if len(pending) == 0 {
		return 0
	}

	slog.InfoContext(ctx, "purge: processing pending deletions", "count", len(pending))

	purged := 0
	for _, u := range pending {
		if ctx.Err() != nil {
			slog.InfoContext(ctx, "purge: context cancelled, stopping early")
			break
		}
		if err := purgeUser(ctx, db, u.ID, nowStr); err != nil {
			slog.WarnContext(ctx, "purge: failed to purge user",
				"user_id", u.ID, "err", err)
			continue
		}
		purged++
	}

	slog.InfoContext(ctx, "purge: done", "purged", purged, "total", len(pending))
	return purged
}

// purgeUser transactionally soft-leaves families, hard-deletes the user, and audits.
func purgeUser(ctx context.Context, db *sql.DB, userID, nowStr string) error {
	return internaldb.WithTx(ctx, db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// 1. Soft-leave all active family memberships.
		if err := qt.SoftLeaveAllFamilies(ctx, gen.SoftLeaveAllFamiliesParams{
			LeftAt: nowStr,
			UserID: userID,
		}); err != nil {
			return err
		}

		// 2. Remove rows with non-CASCADE FK references to users(id):
		//    a) allowlist entries added by this user (ON DELETE RESTRICT).
		if err := qt.DeleteAllowlistByAddedBy(ctx, userID); err != nil {
			return err
		}
		//    b) pending family invites created by this user (default NO ACTION).
		if err := qt.DeleteFamilyInvitesByInvitedBy(ctx, userID); err != nil {
			return err
		}

		// 3. Audit before delete (actor_email snapshot while user row still exists).
		if err := recoveryAudit(ctx, qt, userID, "user.delete.executed", "user", userID, nowStr); err != nil {
			return err
		}

		// 4. Hard-delete the user. CASCADE FKs remove:
		//    devices → sessions, reauth_grants, reauth_challenges, push_subscriptions,
		//    device_envelopes, family_members, notification_settings, held_notifications.
		return qt.HardDeleteUser(ctx, userID)
	})
}

// PurgeOne immediately purges a single user regardless of delete_after.
// Used by the admin delete-immediate endpoint.
func PurgeOne(ctx context.Context, db *sql.DB, userID string) error {
	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)
	return purgeUser(ctx, db, userID, nowStr)
}

// newPurgePendingJob returns a job function for the daily purge runner.
// It is called once at startup and then daily at 04:00 UTC.
func newPurgePendingJob(db *sql.DB) func(ctx context.Context) {
	return func(ctx context.Context) {
		_ = PurgePendingDeletions(ctx, db, time.Now().UTC())
	}
}

// EnsurePurgeOnStartup runs PurgePendingDeletions once synchronously so
// any overdue deletions are processed before the server starts serving.
func EnsurePurgeOnStartup(ctx context.Context, db *sql.DB) {
	n := PurgePendingDeletions(ctx, db, time.Now().UTC())
	if n > 0 {
		slog.InfoContext(ctx, "startup purge: purged overdue accounts", "count", n)
	}
}

// DeleteAfterJob returns the function run by the daily purge ScheduledJob.
// Exported so jobs/deletion_purge.go can use it.
func DeleteAfterJob(db *sql.DB) func(ctx context.Context) {
	return newPurgePendingJob(db)
}

package account

// purge.go — PurgePendingDeletions: hard-deletes or PII-scrubs users whose
// grace period has elapsed. See architecture.md §6.2 and §6.5 for the API
// contract.

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// scrubbedDisplayName replaces a purged user's display_name when the row
// survives as a PII-scrubbed tombstone.
const scrubbedDisplayName = "Deleted User"

// PurgePendingDeletions purges (hard-deletes or PII-scrubs) all users whose
// delete_after <= now. For each user:
//  1. Soft-leave any active family memberships.
//  2. Cascade-delete any family that is now empty (no active members left) —
//     E2E ciphertext for a family with no surviving members must not be kept
//     forever.
//  3. Remove rows with non-CASCADE FK references to users(id): allowlist
//     entries, pending invites, migration records, and devices (which cascade
//     sessions/reauth/push subscriptions/envelopes).
//  4. Audit log: user.delete.executed.
//  5. If the user still has record_meta OR snapshot_entries references
//     (added_by_user / edited_by_user) in a surviving shared family, those
//     FKs are RESTRICT-by-omission and the referenced blobs' AAD is bound to
//     those user IDs — hard-deleting would either fail the FK or force
//     rewriting AAD-bound fields. Instead, scrub the user row's PII and keep
//     it as a tombstone. Otherwise, hard-delete the user row.
//
// Returns the count of successfully purged users.
func PurgePendingDeletions(ctx context.Context, db *sql.DB, now time.Time) int {
	nowStr := httpx.FormatTime(now)
	q := gen.New(db)

	pending, err := q.ListUsersPendingDeletion(ctx, sql.NullString{String: nowStr, Valid: true})
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

// purgeUser transactionally soft-leaves families, cascade-deletes any family
// that becomes empty, cleans up non-CASCADE FK references, audits, and then
// either hard-deletes or PII-scrubs the user row depending on whether any
// record_meta rows still reference it.
func purgeUser(ctx context.Context, db *sql.DB, userID, nowStr string) error {
	return internaldb.WithTx(ctx, db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// 0. Capture families the user is currently an active member of,
		// before soft-leaving, so we can check which become empty.
		familyIDs, err := qt.ListActiveFamilyIDsForUser(ctx, userID)
		if err != nil {
			return err
		}

		// 1. Soft-leave all active family memberships.
		if err := qt.SoftLeaveAllFamilies(ctx, gen.SoftLeaveAllFamiliesParams{
			LeftAt: sql.NullString{String: nowStr, Valid: true},
			UserID: userID,
		}); err != nil {
			return err
		}

		// 2. Cascade-delete any family that now has zero active members.
		for _, familyID := range familyIDs {
			remaining, err := qt.CountActiveFamilyMembers(ctx, familyID)
			if err != nil {
				return err
			}
			if remaining == 0 {
				if err := qt.DeleteFamilyCascade(ctx, familyID); err != nil {
					return err
				}
			}
		}

		// 3. Remove rows with non-CASCADE FK references to users(id):
		//    a) allowlist entries added by this user (ON DELETE RESTRICT).
		if err := qt.DeleteAllowlistByAddedBy(ctx, userID); err != nil {
			return err
		}
		//    b) pending family invites created by this user.
		if err := qt.DeleteFamilyInvitesByInvitedBy(ctx, userID); err != nil {
			return err
		}
		//    c) solo-to-family migration idempotency records.
		if err := qt.DeleteMigrationsByUser(ctx, userID); err != nil {
			return err
		}
		//    d) devices — cascades sessions (-> reauth_challenges/grants),
		//       device_envelopes, and push_subscriptions.
		if err := qt.DeleteDevicesByUser(ctx, userID); err != nil {
			return err
		}

		// 4. Audit before mutating/deleting the user row (email snapshot
		// while the row still has its real identity).
		if err := recoveryAudit(ctx, qt, userID, "user.delete.executed", "user", userID, nowStr); err != nil {
			return err
		}

		// 5. Decide hard-delete vs PII-scrub tombstone: record_meta.added_by_user
		// / edited_by_user have no ON DELETE clause (RESTRICT), and rewriting
		// them would break the AAD binding on the referenced blob for any
		// surviving shared family. Only hard-delete when no references remain.
		//
		// snapshot_entries.added_by_user/edited_by_user (migration 00005) have
		// the same RESTRICT-by-omission FK and the same AAD-binding
		// constraint, but are captured verbatim at snapshot time and are NOT
		// kept in sync with record_meta — a later edit by another family
		// member overwrites record_meta.edited_by_user while a live (≤30-day)
		// snapshot_entries row still names this user as the historical
		// editor. A user in that state would pass the record_meta-only check
		// yet still violate the snapshot_entries FK on HardDeleteUser, so both
		// counts must be checked.
		recordMetaRefs, err := qt.CountRecordMetaRefsForUser(ctx, userID)
		if err != nil {
			return err
		}
		snapshotRefs, err := qt.CountSnapshotEntryRefsForUser(ctx, sql.NullString{String: userID, Valid: true})
		if err != nil {
			return err
		}
		if recordMetaRefs > 0 || snapshotRefs > 0 {
			return qt.ScrubUserPII(ctx, gen.ScrubUserPIIParams{
				Email:       scrubbedEmail(userID),
				DisplayName: scrubbedDisplayName,
				ID:          userID,
			})
		}

		return qt.HardDeleteUser(ctx, userID)
	})
}

// scrubbedEmail returns a deterministic, unique placeholder email for a
// PII-scrubbed user row (email is NOT NULL UNIQUE COLLATE NOCASE).
func scrubbedEmail(userID string) string {
	return "deleted-user-" + userID + "@deleted.invalid"
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

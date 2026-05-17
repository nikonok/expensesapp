// Package admin owns admin-tree mutations and bootstrap-email handling.
package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// EnsureBootstrap is invoked on every startup. It reconciles the configured
// BOOTSTRAP_ADMIN_EMAIL with the bootstrap_state singleton in the database.
// Idempotent on no-op restarts.
//
// Three cases:
//  1. First boot (no bootstrap_state row): write the row. Allowlist insertion is
//     deferred to the first sign-in (Phase 1.g) because allowlist.added_by has a
//     NOT NULL FK on users(id) and no user exists yet.
//  2. Same email as stored (no-op): return nil immediately, no audit entry.
//  3. Different email (handoff): transactional handoff per §8.13.
func EnsureBootstrap(ctx context.Context, sqldb *sql.DB, configuredEmail string) error {
	q := gen.New(sqldb)

	state, err := q.GetBootstrapState(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// First boot: write bootstrap_state only. Allowlist auto-add is deferred
		// to the first sign-in handler because there is no user row yet to satisfy
		// the NOT NULL FK on allowlist.added_by.
		return db.WithTx(ctx, sqldb, func(tx *sql.Tx) error {
			qt := gen.New(tx)
			return qt.UpsertBootstrapState(ctx, gen.UpsertBootstrapStateParams{
				BootstrapEmail: configuredEmail,
				AppliedAt:      httpx.FormatTime(time.Now()),
			})
		})
	}
	if err != nil {
		return fmt.Errorf("get bootstrap state: %w", err)
	}

	// No change — idempotent restart.
	if state.BootstrapEmail == configuredEmail {
		return nil
	}

	// Email changed: perform transactional handoff.
	return db.WithTx(ctx, sqldb, func(tx *sql.Tx) error {
		return handoff(ctx, gen.New(tx), state.BootstrapEmail, configuredEmail)
	})
}

// handoff performs the bootstrap-email change inside an already-open transaction.
// prevEmail is the email stored in bootstrap_state; newEmail is the configured one.
func handoff(ctx context.Context, q *gen.Queries, prevEmail, newEmail string) error {
	now := httpx.FormatTime(time.Now())

	// Locate the prior root (before any mutations so we capture the current state).
	var priorUser *gen.User
	prior, err := q.GetCurrentRoot(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("get current root: %w", err)
	}
	if err == nil {
		priorUser = &prior
	}

	// Locate the new bootstrap user (may not have signed in yet).
	newUser, err := q.GetUserByEmail(ctx, newEmail)
	newUserExists := !errors.Is(err, sql.ErrNoRows)
	if err != nil && newUserExists {
		return fmt.Errorf("get user by email %q: %w", newEmail, err)
	}

	var targetID sql.NullString

	if newUserExists {
		// Promote the new user to root.
		if err := q.SetUserAsRoot(ctx, newUser.ID); err != nil {
			return fmt.Errorf("set user as root: %w", err)
		}
		targetID = sql.NullString{String: newUser.ID, Valid: true}

		// Downgrade the prior root (if different from the new one).
		if priorUser != nil && priorUser.ID != newUser.ID {
			if err := q.DowngradeFromRoot(ctx, priorUser.ID); err != nil {
				return fmt.Errorf("downgrade prior root: %w", err)
			}
			// Re-parent promotion children of the prior root to the new root.
			if err := q.ReparentPromoter(ctx, gen.ReparentPromoterParams{
				PromoterID:   sql.NullString{String: newUser.ID, Valid: true},
				PromoterID_2: sql.NullString{String: priorUser.ID, Valid: true},
			}); err != nil {
				return fmt.Errorf("reparent promoter: %w", err)
			}
		}
	}
	// If newUserExists is false: bootstrap_state is updated and the audit entry is
	// written so the change is tracked. The actual role promotion happens lazily on
	// the new user's first sign-in (Phase 1.g), which reads bootstrap_state.email
	// and grants is_root=1 on insert.

	// Update the singleton.
	if err := q.UpsertBootstrapState(ctx, gen.UpsertBootstrapStateParams{
		BootstrapEmail: newEmail,
		AppliedAt:      now,
	}); err != nil {
		return fmt.Errorf("upsert bootstrap state: %w", err)
	}

	// Audit the change.
	auditID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("new uuid: %w", err)
	}
	detail := fmt.Sprintf(`{"from":%q,"to":%q}`, prevEmail, newEmail)
	if err := q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          auditID.String(),
		ActorUserID: sql.NullString{},
		ActorEmail:  sql.NullString{String: newEmail, Valid: true},
		Action:      "bootstrap.email.change",
		TargetKind:  sql.NullString{String: "admin", Valid: true},
		TargetID:    targetID,
		DetailJson:  sql.NullString{String: detail, Valid: true},
		CreatedAt:   now,
	}); err != nil {
		return fmt.Errorf("insert audit entry: %w", err)
	}

	return nil
}

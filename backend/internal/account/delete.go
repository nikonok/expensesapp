package account

// delete.go — request/cancel account deletion logic (Phase 11).
// See architecture.md §6.2 and §6.5 for the API contract.

import (
	"context"
	"database/sql"
	"errors"
	"time"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// deletionGracePeriod is the 14-day window between request and hard delete.
const deletionGracePeriod = 14 * 24 * time.Hour

// ErrDeletionNotPending is returned by CancelDeletion when no deletion is pending.
var ErrDeletionNotPending = errors.New("no pending deletion")

// RequestDeletion sets delete_after = now + 14d for userID.
// Idempotent: if already set, the existing value is returned unchanged.
// Returns the deleteAfter timestamp string.
func RequestDeletion(ctx context.Context, db *sql.DB, userID string) (string, error) {
	q := gen.New(db)

	// Check if already pending — idempotent: return existing deleteAfter.
	existing, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return "", err
	}
	if existing.DeleteAfter.Valid {
		return existing.DeleteAfter.String, nil
	}

	now := time.Now().UTC()
	deleteAfter := now.Add(deletionGracePeriod)
	deleteAfterStr := httpx.FormatTime(deleteAfter)
	nowStr := httpx.FormatTime(now)

	var updatedUser gen.User
	if err := internaldb.WithTx(ctx, db, func(tx *sql.Tx) error {
		qt := gen.New(tx)
		u, err := qt.SetUserDeleteAfter(ctx, gen.SetUserDeleteAfterParams{
			DeleteAfter: deleteAfterStr,
			ID:          userID,
		})
		if err != nil {
			return err
		}
		updatedUser = u
		return insertAuditTx(ctx, qt, userID, "user.delete.requested", "user", userID, nowStr)
	}); err != nil {
		return "", err
	}

	return updatedUser.DeleteAfter.String, nil
}

// CancelDeletion clears delete_after for userID.
// Returns ErrDeletionNotPending if no deletion is pending.
func CancelDeletion(ctx context.Context, db *sql.DB, userID string) error {
	q := gen.New(db)

	existing, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if !existing.DeleteAfter.Valid {
		return ErrDeletionNotPending
	}

	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)

	return internaldb.WithTx(ctx, db, func(tx *sql.Tx) error {
		qt := gen.New(tx)
		if err := qt.ClearUserDeleteAfter(ctx, userID); err != nil {
			return err
		}
		return insertAuditTx(ctx, qt, userID, "user.delete.canceled", "user", userID, nowStr)
	})
}

// insertAuditTx writes an audit_log row inside an existing transaction.
func insertAuditTx(ctx context.Context, qt *gen.Queries, actorUserID, action, targetKind, targetID, createdAt string) error {
	return recoveryAudit(ctx, qt, actorUserID, action, targetKind, targetID, createdAt)
}

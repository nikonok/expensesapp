package admin

// tree.go — admin promotion tree operations (§8.13).
// IsInSubtree / PromoteToAdmin / DemoteAdmin.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// ErrNotInSubtree is returned when the target user is not in the caller's
// promotion subtree.
var ErrNotInSubtree = errors.New("target user is not in caller's subtree")

// ErrCannotDemoteRoot is returned when an attempt is made to demote the root
// user.
var ErrCannotDemoteRoot = errors.New("root user cannot be demoted")

// maxSubtreeDepth caps the promoter_id walk to prevent infinite loops due to
// data corruption.
const maxSubtreeDepth = 100

// IsInSubtree walks up the promoter_id chain from targetID until callerID is
// reached (returns true) or there are no more parents (returns false). The
// walk is limited to maxSubtreeDepth hops.
//
// The caller must not pass callerID == targetID; that case is treated as false
// (a user is not "above" themselves).
func IsInSubtree(ctx context.Context, q *gen.Queries, callerID, targetID string) (bool, error) {
	current := targetID
	for i := 0; i < maxSubtreeDepth; i++ {
		promoterID, err := q.GetUserPromoterID(ctx, current)
		if errors.Is(err, sql.ErrNoRows) {
			// current user not found — stop the walk.
			return false, nil
		}
		if err != nil {
			return false, fmt.Errorf("get promoter id: %w", err)
		}
		if !promoterID.Valid {
			// Reached the root (promoter_id IS NULL).
			return false, nil
		}
		if promoterID.String == callerID {
			return true, nil
		}
		current = promoterID.String
	}
	return false, fmt.Errorf("subtree walk exceeded max depth %d", maxSubtreeDepth)
}

// PromoteToAdmin promotes targetID to admin with callerID as promoter.
// Writes an audit entry. Must be called inside a transaction.
func PromoteToAdmin(ctx context.Context, q *gen.Queries, callerID, callerEmail, targetID string) error {
	now := httpx.FormatTime(time.Now())

	if err := q.PromoteUserToAdmin(ctx, gen.PromoteUserToAdminParams{
		PromoterID: sql.NullString{String: callerID, Valid: true},
		ID:         targetID,
	}); err != nil {
		return fmt.Errorf("promote user to admin: %w", err)
	}

	auditID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("new uuid: %w", err)
	}
	return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          auditID.String(),
		ActorUserID: sql.NullString{String: callerID, Valid: true},
		ActorEmail:  sql.NullString{String: callerEmail, Valid: true},
		Action:      "admin.promote",
		TargetKind:  sql.NullString{String: "user", Valid: true},
		TargetID:    sql.NullString{String: targetID, Valid: true},
		DetailJson:  sql.NullString{},
		CreatedAt:   now,
	})
}

// DemoteAdmin demotes targetID. The caller must be in the promoter chain above
// the target (verified by the caller before invoking). It:
//  1. Clears is_admin=0 on the target.
//  2. Re-parents target's direct promotees to callerID.
//  3. Writes an audit entry.
//
// Must be called inside a transaction.
func DemoteAdmin(ctx context.Context, q *gen.Queries, callerID, callerEmail, targetID string) error {
	now := httpx.FormatTime(time.Now())

	// Re-parent all users who were directly promoted by targetID to callerID.
	if err := q.ReparentPromoter(ctx, gen.ReparentPromoterParams{
		PromoterID:   sql.NullString{String: callerID, Valid: true},
		PromoterID_2: sql.NullString{String: targetID, Valid: true},
	}); err != nil {
		return fmt.Errorf("reparent promoter: %w", err)
	}

	if err := q.DemoteAdmin(ctx, targetID); err != nil {
		return fmt.Errorf("demote admin: %w", err)
	}

	auditID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("new uuid: %w", err)
	}
	return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          auditID.String(),
		ActorUserID: sql.NullString{String: callerID, Valid: true},
		ActorEmail:  sql.NullString{String: callerEmail, Valid: true},
		Action:      "admin.demote",
		TargetKind:  sql.NullString{String: "user", Valid: true},
		TargetID:    sql.NullString{String: targetID, Valid: true},
		DetailJson:  sql.NullString{},
		CreatedAt:   now,
	})
}

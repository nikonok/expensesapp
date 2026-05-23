package family

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
)

// invariants.go — helper checks for family business rules.

// maxFamilyMembers is the hard cap on active members per family.
const maxFamilyMembers = 6

// inviteCoolDownHours is the re-kick cool-down (24 h).
const inviteCoolDownHours = 24

// ErrFamilyFull is returned when a family has reached the member cap.
var ErrFamilyFull = errors.New("family has reached the maximum member limit")

// ErrNotInFamily is returned when the caller has no active family membership.
var ErrNotInFamily = errors.New("caller has no active family membership")

// ErrInviteNotFound is returned when the specified invite does not exist.
var ErrInviteNotFound = errors.New("invite not found")

// ErrInviteNotPending is returned when the invite exists but is not in 'pending' state.
var ErrInviteNotPending = errors.New("invite is not pending")

// ErrInviteExpired is returned when the invite exists but has expired.
var ErrInviteExpired = errors.New("invite has expired")

// ErrInviteEmailMismatch is returned when the caller's email does not match
// the invite's invitee_email.
var ErrInviteEmailMismatch = errors.New("caller email does not match invite")

// ErrDuplicateInvite is returned when a pending invite already exists for
// this family + email combination.
var ErrDuplicateInvite = errors.New("a pending invite already exists for this email")

// ErrNeedsMigrationDecision is returned when the invite-accept caller is
// already in a family — the frontend must ask them to choose migrate-solo.
var ErrNeedsMigrationDecision = errors.New("caller is already in a family; migration decision required")

// ErrCoolDown is returned when the 24-h remove cool-down has not elapsed.
var ErrCoolDown = errors.New("remove cool-down has not elapsed")

// ErrNotSameFamily is returned when the caller and target are not in the same family.
var ErrNotSameFamily = errors.New("caller and target are not in the same family")

// ErrNotInTargetFamily is returned by MigrateSolo when the caller is not a
// member of the targetFamilyId supplied in the request body.
var ErrNotInTargetFamily = errors.New("caller not in target family")

// checkMemberCap returns ErrFamilyFull when the family already has
// maxFamilyMembers active members.
func checkMemberCap(ctx context.Context, qt *gen.Queries, familyID string) error {
	count, err := qt.CountActiveFamilyMembers(ctx, familyID)
	if err != nil {
		return fmt.Errorf("count active members: %w", err)
	}
	if count >= maxFamilyMembers {
		return ErrFamilyFull
	}
	return nil
}

// ErrNotAllowlisted is returned when the invitee email is not on the server allowlist.
var ErrNotAllowlisted = errors.New("invitee email is not on the allowlist")

// checkAllowlistGate returns ErrNotAllowlisted when email is NOT on the
// server allowlist.
func checkAllowlistGate(ctx context.Context, qt *gen.Queries, email string) error {
	allowed, err := qt.IsEmailAllowed(ctx, email)
	if err != nil {
		return fmt.Errorf("allowlist check: %w", err)
	}
	if !allowed {
		return ErrNotAllowlisted
	}
	return nil
}

// checkCoolDown returns ErrCoolDown when lastRemovedAt is set and is within
// the past 24 hours.
func checkCoolDown(lastRemovedAt sql.NullString, now time.Time) error {
	if !lastRemovedAt.Valid {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, lastRemovedAt.String)
	if err != nil {
		// Unparseable timestamp — treat as old, allow.
		return nil
	}
	if now.Sub(t) < inviteCoolDownHours*time.Hour {
		return ErrCoolDown
	}
	return nil
}

// resolveMutualKickTieBreak returns true when the kicker is allowed to
// remove the target. The rule: the member who joined the family FIRST wins.
// If kicker joined before or at the same time as target, the kick proceeds.
func resolveMutualKickTieBreak(kickerJoinedAt, targetJoinedAt string) bool {
	kicker, errK := time.Parse(time.RFC3339Nano, kickerJoinedAt)
	target, errT := time.Parse(time.RFC3339Nano, targetJoinedAt)
	if errK != nil || errT != nil {
		// Fallback: allow if we can't parse
		return true
	}
	// Kicker wins if they joined earlier or at the same instant.
	return !kicker.After(target)
}

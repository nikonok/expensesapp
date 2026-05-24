// Hand-written query implementations (same pattern as push_queries.go).
// source: queries.sql (account deletion + support_logs section — Phase 11)

package gen

import (
	"context"
)

// ----- account deletion -----

const setUserDeleteAfter = `-- name: SetUserDeleteAfter :one
UPDATE users SET delete_after = ? WHERE id = ? RETURNING id, email, google_sub, display_name, is_admin, is_root, promoter_id, suspended_at, delete_after, created_at, last_signin_at
`

type SetUserDeleteAfterParams struct {
	DeleteAfter string
	ID          string
}

// SetUserDeleteAfter sets delete_after for a user and returns the updated row.
func (q *Queries) SetUserDeleteAfter(ctx context.Context, arg SetUserDeleteAfterParams) (User, error) {
	row := q.db.QueryRowContext(ctx, setUserDeleteAfter, arg.DeleteAfter, arg.ID)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.GoogleSub,
		&i.DisplayName,
		&i.IsAdmin,
		&i.IsRoot,
		&i.PromoterID,
		&i.SuspendedAt,
		&i.DeleteAfter,
		&i.CreatedAt,
		&i.LastSigninAt,
	)
	return i, err
}

const clearUserDeleteAfter = `-- name: ClearUserDeleteAfter :exec
UPDATE users SET delete_after = NULL WHERE id = ?
`

// ClearUserDeleteAfter clears the pending deletion for a user.
func (q *Queries) ClearUserDeleteAfter(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, clearUserDeleteAfter, id)
	return err
}

const listUsersPendingDeletion = `-- name: ListUsersPendingDeletion :many
SELECT id, email, google_sub, display_name, is_admin, is_root, promoter_id, suspended_at, delete_after, created_at, last_signin_at
FROM users WHERE delete_after IS NOT NULL AND delete_after <= ?
`

// ListUsersPendingDeletion returns users whose grace period has elapsed.
func (q *Queries) ListUsersPendingDeletion(ctx context.Context, now string) ([]User, error) {
	rows, err := q.db.QueryContext(ctx, listUsersPendingDeletion, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []User{}
	for rows.Next() {
		var i User
		if err := rows.Scan(
			&i.ID,
			&i.Email,
			&i.GoogleSub,
			&i.DisplayName,
			&i.IsAdmin,
			&i.IsRoot,
			&i.PromoterID,
			&i.SuspendedAt,
			&i.DeleteAfter,
			&i.CreatedAt,
			&i.LastSigninAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const hardDeleteUser = `-- name: HardDeleteUser :exec
DELETE FROM users WHERE id = ?
`

// HardDeleteUser permanently removes a user row. CASCADE FKs remove
// devices, sessions, family_members, push_subscriptions, etc.
func (q *Queries) HardDeleteUser(ctx context.Context, id string) error {
	_, err := q.db.ExecContext(ctx, hardDeleteUser, id)
	return err
}

const softLeaveAllFamilies = `-- name: SoftLeaveAllFamilies :exec
UPDATE family_members SET left_at = ? WHERE user_id = ? AND left_at IS NULL
`

type SoftLeaveAllFamiliesParams struct {
	LeftAt string
	UserID string
}

// SoftLeaveAllFamilies marks all active family memberships as left before purge.
func (q *Queries) SoftLeaveAllFamilies(ctx context.Context, arg SoftLeaveAllFamiliesParams) error {
	_, err := q.db.ExecContext(ctx, softLeaveAllFamilies, arg.LeftAt, arg.UserID)
	return err
}

// ----- pre-purge cleanup for non-CASCADE FKs -----

const deleteAllowlistByAddedBy = `-- name: DeleteAllowlistByAddedBy :exec
DELETE FROM allowlist WHERE added_by = ?
`

// DeleteAllowlistByAddedBy removes allowlist entries added by the given user.
// Called before HardDeleteUser to satisfy the RESTRICT FK.
func (q *Queries) DeleteAllowlistByAddedBy(ctx context.Context, userID string) error {
	_, err := q.db.ExecContext(ctx, deleteAllowlistByAddedBy, userID)
	return err
}

const nullifyFamilyInvitesInvitedBy = `-- name: NullifyFamilyInvitesInvitedBy :exec
DELETE FROM family_invites WHERE invited_by = ?
`

// DeleteFamilyInvitesByInvitedBy removes pending invites created by the user.
func (q *Queries) DeleteFamilyInvitesByInvitedBy(ctx context.Context, userID string) error {
	_, err := q.db.ExecContext(ctx, nullifyFamilyInvitesInvitedBy, userID)
	return err
}

// ----- support_logs -----

const insertSupportLog = `-- name: InsertSupportLog :exec
INSERT INTO support_logs (id, user_id, payload, created_at) VALUES (?, ?, ?, ?)
`

type InsertSupportLogParams struct {
	ID        string
	UserID    string
	Payload   []byte
	CreatedAt string
}

// InsertSupportLog stores a support log blob.
func (q *Queries) InsertSupportLog(ctx context.Context, arg InsertSupportLogParams) error {
	_, err := q.db.ExecContext(ctx, insertSupportLog,
		arg.ID,
		arg.UserID,
		arg.Payload,
		arg.CreatedAt,
	)
	return err
}

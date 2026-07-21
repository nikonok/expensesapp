package auth

// Allowlist checks per architecture.md §8.1.

import (
	"context"
	"database/sql"
	"errors"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
)

// ErrEmailNotAllowed indicates the email is not on the admin allowlist.
// Handler maps to HTTP 403 with title="email-not-allowed".
var ErrEmailNotAllowed = errors.New("email not on allowlist")

// ErrUserSuspended indicates the user exists but is suspended.
// Handler maps to HTTP 403 with title="suspended".
var ErrUserSuspended = errors.New("user is suspended")

// CheckEmailAllowed returns nil if the email is on the allowlist.
// Comparison is case-insensitive via the schema's COLLATE NOCASE.
func CheckEmailAllowed(ctx context.Context, db *sql.DB, email string) error {
	q := gen.New(db)
	allowed, err := q.IsEmailAllowed(ctx, email)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrEmailNotAllowed
	}
	return nil
}

package auth

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbpkg "github.com/nikonok/expensesapp/backend/internal/db"
)

// openTestDB opens an in-memory SQLite DB with all migrations applied.
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	db, err := dbpkg.Open(ctx, ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// insertTestUser inserts a minimal user row and returns the id.
// suspended_at is passed as-is (empty string → NULL via conditional logic below).
func insertTestUser(t *testing.T, db *sql.DB, id, email, suspendedAt string) {
	t.Helper()
	var query string
	var args []any
	if suspendedAt == "" {
		query = `INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)`
		args = []any{id, email, "Test User", "2026-01-01T00:00:00Z"}
	} else {
		query = `INSERT INTO users (id, email, display_name, suspended_at, created_at) VALUES (?, ?, ?, ?, ?)`
		args = []any{id, email, "Test User", suspendedAt, "2026-01-01T00:00:00Z"}
	}
	_, err := db.ExecContext(context.Background(), query, args...)
	require.NoError(t, err)
}

// insertAllowlist inserts an allowlist row. A user with addedByID must exist.
func insertAllowlist(t *testing.T, db *sql.DB, email, addedByID string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(),
		`INSERT INTO allowlist (email, added_by, added_at) VALUES (?, ?, ?)`,
		email, addedByID, "2026-01-01T00:00:00Z",
	)
	require.NoError(t, err)
}

func TestCheckEmailAllowed_Allowed(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	insertTestUser(t, db, "user-1", "alice@example.com", "")
	insertAllowlist(t, db, "alice@example.com", "user-1")

	err := CheckEmailAllowed(ctx, db, "alice@example.com")
	assert.NoError(t, err)
}

func TestCheckEmailAllowed_NotAllowed(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	err := CheckEmailAllowed(ctx, db, "stranger@example.com")
	assert.ErrorIs(t, err, ErrEmailNotAllowed)
}

func TestCheckEmailAllowed_CaseInsensitive(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	insertTestUser(t, db, "user-2", "Alice@Example.com", "")
	insertAllowlist(t, db, "Alice@Example.com", "user-2")

	err := CheckEmailAllowed(ctx, db, "alice@example.com")
	assert.NoError(t, err)
}

func TestCheckUserNotSuspended_NotSuspended(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	insertTestUser(t, db, "user-3", "bob@example.com", "")

	err := CheckUserNotSuspended(ctx, db, "user-3")
	assert.NoError(t, err)
}

func TestCheckUserNotSuspended_Suspended(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	insertTestUser(t, db, "user-4", "carol@example.com", "2026-01-01T00:00:00Z")

	err := CheckUserNotSuspended(ctx, db, "user-4")
	assert.ErrorIs(t, err, ErrUserSuspended)
}

func TestCheckUserNotSuspended_NotFound(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	err := CheckUserNotSuspended(ctx, db, "nonexistent-id")
	assert.ErrorIs(t, err, sql.ErrNoRows)
}

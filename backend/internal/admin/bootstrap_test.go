package admin

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbpkg "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := dbpkg.Open(t.Context(), ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// seedUser inserts a user row and returns the user.
func seedUser(t *testing.T, ctx context.Context, db *sql.DB, email string) gen.User {
	t.Helper()
	q := gen.New(db)
	now := time.Now().UTC().Format(time.RFC3339)
	id, err := uuid.NewV7()
	require.NoError(t, err)
	user, err := q.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
		ID:           id.String(),
		Email:        email,
		DisplayName:  email,
		CreatedAt:    now,
		LastSigninAt: sql.NullString{String: now, Valid: true},
	})
	require.NoError(t, err)
	return user
}

func auditCount(t *testing.T, ctx context.Context, db *sql.DB) int {
	t.Helper()
	row := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM audit_log WHERE action = 'bootstrap.email.change'")
	var n int
	require.NoError(t, row.Scan(&n))
	return n
}

func bootstrapEmail(t *testing.T, ctx context.Context, db *sql.DB) string {
	t.Helper()
	q := gen.New(db)
	state, err := q.GetBootstrapState(ctx)
	require.NoError(t, err)
	return state.BootstrapEmail
}

func TestEnsureBootstrap_FirstBoot(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	err := EnsureBootstrap(ctx, db, "root@example.com")
	require.NoError(t, err)

	// bootstrap_state must have been written.
	assert.Equal(t, "root@example.com", bootstrapEmail(t, ctx, db))

	// No audit entry on first boot.
	assert.Equal(t, 0, auditCount(t, ctx, db))
}

func TestEnsureBootstrap_Restart_NoChange(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// Prime the state.
	require.NoError(t, EnsureBootstrap(ctx, db, "root@example.com"))

	// Call again with the same email.
	require.NoError(t, EnsureBootstrap(ctx, db, "root@example.com"))

	// Still no audit entry.
	assert.Equal(t, 0, auditCount(t, ctx, db))
	assert.Equal(t, "root@example.com", bootstrapEmail(t, ctx, db))
}

func TestEnsureBootstrap_Handoff_NoNewUserYet(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// First boot with email A.
	require.NoError(t, EnsureBootstrap(ctx, db, "a@example.com"))

	// Change bootstrap email to B (B has no user row).
	require.NoError(t, EnsureBootstrap(ctx, db, "b@example.com"))

	// bootstrap_state updated.
	assert.Equal(t, "b@example.com", bootstrapEmail(t, ctx, db))

	// One audit entry written.
	assert.Equal(t, 1, auditCount(t, ctx, db))

	// No is_root changes — no user rows exist.
	q := gen.New(db)
	_, err := q.GetCurrentRoot(ctx)
	assert.ErrorIs(t, err, sql.ErrNoRows, "no root should exist when users haven't signed in")
}

func TestEnsureBootstrap_Handoff_WithExistingUsers(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	q := gen.New(db)

	// Set up users A (root), B, C (promoted by A).
	userA := seedUser(t, ctx, db, "a@example.com")
	userB := seedUser(t, ctx, db, "b@example.com")
	userC := seedUser(t, ctx, db, "c@example.com")

	// Mark A as root.
	require.NoError(t, q.SetUserAsRoot(ctx, userA.ID))
	// Promote C with A as promoter.
	require.NoError(t, q.PromoteUserToAdmin(ctx, gen.PromoteUserToAdminParams{
		PromoterID: sql.NullString{String: userA.ID, Valid: true},
		ID:         userC.ID,
	}))

	// Seed bootstrap_state to A.
	require.NoError(t, q.UpsertBootstrapState(ctx, gen.UpsertBootstrapStateParams{
		BootstrapEmail: "a@example.com",
		AppliedAt:      time.Now().UTC().Format(time.RFC3339),
	}))

	// Handoff to B.
	require.NoError(t, EnsureBootstrap(ctx, db, "b@example.com"))

	// bootstrap_state updated.
	assert.Equal(t, "b@example.com", bootstrapEmail(t, ctx, db))

	// One audit entry.
	assert.Equal(t, 1, auditCount(t, ctx, db))

	// B is now root.
	newRoot, err := q.GetCurrentRoot(ctx)
	require.NoError(t, err)
	assert.Equal(t, userB.ID, newRoot.ID)

	// A is downgraded.
	aRow, err := q.GetUserByEmail(ctx, "a@example.com")
	require.NoError(t, err)
	assert.Equal(t, int64(0), aRow.IsRoot)
	assert.Equal(t, int64(0), aRow.IsAdmin)

	// C's promoter_id has been reparented from A to B.
	cRow, err := q.GetUserByEmail(ctx, "c@example.com")
	require.NoError(t, err)
	assert.True(t, cRow.PromoterID.Valid)
	assert.Equal(t, userB.ID, cRow.PromoterID.String)
}

func TestEnsureBootstrap_Handoff_NewUserNotOnAllowlist(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// First boot with A.
	require.NoError(t, EnsureBootstrap(ctx, db, "a@example.com"))

	// Change to Z (not on allowlist, no user row).
	// Per spec: bootstrap_state is updated and audited; allowlist/role changes
	// are deferred to Z's first sign-in (Phase 1.g).
	require.NoError(t, EnsureBootstrap(ctx, db, "z@example.com"))

	assert.Equal(t, "z@example.com", bootstrapEmail(t, ctx, db))
	assert.Equal(t, 1, auditCount(t, ctx, db))

	// Allowlist for Z must NOT exist (auto-insert deferred due to FK constraint).
	q := gen.New(db)
	allowed, err := q.IsEmailAllowed(ctx, "z@example.com")
	require.NoError(t, err)
	assert.False(t, allowed, "z should not be auto-added to allowlist on bootstrap (deferred to first sign-in)")
}

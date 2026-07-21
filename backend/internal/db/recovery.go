package db

import "github.com/nikonok/expensesapp/backend/internal/db/gen"

// RecoveryCreatedAtOrFallback returns family.RecoveryCreatedAt when set (the
// opaque, client-supplied value bound into the recovery-envelope AAD), else
// falls back to the legacy families.created_at (server clock) for families
// created before this field existed. Shared by internal/account and
// internal/family, both of which return this value on recovery-envelope
// responses.
func RecoveryCreatedAtOrFallback(family gen.Family) string {
	if family.RecoveryCreatedAt.Valid && family.RecoveryCreatedAt.String != "" {
		return family.RecoveryCreatedAt.String
	}
	return family.CreatedAt
}

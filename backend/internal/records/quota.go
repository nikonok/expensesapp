package records

import (
	"context"
	"database/sql"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
)

// QuotaMaxBytes is the hard cap per family (200 MiB).
const QuotaMaxBytes = 200 * 1024 * 1024

// ErrQuotaExceeded is returned when a push would exceed the quota.
type ErrQuotaExceeded struct{}

func (ErrQuotaExceeded) Error() string { return "quota exceeded" }

// CheckQuota returns ErrQuotaExceeded if currentBytes + incomingBytes > QuotaMaxBytes.
func CheckQuota(currentBytes, incomingBytes int64) error {
	if currentBytes+incomingBytes > QuotaMaxBytes {
		return ErrQuotaExceeded{}
	}
	return nil
}

// ReconcileUsage recomputes families.usage_bytes for every family from the
// live sum of blobs.byte_count, correcting any drift left by incremental
// updates (e.g. PruneOrphanBlobs deletes blob rows without decrementing
// usage_bytes). Self-healing; safe to call repeatedly on a schedule.
func ReconcileUsage(ctx context.Context, db *sql.DB) error {
	return gen.New(db).ReconcileFamilyUsageBytes(ctx)
}

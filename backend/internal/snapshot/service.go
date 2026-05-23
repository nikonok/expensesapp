// Package snapshot implements snapshot creation, restoration, pruning, and
// HTTP handlers for the /v1/snapshots endpoints.
package snapshot

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// snapshotTTL is how long a snapshot is retained before expiry.
const snapshotTTL = 30 * 24 * time.Hour

// timeNow is overridable in tests.
var timeNow = func() time.Time { return time.Now().UTC() }

// Service holds dependencies for snapshot business logic.
type Service struct {
	db *sql.DB
}

// NewService constructs a snapshot Service.
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// ErrSnapshotAlreadyExists is returned when a snapshot already exists for the
// given family + date (UNIQUE constraint violation treated as a no-op).
var ErrSnapshotAlreadyExists = errors.New("snapshot already exists for this date")

// ErrSnapshotNotFound is returned when the requested snapshot does not exist.
var ErrSnapshotNotFound = errors.New("snapshot not found")

// CreateSnapshot creates a daily snapshot for familyID at date (YYYY-MM-DD UTC).
// It is idempotent: if a snapshot already exists for that date it returns
// (existingID, ErrSnapshotAlreadyExists) so callers can decide to skip.
//
// The operation is atomic: snapshot + all entries are inserted in one tx.
func (s *Service) CreateSnapshot(ctx context.Context, familyID, date string) (snapshotID string, err error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}

	now := timeNow()
	createdAt := httpx.FormatTime(now)
	expiresAt := httpx.FormatTime(now.Add(snapshotTTL))

	err = internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Check for existing snapshot on the same date.
		existing, lookupErr := qt.GetSnapshotByDate(ctx, familyID, date)
		if lookupErr == nil {
			// Already exists — return the existing ID via the outer err variable.
			snapshotID = existing.ID
			return ErrSnapshotAlreadyExists
		}
		if !errors.Is(lookupErr, sql.ErrNoRows) {
			return lookupErr
		}

		// Insert snapshot row.
		if insertErr := qt.InsertSnapshot(ctx, gen.InsertSnapshotParams{
			ID:           id.String(),
			FamilyID:     familyID,
			SnapshotDate: date,
			CreatedAt:    createdAt,
			ExpiresAt:    expiresAt,
		}); insertErr != nil {
			return insertErr
		}

		// Snapshot all non-deleted records for this family.
		records, listErr := qt.ListNonDeletedRecordMetaForFamily(ctx, familyID)
		if listErr != nil {
			return listErr
		}

		for _, rec := range records {
			if entryErr := qt.InsertSnapshotEntry(ctx, gen.InsertSnapshotEntryParams{
				SnapshotID:   id.String(),
				RecordID:     rec.RecordID,
				BlobID:       rec.BlobID,
				RecordType:   rec.RecordType,
				Version:      rec.Version,
				UpdatedAtMap: rec.UpdatedAtMap,
			}); entryErr != nil {
				return entryErr
			}
		}

		snapshotID = id.String()
		return nil
	})
	if errors.Is(err, ErrSnapshotAlreadyExists) {
		return snapshotID, ErrSnapshotAlreadyExists
	}
	if err != nil {
		return "", err
	}
	return snapshotID, nil
}

package snapshot

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/google/uuid"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
	syncp "github.com/nikonok/expensesapp/backend/internal/sync"
)

// RestoreResult is returned by a successful RestoreSnapshot call.
type RestoreResult struct {
	// NewCursor is the base64url-encoded family_seq after the last change
	// applied during restore. Clients should use this as their new sync cursor.
	NewCursor string
}

// syncBarrierPayload is the JSON payload for the "sync.barrier" SSE event.
type syncBarrierPayload struct {
	Cursor string `json:"cursor"`
}

// RestoreSnapshot restores familyID to the state recorded in snapshotID.
//
// Per §8.6:
//   - For each record in snapshot_entries: upsert record_meta to snapshot state.
//   - For each record_meta NOT in the snapshot (and belonging to this family):
//     soft-delete it (deleted_at = now, version++, new family_seq).
//   - Emit sync.barrier{cursor} to the "family:<familyID>" SSE scope.
//   - Write audit_log('snapshot.restore').
func (s *Service) RestoreSnapshot(ctx context.Context, familyID, snapshotID, callerUserID string, hub *live.Hub) (*RestoreResult, error) {
	now := timeNow()
	nowStr := httpx.FormatTime(now)

	var finalCursor int64

	err := internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Load snapshot entries.
		entries, err := qt.ListSnapshotEntries(ctx, snapshotID)
		if err != nil {
			return err
		}

		// Build a set of record IDs in the snapshot for quick lookup.
		snapshotIDs := make(map[string]struct{}, len(entries))
		for _, e := range entries {
			snapshotIDs[e.RecordID] = struct{}{}
		}

		// Upsert each snapshot entry into record_meta.
		for _, entry := range entries {
			existing, lookupErr := qt.GetRecordMeta(ctx, entry.RecordID)
			isNew := errors.Is(lookupErr, sql.ErrNoRows)
			if lookupErr != nil && !isNew {
				return lookupErr
			}

			seq, seqErr := qt.AdvanceFamilySeq(ctx, familyID)
			if seqErr != nil {
				return seqErr
			}

			if isNew {
				// Re-insert the record_meta row.
				if insertErr := qt.InsertRecordMeta(ctx, gen.InsertRecordMetaParams{
					RecordID:       entry.RecordID,
					FamilyID:       familyID,
					RecordType:     entry.RecordType,
					BlobID:         entry.BlobID,
					Version:        entry.Version + 1,
					AddedByUser:    callerUserID,
					EditedByUser:   callerUserID,
					UpdatedAtMap:   entry.UpdatedAtMap,
					DeletedAt:      sql.NullString{},
					FamilySeq:      seq,
					CreatedAt:      nowStr,
					LastModifiedAt: nowStr,
				}); insertErr != nil {
					return insertErr
				}
			} else {
				// Update existing record_meta to snapshot state.
				if updateErr := qt.UpdateRecordMeta(ctx, gen.UpdateRecordMetaParams{
					RecordID:       entry.RecordID,
					BlobID:         entry.BlobID,
					Version:        existing.Version + 1,
					EditedByUser:   callerUserID,
					UpdatedAtMap:   entry.UpdatedAtMap,
					DeletedAt:      sql.NullString{}, // restore clears deleted_at
					FamilySeq:      seq,
					LastModifiedAt: nowStr,
				}); updateErr != nil {
					return updateErr
				}
			}
			finalCursor = seq
		}

		// Soft-delete records in record_meta that are NOT in the snapshot.
		allRecords, err := qt.ListAllRecordMetaForFamily(ctx, familyID)
		if err != nil {
			return err
		}
		for _, rec := range allRecords {
			if _, inSnapshot := snapshotIDs[rec.RecordID]; inSnapshot {
				continue
			}
			// Already soft-deleted — skip (nothing to change).
			if rec.DeletedAt.Valid {
				continue
			}

			seq, seqErr := qt.AdvanceFamilySeq(ctx, familyID)
			if seqErr != nil {
				return seqErr
			}

			if updateErr := qt.UpdateRecordMeta(ctx, gen.UpdateRecordMetaParams{
				RecordID:       rec.RecordID,
				BlobID:         rec.BlobID,
				Version:        rec.Version + 1,
				EditedByUser:   callerUserID,
				UpdatedAtMap:   rec.UpdatedAtMap,
				DeletedAt:      sql.NullString{String: nowStr, Valid: true},
				FamilySeq:      seq,
				LastModifiedAt: nowStr,
			}); updateErr != nil {
				return updateErr
			}
			finalCursor = seq
		}

		// Write audit entry. Failure aborts the transaction.
		if auditErr := insertAudit(ctx, qt, callerUserID, "snapshot.restore", "snapshot", snapshotID, nowStr); auditErr != nil {
			return auditErr
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Emit sync.barrier SSE event to family scope (best-effort, outside tx).
	if hub != nil {
		payload := syncBarrierPayload{Cursor: syncp.EncodeCursor(finalCursor)}
		data, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			slog.WarnContext(ctx, "snapshot.restore: marshal sync.barrier payload failed", "err", marshalErr)
		} else {
			hub.Publish("family:"+familyID, live.Event{
				Type: "sync.barrier",
				Data: data,
			})
		}
	}

	return &RestoreResult{NewCursor: syncp.EncodeCursor(finalCursor)}, nil
}

// insertAudit writes a single audit_log row using an already-open *gen.Queries.
func insertAudit(ctx context.Context, qt *gen.Queries, actorUserID, action, targetKind, targetID, createdAt string) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          id.String(),
		ActorUserID: sql.NullString{String: actorUserID, Valid: actorUserID != ""},
		ActorEmail:  sql.NullString{},
		Action:      action,
		TargetKind:  sql.NullString{String: targetKind, Valid: targetKind != ""},
		TargetID:    sql.NullString{String: targetID, Valid: targetID != ""},
		DetailJson:  sql.NullString{},
		CreatedAt:   createdAt,
	})
}

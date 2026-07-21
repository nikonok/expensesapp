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
// Per §8.6 (revised B4h):
//   - For each record in snapshot_entries: upsert record_meta to snapshot state.
//   - For each record_meta NOT in the snapshot (and belonging to this family):
//     soft-delete it (deleted_at = now, version++).
//   - Per-row writes still consume distinct family_seq values because the
//     idx_record_meta_seq UNIQUE(family_id, family_seq) index forbids reuse.
//   - Emit ONE sync.barrier{cursor: highest seq used} to the "family:<familyID>"
//     SSE scope. The frontend treats the barrier as a "drop your cache and
//     re-pull from this cursor" signal rather than processing per-row
//     record.changed events one at a time (B4h). Per-row record.changed events
//     are NOT emitted from restore.
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

		// Upsert each snapshot entry into record_meta. Authorship
		// (added_by_user/edited_by_user) is bound into the blob's AAD by the
		// client, so restore must reapply the ORIGINAL values captured on the
		// snapshot entry rather than the restoring caller — otherwise the
		// (unchanged) ciphertext becomes undecryptable. Historical snapshot
		// entries taken before authorship capture was added have NULL here;
		// fall back to callerUserID only for those (best effort — such a
		// snapshot cannot fully round-trip either way).
		for _, entry := range entries {
			existing, lookupErr := qt.GetRecordMeta(ctx, gen.GetRecordMetaParams{
				RecordID: entry.RecordID,
				FamilyID: familyID,
			})
			isNew := errors.Is(lookupErr, sql.ErrNoRows)
			if lookupErr != nil && !isNew {
				return lookupErr
			}

			seq, seqErr := qt.AdvanceFamilySeq(ctx, familyID)
			if seqErr != nil {
				return seqErr
			}

			addedBy := stringOrFallback(entry.AddedByUser, callerUserID)
			editedBy := stringOrFallback(entry.EditedByUser, callerUserID)

			if isNew {
				if insertErr := qt.InsertRecordMeta(ctx, gen.InsertRecordMetaParams{
					RecordID:       entry.RecordID,
					FamilyID:       familyID,
					RecordType:     entry.RecordType,
					BlobID:         entry.BlobID,
					Version:        entry.Version + 1,
					AddedByUser:    addedBy,
					EditedByUser:   editedBy,
					UpdatedAtMap:   entry.UpdatedAtMap,
					DeletedAt:      sql.NullString{},
					FamilySeq:      seq,
					CreatedAt:      nowStr,
					LastModifiedAt: nowStr,
				}); insertErr != nil {
					return insertErr
				}
			} else {
				if updateErr := qt.UpdateRecordMeta(ctx, gen.UpdateRecordMetaParams{
					RecordID:       entry.RecordID,
					FamilyID:       familyID,
					BlobID:         entry.BlobID,
					Version:        existing.Version + 1,
					EditedByUser:   editedBy,
					UpdatedAtMap:   entry.UpdatedAtMap,
					DeletedAt:      sql.NullString{},
					FamilySeq:      seq,
					LastModifiedAt: nowStr,
				}); updateErr != nil {
					return updateErr
				}
			}
			finalCursor = seq
		}

		// Soft-delete records in record_meta that are NOT in the snapshot.
		// The client applies tombstones by identity (recordId/deletedAt)
		// without needing to decrypt them, but the row's added_by_user/
		// edited_by_user are still bound into its blob's AAD — preserve the
		// record's own values here too rather than overwriting with the
		// restoring caller.
		allRecords, err := qt.ListAllRecordMetaForFamily(ctx, familyID)
		if err != nil {
			return err
		}
		for _, rec := range allRecords {
			if _, inSnapshot := snapshotIDs[rec.RecordID]; inSnapshot {
				continue
			}
			if rec.DeletedAt.Valid {
				continue
			}

			seq, seqErr := qt.AdvanceFamilySeq(ctx, familyID)
			if seqErr != nil {
				return seqErr
			}

			if updateErr := qt.UpdateRecordMeta(ctx, gen.UpdateRecordMetaParams{
				RecordID:       rec.RecordID,
				FamilyID:       familyID,
				BlobID:         rec.BlobID,
				Version:        rec.Version + 1,
				EditedByUser:   rec.EditedByUser,
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

	// Emit exactly ONE sync.barrier SSE event (B4h). Peer clients adopt the
	// new cursor as their pull baseline and re-pull all rows up to it as a
	// single batch — much cheaper than processing N record.changed events.
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

// stringOrFallback returns ns.String when valid and non-empty, else fallback.
func stringOrFallback(ns sql.NullString, fallback string) string {
	if ns.Valid && ns.String != "" {
		return ns.String
	}
	return fallback
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

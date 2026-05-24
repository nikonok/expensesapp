package sync

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/records"
)

// blobOverheadBytes = 1 (version) + 24 (nonce) + 32 (commit) + 16 (AEAD tag).
const blobOverheadBytes = 73

// pushRequest is the JSON body for POST /v1/sync/push.
type pushRequest struct {
	Records []pushRecord `json:"records"`
}

// pushRecord represents one record in a push batch.
type pushRecord struct {
	RecordID           string            `json:"recordId"`
	RecordType         string            `json:"recordType"`
	Blob               string            `json:"blob"` // base64url
	UpdatedAtMap       map[string]string `json:"updatedAtMap"`
	DeletedAt          string            `json:"deletedAt,omitempty"`
	ParentVersion      int64             `json:"parentVersion"`
	PlaintextByteCount int64             `json:"plaintextByteCount"`
}

// pushResponseAccepted is one accepted entry in the push response.
type pushResponseAccepted struct {
	RecordID  string `json:"recordId"`
	Version   int64  `json:"version"`
	FamilySeq int64  `json:"familySeq"`
}

// pushResponseConflict is one conflicting entry in the push response.
type pushResponseConflict struct {
	RecordID            string            `json:"recordId"`
	CurrentBlob         string            `json:"currentBlob"` // base64url
	CurrentVersion      int64             `json:"currentVersion"`
	CurrentUpdatedAtMap map[string]string `json:"currentUpdatedAtMap"`
}

// pushResponse is the JSON body returned by POST /v1/sync/push.
type pushResponse struct {
	Accepted  []pushResponseAccepted `json:"accepted"`
	Conflicts []pushResponseConflict `json:"conflicts"`
}

// PostPush handles POST /v1/sync/push.
func (h *Handler) PostPush(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024*1024)

	ctx := r.Context()
	userID := httpx.UserID(ctx)
	familyID := httpx.FamilyID(ctx)

	var req pushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}

	if len(req.Records) == 0 {
		httpx.WriteJSON(w, http.StatusOK, pushResponse{
			Accepted:  []pushResponseAccepted{},
			Conflicts: []pushResponseConflict{},
		})
		return
	}

	// -------------------------------------------------------------------------
	// Validate all records before touching the DB.
	// -------------------------------------------------------------------------
	type validatedRecord struct {
		raw        pushRecord
		ciphertext []byte
	}

	validated := make([]validatedRecord, 0, len(req.Records))

	for i, rec := range req.Records {
		// Validate recordId is a valid UUID.
		if _, err := uuid.Parse(rec.RecordID); err != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("recordId", i)+" is not a valid UUID")
			return
		}

		// Validate recordType is in the closed set.
		if _, ok := records.ValidRecordTypes[rec.RecordType]; !ok {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("recordType", i)+" is not a valid record type")
			return
		}

		// Decode blob.
		ciphertext, err := decodeBase64URL(rec.Blob)
		if err != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("blob", i)+" is not valid base64url")
			return
		}

		// Validate blob minimum length: 1 + 24 + 32 + 16 = 73 bytes overhead + at least 0 ct bytes.
		if len(ciphertext) < blobOverheadBytes {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("blob", i)+" is too short (minimum 73 bytes)")
			return
		}

		// Validate version byte is 0x01.
		if ciphertext[0] != 0x01 {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("blob", i)+" has unsupported version byte")
			return
		}

		// Validate plaintextByteCount matches ciphertext length - overhead.
		expectedCTLen := int64(len(ciphertext)) - blobOverheadBytes
		if rec.PlaintextByteCount != expectedCTLen {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("plaintextByteCount", i)+" does not match blob length")
			return
		}

		// Validate updatedAtMap: all values must be parseable ISO-8601-ms.
		for field, ts := range rec.UpdatedAtMap {
			if _, err := time.Parse("2006-01-02T15:04:05.000Z07:00", ts); err != nil {
				// Also try RFC3339Nano for flexibility.
				if _, err2 := time.Parse(time.RFC3339Nano, ts); err2 != nil {
					httpx.WriteError(w, r, http.StatusBadRequest, "bad-request",
						jsonIndex("updatedAtMap", i)+"."+field+" is not a valid ISO-8601-ms timestamp")
					return
				}
			}
		}

		// Validate deletedAt if non-empty.
		if rec.DeletedAt != "" {
			if _, err := time.Parse("2006-01-02T15:04:05.000Z07:00", rec.DeletedAt); err != nil {
				if _, err2 := time.Parse(time.RFC3339Nano, rec.DeletedAt); err2 != nil {
					httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", jsonIndex("deletedAt", i)+" is not a valid timestamp")
					return
				}
			}
		}

		validated = append(validated, validatedRecord{raw: rec, ciphertext: ciphertext})
	}

	// -------------------------------------------------------------------------
	// Load family to obtain current usage (used for quota check inside tx).
	// -------------------------------------------------------------------------
	q := gen.New(h.db)
	family, err := q.GetFamilyByID(ctx, familyID)
	if err != nil {
		slog.WarnContext(ctx, "sync.push: get family error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// -------------------------------------------------------------------------
	// Apply all records in a single transaction.
	// -------------------------------------------------------------------------
	accepted := make([]pushResponseAccepted, 0, len(validated))
	conflicts := make([]pushResponseConflict, 0)
	var totalAcceptedBytes int64

	// acceptedResults and acceptedTypes track the UpsertResult + record type
	// for each accepted record so we can publish SSE events after the tx.
	var acceptedResults []records.UpsertResult
	var acceptedTypes []string

	txErr := h.svc.WithTx(ctx, func(qt *gen.Queries) error {
		for _, v := range validated {
			result, conflict, err := h.svc.Upsert(ctx, qt, records.UpsertParams{
				RecordID:           v.raw.RecordID,
				FamilyID:           familyID,
				RecordType:         v.raw.RecordType,
				UserID:             userID,
				Ciphertext:         v.ciphertext,
				UpdatedAtMap:       v.raw.UpdatedAtMap,
				DeletedAt:          v.raw.DeletedAt,
				ParentVersion:      v.raw.ParentVersion,
				PlaintextByteCount: v.raw.PlaintextByteCount,
			})
			if err != nil {
				// A brand-new record arriving with parentVersion != 0 is a client
				// data error. Treat it as a synthetic conflict (no existing row →
				// currentVersion=0) rather than an infrastructure failure.
				if errors.Is(err, records.ErrInvalidParentVersion) {
					conflicts = append(conflicts, pushResponseConflict{
						RecordID:            v.raw.RecordID,
						CurrentBlob:         "",
						CurrentVersion:      0,
						CurrentUpdatedAtMap: nil,
					})
					continue
				}
				return err
			}
			if conflict != nil {
				curBlobB64 := base64.RawURLEncoding.EncodeToString(conflict.CurrentBlob)
				conflicts = append(conflicts, pushResponseConflict{
					RecordID:            conflict.RecordID,
					CurrentBlob:         curBlobB64,
					CurrentVersion:      conflict.CurrentVersion,
					CurrentUpdatedAtMap: conflict.CurrentUpdAtMap,
				})
				continue
			}
			accepted = append(accepted, pushResponseAccepted{
				RecordID:  result.RecordID,
				Version:   result.Version,
				FamilySeq: result.FamilySeq,
			})
			acceptedResults = append(acceptedResults, *result)
			acceptedTypes = append(acceptedTypes, v.raw.RecordType)
			totalAcceptedBytes += int64(len(v.ciphertext))
		}

		// Quota check: only bytes that would actually be stored count.
		// Conflicts and ErrInvalidParentVersion records are excluded.
		if err := records.CheckQuota(family.UsageBytes, totalAcceptedBytes); err != nil {
			return err
		}

		// Increment usage by the sum of all accepted blobs.
		if totalAcceptedBytes > 0 {
			if err := records.IncrementUsage(ctx, qt, familyID, totalAcceptedBytes); err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		if _, ok := txErr.(records.ErrQuotaExceeded); ok {
			httpx.WriteError(w, r, http.StatusRequestEntityTooLarge, "quota-exceeded", "family storage quota exceeded")
			return
		}
		slog.WarnContext(ctx, "sync.push: transaction error", "err", txErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Publish SSE events (and fire Web Push) for each accepted record
	// (best-effort, after tx commits).
	if h.eventBus != nil && len(acceptedResults) > 0 {
		h.eventBus.PublishRecordChanged(familyID, userID, acceptedResults, acceptedTypes)
	}

	httpx.WriteJSON(w, http.StatusOK, pushResponse{
		Accepted:  accepted,
		Conflicts: conflicts,
	})
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// decodeBase64URL decodes a base64url string (raw or padded).
func decodeBase64URL(s string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}

// jsonIndex formats a field+index label for error messages.
func jsonIndex(field string, i int) string {
	return "records[" + itoa(i) + "]." + field
}

// itoa converts an int to a string without importing strconv into this file.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}

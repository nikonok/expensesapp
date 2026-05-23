package records

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// timeNow is overridable in tests.
var timeNow = func() time.Time { return time.Now().UTC() }

// ValidRecordTypes is the closed set of allowed record_type values.
var ValidRecordTypes = map[string]struct{}{
	"transaction": {},
	"account":     {},
	"category":    {},
	"budget":      {},
	"settings":    {},
}

// ErrInvalidParentVersion is returned when the parentVersion does not match the
// current record version (or is non-zero for a new record).
var ErrInvalidParentVersion = errors.New("invalid parent version")

// nowUTC is overridable in tests.
var nowUTC = func() string { return httpx.FormatTime(timeNow()) }

// UpsertParams are the caller-validated inputs for one record upsert.
type UpsertParams struct {
	RecordID           string
	FamilyID           string
	RecordType         string
	UserID             string
	Ciphertext         []byte            // full blob bytes
	UpdatedAtMap       map[string]string // field → ISO-8601-ms
	DeletedAt          string            // ISO-8601-ms or ""
	ParentVersion      int64
	PlaintextByteCount int64
}

// UpsertResult is the result for a single accepted record.
type UpsertResult struct {
	RecordID  string
	Version   int64
	FamilySeq int64
}

// ConflictResult holds the current server state for a conflicting record.
type ConflictResult struct {
	RecordID        string
	CurrentBlob     []byte
	CurrentVersion  int64
	CurrentUpdAtMap map[string]string
}

// Service holds dependencies for records business logic.
type Service struct {
	db *sql.DB
}

// NewService constructs a records Service.
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// Upsert attempts to apply a single record within an already-open transaction.
// It returns (result, nil) on success, (nil, ErrInvalidParentVersion) for a
// hard version mismatch on a new record, or (conflict, nil) with a non-nil
// ConflictResult for a concurrent-write conflict on an existing record. Any
// other error is an infrastructure error.
//
// The caller is responsible for quota checking BEFORE calling Upsert, and for
// incrementing families.usage_bytes AFTER a successful insert.
func (s *Service) Upsert(ctx context.Context, qt *gen.Queries, p UpsertParams) (result *UpsertResult, conflict *ConflictResult, err error) {
	now := nowUTC()

	existing, err := qt.GetRecordMeta(ctx, p.RecordID)
	isNew := errors.Is(err, sql.ErrNoRows)
	if err != nil && !isNew {
		return nil, nil, err
	}

	if isNew {
		// New record: parentVersion must be 0.
		if p.ParentVersion != 0 {
			return nil, nil, ErrInvalidParentVersion
		}

		// Insert blob.
		blobID, err := uuid.NewV7()
		if err != nil {
			return nil, nil, err
		}

		if err := qt.InsertBlob(ctx, gen.InsertBlobParams{
			ID:         blobID.String(),
			FamilyID:   p.FamilyID,
			Ciphertext: p.Ciphertext,
			ByteCount:  int64(len(p.Ciphertext)),
			CreatedAt:  now,
		}); err != nil {
			return nil, nil, err
		}

		// Claim family_seq.
		seq, err := qt.AdvanceFamilySeq(ctx, p.FamilyID)
		if err != nil {
			return nil, nil, err
		}

		// Serialize updatedAtMap.
		updAtMapJSON, err := marshalMap(p.UpdatedAtMap)
		if err != nil {
			return nil, nil, err
		}

		if err := qt.InsertRecordMeta(ctx, gen.InsertRecordMetaParams{
			RecordID:       p.RecordID,
			FamilyID:       p.FamilyID,
			RecordType:     p.RecordType,
			BlobID:         blobID.String(),
			Version:        1,
			AddedByUser:    p.UserID,
			EditedByUser:   p.UserID,
			UpdatedAtMap:   updAtMapJSON,
			DeletedAt:      nullStr(p.DeletedAt),
			FamilySeq:      seq,
			CreatedAt:      now,
			LastModifiedAt: now,
		}); err != nil {
			return nil, nil, err
		}

		return &UpsertResult{RecordID: p.RecordID, Version: 1, FamilySeq: seq}, nil, nil
	}

	// Existing record: check parentVersion.
	if p.ParentVersion != existing.Version {
		// Conflict: return current blob for client-side merge.
		blob, err := qt.GetBlobByID(ctx, existing.BlobID)
		if err != nil {
			return nil, nil, err
		}
		curMap, err := unmarshalMap(existing.UpdatedAtMap)
		if err != nil {
			curMap = map[string]string{}
		}
		return nil, &ConflictResult{
			RecordID:        p.RecordID,
			CurrentBlob:     blob.Ciphertext,
			CurrentVersion:  existing.Version,
			CurrentUpdAtMap: curMap,
		}, nil
	}

	// Apply update.
	blobID, err := uuid.NewV7()
	if err != nil {
		return nil, nil, err
	}

	if err := qt.InsertBlob(ctx, gen.InsertBlobParams{
		ID:         blobID.String(),
		FamilyID:   p.FamilyID,
		Ciphertext: p.Ciphertext,
		ByteCount:  int64(len(p.Ciphertext)),
		CreatedAt:  now,
	}); err != nil {
		return nil, nil, err
	}

	// Claim family_seq.
	seq, err := qt.AdvanceFamilySeq(ctx, p.FamilyID)
	if err != nil {
		return nil, nil, err
	}

	updAtMapJSON, err := marshalMap(p.UpdatedAtMap)
	if err != nil {
		return nil, nil, err
	}

	newVersion := existing.Version + 1
	if err := qt.UpdateRecordMeta(ctx, gen.UpdateRecordMetaParams{
		RecordID:       p.RecordID,
		BlobID:         blobID.String(),
		Version:        newVersion,
		EditedByUser:   p.UserID,
		UpdatedAtMap:   updAtMapJSON,
		DeletedAt:      nullStr(p.DeletedAt),
		FamilySeq:      seq,
		LastModifiedAt: now,
	}); err != nil {
		return nil, nil, err
	}

	return &UpsertResult{RecordID: p.RecordID, Version: newVersion, FamilySeq: seq}, nil, nil
}

// FetchSince returns records for a family with family_seq > afterSeq, up to
// limit rows, ordered by family_seq ASC.
func (s *Service) FetchSince(ctx context.Context, familyID string, afterSeq, limit int64) ([]gen.ListRecordsSinceSeqRow, error) {
	q := gen.New(s.db)
	return q.ListRecordsSinceSeq(ctx, gen.ListRecordsSinceSeqParams{
		FamilyID:  familyID,
		FamilySeq: afterSeq,
		Limit:     limit,
	})
}

// IncrementUsage increments families.usage_bytes within an open transaction.
func IncrementUsage(ctx context.Context, qt *gen.Queries, familyID string, delta int64) error {
	return qt.IncrementFamilyUsage(ctx, gen.IncrementFamilyUsageParams{
		UsageBytes: delta,
		ID:         familyID,
	})
}

// WithTx is a convenience wrapper that opens a transaction and provides a *gen.Queries.
func (s *Service) WithTx(ctx context.Context, fn func(*gen.Queries) error) error {
	return internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		return fn(gen.New(tx))
	})
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

func marshalMap(m map[string]string) (string, error) {
	if len(m) == 0 {
		return "{}", nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func unmarshalMap(s string) (map[string]string, error) {
	var m map[string]string
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, err
	}
	return m, nil
}

func nullStr(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

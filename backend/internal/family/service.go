// Package family implements the family layer: Init, invite lifecycle,
// migrate-solo, leave, and remove.
package family

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/records"
)

// suiteVersion is the envelope-suite version byte written to device_envelopes
// and family_recovery_envelopes. Matches the frontend SUITE_V1 constant.
const suiteVersion int64 = 0x01

// ErrAlreadyInFamily is returned by Init when the user already has an active
// family_members row (left_at IS NULL).
var ErrAlreadyInFamily = errors.New("user is already a member of an active family")

// InitParams carries the validated, decoded inputs for Init.
type InitParams struct {
	// FamilyID is the client-generated UUID v7 string.
	FamilyID string
	// DeviceID is the device to associate the envelope with.
	DeviceID string
	// UserID is the authenticated user initiating the family.
	UserID string
	// WrappedKey is the 80-byte libsodium sealed-box ciphertext.
	WrappedKey []byte
	// RecoveryWrap is the AEAD blob of familyKey under kRecovery.
	RecoveryWrap []byte
	// PhraseCt is the AEAD blob of the recovery phrase under familyKey.
	PhraseCt []byte
	// Salt is the 16-byte HKDF-derived salt stored explicitly.
	Salt []byte
	// RecoveryCreatedAt is an opaque, client-supplied createdAt string bound
	// into the recovery-envelope AAD. Stored verbatim (never reformatted);
	// empty when the client did not supply one.
	RecoveryCreatedAt string
}

// Service holds dependencies for family business logic.
type Service struct {
	db *sql.DB
}

// NewService constructs a family Service.
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// Init creates a new family for the given user and device in a single atomic
// transaction. Returns ErrAlreadyInFamily if the user already belongs to an
// active family.
func (s *Service) Init(ctx context.Context, p InitParams) error {
	now := httpx.FormatTime(nowUTC())

	return internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Check whether the user already has an active family membership.
		_, err := qt.GetActiveFamilyMember(ctx, p.UserID)
		if err == nil {
			return ErrAlreadyInFamily
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		// Insert families row.
		if err := qt.InsertFamily(ctx, gen.InsertFamilyParams{
			ID:                p.FamilyID,
			CreatedAt:         now,
			RecoveryCreatedAt: nullString(p.RecoveryCreatedAt),
		}); err != nil {
			return err
		}

		// Insert family_members row.
		if err := qt.InsertFamilyMember(ctx, gen.InsertFamilyMemberParams{
			FamilyID: p.FamilyID,
			UserID:   p.UserID,
			JoinedAt: now,
		}); err != nil {
			return err
		}

		// Insert device_envelopes row.
		if err := qt.InsertDeviceEnvelope(ctx, gen.InsertDeviceEnvelopeParams{
			DeviceID:   p.DeviceID,
			FamilyID:   p.FamilyID,
			WrappedKey: p.WrappedKey,
			Version:    suiteVersion,
			CreatedAt:  now,
		}); err != nil {
			return err
		}

		// Insert family_recovery_envelopes row.
		if err := qt.InsertFamilyRecoveryEnvelope(ctx, gen.InsertFamilyRecoveryEnvelopeParams{
			FamilyID:     p.FamilyID,
			RecoveryWrap: p.RecoveryWrap,
			PhraseCt:     p.PhraseCt,
			Version:      suiteVersion,
			Salt:         p.Salt,
			CreatedAt:    now,
		}); err != nil {
			return err
		}

		// Seed family_seq.
		if err := qt.InsertFamilySeq(ctx, p.FamilyID); err != nil {
			return err
		}

		// Audit: family.create — final atomic step per architecture §8.1.
		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.UserID),
			ActorEmail:  sql.NullString{},
			Action:      "family.create",
			TargetKind:  nullString("family"),
			TargetID:    nullString(p.FamilyID),
			DetailJson:  sql.NullString{},
			CreatedAt:   now,
		})
	})
}

// LookupActive returns the active family_members row for a user, or
// (nil, nil) when the user has no active membership.
func (s *Service) LookupActive(ctx context.Context, userID string) (*gen.FamilyMember, error) {
	q := gen.New(s.db)
	row, err := q.GetActiveFamilyMember(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// SendInviteParams carries inputs for sending an invite.
type SendInviteParams struct {
	CallerUserID   string
	CallerFamilyID string
	CallerEmail    string
	InviteeEmail   string
}

// SendInviteResult carries the result of a successful invite send.
type SendInviteResult struct {
	InviteID  string
	ExpiresAt string
}

// SendInvite creates a family invite in a single atomic transaction.
func (s *Service) SendInvite(ctx context.Context, p SendInviteParams) (SendInviteResult, error) {
	now := nowUTC()
	nowStr := httpx.FormatTime(now)
	expiresAt := httpx.FormatTime(now.AddDate(0, 0, 30))

	inviteID, err := uuid.NewV7()
	if err != nil {
		return SendInviteResult{}, fmt.Errorf("generate invite id: %w", err)
	}

	err = internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Allowlist check.
		if err := checkAllowlistGate(ctx, qt, p.InviteeEmail); err != nil {
			return err
		}

		// Member cap check.
		if err := checkMemberCap(ctx, qt, p.CallerFamilyID); err != nil {
			return err
		}

		// Duplicate invite check.
		_, err := qt.GetPendingInviteForEmail(ctx, gen.GetPendingInviteForEmailParams{
			FamilyID:     p.CallerFamilyID,
			InviteeEmail: p.InviteeEmail,
		})
		if err == nil {
			return ErrDuplicateInvite
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check duplicate invite: %w", err)
		}

		// Insert invite row.
		if err := qt.InsertFamilyInvite(ctx, gen.InsertFamilyInviteParams{
			ID:           inviteID.String(),
			FamilyID:     p.CallerFamilyID,
			InvitedBy:    p.CallerUserID,
			InviteeEmail: p.InviteeEmail,
			CreatedAt:    nowStr,
			ExpiresAt:    expiresAt,
		}); err != nil {
			return fmt.Errorf("insert invite: %w", err)
		}

		// Audit.
		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.CallerUserID),
			ActorEmail:  nullString(p.CallerEmail),
			Action:      "family.invite.send",
			TargetKind:  nullString("invite"),
			TargetID:    nullString(inviteID.String()),
			DetailJson:  sql.NullString{},
			CreatedAt:   nowStr,
		})
	})
	if err != nil {
		return SendInviteResult{}, err
	}
	return SendInviteResult{InviteID: inviteID.String(), ExpiresAt: expiresAt}, nil
}

// AcceptInviteParams carries inputs for accepting an invite.
type AcceptInviteParams struct {
	InviteID     string
	CallerUserID string
	CallerEmail  string
	// CallerDeviceID is the device making this request (from the session).
	// It does not hold the target family's key yet, so it is moved to
	// 'pending' as part of the same transaction — mirroring how a brand-new
	// device is created 'pending' on sign-in when the user already belongs
	// to a family (see auth.PostGoogle).
	CallerDeviceID string
	// DevicePubKey is an optional X25519 public key (raw bytes) for
	// CallerDeviceID. Solo devices (never part of a family) may not have
	// generated a keypair yet; if supplied here, it is written onto the
	// device row so an existing family member can wrap the family key for it.
	DevicePubKey []byte
}

// AcceptInviteResult carries the result of a successful invite accept.
type AcceptInviteResult struct {
	FamilyID string
	// DeviceWentPending is true when CallerDeviceID was transitioned from
	// 'active' to 'pending' as part of this accept.
	DeviceWentPending bool
}

// AcceptInvite accepts the invite atomically. Returns ErrNeedsMigrationDecision
// when the caller is already in a family.
func (s *Service) AcceptInvite(ctx context.Context, p AcceptInviteParams) (AcceptInviteResult, error) {
	now := nowUTC()
	nowStr := httpx.FormatTime(now)

	var result AcceptInviteResult

	err := internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Load invite.
		invite, err := qt.GetFamilyInvite(ctx, p.InviteID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInviteNotFound
		}
		if err != nil {
			return fmt.Errorf("get invite: %w", err)
		}

		if invite.Status != "pending" {
			return ErrInviteNotPending
		}
		inviteExpiry, err := httpx.ParseTime(invite.ExpiresAt)
		if err == nil && now.After(inviteExpiry) {
			return ErrInviteExpired
		}

		// Email match.
		if !strings.EqualFold(invite.InviteeEmail, p.CallerEmail) {
			return ErrInviteEmailMismatch
		}

		// Caller must NOT already be in a family.
		_, err = qt.GetActiveFamilyMember(ctx, p.CallerUserID)
		if err == nil {
			return ErrNeedsMigrationDecision
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check existing membership: %w", err)
		}

		// Target family member cap.
		if err := checkMemberCap(ctx, qt, invite.FamilyID); err != nil {
			return err
		}

		// Join.
		if err := qt.JoinFamily(ctx, gen.JoinFamilyParams{
			FamilyID: invite.FamilyID,
			UserID:   p.CallerUserID,
			JoinedAt: nowStr,
		}); err != nil {
			return fmt.Errorf("join family: %w", err)
		}

		// Mark invite accepted.
		if err := qt.UpdateInviteStatus(ctx, gen.UpdateInviteStatusParams{
			Status:    "accepted",
			DecidedAt: sql.NullString{String: nowStr, Valid: true},
			ID:        p.InviteID,
		}); err != nil {
			return fmt.Errorf("update invite status: %w", err)
		}

		// The accepting device does not hold the target family's key yet —
		// move it back to 'pending' so RequireActiveDevice blocks push/pull
		// until an existing member of the target family wraps a fresh
		// envelope for it via POST /v1/family/devices/{id}/envelope.
		if p.CallerDeviceID != "" {
			if len(p.DevicePubKey) > 0 {
				if err := qt.UpdateDevicePubKey(ctx, gen.UpdateDevicePubKeyParams{
					PubKey: p.DevicePubKey,
					ID:     p.CallerDeviceID,
				}); err != nil {
					return fmt.Errorf("update device pub key: %w", err)
				}
			}
			if err := qt.SetDevicePendingByID(ctx, p.CallerDeviceID); err != nil {
				return fmt.Errorf("set device pending: %w", err)
			}
			result.DeviceWentPending = true
		}

		// Audit.
		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if err := qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.CallerUserID),
			ActorEmail:  nullString(p.CallerEmail),
			Action:      "family.invite.accept",
			TargetKind:  nullString("invite"),
			TargetID:    nullString(p.InviteID),
			DetailJson:  sql.NullString{},
			CreatedAt:   nowStr,
		}); err != nil {
			return err
		}

		result.FamilyID = invite.FamilyID
		return nil
	})
	return result, err
}

// DeclineInviteParams carries inputs for declining an invite.
type DeclineInviteParams struct {
	InviteID     string
	CallerUserID string
	CallerEmail  string
}

// DeclineInvite marks the invite as declined.
func (s *Service) DeclineInvite(ctx context.Context, p DeclineInviteParams) error {
	now := nowUTC()
	nowStr := httpx.FormatTime(now)

	return internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		invite, err := qt.GetFamilyInvite(ctx, p.InviteID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInviteNotFound
		}
		if err != nil {
			return fmt.Errorf("get invite: %w", err)
		}
		if invite.Status != "pending" {
			return ErrInviteNotPending
		}

		// Email match — only the invitee may decline.
		if !strings.EqualFold(invite.InviteeEmail, p.CallerEmail) {
			return ErrInviteEmailMismatch
		}

		if err := qt.UpdateInviteStatus(ctx, gen.UpdateInviteStatusParams{
			Status:    "declined",
			DecidedAt: sql.NullString{String: nowStr, Valid: true},
			ID:        p.InviteID,
		}); err != nil {
			return fmt.Errorf("update invite status: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.CallerUserID),
			ActorEmail:  nullString(p.CallerEmail),
			Action:      "family.invite.decline",
			TargetKind:  nullString("invite"),
			TargetID:    nullString(p.InviteID),
			DetailJson:  sql.NullString{},
			CreatedAt:   nowStr,
		})
	})
}

// MigrateSoloRecord is a single record being migrated from solo family.
type MigrateSoloRecord struct {
	RecordID           string
	RecordType         string
	Blob               []byte
	UpdatedAtMap       string
	AddedByUser        string
	EditedByUser       string
	DeletedAt          sql.NullString
	PlaintextByteCount int64
}

// MigrateSoloParams carries inputs for the migrate-solo operation.
type MigrateSoloParams struct {
	MigrationID    string
	CallerUserID   string
	CallerEmail    string
	SourceFamilyID string
	TargetFamilyID string
	Records        []MigrateSoloRecord
}

// MigrateSoloResult carries the committed migration result.
type MigrateSoloResult struct {
	CommittedAt string
	RecordCount int
}

// MigrateSolo atomically migrates all records from the caller's solo family
// into the target family. Idempotent on MigrationID.
func (s *Service) MigrateSolo(ctx context.Context, p MigrateSoloParams) (MigrateSoloResult, error) {
	now := nowUTC()
	nowStr := httpx.FormatTime(now)

	var result MigrateSoloResult

	// Reject self-migration: source and target must be different families.
	// Otherwise MarkFamilyMemberLeft at the end would soft-kick the caller
	// out of the family they were trying to migrate INTO.
	if p.SourceFamilyID == p.TargetFamilyID {
		return result, ErrSourceSameAsTarget
	}

	err := internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Idempotency: if migration already committed, return cached result.
		existing, err := qt.GetMigrationRecord(ctx, p.MigrationID)
		if err == nil {
			if existing.UserID != p.CallerUserID {
				return ErrNotInTargetFamily
			}
			result = MigrateSoloResult{
				CommittedAt: existing.CommittedAt,
				RecordCount: int(existing.RecordCount),
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check migration idempotency: %w", err)
		}

		// Verify that the caller has a right to migrate into the target family:
		// either already a member (e.g. idempotent re-try) or holds a pending invite.
		_, memberErr := qt.GetFamilyMemberByUserID(ctx, gen.GetFamilyMemberByUserIDParams{
			FamilyID: p.TargetFamilyID,
			UserID:   p.CallerUserID,
		})
		if errors.Is(memberErr, sql.ErrNoRows) {
			// Not a member — check for a pending invite.
			_, inviteErr := qt.GetPendingInviteForEmail(ctx, gen.GetPendingInviteForEmailParams{
				FamilyID:     p.TargetFamilyID,
				InviteeEmail: p.CallerEmail,
			})
			if errors.Is(inviteErr, sql.ErrNoRows) {
				return ErrNotInTargetFamily
			}
			if inviteErr != nil {
				return fmt.Errorf("check target invite: %w", inviteErr)
			}
		} else if memberErr != nil {
			return fmt.Errorf("check target membership: %w", memberErr)
		}

		// Insert all records into target family.
		var totalBytes int64
		for _, rec := range p.Records {
			blobID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("generate blob id: %w", err)
			}

			byteCount := int64(len(rec.Blob))

			if err := qt.InsertBlob(ctx, gen.InsertBlobParams{
				ID:         blobID.String(),
				FamilyID:   p.TargetFamilyID,
				Ciphertext: rec.Blob,
				ByteCount:  byteCount,
				CreatedAt:  nowStr,
			}); err != nil {
				return fmt.Errorf("insert blob %s: %w", rec.RecordID, err)
			}

			seq, err := qt.AdvanceFamilySeq(ctx, p.TargetFamilyID)
			if err != nil {
				return fmt.Errorf("advance seq: %w", err)
			}

			// Try insert; if the record already has a row in the caller's OWN
			// source family (its pre-migration home), update that row in
			// place. Scoping the lookup by SourceFamilyID (rather than an
			// unscoped global lookup) prevents a client from using a
			// record_id that happens to belong to a DIFFERENT, unrelated
			// family to read or overwrite that family's row.
			existingMeta, metaErr := qt.GetRecordMeta(ctx, gen.GetRecordMetaParams{
				RecordID: rec.RecordID,
				FamilyID: p.SourceFamilyID,
			})
			if errors.Is(metaErr, sql.ErrNoRows) {
				// Not found in the source family either — this is a brand-new
				// record_id. Guard against it colliding with some OTHER
				// family's row before inserting (record_meta.record_id is a
				// global PRIMARY KEY).
				exists, existsErr := qt.RecordIDExistsInAnyFamily(ctx, rec.RecordID)
				if existsErr != nil {
					return fmt.Errorf("check record id collision %s: %w", rec.RecordID, existsErr)
				}
				if exists {
					return fmt.Errorf("migrate record %s: %w", rec.RecordID, records.ErrRecordIDConflict)
				}
				if err := qt.InsertRecordMeta(ctx, gen.InsertRecordMetaParams{
					RecordID:       rec.RecordID,
					FamilyID:       p.TargetFamilyID,
					RecordType:     rec.RecordType,
					BlobID:         blobID.String(),
					Version:        1,
					AddedByUser:    rec.AddedByUser,
					EditedByUser:   rec.EditedByUser,
					UpdatedAtMap:   rec.UpdatedAtMap,
					DeletedAt:      rec.DeletedAt,
					FamilySeq:      seq,
					CreatedAt:      nowStr,
					LastModifiedAt: nowStr,
				}); err != nil {
					return fmt.Errorf("insert record_meta %s: %w", rec.RecordID, err)
				}
			} else if metaErr != nil {
				return fmt.Errorf("get record_meta %s: %w", rec.RecordID, metaErr)
			} else {
				// Rewrite family_id along with the update: the record's ownership
				// row moves from the caller's source (solo) family into the
				// target family, matching where its blob and family_seq (already
				// allocated from the target family's counter above) now live.
				if err := qt.UpdateRecordMetaFamily(ctx, gen.UpdateRecordMetaFamilyParams{
					NewFamilyID:    p.TargetFamilyID,
					BlobID:         blobID.String(),
					Version:        existingMeta.Version + 1,
					EditedByUser:   rec.EditedByUser,
					UpdatedAtMap:   rec.UpdatedAtMap,
					DeletedAt:      rec.DeletedAt,
					FamilySeq:      seq,
					LastModifiedAt: nowStr,
					RecordID:       rec.RecordID,
					OldFamilyID:    p.SourceFamilyID,
				}); err != nil {
					return fmt.Errorf("update record_meta %s: %w", rec.RecordID, err)
				}
			}

			totalBytes += byteCount
		}

		// Quota check: read current usage inside the transaction to avoid stale reads.
		if totalBytes > 0 {
			targetFamily, err := qt.GetFamilyByID(ctx, p.TargetFamilyID)
			if err != nil {
				return fmt.Errorf("get target family for quota: %w", err)
			}
			if err := records.CheckQuota(targetFamily.UsageBytes, totalBytes); err != nil {
				return err
			}
		}

		// Update target family usage.
		if totalBytes > 0 {
			if err := qt.IncrementFamilyUsage(ctx, gen.IncrementFamilyUsageParams{
				UsageBytes: totalBytes,
				ID:         p.TargetFamilyID,
			}); err != nil {
				return fmt.Errorf("increment usage: %w", err)
			}
		}

		// Leave source family.
		if err := qt.MarkFamilyMemberLeft(ctx, gen.MarkFamilyMemberLeftParams{
			LeftAt:   sql.NullString{String: nowStr, Valid: true},
			FamilyID: p.SourceFamilyID,
			UserID:   p.CallerUserID,
		}); err != nil {
			return fmt.Errorf("leave source family: %w", err)
		}

		// Record migration for idempotency.
		if err := qt.InsertMigrationRecord(ctx, gen.InsertMigrationRecordParams{
			ID:             p.MigrationID,
			UserID:         p.CallerUserID,
			SourceFamilyID: sql.NullString{String: p.SourceFamilyID, Valid: p.SourceFamilyID != ""},
			TargetFamilyID: p.TargetFamilyID,
			RecordCount:    int64(len(p.Records)),
			CommittedAt:    nowStr,
		}); err != nil {
			return fmt.Errorf("insert migration record: %w", err)
		}

		// Audit.
		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if err := qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.CallerUserID),
			ActorEmail:  sql.NullString{},
			Action:      "family.migrate.solo",
			TargetKind:  nullString("family"),
			TargetID:    nullString(p.TargetFamilyID),
			DetailJson:  sql.NullString{},
			CreatedAt:   nowStr,
		}); err != nil {
			return err
		}

		result = MigrateSoloResult{
			CommittedAt: nowStr,
			RecordCount: len(p.Records),
		}
		return nil
	})
	return result, err
}

// LeaveParams carries inputs for a family leave.
type LeaveParams struct {
	CallerUserID   string
	CallerFamilyID string
	CallerEmail    string
}

// Leave soft-leaves the caller from their family. If the caller was the last
// active member, the family row and ALL its dependent data (members, invites,
// device envelopes, recovery envelope, family_seq, blobs, record_meta,
// snapshots) are cascade-deleted in the same transaction (B4f).
func (s *Service) Leave(ctx context.Context, p LeaveParams) error {
	now := nowUTC()
	nowStr := httpx.FormatTime(now)

	return internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		if err := qt.MarkFamilyMemberLeft(ctx, gen.MarkFamilyMemberLeftParams{
			LeftAt:   sql.NullString{String: nowStr, Valid: true},
			FamilyID: p.CallerFamilyID,
			UserID:   p.CallerUserID,
		}); err != nil {
			return fmt.Errorf("mark member left: %w", err)
		}

		// If no active members remain, hard-delete the family. FK ON DELETE
		// CASCADE drops everything family-scoped.
		remaining, err := qt.CountActiveFamilyMembers(ctx, p.CallerFamilyID)
		if err != nil {
			return fmt.Errorf("count remaining members: %w", err)
		}
		if remaining == 0 {
			if err := qt.DeleteFamilyCascade(ctx, p.CallerFamilyID); err != nil {
				return fmt.Errorf("cascade-delete empty family: %w", err)
			}
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.CallerUserID),
			ActorEmail:  nullString(p.CallerEmail),
			Action:      "family.leave",
			TargetKind:  nullString("family"),
			TargetID:    nullString(p.CallerFamilyID),
			DetailJson:  sql.NullString{},
			CreatedAt:   nowStr,
		})
	})
}

// RemoveMemberParams carries inputs for removing a family member.
type RemoveMemberParams struct {
	CallerUserID   string
	CallerFamilyID string
	CallerJoinedAt string
	CallerEmail    string
	TargetUserID   string
}

// RemoveMember soft-removes the target member from the family.
func (s *Service) RemoveMember(ctx context.Context, p RemoveMemberParams) error {
	now := nowUTC()
	nowStr := httpx.FormatTime(now)

	return internaldb.WithTx(ctx, s.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Load target's current membership in caller's family.
		targetMember, err := qt.GetFamilyMemberByUserID(ctx, gen.GetFamilyMemberByUserIDParams{
			FamilyID: p.CallerFamilyID,
			UserID:   p.TargetUserID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotSameFamily
		}
		if err != nil {
			return fmt.Errorf("get target member: %w", err)
		}
		if targetMember.LeftAt.Valid {
			return ErrNotSameFamily
		}

		// 24h cool-down check.
		if err := checkCoolDown(targetMember.LastRemovedAt, now); err != nil {
			return err
		}

		// Mutual-kick tie-break: kicker must have joined first.
		if !resolveMutualKickTieBreak(p.CallerJoinedAt, targetMember.JoinedAt) {
			return ErrTieBreakDenied
		}

		// Soft-remove.
		if err := qt.SetMemberLastRemoved(ctx, gen.SetMemberLastRemovedParams{
			LeftAt:        sql.NullString{String: nowStr, Valid: true},
			LastRemovedAt: sql.NullString{String: nowStr, Valid: true},
			FamilyID:      p.CallerFamilyID,
			UserID:        p.TargetUserID,
		}); err != nil {
			return fmt.Errorf("set member last removed: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: nullString(p.CallerUserID),
			ActorEmail:  nullString(p.CallerEmail),
			Action:      "family.member.remove",
			TargetKind:  nullString("user"),
			TargetID:    nullString(p.TargetUserID),
			DetailJson:  sql.NullString{},
			CreatedAt:   nowStr,
		})
	})
}

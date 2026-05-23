// Package family implements the family layer: Init, LookupActive, and Phase 7
// stubs for invite/accept/decline/migrate-solo.
package family

import (
	"context"
	"database/sql"
	"errors"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
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
			ID:        p.FamilyID,
			CreatedAt: now,
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
		return qt.InsertFamilySeq(ctx, p.FamilyID)
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

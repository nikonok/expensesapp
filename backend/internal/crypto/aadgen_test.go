//go:build aadgen

package crypto

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// vectorInput mirrors the JSON shape used in testdata/aad-vectors.json.
type vectorInput struct {
	VerByte            int               `json:"verByte"`
	FamilyID           string            `json:"familyId"`
	RecordID           string            `json:"recordId"`
	RecordType         string            `json:"recordType"`
	AddedByUserID      string            `json:"addedByUserId"`
	EditedByUserID     string            `json:"editedByUserId"`
	UpdatedAtMap       map[string]string `json:"updatedAtMap"`
	DeletedAt          string            `json:"deletedAt"`
	PlaintextByteCount uint32            `json:"plaintextByteCount"`
	NonceHex           string            `json:"nonceHex"`
}

type vector struct {
	Name           string      `json:"name"`
	Input          vectorInput `json:"input"`
	ExpectedAADHex string      `json:"expectedAADHex"`
}

type vectorFile struct {
	Schema  string   `json:"$schema"`
	Vectors []vector `json:"vectors"`
}

// TestGenerateVectors writes testdata/aad-vectors.json with computed expectedAADHex.
// Run with: go test -run TestGenerateVectors -tags aadgen ./internal/crypto/...
func TestGenerateVectors(t *testing.T) {
	nonce24zero := "000000000000000000000000000000000000000000000000"
	nonce24seq := "000102030405060708090a0b0c0d0e0f1011121314151617"
	nonce24ff := "ffffffffffffffffffffffffffffffffffffffffffffffff"

	vectors := []vector{
		{
			Name: "minimal-tx-no-deletedAt",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "transaction",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{"amount": "2026-05-17T10:00:00.000Z", "note": "2026-05-17T10:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 187,
				NonceHex:           nonce24seq,
			},
		},
		{
			Name: "empty-updatedAtMap",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "account",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{},
				DeletedAt:          "",
				PlaintextByteCount: 42,
				NonceHex:           nonce24zero,
			},
		},
		{
			Name: "single-field-updatedAtMap",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "category",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{"name": "2026-05-17T12:34:56.789Z"},
				DeletedAt:          "",
				PlaintextByteCount: 64,
				NonceHex:           nonce24zero,
			},
		},
		{
			Name: "deletedAt-populated",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "a1b2c3d4-e5f6-7000-8000-aabbccddeeff",
				RecordID:           "f1e2d3c4-b5a6-7000-8000-112233445566",
				RecordType:         "transaction",
				AddedByUserID:      "00000000-0000-7000-8000-000000000010",
				EditedByUserID:     "00000000-0000-7000-8000-000000000011",
				UpdatedAtMap:       map[string]string{"amount": "2026-01-01T00:00:00.000Z"},
				DeletedAt:          "2026-05-17T10:00:00.000Z",
				PlaintextByteCount: 128,
				NonceHex:           nonce24seq,
			},
		},
		{
			Name: "large-plaintextByteCount",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "budget",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{"amount": "2026-05-17T10:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 4294967295, // 0xFFFFFFFF
				NonceHex:           nonce24zero,
			},
		},
		{
			Name: "distinct-addedBy-editedBy",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "aaaaaaaa-bbbb-7000-8000-cccccccccccc",
				RecordID:           "dddddddd-eeee-7000-8000-ffffffffffff",
				RecordType:         "settings",
				AddedByUserID:      "11111111-2222-7000-8000-333333333333",
				EditedByUserID:     "44444444-5555-7000-8000-666666666666",
				UpdatedAtMap:       map[string]string{"theme": "2026-05-17T08:00:00.000Z", "currency": "2026-05-17T09:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 256,
				NonceHex:           nonce24seq,
			},
		},
		{
			Name: "all-zero-nonce",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "transaction",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{"amount": "2026-05-17T10:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 100,
				NonceHex:           nonce24zero,
			},
		},
		{
			Name: "all-ff-nonce",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "account",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{"balance": "2026-05-17T10:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 512,
				NonceHex:           nonce24ff,
			},
		},
		{
			Name: "multi-field-updatedAtMap-key-order",
			Input: vectorInput{
				VerByte:            1,
				FamilyID:           "00000000-0000-7000-8000-000000000001",
				RecordID:           "00000000-0000-7000-8000-000000000002",
				RecordType:         "transaction",
				AddedByUserID:      "00000000-0000-7000-8000-000000000003",
				EditedByUserID:     "00000000-0000-7000-8000-000000000003",
				UpdatedAtMap:       map[string]string{"z-field": "2026-05-17T10:00:00.000Z", "a-field": "2026-05-17T11:00:00.000Z", "m-field": "2026-05-17T12:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 300,
				NonceHex:           nonce24seq,
			},
		},
		{
			Name: "record-type-budget",
			Input: vectorInput{
				VerByte:            2,
				FamilyID:           "12345678-1234-7000-8000-123456789abc",
				RecordID:           "87654321-4321-7000-8000-cba987654321",
				RecordType:         "budget",
				AddedByUserID:      "aaaabbbb-cccc-7000-8000-ddddeeeeeeee",
				EditedByUserID:     "aaaabbbb-cccc-7000-8000-ddddeeeeeeee",
				UpdatedAtMap:       map[string]string{"limit": "2026-05-17T10:00:00.000Z"},
				DeletedAt:          "",
				PlaintextByteCount: 88,
				NonceHex:           nonce24seq,
			},
		},
	}

	// Compute expectedAADHex for each vector.
	for i := range vectors {
		v := &vectors[i]
		nonceBytes, err := hex.DecodeString(v.Input.NonceHex)
		require.NoError(t, err, "vector %q: bad nonce hex", v.Name)

		updatedAtMap := v.Input.UpdatedAtMap
		if updatedAtMap == nil {
			updatedAtMap = map[string]string{}
		}

		out, err := SerializeAAD(AADInput{
			VerByte:            byte(v.Input.VerByte),
			FamilyID:           v.Input.FamilyID,
			RecordID:           v.Input.RecordID,
			RecordType:         v.Input.RecordType,
			AddedByUserID:      v.Input.AddedByUserID,
			EditedByUserID:     v.Input.EditedByUserID,
			UpdatedAtMap:       updatedAtMap,
			DeletedAt:          v.Input.DeletedAt,
			PlaintextByteCount: v.Input.PlaintextByteCount,
			Nonce:              nonceBytes,
		})
		require.NoError(t, err, "vector %q: SerializeAAD failed", v.Name)
		v.ExpectedAADHex = hex.EncodeToString(out)
	}

	vf := vectorFile{
		Schema:  "internal/crypto AAD v1 golden vectors",
		Vectors: vectors,
	}

	data, err := json.MarshalIndent(vf, "", "  ")
	require.NoError(t, err)

	err = os.WriteFile("testdata/aad-vectors.json", data, 0644)
	require.NoError(t, err)

	t.Logf("Wrote %d vectors to testdata/aad-vectors.json", len(vectors))
}

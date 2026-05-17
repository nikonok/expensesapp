package crypto

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// aadVector mirrors the JSON shape of testdata/aad-vectors.json.
type aadVector struct {
	Name  string `json:"name"`
	Input struct {
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
	} `json:"input"`
	ExpectedAADHex string `json:"expectedAADHex"`
}

type aadVectorFile struct {
	Vectors []aadVector `json:"vectors"`
}

func loadVectors(t *testing.T) []aadVector {
	t.Helper()
	data, err := os.ReadFile("testdata/aad-vectors.json")
	require.NoError(t, err)
	var vf aadVectorFile
	require.NoError(t, json.Unmarshal(data, &vf))
	require.NotEmpty(t, vf.Vectors, "test vector file must not be empty")
	return vf.Vectors
}

func vectorToAADInput(t *testing.T, v aadVector) AADInput {
	t.Helper()
	nonce, err := hex.DecodeString(v.Input.NonceHex)
	require.NoError(t, err)
	m := v.Input.UpdatedAtMap
	if m == nil {
		m = map[string]string{}
	}
	return AADInput{
		VerByte:            byte(v.Input.VerByte),
		FamilyID:           v.Input.FamilyID,
		RecordID:           v.Input.RecordID,
		RecordType:         v.Input.RecordType,
		AddedByUserID:      v.Input.AddedByUserID,
		EditedByUserID:     v.Input.EditedByUserID,
		UpdatedAtMap:       m,
		DeletedAt:          v.Input.DeletedAt,
		PlaintextByteCount: v.Input.PlaintextByteCount,
		Nonce:              nonce,
	}
}

// TestSerializeAAD_GoldenVectors loads every vector from testdata/aad-vectors.json
// and asserts that SerializeAAD produces the expected hex output.
func TestSerializeAAD_GoldenVectors(t *testing.T) {
	vectors := loadVectors(t)
	for _, v := range vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			in := vectorToAADInput(t, v)
			got, err := SerializeAAD(in)
			require.NoError(t, err)
			require.Equal(t, v.ExpectedAADHex, hex.EncodeToString(got),
				"AAD output mismatch for vector %q", v.Name)
		})
	}
}

// TestSerializeAAD_NonceLengthValidation verifies that a 23-byte or 25-byte
// nonce is rejected with an error.
func TestSerializeAAD_NonceLengthValidation(t *testing.T) {
	base := AADInput{
		VerByte:            1,
		FamilyID:           "00000000-0000-7000-8000-000000000001",
		RecordID:           "00000000-0000-7000-8000-000000000002",
		RecordType:         "transaction",
		AddedByUserID:      "00000000-0000-7000-8000-000000000003",
		EditedByUserID:     "00000000-0000-7000-8000-000000000003",
		UpdatedAtMap:       map[string]string{},
		DeletedAt:          "",
		PlaintextByteCount: 100,
	}

	t.Run("23-byte-nonce", func(t *testing.T) {
		in := base
		in.Nonce = make([]byte, 23)
		_, err := SerializeAAD(in)
		require.Error(t, err)
	})

	t.Run("25-byte-nonce", func(t *testing.T) {
		in := base
		in.Nonce = make([]byte, 25)
		_, err := SerializeAAD(in)
		require.Error(t, err)
	})
}

// TestSerializeAAD_EmptyUpdatedAtMap verifies that an empty updatedAtMap
// produces the SHA-256 of the empty byte string as the digest.
func TestSerializeAAD_EmptyUpdatedAtMap(t *testing.T) {
	in := AADInput{
		VerByte:            1,
		FamilyID:           "00000000-0000-7000-8000-000000000001",
		RecordID:           "00000000-0000-7000-8000-000000000002",
		RecordType:         "account",
		AddedByUserID:      "00000000-0000-7000-8000-000000000003",
		EditedByUserID:     "00000000-0000-7000-8000-000000000003",
		UpdatedAtMap:       map[string]string{},
		DeletedAt:          "",
		PlaintextByteCount: 10,
		Nonce:              make([]byte, 24),
	}

	got, err := SerializeAAD(in)
	require.NoError(t, err)

	// SHA-256 of empty string is well-known: e3b0c44298fc1c14...
	emptyDigest := sha256.Sum256([]byte{})
	emptyDigestHex := hex.EncodeToString(emptyDigest[:])

	// The digest occupies bytes after: 13 (prefix) + 1 (ver) + 4+36 (familyId LP) +
	// 4+36 (recordId LP) + 4+7 (recordType "account" LP) +
	// 4+36 (addedBy LP) + 4+36 (editedBy LP) + 4 (digest len prefix) = 186 bytes in.
	// Simpler: just verify the full serialized output contains the empty digest.
	require.Contains(t, hex.EncodeToString(got), emptyDigestHex,
		"empty updatedAtMap should produce SHA-256 of empty string in AAD")
}

// TestSerializeAAD_UpdatedAtMapKeyOrder verifies that insertion order in
// UpdatedAtMap does not affect the output — the sort must be stable.
func TestSerializeAAD_UpdatedAtMapKeyOrder(t *testing.T) {
	nonce := make([]byte, 24)

	// Build two maps with the same key-value pairs in different insertion orders.
	m1 := map[string]string{
		"amount": "2026-05-17T10:00:00.000Z",
		"note":   "2026-05-17T11:00:00.000Z",
		"date":   "2026-05-17T12:00:00.000Z",
	}
	// Go map iteration is randomised, so we can't guarantee a different order
	// by just rewriting literals — but SerializeAAD must sort regardless.
	m2 := map[string]string{
		"date":   "2026-05-17T12:00:00.000Z",
		"note":   "2026-05-17T11:00:00.000Z",
		"amount": "2026-05-17T10:00:00.000Z",
	}

	mkInput := func(m map[string]string) AADInput {
		return AADInput{
			VerByte:            1,
			FamilyID:           "00000000-0000-7000-8000-000000000001",
			RecordID:           "00000000-0000-7000-8000-000000000002",
			RecordType:         "transaction",
			AddedByUserID:      "00000000-0000-7000-8000-000000000003",
			EditedByUserID:     "00000000-0000-7000-8000-000000000003",
			UpdatedAtMap:       m,
			DeletedAt:          "",
			PlaintextByteCount: 200,
			Nonce:              nonce,
		}
	}

	out1, err := SerializeAAD(mkInput(m1))
	require.NoError(t, err)
	out2, err := SerializeAAD(mkInput(m2))
	require.NoError(t, err)

	require.Equal(t, out1, out2, "map key insertion order must not affect AAD output")
}

// TestSerializeAAD_DeletedAtEmpty_vs_Present asserts that an empty DeletedAt
// and a populated one produce different AAD bytes.
func TestSerializeAAD_DeletedAtEmpty_vs_Present(t *testing.T) {
	base := AADInput{
		VerByte:            1,
		FamilyID:           "00000000-0000-7000-8000-000000000001",
		RecordID:           "00000000-0000-7000-8000-000000000002",
		RecordType:         "transaction",
		AddedByUserID:      "00000000-0000-7000-8000-000000000003",
		EditedByUserID:     "00000000-0000-7000-8000-000000000003",
		UpdatedAtMap:       map[string]string{"amount": "2026-05-17T10:00:00.000Z"},
		PlaintextByteCount: 150,
		Nonce:              make([]byte, 24),
	}

	withoutDeletedAt := base
	withoutDeletedAt.DeletedAt = ""

	withDeletedAt := base
	withDeletedAt.DeletedAt = "2026-05-17T10:00:00.000Z"

	out1, err := SerializeAAD(withoutDeletedAt)
	require.NoError(t, err)
	out2, err := SerializeAAD(withDeletedAt)
	require.NoError(t, err)

	require.NotEqual(t, out1, out2, "empty vs populated DeletedAt must produce different AAD")
}

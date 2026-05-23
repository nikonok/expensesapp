// Package crypto provides server-side cryptographic helpers — primarily the
// AAD serializer used as Additional Authenticated Data on the client's AEAD
// blob. The server does NOT encrypt or decrypt user data; this serializer
// exists so the server can verify on push that the metadata it stores matches
// what the client bound into the ciphertext.
package crypto

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"sort"
)

// SerializeAAD produces the canonical AAD bytes per architecture.md §7.4.
// All ID fields are encoded as their UTF-8 representation (the 36-character
// dashed UUID string), NOT as 16 raw bytes; both Go and TypeScript implementations
// must agree on that point.

// AADInput holds all fields needed to construct the canonical AAD bytes.
type AADInput struct {
	VerByte            byte
	FamilyID           string
	RecordID           string
	RecordType         string
	AddedByUserID      string
	EditedByUserID     string
	UpdatedAtMap       map[string]string // field name → RFC3339 ms timestamp
	DeletedAt          string            // RFC3339 ms or "" for none
	PlaintextByteCount uint32
	Nonce              []byte // exactly 24 bytes (XChaCha20 nonce)
}

// SerializeAAD builds the length-prefixed canonical AAD described in §7.4.
// Returns an error if in.Nonce is not exactly 24 bytes.
func SerializeAAD(in AADInput) ([]byte, error) {
	if len(in.Nonce) != 24 {
		return nil, errors.New("crypto: nonce must be exactly 24 bytes")
	}

	var buf []byte

	// Fixed prefix: "expapp-rec-v1" (13 bytes)
	buf = append(buf, []byte("expapp-rec-v1")...)

	// ver_byte (1 byte)
	buf = append(buf, in.VerByte)

	// LP(familyIdBytes)
	buf = append(buf, lp([]byte(in.FamilyID))...)

	// LP(recordIdBytes)
	buf = append(buf, lp([]byte(in.RecordID))...)

	// LP(recordTypeUtf8)
	buf = append(buf, lp([]byte(in.RecordType))...)

	// LP(addedByUserIdBytes)
	buf = append(buf, lp([]byte(in.AddedByUserID))...)

	// LP(editedByUserIdBytes)
	buf = append(buf, lp([]byte(in.EditedByUserID))...)

	// LP(updatedAtMapDigest) — SHA-256 of sorted key=value\n pairs
	digest := updatedAtMapDigest(in.UpdatedAtMap)
	buf = append(buf, lp(digest[:])...)

	// LP(deletedAtUtf8 or 0-length)
	if in.DeletedAt == "" {
		buf = append(buf, lp(nil)...)
	} else {
		buf = append(buf, lp([]byte(in.DeletedAt))...)
	}

	// uint32_be(plaintextByteCount)
	var countBuf [4]byte
	binary.BigEndian.PutUint32(countBuf[:], in.PlaintextByteCount)
	buf = append(buf, countBuf[:]...)

	// LP(nonce)
	buf = append(buf, lp(in.Nonce)...)

	return buf, nil
}

// lp returns the length-prefixed encoding: uint32_be(len(b)) || b.
func lp(b []byte) []byte {
	out := make([]byte, 4+len(b))
	binary.BigEndian.PutUint32(out[:4], uint32(len(b)))
	copy(out[4:], b)
	return out
}

// updatedAtMapDigest computes SHA-256 over the sorted key=value\n pairs of
// the updatedAtMap. Keys are sorted lexicographically. An empty map returns
// the SHA-256 of the empty byte string.
func updatedAtMapDigest(m map[string]string) [32]byte {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var content []byte
	for _, k := range keys {
		content = append(content, []byte(k)...)
		content = append(content, '=')
		content = append(content, []byte(m[k])...)
		content = append(content, '\n')
	}

	return sha256.Sum256(content)
}

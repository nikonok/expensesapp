// Package sync implements the sync push/pull HTTP handlers.
package sync

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
)

// EncodeCursor encodes a family_seq integer as an opaque base64url string.
// The internal representation is an 8-byte big-endian uint64.
func EncodeCursor(seq int64) string {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(seq))
	return base64.RawURLEncoding.EncodeToString(buf[:])
}

// DecodeCursor decodes an opaque cursor string back to a family_seq integer.
// A missing/empty cursor is treated as seq=0 (full sync from beginning).
func DecodeCursor(s string) (int64, error) {
	if s == "" {
		return 0, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		// Try padded variant.
		b, err = base64.URLEncoding.DecodeString(s)
		if err != nil {
			return 0, errors.New("cursor: invalid base64url encoding")
		}
	}
	if len(b) != 8 {
		return 0, errors.New("cursor: unexpected length")
	}
	v := int64(binary.BigEndian.Uint64(b))
	if v < 0 {
		// A negative cursor either came from someone fuzzing the API or from
		// a uint64 value > MaxInt64 cast through the BE decoder. Either way
		// it has no valid meaning in our schema — reject (B4j).
		return 0, errors.New("cursor: negative cursor not allowed")
	}
	return v, nil
}

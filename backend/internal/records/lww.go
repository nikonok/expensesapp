// Package records implements the record storage and sync logic.
package records

import (
	"errors"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// ErrBadTimestamp is returned by MergeUpdatedAtMap when either the incoming
// or the stored timestamp for a field fails to parse. Callers propagate this
// to the HTTP layer as a 400 with reason "bad-timestamp".
var ErrBadTimestamp = errors.New("bad timestamp in updatedAtMap")

// MergeUpdatedAtMap performs a per-field last-write-wins merge of two
// updatedAtMap values. For each key in incoming, if the timestamp is strictly
// newer than the corresponding key in current (or current is missing the key),
// the incoming value wins. Returns the merged map and a bool indicating whether
// any field in incoming won (meaning the record should be updated).
//
// If either the incoming or the stored timestamp fails to parse, the function
// returns ErrBadTimestamp. Previously the function silently let the incoming
// value win on parse failure, which let a single malformed timestamp poison
// future merges. Callers should reject the push with HTTP 400.
func MergeUpdatedAtMap(current, incoming map[string]string) (merged map[string]string, hasWinner bool, err error) {
	merged = make(map[string]string, len(current))
	for k, v := range current {
		merged[k] = v
	}

	for k, inVal := range incoming {
		curVal, exists := merged[k]
		if !exists {
			// New field — still validate the incoming timestamp so future merges
			// have a parseable comparand.
			if _, parseErr := httpx.ParseTime(inVal); parseErr != nil {
				return nil, false, ErrBadTimestamp
			}
			merged[k] = inVal
			hasWinner = true
			continue
		}
		inT, errIn := httpx.ParseTime(inVal)
		curT, errCur := httpx.ParseTime(curVal)
		if errIn != nil || errCur != nil {
			return nil, false, ErrBadTimestamp
		}
		if inT.After(curT) {
			merged[k] = inVal
			hasWinner = true
		}
	}
	return merged, hasWinner, nil
}

// LatestTimestamp returns the latest timestamp in the map, or zero if the map
// is empty or all entries fail to parse.
func LatestTimestamp(m map[string]string) time.Time {
	var latest time.Time
	for _, v := range m {
		t, err := httpx.ParseTime(v)
		if err == nil && t.After(latest) {
			latest = t
		}
	}
	return latest
}

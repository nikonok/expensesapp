// Package records implements the record storage and sync logic.
package records

import (
	"time"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// MergeUpdatedAtMap performs a per-field last-write-wins merge of two
// updatedAtMap values. For each key in incoming, if the timestamp is strictly
// newer than the corresponding key in current (or current is missing the key),
// the incoming value wins. Returns the merged map and a bool indicating whether
// any field in incoming won (meaning the record should be updated).
func MergeUpdatedAtMap(current, incoming map[string]string) (merged map[string]string, hasWinner bool) {
	merged = make(map[string]string, len(current))
	for k, v := range current {
		merged[k] = v
	}

	for k, inVal := range incoming {
		curVal, exists := merged[k]
		if !exists {
			merged[k] = inVal
			hasWinner = true
			continue
		}
		inT, errIn := httpx.ParseTime(inVal)
		curT, errCur := httpx.ParseTime(curVal)
		if errIn != nil || errCur != nil {
			// Unparseable timestamp: incoming wins to avoid silently dropping updates.
			merged[k] = inVal
			hasWinner = true
			continue
		}
		if inT.After(curT) {
			merged[k] = inVal
			hasWinner = true
		}
	}
	return merged, hasWinner
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

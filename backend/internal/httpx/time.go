package httpx

import "time"

// TimeFormat is the project's canonical RFC 3339 timestamp format.
// Per docs/backend/architecture.md §4.2: UTC, millisecond precision.
const TimeFormat = "2006-01-02T15:04:05.000Z07:00"

// FormatTime renders t as an RFC 3339 UTC string with millisecond precision.
func FormatTime(t time.Time) string { return t.UTC().Format(TimeFormat) }

// ParseTime tolerantly parses RFC 3339 with or without sub-second precision.
// Use this for reading timestamp columns that may have been written by
// older code paths using second precision.
func ParseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

package push

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInQuietWindow(t *testing.T) {
	cases := []struct {
		name       string
		quietStart string
		quietEnd   string
		nowHour    int
		nowMin     int
		want       bool
	}{
		// Overnight window 23:00–07:00
		{"in overnight window (midnight)", "23:00", "07:00", 0, 0, true},
		{"in overnight window (03:00)", "23:00", "07:00", 3, 0, true},
		{"in overnight window (start boundary)", "23:00", "07:00", 23, 0, true},
		{"outside overnight window (07:00 = end, exclusive)", "23:00", "07:00", 7, 0, false},
		{"outside overnight window (12:00)", "23:00", "07:00", 12, 0, false},
		{"outside overnight window (22:59)", "23:00", "07:00", 22, 59, false},
		// Same-day window 01:00–06:00
		{"in same-day window (03:00)", "01:00", "06:00", 3, 0, true},
		{"at start of same-day window", "01:00", "06:00", 1, 0, true},
		{"outside same-day window (07:00)", "01:00", "06:00", 7, 0, false},
		{"outside same-day window (00:59)", "01:00", "06:00", 0, 59, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Date(2026, 5, 24, tc.nowHour, tc.nowMin, 0, 0, time.UTC)
			got := inQuietWindow(now, tc.quietStart, tc.quietEnd)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestParseHHMM(t *testing.T) {
	h, m, err := parseHHMM("07:30")
	require.NoError(t, err)
	assert.Equal(t, 7, h)
	assert.Equal(t, 30, m)

	_, _, err = parseHHMM("25:00")
	assert.Error(t, err)

	_, _, err = parseHHMM("bad")
	assert.Error(t, err)
}

func TestParseHHMMExported(t *testing.T) {
	h, m, err := ParseHHMMExported("14:45")
	require.NoError(t, err)
	assert.Equal(t, 14, h)
	assert.Equal(t, 45, m)
}

package family

import (
	"testing"
)

// TestResolveMutualKickTieBreak verifies B4g: unparseable timestamps deny the
// kick instead of failing open.
func TestResolveMutualKickTieBreak(t *testing.T) {
	cases := []struct {
		name           string
		kickerJoinedAt string
		targetJoinedAt string
		want           bool
	}{
		{
			name:           "kicker_earlier_allows_kick",
			kickerJoinedAt: "2026-01-01T00:00:00.000Z",
			targetJoinedAt: "2026-01-02T00:00:00.000Z",
			want:           true,
		},
		{
			name:           "kicker_later_denies_kick",
			kickerJoinedAt: "2026-01-02T00:00:00.000Z",
			targetJoinedAt: "2026-01-01T00:00:00.000Z",
			want:           false,
		},
		{
			name:           "same_instant_allows_kick",
			kickerJoinedAt: "2026-01-01T00:00:00.000Z",
			targetJoinedAt: "2026-01-01T00:00:00.000Z",
			want:           true,
		},
		{
			name:           "bad_kicker_timestamp_denies_kick",
			kickerJoinedAt: "not-a-timestamp",
			targetJoinedAt: "2026-01-01T00:00:00.000Z",
			want:           false,
		},
		{
			name:           "bad_target_timestamp_denies_kick",
			kickerJoinedAt: "2026-01-01T00:00:00.000Z",
			targetJoinedAt: "not-a-timestamp",
			want:           false,
		},
		{
			name:           "both_bad_timestamps_denies_kick",
			kickerJoinedAt: "garbage",
			targetJoinedAt: "garbage",
			want:           false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveMutualKickTieBreak(tc.kickerJoinedAt, tc.targetJoinedAt)
			if got != tc.want {
				t.Fatalf("resolveMutualKickTieBreak(%q, %q) = %v, want %v",
					tc.kickerJoinedAt, tc.targetJoinedAt, got, tc.want)
			}
		})
	}
}

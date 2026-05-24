package push

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// QuietHoursService checks whether the current wall-clock time for a user
// falls within their configured quiet window, and enqueues notifications that
// must be delivered after quiet hours end.
type QuietHoursService struct {
	db *sql.DB
}

// NewQuietHoursService constructs a QuietHoursService.
func NewQuietHoursService(db *sql.DB) *QuietHoursService {
	return &QuietHoursService{db: db}
}

// notifSettings loads notification_settings for userID, returning defaults if
// no row exists.
func (s *QuietHoursService) notifSettings(ctx context.Context, userID string) gen.NotificationSetting {
	ns, err := gen.New(s.db).GetNotificationSettings(ctx, userID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.WarnContext(ctx, "push.QuietHours: load settings failed", "user_id", userID, "err", err)
		}
		// Defaults: UTC, quiet 23:00–07:00.
		return gen.NotificationSetting{
			UserID:     userID,
			Tz:         "UTC",
			QuietStart: "23:00",
			QuietEnd:   "07:00",
		}
	}
	return ns
}

// ShouldHold reports whether now is inside the user's quiet window (in their
// local timezone). If the timezone is invalid, UTC is assumed.
func (s *QuietHoursService) ShouldHold(ctx context.Context, userID string, now time.Time) bool {
	ns := s.notifSettings(ctx, userID)
	loc, err := time.LoadLocation(ns.Tz)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	return inQuietWindow(local, ns.QuietStart, ns.QuietEnd)
}

// QuietEndTime returns the time at which quiet hours end for the user, given
// now. The returned time is in UTC.
func (s *QuietHoursService) QuietEndTime(ctx context.Context, userID string, now time.Time) time.Time {
	ns := s.notifSettings(ctx, userID)
	loc, err := time.LoadLocation(ns.Tz)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	endH, endM, parseErr := parseHHMM(ns.QuietEnd)
	if parseErr != nil {
		endH, endM = 7, 0
	}

	candidate := time.Date(local.Year(), local.Month(), local.Day(), endH, endM, 0, 0, loc)
	if !candidate.After(local) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate.UTC()
}

// EnqueueHeld inserts a held_notifications row so the notification is
// delivered after quiet hours end.
func (s *QuietHoursService) EnqueueHeld(ctx context.Context, userID string, payload []byte, deliverAfter time.Time) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	now := httpx.FormatTime(time.Now().UTC())
	return gen.New(s.db).InsertHeldNotification(ctx, gen.InsertHeldNotificationParams{
		ID:           id.String(),
		UserID:       userID,
		Payload:      payload,
		DeliverAfter: httpx.FormatTime(deliverAfter),
		CreatedAt:    now,
	})
}

// inQuietWindow reports whether localNow falls within the quiet window
// [quietStart, quietEnd). Handles overnight windows (e.g. 23:00–07:00).
func inQuietWindow(localNow time.Time, quietStart, quietEnd string) bool {
	startH, startM, err1 := parseHHMM(quietStart)
	endH, endM, err2 := parseHHMM(quietEnd)
	if err1 != nil || err2 != nil {
		return false
	}

	nowMins := localNow.Hour()*60 + localNow.Minute()
	startMins := startH*60 + startM
	endMins := endH*60 + endM

	if startMins < endMins {
		// Same-day window (e.g. 01:00–06:00).
		return nowMins >= startMins && nowMins < endMins
	}
	// Overnight window (e.g. 23:00–07:00): quiet if >= start OR < end.
	return nowMins >= startMins || nowMins < endMins
}

// ParseHHMMExported is the exported variant of parseHHMM for use in jobs.
func ParseHHMMExported(s string) (hour, min int, err error) {
	return parseHHMM(s)
}

// parseHHMM parses "HH:MM" into hours and minutes.
func parseHHMM(s string) (hour, min int, err error) {
	if len(s) != 5 || s[2] != ':' {
		return 0, 0, fmt.Errorf("invalid HH:MM: %q", s)
	}
	h, e1 := twoDigit(s[0:2])
	m, e2 := twoDigit(s[3:5])
	if e1 != nil || e2 != nil || h > 23 || m > 59 {
		return 0, 0, fmt.Errorf("invalid HH:MM: %q", s)
	}
	return h, m, nil
}

func twoDigit(s string) (int, error) {
	if len(s) != 2 {
		return 0, fmt.Errorf("not two digits: %q", s)
	}
	a, b := int(s[0]-'0'), int(s[1]-'0')
	if a < 0 || a > 9 || b < 0 || b > 9 {
		return 0, fmt.Errorf("not digits: %q", s)
	}
	return a*10 + b, nil
}

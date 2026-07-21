package push

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
)

// DigestService builds and sends daily family-activity digest push
// notifications. It is triggered by the hourly digest_push job.
type DigestService struct {
	db        *sql.DB
	deliverer *Deliverer
}

// NewDigestService constructs a DigestService.
func NewDigestService(db *sql.DB, deliverer *Deliverer) *DigestService {
	return &DigestService{db: db, deliverer: deliverer}
}

// digestPayload is the JSON structure sent in the daily digest push.
type digestPayload struct {
	Type         string `json:"type"`
	FamilyID     string `json:"familyId"`
	ChangedCount int64  `json:"changedCount"`
	PeriodStart  string `json:"periodStart"`
}

// SendDigestForUser sends a daily family-activity digest to userID if their
// notification_settings.family_digest flag is enabled and they have an active
// family membership. The changesCount is the number of records modified in the
// family in the past 24h.
func (d *DigestService) SendDigestForUser(ctx context.Context, userID string) {
	q := gen.New(d.db)

	// Look up the user's active family.
	member, err := q.GetActiveFamilyMember(ctx, userID)
	if err != nil {
		if err != sql.ErrNoRows {
			slog.WarnContext(ctx, "push.Digest: get active family member failed",
				"user_id", userID, "err", err)
		}
		return
	}

	// Check family_digest flag (auto-create default row if missing).
	ns, err := q.GetNotificationSettings(ctx, userID)
	if err != nil {
		if err != sql.ErrNoRows {
			slog.WarnContext(ctx, "push.Digest: load settings failed",
				"user_id", userID, "err", err)
			return
		}
		// No settings row → digest defaults to 0 (off).
		return
	}
	if ns.FamilyDigest == 0 {
		return
	}

	// Count changes in the past 24h.
	since := time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
	count, err := q.CountRecentChangesForFamily(ctx, gen.CountRecentChangesForFamilyParams{
		FamilyID:       member.FamilyID,
		LastModifiedAt: since,
	})
	if err != nil {
		slog.WarnContext(ctx, "push.Digest: count changes failed",
			"family_id", member.FamilyID, "err", err)
		return
	}

	payload, err := json.Marshal(digestPayload{
		Type:         "family.digest",
		FamilyID:     member.FamilyID,
		ChangedCount: count,
		PeriodStart:  since,
	})
	if err != nil {
		slog.WarnContext(ctx, "push.Digest: marshal payload failed", "err", err)
		return
	}

	slog.InfoContext(ctx, "push.Digest: sending digest",
		"user_id", userID, "family_id", member.FamilyID, "changes", count)

	// Digest is optional — pass mandatory=false so it is dropped during quiet hours.
	d.deliverer.Deliver(ctx, userID, payload, false)
}

// dailyReminderPayload is the JSON structure sent for a simple daily reminder.
type dailyReminderPayload struct {
	Type string `json:"type"`
}

// SendDailyReminderForUser sends a simple "don't forget to log today" push to
// all active subscriptions for userID. It is called by the digest_push job when
// daily_reminder=1 and family_digest=0.
func (d *DigestService) SendDailyReminderForUser(ctx context.Context, userID string) {
	payload, err := json.Marshal(dailyReminderPayload{Type: "daily.reminder"})
	if err != nil {
		slog.WarnContext(ctx, "push.Digest: marshal daily reminder payload failed", "err", err)
		return
	}

	slog.InfoContext(ctx, "push.Digest: sending daily reminder", "user_id", userID)

	// Reminder is optional — pass mandatory=false so it is dropped during quiet hours.
	d.deliverer.Deliver(ctx, userID, payload, false)
}

// RecordChangedPayload is the JSON body sent to other family members when a
// record is changed (the "family activity" push on record.changed SSE).
type RecordChangedPayload struct {
	Type       string `json:"type"`
	FamilyID   string `json:"familyId"`
	RecordID   string `json:"recordId"`
	RecordType string `json:"recordType"`
	Version    int64  `json:"version"`
	Seq        int64  `json:"seq"`
	ActorUser  string `json:"actorUserId"`
}

// NotifyFamilyRecordChanged sends a Web Push to all family members except
// actorUserID. Should be called in a fire-and-forget goroutine from sync.push.
func (d *DigestService) NotifyFamilyRecordChanged(ctx context.Context, familyID, actorUserID, recordID, recordType string, version, seq int64) {
	q := gen.New(d.db)
	members, err := q.ListActiveUserIDsForFamily(ctx, familyID)
	if err != nil {
		slog.WarnContext(ctx, "push.Digest: list family members failed",
			"family_id", familyID, "err", err)
		return
	}

	payload, err := json.Marshal(RecordChangedPayload{
		Type:       "record.changed",
		FamilyID:   familyID,
		RecordID:   recordID,
		RecordType: recordType,
		Version:    version,
		Seq:        seq,
		ActorUser:  actorUserID,
	})
	if err != nil {
		slog.WarnContext(ctx, "push.Digest: marshal record.changed payload failed", "err", err)
		return
	}

	for _, uid := range members {
		if uid == actorUserID {
			continue // do not push to the actor
		}
		// Apply the same per-user family_digest opt-out the digest job
		// applies in SendDigestForUser — a record.changed push is exactly
		// the kind of family-activity notification that setting gates.
		ns, err := q.GetNotificationSettings(ctx, uid)
		if err != nil {
			if err != sql.ErrNoRows {
				slog.WarnContext(ctx, "push.Digest: load settings failed",
					"user_id", uid, "err", err)
			}
			// No settings row → defaults to off; skip.
			continue
		}
		if ns.FamilyDigest == 0 {
			continue
		}
		d.deliverer.Deliver(ctx, uid, payload, false)
	}
}

// FormatReminderTime formats an HH:MM reminder time for a push payload label.
func FormatReminderTime(t string) string {
	return fmt.Sprintf("daily reminder at %s", t)
}

package push

import (
	"context"
	"database/sql"
	"encoding/base64"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// VAPIDConfig holds the three VAPID parameters required for push delivery.
// When PublicKey or PrivateKey is empty, delivery is disabled and Deliver
// is a no-op (endpoints still accept subscriptions).
type VAPIDConfig struct {
	PublicKey  string // base64url-encoded uncompressed P-256 point
	PrivateKey string // base64url-encoded 32-byte scalar
	Subject    string // mailto: or https: URI per RFC 8292 §2.1
}

// Disabled reports whether VAPID keys are absent (push delivery is off).
func (v VAPIDConfig) Disabled() bool {
	return v.PublicKey == "" || v.PrivateKey == ""
}

// Deliverer sends Web Push notifications via VAPID and tracks delivery state.
type Deliverer struct {
	db         *sql.DB
	vapid      VAPIDConfig
	quietHours *QuietHoursService
}

// NewDeliverer constructs a Deliverer.
func NewDeliverer(db *sql.DB, vapid VAPIDConfig, qh *QuietHoursService) *Deliverer {
	return &Deliverer{db: db, vapid: vapid, quietHours: qh}
}

// Deliver sends payload to every active push subscription for userID. If quiet
// hours are currently active for the user the payload is held in the
// held_notifications queue instead of being delivered immediately.
//
// mandatory controls whether the notification must be delivered eventually
// (queued during quiet hours) or can be silently dropped.
func (d *Deliverer) Deliver(ctx context.Context, userID string, payload []byte, mandatory bool) {
	if d.vapid.Disabled() {
		return
	}

	// Quiet hours check.
	if d.quietHours != nil {
		now := time.Now()
		if d.quietHours.ShouldHold(ctx, userID, now) {
			if mandatory {
				deliverAfter := d.quietHours.QuietEndTime(ctx, userID, now)
				if err := d.quietHours.EnqueueHeld(ctx, userID, payload, deliverAfter); err != nil {
					slog.WarnContext(ctx, "push.Deliverer: enqueue held notification failed",
						"user_id", userID, "err", err)
				}
			}
			return
		}
	}

	q := gen.New(d.db)
	subs, err := q.ListPushSubscriptionsForUser(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "push.Deliverer: list subscriptions failed",
			"user_id", userID, "err", err)
		return
	}

	for _, sub := range subs {
		d.sendOne(ctx, q, sub, payload)
	}
}

// sendOne attempts delivery to a single subscription and updates tracking columns.
func (d *Deliverer) sendOne(ctx context.Context, q *gen.Queries, sub gen.PushSubscription, payload []byte) {
	// webpush-go Keys expects base64url-encoded strings; we store raw bytes in DB.
	p256dhB64 := base64.RawURLEncoding.EncodeToString(sub.P256dh)
	authB64 := base64.RawURLEncoding.EncodeToString(sub.Auth)

	s := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: p256dhB64,
			Auth:   authB64,
		},
	}

	opts := &webpush.Options{
		// AuthScheme: webpush.WebPush uses the modern "webpush" scheme compatible
		// with Apple Web Push (commit 76cc00f5, 2026-04-22). The older "vapid"
		// scheme (v1.4.0 default) is incompatible with Apple endpoints.
		AuthScheme:      webpush.WebPush,
		Subscriber:      d.vapid.Subject,
		VAPIDPublicKey:  d.vapid.PublicKey,
		VAPIDPrivateKey: d.vapid.PrivateKey,
		TTL:             3600, // 1 hour
		Urgency:         webpush.UrgencyNormal,
	}

	resp, err := webpush.SendNotificationWithContext(ctx, payload, s, opts)
	now := httpx.FormatTime(time.Now().UTC())

	if err != nil {
		slog.WarnContext(ctx, "push.Deliverer: send failed",
			"sub_id", sub.ID, "err", err)
		_ = q.MarkPushSubscriptionFailure(ctx, gen.MarkPushSubscriptionFailureParams{
			LastFailureAt: sql.NullString{String: now, Valid: true},
			ID:            sub.ID,
		})
		return
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusCreated, http.StatusOK:
		_ = q.MarkPushSubscriptionSuccess(ctx, gen.MarkPushSubscriptionSuccessParams{
			LastSuccessAt: sql.NullString{String: now, Valid: true},
			ID:            sub.ID,
		})

	case http.StatusGone, http.StatusNotFound:
		// 410/404 → subscription is permanently invalid; hard-delete it.
		slog.InfoContext(ctx, "push.Deliverer: subscription gone, removing",
			"sub_id", sub.ID, "status", resp.StatusCode)
		if delErr := q.DeletePushSubscription(ctx, sub.ID); delErr != nil {
			slog.WarnContext(ctx, "push.Deliverer: delete gone subscription failed",
				"sub_id", sub.ID, "err", delErr)
		}

	default:
		slog.WarnContext(ctx, "push.Deliverer: unexpected status",
			"sub_id", sub.ID, "status", resp.StatusCode)
		_ = q.MarkPushSubscriptionFailure(ctx, gen.MarkPushSubscriptionFailureParams{
			LastFailureAt: sql.NullString{String: now, Valid: true},
			ID:            sub.ID,
		})
	}
}

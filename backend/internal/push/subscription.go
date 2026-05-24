// Package push manages Web Push subscriptions and VAPID delivery.
package push

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// SubscriptionService stores and queries push_subscriptions rows.
type SubscriptionService struct {
	db *sql.DB
}

// NewSubscriptionService constructs a SubscriptionService.
func NewSubscriptionService(db *sql.DB) *SubscriptionService {
	return &SubscriptionService{db: db}
}

// Store inserts a new push subscription bound to the given device.
// If an identical endpoint already exists for the device it replaces the old row.
func (s *SubscriptionService) Store(ctx context.Context, deviceID, endpoint string, p256dh, auth []byte) (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	idStr := id.String()
	now := httpx.FormatTime(time.Now().UTC())

	q := gen.New(s.db)

	// Remove any existing subscription for this device+endpoint combination so
	// re-subscribing from the same browser does not create duplicates.
	existing, err := q.ListPushSubscriptionsForDevice(ctx, deviceID)
	if err != nil {
		slog.WarnContext(ctx, "push.SubscriptionService: list device subs failed", "err", err)
	}
	for _, sub := range existing {
		if sub.Endpoint == endpoint {
			if delErr := q.DeletePushSubscription(ctx, sub.ID); delErr != nil {
				slog.WarnContext(ctx, "push.SubscriptionService: delete old sub failed", "id", sub.ID, "err", delErr)
			}
		}
	}

	if err := q.InsertPushSubscription(ctx, gen.InsertPushSubscriptionParams{
		ID:        idStr,
		DeviceID:  deviceID,
		Endpoint:  endpoint,
		P256dh:    p256dh,
		Auth:      auth,
		CreatedAt: now,
	}); err != nil {
		return "", err
	}
	return idStr, nil
}

// Delete soft-deletes a push subscription by hard-deleting the row (no audit
// trail needed for push tokens).
func (s *SubscriptionService) Delete(ctx context.Context, id string) error {
	return gen.New(s.db).DeletePushSubscription(ctx, id)
}

// ListForUser returns all active push subscriptions for every device owned by
// the user. "Active" means last_failure_at IS NULL OR last_success_at >
// last_failure_at (i.e. not permanently failed).
func (s *SubscriptionService) ListForUser(ctx context.Context, userID string) ([]gen.PushSubscription, error) {
	return gen.New(s.db).ListPushSubscriptionsForUser(ctx, userID)
}

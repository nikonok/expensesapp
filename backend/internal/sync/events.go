package sync

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/live"
	"github.com/nikonok/expensesapp/backend/internal/records"
)

// pushDeliverer is the interface used by EventBus to fire Web Push on
// record.changed events. push.DigestService implements this.
type pushDeliverer interface {
	NotifyFamilyRecordChanged(ctx context.Context, familyID, actorUserID, recordID, recordType string, version, seq int64)
}

// EventBus translates accepted record upserts into SSE events published to the
// live.Hub. Attach it to the sync.Handler by calling Handler.SetEventBus.
type EventBus struct {
	hub      *live.Hub
	pusher   pushDeliverer // optional; nil disables Web Push delivery
}

// NewEventBus constructs an EventBus backed by hub.
func NewEventBus(hub *live.Hub) *EventBus {
	return &EventBus{hub: hub}
}

// SetPushDeliverer wires a Web Push deliverer into the EventBus so that
// record.changed events also trigger Web Push to other family members.
func (eb *EventBus) SetPushDeliverer(p pushDeliverer) {
	eb.pusher = p
}

// recordChangedPayload is the JSON payload for the "record.changed" SSE event.
type recordChangedPayload struct {
	Seq        int64  `json:"seq"`
	RecordID   string `json:"recordId"`
	RecordType string `json:"recordType"`
	Version    int64  `json:"version"`
}

// PublishRecordChanged emits a "record.changed" SSE event to the
// "family:<familyId>" scope for each accepted result, then fires a Web Push
// to other family members in a fire-and-forget goroutine (if a pusher is
// configured). Errors are logged but never returned — publishing is
// best-effort and must not affect the HTTP response.
func (eb *EventBus) PublishRecordChanged(familyID string, actorUserID string, results []records.UpsertResult, types []string) {
	scope := "family:" + familyID
	for i, r := range results {
		recordType := ""
		if i < len(types) {
			recordType = types[i]
		}
		payload := recordChangedPayload{
			Seq:        r.FamilySeq,
			RecordID:   r.RecordID,
			RecordType: recordType,
			Version:    r.Version,
		}
		data, err := json.Marshal(payload)
		if err != nil {
			slog.Warn("sync.EventBus: marshal record.changed payload failed",
				"record_id", r.RecordID,
				"err", err,
			)
			continue
		}
		eb.hub.Publish(scope, live.Event{
			Type: "record.changed",
			Data: data,
		})

		// Web Push: fire-and-forget to other family members.
		if eb.pusher != nil {
			p := eb.pusher
			rID := r.RecordID
			rType := recordType
			rVer := r.Version
			rSeq := r.FamilySeq
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				p.NotifyFamilyRecordChanged(ctx, familyID, actorUserID, rID, rType, rVer, rSeq)
			}()
		}
	}
}

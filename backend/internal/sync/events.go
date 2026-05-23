package sync

import (
	"encoding/json"
	"log/slog"

	"github.com/nikonok/expensesapp/backend/internal/live"
	"github.com/nikonok/expensesapp/backend/internal/records"
)

// EventBus translates accepted record upserts into SSE events published to the
// live.Hub. Attach it to the sync.Handler by calling Handler.SetEventBus.
type EventBus struct {
	hub *live.Hub
}

// NewEventBus constructs an EventBus backed by hub.
func NewEventBus(hub *live.Hub) *EventBus {
	return &EventBus{hub: hub}
}

// recordChangedPayload is the JSON payload for the "record.changed" SSE event.
type recordChangedPayload struct {
	Seq        int64  `json:"seq"`
	RecordID   string `json:"recordId"`
	RecordType string `json:"recordType"`
	Version    int64  `json:"version"`
}

// PublishRecordChanged emits a "record.changed" event to the "family:<familyId>"
// scope for each accepted result. Errors are logged but never returned — event
// publishing is best-effort and must not affect the HTTP response.
func (eb *EventBus) PublishRecordChanged(familyID string, results []records.UpsertResult, types []string) {
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
	}
}

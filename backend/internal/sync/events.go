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
	hub    *live.Hub
	pusher pushDeliverer // optional; nil disables Web Push delivery
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

// pushFanoutWorkers caps the number of goroutines that may concurrently call
// the Web Push deliverer for a single (familyID, actorUserID) batch.
const pushFanoutWorkers = 4

// pushJob is one Web Push delivery scheduled by PublishRecordChanged.
// We notify per (familyID, actorUserID, recordType) and report a representative
// recordID + version + seq for the digest deliverer.
type pushJob struct {
	familyID    string
	actorUserID string
	recordType  string
	recordID    string
	version     int64
	seq         int64
}

// PublishRecordChanged emits a "record.changed" SSE event per accepted record
// to the "family:<familyId>" scope. Web Push delivery is fanned out per
// (familyID, actorUserID, recordType) — NOT per record — through a small
// bounded worker pool, so a large push batch can't spawn N goroutines.
// Errors are logged but never returned (B4e).
func (eb *EventBus) PublishRecordChanged(familyID string, actorUserID string, results []records.UpsertResult, types []string) {
	scope := "family:" + familyID

	// Track the latest (highest-seq) push job per recordType so we send at
	// most one Web Push per type per batch. Map order is irrelevant — we just
	// need uniqueness.
	jobsByType := make(map[string]pushJob, 8)

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

		// Accumulate one push job per (recordType); prefer the latest one so
		// the deliverer sees the most recent version/seq for that bucket.
		if eb.pusher != nil {
			existing, ok := jobsByType[recordType]
			if !ok || r.FamilySeq > existing.seq {
				jobsByType[recordType] = pushJob{
					familyID:    familyID,
					actorUserID: actorUserID,
					recordType:  recordType,
					recordID:    r.RecordID,
					version:     r.Version,
					seq:         r.FamilySeq,
				}
			}
		}
	}

	if eb.pusher == nil || len(jobsByType) == 0 {
		return
	}

	// Drain the dedup map through a single worker pool. A buffered channel
	// sized to the number of jobs ensures we never block the producer.
	jobs := make(chan pushJob, len(jobsByType))
	for _, j := range jobsByType {
		jobs <- j
	}
	close(jobs)

	p := eb.pusher
	workers := pushFanoutWorkers
	if workers > len(jobsByType) {
		workers = len(jobsByType)
	}
	for w := 0; w < workers; w++ {
		go func() {
			for j := range jobs {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				p.NotifyFamilyRecordChanged(ctx, j.familyID, j.actorUserID, j.recordID, j.recordType, j.version, j.seq)
				cancel()
			}
		}()
	}
}

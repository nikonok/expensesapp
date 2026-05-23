// Package live implements the in-process SSE pub-sub hub used by the
// GET /v1/sync/live endpoint and the event bus in sync/events.go.
package live

import (
	"log/slog"
	"sync"
)

// Event is one SSE event emitted to subscribers.
type Event struct {
	// Type is the SSE event name, e.g. "record.changed", "device.joined".
	// The empty string is treated as a generic "message" event.
	// The special value keepaliveType is sent as an SSE comment (": keepalive").
	Type string
	// Data is the raw JSON payload. Unused when Type is keepaliveType.
	Data []byte
}

// keepaliveType is the sentinel event type used for the heartbeat ping.
// The SSE handler writes it as an SSE comment, not a data event.
const keepaliveType = ":keepalive"

// Keepalive returns a synthetic keepalive Event.
func Keepalive() Event {
	return Event{Type: keepaliveType}
}

// IsKeepalive reports whether e is the heartbeat sentinel.
func (e Event) IsKeepalive() bool {
	return e.Type == keepaliveType
}

// subscriber holds one active SSE connection.
type subscriber struct {
	ch chan Event
}

// Hub maintains in-process maps of subscribers per scope and dispatches events.
// All methods are goroutine-safe.
type Hub struct {
	mu   sync.RWMutex
	subs map[string][]*subscriber // scope → subscribers
}

// NewHub constructs an empty Hub.
func NewHub() *Hub {
	return &Hub{
		subs: make(map[string][]*subscriber),
	}
}

// Register adds a new subscriber for the given scope and returns a receive-only
// channel and an unregister function. The caller MUST call unregister exactly
// once when the connection is closed.
//
// Scope must be one of: "family:<familyId>", "user:<userId>", "device:<deviceId>".
// The returned channel has a buffer of 32 — if a slow client allows the buffer
// to fill, subsequent Publish calls will drop events for that subscriber.
func (h *Hub) Register(scope string) (<-chan Event, func()) {
	sub := &subscriber{ch: make(chan Event, 32)}

	h.mu.Lock()
	h.subs[scope] = append(h.subs[scope], sub)
	h.mu.Unlock()

	unregister := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		list := h.subs[scope]
		for i, s := range list {
			if s == sub {
				h.subs[scope] = append(list[:i], list[i+1:]...)
				break
			}
		}
		if len(h.subs[scope]) == 0 {
			delete(h.subs, scope)
		}
	}

	return sub.ch, unregister
}

// Publish sends event to all subscribers registered under scope.
// If a subscriber's channel is full (slow client), the event is dropped and a
// warning is logged. Publish never blocks.
func (h *Hub) Publish(scope string, event Event) {
	h.mu.RLock()
	list := h.subs[scope]
	// Copy to avoid holding the lock during channel sends.
	if len(list) == 0 {
		h.mu.RUnlock()
		return
	}
	targets := make([]*subscriber, len(list))
	copy(targets, list)
	h.mu.RUnlock()

	for _, s := range targets {
		select {
		case s.ch <- event:
		default:
			slog.Warn("live.Hub: subscriber channel full, dropping event",
				"scope", scope,
				"event_type", event.Type,
			)
		}
	}
}

// PublishAll sends event to every active subscriber regardless of scope.
// Used by the heartbeat to ping all connections.
func (h *Hub) PublishAll(event Event) {
	h.mu.RLock()
	// Collect all unique subscriber pointers.
	// Use a map to deduplicate when a subscriber appears in multiple scopes
	// (which does not happen today, but is defensive).
	seen := make(map[*subscriber]struct{})
	for _, list := range h.subs {
		for _, s := range list {
			seen[s] = struct{}{}
		}
	}
	h.mu.RUnlock()

	for s := range seen {
		select {
		case s.ch <- event:
		default:
			slog.Warn("live.Hub: subscriber channel full, dropping keepalive")
		}
	}
}

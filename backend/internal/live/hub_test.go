package live

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHub_RegisterAndPublish verifies that a registered subscriber receives
// a published event on the matching scope.
func TestHub_RegisterAndPublish(t *testing.T) {
	h := NewHub()

	ch, unregister := h.Register("family:abc")
	defer unregister()

	data, err := json.Marshal(map[string]string{"hello": "world"})
	require.NoError(t, err)

	h.Publish("family:abc", Event{Type: "record.changed", Data: data})

	select {
	case ev := <-ch:
		assert.Equal(t, "record.changed", ev.Type)
		assert.JSONEq(t, `{"hello":"world"}`, string(ev.Data))
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for event")
	}
}

// TestHub_PublishToWrongScope verifies that a subscriber on scope A does not
// receive an event published to scope B.
func TestHub_PublishToWrongScope(t *testing.T) {
	h := NewHub()

	ch, unregister := h.Register("family:abc")
	defer unregister()

	h.Publish("family:xyz", Event{Type: "record.changed"})

	select {
	case ev := <-ch:
		t.Fatalf("unexpected event received: %+v", ev)
	case <-time.After(20 * time.Millisecond):
		// correct — nothing received
	}
}

// TestHub_UnregisterStopsDelivery verifies that after unregistering, no more
// events are delivered to the closed channel.
func TestHub_UnregisterStopsDelivery(t *testing.T) {
	h := NewHub()

	ch, unregister := h.Register("user:u1")
	unregister()

	h.Publish("user:u1", Event{Type: "device.joined"})

	// Channel should be drained or empty — the subscriber was removed so the
	// event should not have been enqueued.
	select {
	case <-ch:
		t.Fatal("event delivered after unregister")
	case <-time.After(20 * time.Millisecond):
		// correct
	}
}

// TestHub_DropOnFullChannel verifies that Publish does not block when the
// subscriber's channel is full (32 buffered slots).
func TestHub_DropOnFullChannel(t *testing.T) {
	h := NewHub()

	ch, unregister := h.Register("device:d1")
	defer unregister()

	// Fill the buffer (capacity 32).
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 40; i++ {
			h.Publish("device:d1", Event{Type: "test"})
		}
	}()

	// Goroutine must complete without blocking.
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Publish blocked on full channel")
	}

	_ = ch
}

// TestHub_MultipleSubscribersOnSameScope verifies all subscribers on the same
// scope receive the event.
func TestHub_MultipleSubscribersOnSameScope(t *testing.T) {
	h := NewHub()

	const n = 5
	channels := make([]<-chan Event, n)
	for i := 0; i < n; i++ {
		ch, unreg := h.Register("family:fam1")
		channels[i] = ch
		defer unreg()
	}

	h.Publish("family:fam1", Event{Type: "record.changed", Data: []byte(`{}`)})

	for i, ch := range channels {
		select {
		case ev := <-ch:
			assert.Equal(t, "record.changed", ev.Type, "subscriber %d", i)
		case <-time.After(100 * time.Millisecond):
			t.Fatalf("subscriber %d did not receive event", i)
		}
	}
}

// TestHub_ConcurrentPublish verifies that concurrent publishes are goroutine-safe.
func TestHub_ConcurrentPublish(t *testing.T) {
	h := NewHub()

	ch, unregister := h.Register("family:concurrent")
	defer unregister()

	const goroutines = 10
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.Publish("family:concurrent", Event{Type: "x"})
		}()
	}
	wg.Wait()

	_ = ch
}

// TestHub_PublishAll verifies that PublishAll delivers to all subscribers
// regardless of scope.
func TestHub_PublishAll(t *testing.T) {
	h := NewHub()

	ch1, unreg1 := h.Register("family:f1")
	defer unreg1()
	ch2, unreg2 := h.Register("user:u1")
	defer unreg2()

	h.PublishAll(Keepalive())

	for _, ch := range []<-chan Event{ch1, ch2} {
		select {
		case ev := <-ch:
			assert.True(t, ev.IsKeepalive())
		case <-time.After(100 * time.Millisecond):
			t.Fatal("timed out waiting for keepalive")
		}
	}
}

// TestKeepaliveEvent verifies the Keepalive sentinel values.
func TestKeepaliveEvent(t *testing.T) {
	ev := Keepalive()
	assert.True(t, ev.IsKeepalive())
	assert.Equal(t, keepaliveType, ev.Type)

	regular := Event{Type: "record.changed"}
	assert.False(t, regular.IsKeepalive())
}

// TestHeartbeatInterval verifies the exported constant matches expectations.
func TestHeartbeatInterval(t *testing.T) {
	assert.Equal(t, 25*time.Second, HeartbeatInterval)
}

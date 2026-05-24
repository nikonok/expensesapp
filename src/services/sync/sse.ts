// SSE subscriber for /api/v1/sync/live — architecture §6.3, Phase 5d.
//
// Public API:
//   connectSSE(opts) → { disconnect() }
//
// Features:
// - Auto-reconnect with exponential backoff (500ms → 1s → 2s → 5s → 10s cap).
// - Per-event-type seq tracking to drop duplicates.
// - "connection lost" state if no message arrives within 60 seconds.

import { logger } from "@/services/log.service";

const SSE_ENDPOINT = "/api/v1/sync/live";

/** Backoff delays in milliseconds, capped at the last value. */
const BACKOFF_MS = [500, 1000, 2000, 5000, 10000] as const;

export type SSEEventType =
  | "record.changed"
  | "device.joined"
  | "device.activated"
  | "device.revoked"
  | "you.removed"
  | "sync.barrier"
  | "notification.dismiss";

export interface SSERecordChangedPayload {
  seq: number;
  recordId: string;
  recordType: string;
  version: number;
}

export interface SSEDeviceJoinedPayload {
  deviceId: string;
  label: string;
  createdAt: string;
  pubKey?: string;
}

export interface SSEDeviceActivatedPayload {
  deviceId: string;
  envelope: string;
}

export interface SSEDeviceRevokedPayload {
  deviceId: string;
  reason: string;
}

export interface SSEYouRemovedPayload {
  familyId: string;
  reason: string;
}

export interface SSESyncBarrierPayload {
  cursor: string;
}

export interface SSENotificationDismissPayload {
  notificationId: string;
}

export type SSEPayloadMap = {
  "record.changed": SSERecordChangedPayload;
  "device.joined": SSEDeviceJoinedPayload;
  "device.activated": SSEDeviceActivatedPayload;
  "device.revoked": SSEDeviceRevokedPayload;
  "you.removed": SSEYouRemovedPayload;
  "sync.barrier": SSESyncBarrierPayload;
  "notification.dismiss": SSENotificationDismissPayload;
};

export interface SSEConnectionHandle {
  disconnect(): void;
}

export interface ConnectSSEOptions {
  onEvent: <T extends SSEEventType>(type: T, payload: SSEPayloadMap[T]) => void;
  onOpen?: () => void;
  onError?: (e: Event) => void;
}

/**
 * Opens an EventSource to /api/v1/sync/live.  Reconnects automatically with
 * exponential backoff.  Surfaces a "connection lost" log if no event arrives
 * in 60 seconds.  Returns a handle with a disconnect() method.
 */
export function connectSSE(opts: ConnectSSEOptions): SSEConnectionHandle {
  let es: EventSource | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Per-event-type last seen seq to drop duplicates.
  const lastSeenSeq = new Map<string, number>();

  function resetHeartbeat() {
    if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      logger.warn("sse.heartbeat.lost: no message in 60s");
    }, 60_000);
  }

  function connect() {
    if (stopped) return;

    es = new EventSource(SSE_ENDPOINT, { withCredentials: true });

    es.onopen = () => {
      reconnectAttempt = 0;
      resetHeartbeat();
      logger.info("sse.connected");
      opts.onOpen?.();
    };

    // Listen for each named event type individually.
    const TYPES: SSEEventType[] = [
      "record.changed",
      "device.joined",
      "device.activated",
      "device.revoked",
      "you.removed",
      "sync.barrier",
      "notification.dismiss",
    ];

    for (const eventType of TYPES) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        resetHeartbeat();
        let payload: SSEPayloadMap[typeof eventType];
        try {
          payload = JSON.parse(e.data) as SSEPayloadMap[typeof eventType];
        } catch (err) {
          logger.warn("sse.parse.error", { eventType, error: String(err) });
          return;
        }

        // Seq-based dedup for record.changed (the only event carrying seq).
        if (eventType === "record.changed") {
          const p = payload as SSERecordChangedPayload;
          const key = `${eventType}:${p.recordId}`;
          const prev = lastSeenSeq.get(key) ?? -1;
          if (p.seq <= prev) {
            logger.debug("sse.dedup: dropping duplicate event", { eventType, seq: p.seq });
            return;
          }
          lastSeenSeq.set(key, p.seq);
        }

        logger.debug("sse.event", { eventType });
        (opts.onEvent as (type: string, payload: unknown) => void)(eventType, payload);
      });
    }

    // Also listen for generic "message" events (server may send without a named type).
    es.onmessage = () => {
      resetHeartbeat();
    };

    es.onerror = (e) => {
      logger.warn("sse.error: connection error, will reconnect");
      opts.onError?.(e);
      es?.close();
      es = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    const idx = Math.min(reconnectAttempt, BACKOFF_MS.length - 1);
    const delay = BACKOFF_MS[idx];
    reconnectAttempt++;
    logger.info("sse.reconnect.scheduled", { attempt: reconnectAttempt, delayMs: delay });
    reconnectTimer = setTimeout(() => {
      if (!stopped) connect();
    }, delay);
  }

  connect();

  return {
    disconnect() {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
      es?.close();
      es = null;
      logger.info("sse.disconnected");
    },
  };
}

# internal/push

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Web Push subscriptions, VAPID-signed delivery, quiet-hours queueing, digest
delivery on `record.changed`, and the notifications settings endpoints.

## Key files

- `subscription.go` — `SubscriptionService`; stores/lists/removes `push_subscriptions` rows; replaces duplicates for the same device+endpoint.
- `deliver.go` — `Deliverer`; signs and sends Web Push messages via `SherClockHolmes/webpush-go`; honors quiet hours.
- `digest.go` — `DigestService`; implements `sync.pushDeliverer`; coalesces per-family record changes into a periodic digest payload.
- `quiet_hours.go` — `QuietHoursService`; per-user start/end window with TZ awareness; computes `QuietEndTime`, enqueues `held_notifications`.
- `handlers.go` — endpoints `POST /v1/push/subscribe`, `DELETE /v1/push/subscribe/{id}`, `GET/PATCH /v1/notifications/settings`, `POST /v1/notifications/dismiss`.

## Public surface

- `SubscriptionService`, `Deliverer`, `DigestService`, `QuietHoursService` — all constructed in `cmd/api/main.go` and wired via `Handler`.
- `Handler`, `NewHandler` — registered in `internal/server.NewRouter`.
- `VAPIDConfig` and `VAPIDConfig.Disabled()` — push is a no-op when keys are absent (still accepts subscriptions).
- `DigestService.NotifyFamilyRecordChanged` — satisfies the `sync.pushDeliverer` interface.

## Conventions

- VAPID keys are env-loaded; if either public or private is empty, `Deliverer` short-circuits without error.
- `Deliver(ctx, userID, payload, mandatory)`:
  - `mandatory=true` ⇒ if quiet hours, enqueue in `held_notifications` with `deliverAfter = QuietEndTime`.
  - `mandatory=false` ⇒ silently drop during quiet hours.
- Subscriptions are de-duplicated by `(device_id, endpoint)`: re-subscribing from the same browser replaces the old row.
- Digest delivery is best-effort and runs on a background goroutine spawned by `sync.EventBus`; never blocks the HTTP response.
- Held notifications drain via `jobs.HeldDrainerJob` (`internal/jobs/held_drainer.go`).

## Gotchas

- The `webpush-go` import path uses a pinned, slightly non-upstream version (see go.mod) — do not bump.
- Errors from `webpush.SendNotification` are logged, not propagated. 410/404 from the push service means the subscription is gone — handle this by deleting the row; do not retry.
- `QuietHoursService` reads per-user settings from the DB. If a user has no row, defaults apply — check the implementation before assuming "always deliver".
- `digest.go` runs in fire-and-forget goroutines with 30 s timeouts; long-running pushes get cancelled, that's intentional.

## Tests

- `push_integration_test.go` — covers subscribe/dismiss/settings round trips.
- `quiet_hours_test.go` — per-user quiet window edge cases (DST, midnight wrap).
- Add VAPID delivery tests with a fake HTTP client; do not actually call FCM/APNS in tests.

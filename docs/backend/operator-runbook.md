# Operator Runbook — Expenses App Backend

Day-2 reference for keeping the Go API service healthy after it is already deployed. The operator does **not** SSH for setup — initial provisioning lives in [`docs/deployment-setup.md`](../deployment-setup.md). SSH is for diagnostics, manual snapshots, and emergency repair only.

Everything below assumes the standard layout: the Compose project lives at `/home/deploy/expensesapp/`, the API container is `expensesapp-api`, and the data volume is `expensesapp_apidata` (mounted at `/var/lib/expensesapp/` inside the container).

---

## Quick reference

| Task                                  | Section                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Is the API up?                        | [Health checks](#health-checks)                                                   |
| What is the API doing right now?      | [Reading logs](#reading-logs)                                                     |
| Inspect / create / restore a snapshot | [Snapshots](#snapshots)                                                           |
| Restore the whole database            | [Restoring the database file](#restoring-the-database-file)                       |
| Per-family storage usage              | [Inspecting quota](#inspecting-quota)                                             |
| Suspend a user                        | [Suspending a user](#suspending-a-user)                                           |
| Rotate VAPID keys                     | [Rotating VAPID keys](#rotating-vapid-keys)                                       |
| Change the bootstrap admin            | [Rotating the bootstrap admin email](#rotating-the-bootstrap-admin-email)         |
| Force a family key rotation           | [Force key-rotation on a family](#force-key-rotation-on-a-family)                 |
| "Something is broken"                 | [Common failure modes](#common-failure-modes)                                     |
| Update cloudflared or Docker images   | [Updating cloudflared and Docker images](#updating-cloudflared-and-docker-images) |
| Promote another admin                 | [Onboarding a second admin](#onboarding-a-second-admin)                           |
| Run a one-off SQL query               | [Running SQL against the database](#running-sql-against-the-database)             |

---

## Running SQL against the database

`expensesapp-api` runs on `gcr.io/distroless/static-debian12:nonroot` — the image contains only the compiled Go binary. There is no shell, no `sqlite3`, no coreutils, nothing else to exec into. **You cannot `docker exec` into the API container** for anything, not even `sh` or `ls`.

To run SQL against `data.db`, start a disposable container that mounts the same named volume (`expensesapp_apidata`, containing `data.db` at its root) instead:

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="<sql statement>" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

The rest of this document calls this **the sqlite shell command** and shows it with the `SQL=` value already filled in. Drop `-header -column` for statements that return no rows (`DELETE`/`UPDATE`/`INSERT`).

This is safe to run for reads at any time: `data.db` runs in WAL mode, so a second process can read concurrently with the API's own writes. Writes from this container while the API is running are not recommended — SQLite's file locking prevents corruption, but a second writer can hit `database is locked` / contend with the API's own writes, especially under load. Prefer running `DELETE`/`UPDATE`/`INSERT` through the sqlite shell command in a section that already tells you to stop the API first (see [Restoring the database file](#restoring-the-database-file)), or after you have stopped it yourself with `docker compose stop api`. Where a section below runs a write with the API still up, that has been called out explicitly.

For anything that only needs to talk to the running API over HTTP (not the database file), use `docker exec expensesapp-app wget -qO- http://api:8080/...` instead — the `app` container is Alpine-based nginx and has a shell and `wget`, as shown in [Health checks](#health-checks).

---

## Health checks

The API exposes a single liveness endpoint that the GitHub Actions deploy step polls. The `api` container has no Docker-level healthcheck (it runs on a distroless base image with no shell or `wget`/`curl` binary to probe itself with), so health is verified from outside the container, through nginx.

- **Public (through the tunnel and nginx):** `https://<APP_HOSTNAME>/api/v1/health`
- **From the server, without going out to the internet:** exec into the `app` container (nginx, Alpine-based, has `wget`) and hit `api` over the internal Docker network — you cannot `docker exec` into `expensesapp-api` itself for this; the image has no shell and no extra binaries to run.

Expected response: HTTP `200` with a JSON body:

```json
{ "ok": true, "version": "<git-sha>", "time": "2026-06-07T12:34:56.000Z" }
```

A handful of quick probes:

```bash
# Public health (from your laptop)
curl -fsS https://expenses.example.com/api/v1/health | jq .

# From the server, via the app container's internal network (bypasses nginx's /api/ proxy)
sudo docker exec expensesapp-app wget -qO- http://api:8080/v1/health

# Compose-level status — api shows plain "Up" (no container healthcheck);
# app and cloudflared show "Up (healthy)"/"Up" per their own checks
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml ps
```

If the API is not responding, the next sections under [Reading logs](#reading-logs) and [Common failure modes](#common-failure-modes) are the right starting points.

---

## Reading logs

All API logs are structured JSON written to `stdout` via Go's `log/slog`. Docker captures them; there is no log file on disk.

```bash
# Follow live logs
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs -f api

# Last 200 lines, then follow
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs --tail=200 -f api

# Logs from the last hour
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs --since=1h api

# Just one component
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs -f cloudflared
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs -f app
```

Useful fields on each line: `time`, `level`, `msg`, `request_id`, `user_id`, `device_id`, `method`, `path`, `status`, `duration_ms`. For grepping a single request across services, filter on `request_id` — it is propagated from chi's `RequestID` middleware into every log line for that request.

Pretty-print + filter example:

```bash
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs --no-color --tail=2000 api \
  | grep -E '^expensesapp-api' \
  | sed 's/^[^|]*| //' \
  | jq -c 'select(.level == "ERROR" or .level == "WARN")'
```

Background-job log lines start with `job=`: `job=daily-snapshot`, `job=deletion-purge`, `job=digest-push`, `job=held-drainer`. Filtering by job name is the fastest way to confirm a cron run actually fired.

---

## Snapshots

The backend keeps **per-family logical snapshots** — rows in the `snapshots` and `snapshot_entries` tables — not whole-database file copies. Each family snapshot is a list of pointers to existing `blobs` rows; ciphertext is never duplicated. There is no scheduled `VACUUM INTO` of `data.db`; to back up the file on disk see [Restoring the database file](#restoring-the-database-file).

The daily snapshot job (`job=daily-snapshot`) runs at **03:00 UTC** and:

1. Creates a snapshot row for every family for today's UTC date.
2. Prunes snapshots whose `expires_at` has passed (TTL is 30 days from creation).
3. Prunes orphan `blobs` rows (no `record_meta` reference, no `snapshot_entries` reference).

### Listing snapshots for a family

Using [the sqlite shell command](#running-sql-against-the-database):

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT snapshot_date, created_at, expires_at FROM snapshots
   WHERE family_id = '<family-uuid>'
   ORDER BY snapshot_date DESC LIMIT 30;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

### Inspecting a snapshot's entries

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT record_type, COUNT(*) AS rows
   FROM snapshot_entries
   WHERE snapshot_id = '<snapshot-uuid>'
   GROUP BY record_type;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

### Triggering a snapshot manually

The job is idempotent on `(family_id, snapshot_date)` — re-running it for the same UTC day is a no-op. To force creation for every family right now, restart the API container shortly before 03:00 UTC, or call the existing service method via a small one-shot SQL insert (see code in `backend/internal/snapshot/service.go`). For ad-hoc inspection, copying the database file is usually simpler:

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL=".backup /data/snapshots/$(date -u +%Y-%m-%d)-manual.db" \
  alpine:3 sh -c 'apk add -q sqlite && mkdir -p /data/snapshots && sqlite3 /data/data.db "$SQL"'

sudo docker run --rm -v expensesapp_apidata:/data alpine:3 ls -lh /data/snapshots/
```

`sqlite3 .backup` is online-safe (uses the SQLite backup API) and produces a consistent copy without blocking writers.

### Restoring a family snapshot

Family snapshot restore is exposed via the API, not the database. An admin (or family member) hits:

```text
POST /v1/snapshots/{snapshotDate}/restore
```

Effect (single DB transaction):

1. Every record in the snapshot is upserted into `record_meta` with a fresh `version` and a fresh `family_seq`.
2. Every record_meta belonging to the family that is **not** in the snapshot is soft-deleted (tombstone) with a fresh `version`/`family_seq`.
3. An `snapshot.restore` audit entry is written.
4. A **single** `sync.barrier` SSE event is broadcast on the `family:<familyId>` scope (B4h). Peer devices drop their local sync cursor and re-pull from scratch — they do not receive a flood of `record.changed` events.

Operator fallback if the admin UI is broken — call the endpoint with a valid admin session cookie:

```bash
curl -fsS -X POST "https://expenses.example.com/v1/snapshots/2026-06-01/restore" \
  -H "X-Requested-With: fetch" \
  -b "__Host-session=<session-cookie>"
```

If the restore succeeds, every active client for the family will reconnect to SSE, see one `sync.barrier`, and re-pull. No further operator action is required.

---

## Restoring the database file

For "everything is gone" recovery — corruption, ransomware, accidental `rm`, hardware replacement — restore the whole `data.db` file from a host-side backup.

The live database is at `/var/lib/expensesapp/data.db` inside the `apidata` Docker volume. There is no automatic file-level backup; you are expected to capture one out-of-band (restic / borg / ZFS send / rsync), typically by snapshotting `/var/lib/docker/volumes/expensesapp_apidata/_data/`.

```bash
# 1. Stop the API so no writes race with the copy.
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml stop api

# 2. Find the volume mount path on the host.
sudo docker volume inspect expensesapp_apidata --format '{{ .Mountpoint }}'
# Example: /var/lib/docker/volumes/expensesapp_apidata/_data

# 3. Replace data.db (and remove stale WAL companions).
sudo cp /path/to/backup/data.db \
   /var/lib/docker/volumes/expensesapp_apidata/_data/data.db
sudo rm -f /var/lib/docker/volumes/expensesapp_apidata/_data/data.db-wal \
           /var/lib/docker/volumes/expensesapp_apidata/_data/data.db-shm

# 4. Restart.
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml start api

# 5. Confirm health.
curl -fsS https://expenses.example.com/api/v1/health
```

Notes:

- Migrations run automatically on startup. Restoring an older-schema backup onto a newer binary is fine — goose will bring it forward. Restoring a newer-schema backup onto an older binary is **not** supported; downgrade the API image first.
- Removing the stale WAL/SHM files is important: SQLite refuses to attach a WAL that does not match the main database file.
- Clients see the restore as a series of stale-cursor errors on their next pull; they will recover automatically on the following sync cycle.

---

## Inspecting quota

Per [`docs/backend/architecture.md`](./architecture.md) §7.7, each family's deduplicated ciphertext usage is tracked incrementally in `families.usage_bytes`. The ceiling is 200 MB per family.

Using [the sqlite shell command](#running-sql-against-the-database):

```bash
# Per-family usage, ranked
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT id AS family_id, usage_bytes,
          ROUND(usage_bytes * 100.0 / (200 * 1024 * 1024), 1) AS pct_of_200mb,
          created_at
   FROM families
   ORDER BY usage_bytes DESC;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'

# Reconciled count (defensive — should match the maintained counter)
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT f.id AS family_id,
          f.usage_bytes AS counter_bytes,
          IFNULL(SUM(b.byte_count), 0) AS actual_bytes
   FROM families f
   LEFT JOIN blobs b ON b.family_id = f.id
   GROUP BY f.id
   ORDER BY actual_bytes DESC;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'

# Blob counts per family (active records, snapshot entries, orphans pending GC)
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT f.id AS family_id,
          (SELECT COUNT(*) FROM record_meta rm WHERE rm.family_id = f.id AND rm.deleted_at IS NULL) AS live_records,
          (SELECT COUNT(*) FROM record_meta rm WHERE rm.family_id = f.id AND rm.deleted_at IS NOT NULL) AS tombstones,
          (SELECT COUNT(*) FROM blobs b WHERE b.family_id = f.id) AS blobs
   FROM families f;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

If `counter_bytes` and `actual_bytes` diverge by more than a kilobyte, that is a bug — capture both before mutating anything and file an issue. The nightly reconciliation job is intended to keep them in lock-step.

---

## Suspending a user

Suspension is an admin action: it sets `users.suspended_at` and revokes every active session for the user. A suspended user gets `403 account-suspended` on every authenticated endpoint until they are unsuspended; their existing data is preserved.

### Via the admin UI (preferred)

1. Sign in to `https://<APP_HOSTNAME>/admin` with an admin or root account.
2. Open **Users**, find the target row, click **Suspend** → confirm.
3. The action writes an `audit_log` entry (`user.suspend`) automatically.

### Via curl (fallback)

If the admin UI is unavailable, call the endpoint directly with a valid admin session cookie:

```bash
# Suspend
curl -fsS -X POST "https://expenses.example.com/v1/admin/users/<userId>/suspend" \
  -H "X-Requested-With: fetch" \
  -b "__Host-session=<admin-session-cookie>"

# Unsuspend
curl -fsS -X POST "https://expenses.example.com/v1/admin/users/<userId>/unsuspend" \
  -H "X-Requested-With: fetch" \
  -b "__Host-session=<admin-session-cookie>"
```

Root users cannot be suspended (`403 forbidden` with detail `"cannot suspend root user"`). To remove root authority, see [Rotating the bootstrap admin email](#rotating-the-bootstrap-admin-email).

To confirm the change took:

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT id, email, suspended_at FROM users WHERE id = '<userId>';" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

---

## Rotating VAPID keys

VAPID (Web Push) keys sign the push messages the backend sends to FCM/Apple. Three GitHub Secrets carry them: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. There is no separate `VITE_VAPID_PUBLIC_KEY` secret — `docker-compose.yml` derives the `app` image's `VITE_VAPID_PUBLIC_KEY` build arg from `VAPID_PUBLIC_KEY` in the server `.env`, baking the same public key into the Vite bundle at build time.

**Rotation invalidates every existing push subscription.** Browsers tie a subscription to the public key it was created with — every device must re-subscribe on its next visit. Users will simply stop receiving notifications until they re-open the app and accept the prompt again. Rotate only on suspected compromise.

```bash
# Generate a fresh pair locally
docker run --rm node:alpine npx -y web-push generate-vapid-keys --json > vapid.json

# Update the three GitHub Secrets
gh secret set VAPID_PUBLIC_KEY       --body "$(jq -r .publicKey  vapid.json)"
gh secret set VAPID_PRIVATE_KEY      --body "$(jq -r .privateKey vapid.json)"
gh secret set VAPID_SUBJECT          --body "mailto:you@example.com"

# Shred the local copy
shred -u vapid.json

# Trigger a deploy so the new keys reach the server and the Vite bundle is rebuilt
gh workflow run "Deploy to Server"
```

After the deploy is green:

- Existing `push_subscriptions` rows in SQLite are now dead. They will be GC'd opportunistically when delivery fails (`push_token_gc` path). You can also wipe them eagerly:

  This is a write while the API stays up — a single `DELETE` is low-risk, but if you hit `database is locked`, retry (or stop the API first, per the note in [Running SQL against the database](#running-sql-against-the-database)):

  ```bash
  sudo docker run --rm -i -v expensesapp_apidata:/data \
    -e SQL="DELETE FROM push_subscriptions;" \
    alpine:3 sh -c 'apk add -q sqlite && sqlite3 /data/data.db "$SQL"'
  ```

- Watch the API logs for `push: subscribe` lines as devices re-register over the next few days.

---

## Rotating the bootstrap admin email

`BOOTSTRAP_ADMIN_EMAIL` controls which Google account becomes (and remains) root. On every container start, `EnsureBootstrap` reads this env var, compares it to the singleton `bootstrap_state` row, and:

- **First boot** (no row yet) — writes the row; the allowlist entry is added on the first matching sign-in.
- **Same email as stored** — no-op, no audit entry.
- **Different email** — transactional handoff: the previous root is downgraded to a regular user (account preserved, data untouched), and the new email is promoted to root on its next sign-in. Re-parenting of the prior root's promotees happens lazily when the new root signs in for the first time. An `audit_log` entry with action `bootstrap.email.change` is written.

To rotate:

```bash
# 1. Update the GitHub Secret.
gh secret set BOOTSTRAP_ADMIN_EMAIL --body "new-root@example.com"

# 2. Trigger a deploy. The workflow rewrites .env on the server and restarts api.
gh workflow run "Deploy to Server"

# 3. Have the new owner sign in via Google with the new address.
#    They are auto-promoted to root on first sign-in.
```

Verify after deploy:

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT id, bootstrap_email, applied_at FROM bootstrap_state;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'

sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT id, email, is_root, is_admin FROM users WHERE email IN ('old@example.com','new-root@example.com');" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

If you must restart the API container by hand (no deploy), use:

```bash
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml restart api
```

— but note the workflow rewrites `.env` on every deploy, so any manual edit to `/home/deploy/expensesapp/.env` will be reverted on the next push. Always set the GitHub Secret as the source of truth.

---

## Force key-rotation on a family

> **Status: not yet implemented.** This is the B5b roadmap item. Until it ships, the operator cannot rotate the `familyKey` after removing a member.

What works today (member removal, soft):

- Removing a member via the admin UI or `POST /v1/family/members/{userId}/remove` does all of:
  - Marks `family_members.left_at = now`.
  - Revokes every session for that user.
  - Deletes their `device_envelopes` rows for the family.
  - Emits SSE `you.removed` to the removed user's devices and `family.changed` to remaining members.
- The removed user's local clients wipe their copy of the family data on receipt of `you.removed`.

What is **not** done today:

- The `familyKey` is **not** rotated. A removed member who kept an offline copy of the encrypted blobs they pulled before removal can still decrypt them with the key material their browser cached prior to wipe. For an app that markets E2E encryption, this is a known gap.
- There is no `POST /v1/family/key-rotation` endpoint yet. The proposed design lives in [`docs/design-notes/key-rotation.md`](../design-notes/key-rotation.md); the brief is to generate a fresh `familyKey'`, re-wrap it for every remaining device, and tag subsequent ciphertexts with a new key epoch. See that document for the open questions (snapshot interaction, pending-outbox re-encryption, recovery-envelope regeneration).

Until B5b lands, treat "force key rotation" as **not available**. If a hard reset is operationally required:

1. Remove the member through the admin UI as usual.
2. Communicate out-of-band that any data exfiltrated prior to removal should be considered visible to them.
3. Track the gap in your runbook so you can flip the switch once the endpoint exists.

---

## Common failure modes

| Symptom                                                                                                                                                   | Likely cause                                                                                                                            | Fix                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose ps` shows `api` restarting or exited (it has no container healthcheck, so it never shows `unhealthy` — check state/restart count instead) | A required env var is missing (`BOOTSTRAP_ADMIN_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `VAPID_*`); migration failed; volume permission error | `docker compose logs api` — the container prints the missing variable name on exit. Set the corresponding GitHub Secret and redeploy.                                                                                                                      |
| `curl https://<host>/api/v1/health` returns `502` / `503`                                                                                                 | API container is down or restarting                                                                                                     | `docker compose ps`; if `api` is restarting check the logs. If `cloudflared` is up but `api` is not, nginx (in `app`) returns 502.                                                                                                                         |
| `curl https://<host>/api/v1/health` hangs or DNS-fails                                                                                                    | Cloudflare tunnel is down                                                                                                               | `docker compose logs cloudflared`; expect `Registered tunnel connection`. If absent, `docker compose restart cloudflared`. If still failing, regenerate the tunnel token in Cloudflare and update `CLOUDFLARE_TUNNEL_TOKEN`.                               |
| Clients get `401 unauthenticated` on every request                                                                                                        | Session table was wiped, or sessions expired in bulk after a restart                                                                    | Confirm `sessions` row count with [the sqlite shell command](#running-sql-against-the-database), `SQL="SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL;"`. Users must sign in again — there is no recovery from a wiped sessions table.             |
| Clients get `403 forbidden` with detail mentioning CSRF                                                                                                   | Frontend deploy out of sync with backend; missing `X-Requested-With: fetch` header                                                      | Redeploy the frontend so it matches the backend. For curl, always pass `-H "X-Requested-With: fetch"`.                                                                                                                                                     |
| Clients get `403 account-suspended`                                                                                                                       | The user was suspended (by accident or otherwise)                                                                                       | Unsuspend via admin UI, or `POST /v1/admin/users/{id}/unsuspend` (see above).                                                                                                                                                                              |
| Push notifications stopped working for everyone simultaneously                                                                                            | VAPID keys were rotated; every subscription is now dead                                                                                 | Expected after a VAPID rotation. Users re-subscribe on next app open.                                                                                                                                                                                      |
| Push notifications stopped for one user only                                                                                                              | Their browser dropped the subscription (uninstall / private mode / GC)                                                                  | They need to re-open the PWA and accept the prompt again. Inspect their rows with [the sqlite shell command](#running-sql-against-the-database), `SQL="SELECT * FROM push_subscriptions WHERE device_id IN (SELECT id FROM devices WHERE user_id='...');"` |
| SSE connections dropping every few minutes                                                                                                                | Cloudflare default idle timeout (~100s) won the race against the 25s heartbeat                                                          | Confirm `:keepalive` lines in the SSE traffic; if missing the backend has a regression. If present, check Cloudflare tunnel/proxy settings for buffering rules that strip events.                                                                          |
| New sign-ins fail with `403 email-not-allowed`                                                                                                            | The email is not on the allowlist                                                                                                       | Add via the admin UI's allowlist screen, or `POST /v1/admin/allowlist`. New users only join via this list.                                                                                                                                                 |
| `sync.push` returns `413 payload-too-large`                                                                                                               | Client tried to upload a batch above the server-side body limit                                                                         | Client bug — clients are supposed to chunk batches. Inspect the request, file an issue.                                                                                                                                                                    |
| `sync.push` returns `429 rate-limit-exceeded`                                                                                                             | Client is in a tight retry loop after a 5xx                                                                                             | Backoff is client-side; nothing for the operator to fix. Check API logs for the underlying 5xx that started the loop.                                                                                                                                      |
| `usage_bytes` won't go down after deleting records                                                                                                        | Tombstoned records still pin their blob; orphan blobs are GC'd by the daily snapshot job                                                | Wait for the 03:00 UTC `daily-snapshot` job to run, or restart the API to trigger the pruner on next schedule.                                                                                                                                             |
| Tunnel up, API up, but the PWA gets `404` on `/api/*`                                                                                                     | Tunnel ingress rules don't route `/api/*` to `api:8080`                                                                                 | Check Cloudflare Zero Trust → Networks → Tunnels → your tunnel → Public Hostnames. The `/api/*` rule must come before the catch-all. If you set `CF_API_TOKEN` in GitHub Secrets, re-running the deploy rewrites ingress automatically.                    |
| Container restarts in a loop with `database is locked`                                                                                                    | Stale WAL or another process is writing to `data.db`                                                                                    | Stop the API, ensure no other container has the volume mounted, remove stale `data.db-wal` and `data.db-shm`, start again. See [Restoring the database file](#restoring-the-database-file) for the exact paths.                                            |

For anything not in the table, the loop is always the same: `docker compose ps` → `docker compose logs api` → look up the failing endpoint in [`docs/backend/architecture.md`](./architecture.md) §6 → if the log line includes a `request_id`, grep the rest of the request out of the logs.

---

## Updating cloudflared and Docker images

The Compose file pins:

- `cloudflare/cloudflared:latest` — a moving tag; pull regularly.
- `expensesapp:local` and `expensesapp-api:local` — both rebuilt by the deploy workflow from the repo.

### Refresh cloudflared

```bash
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml pull cloudflared
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml up -d --no-deps cloudflared

sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs --tail=50 cloudflared
# Expect: "Registered tunnel connection"
```

If you want a pinned cloudflared (recommended for production), change the image tag in `docker-compose.yml` to a release tag from [cloudflare/cloudflared releases](https://github.com/cloudflare/cloudflared/releases), commit, push, redeploy.

### Refresh API / app images

Just push to `main` (or `gh workflow run "Deploy to Server"`). The workflow rebuilds both images, restarts the containers in order, and waits on the `/api/v1/health` gate before marking the deploy green. No operator action on the server is required.

### Free up disk after many rebuilds

```bash
sudo docker image prune -f
sudo docker builder prune -f
# Heavier — removes ALL unused images, networks, build cache:
sudo docker system prune -af
```

Do **not** run `docker volume prune` blindly — `expensesapp_apidata` is the database.

---

## Onboarding a second admin

Only a root user can promote another user to admin. The flow assumes the second admin already has an account (they have signed in at least once).

### Promote via the admin UI

1. Root signs in to `https://<APP_HOSTNAME>/admin`.
2. Open **Users**, find the candidate, click **Promote to admin** → confirm.
3. The action writes an `audit_log` entry (`admin.promote`) and sets `users.promoter_id = <root's user id>`. Demotion later can be done by the promoter or by root.

### Promote via curl (fallback)

```bash
curl -fsS -X POST "https://expenses.example.com/v1/admin/admins/<userId>/promote" \
  -H "X-Requested-With: fetch" \
  -b "__Host-session=<root-session-cookie>"
```

### What a new admin can do

- Suspend / unsuspend non-root users.
- Read and write the allowlist.
- Promote and demote admins **whose promoter is themselves** (or via the regular tree rules in [`internal/admin/tree.go`](../../backend/internal/admin/tree.go)).
- Read the audit log.
- Force-revoke a device (`POST /v1/admin/devices/{id}/revoke`).
- Self-delete via `POST /v1/admin/account/delete-immediate` (testing escape hatch — admins only on themselves).

### What only root can do

- Promote a regular user to admin in the first place.
- Demote an admin who was promoted by someone else.
- Be the target of `BOOTSTRAP_ADMIN_EMAIL` for handoff (see [Rotating the bootstrap admin email](#rotating-the-bootstrap-admin-email)).
- Receive root status from the bootstrap flow (regular users cannot be promoted to root via the admin tree — only via the env var).

Verify:

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT id, email, is_admin, is_root, promoter_id, suspended_at FROM users WHERE is_admin = 1 OR is_root = 1;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

Then check the audit trail:

```bash
sudo docker run --rm -i -v expensesapp_apidata:/data \
  -e SQL="SELECT created_at, actor_email, action, target_id FROM audit_log
   WHERE action IN ('admin.promote','admin.demote','bootstrap.email.change')
   ORDER BY created_at DESC LIMIT 20;" \
  alpine:3 sh -c 'apk add -q sqlite && sqlite3 -header -column /data/data.db "$SQL"'
```

---

## Where to look next

- [`docs/backend/architecture.md`](./architecture.md) — full data model, endpoint list, key flows.
- [`docs/deployment-setup.md`](../deployment-setup.md) — first-boot provisioning, Cloudflare Tunnel, GitHub Secrets.
- [`docs/design-notes/key-rotation.md`](../design-notes/key-rotation.md) — proposed family-key rotation design (B5b, not yet implemented).
- [`backend/internal/`](../../backend/internal/) — the code itself. Every package has a `CLAUDE.md` that names its public surface and gotchas.

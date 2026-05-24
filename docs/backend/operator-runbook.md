# Operator Runbook — Expenses App Backend

Concise day-2 reference for the Go API service. For initial server provisioning (SSH, cloudflared tunnel, GitHub Actions), see `docs/deployment-setup.md`.

---

## First Boot

### 1. Generate VAPID keys

```bash
docker run --rm node:alpine npx web-push generate-vapid-keys
```

Copy the `Public Key` and `Private Key` values.

### 2. Populate `.env`

Add these entries to `/home/deploy/expensesapp/.env` (alongside `CLOUDFLARE_TUNNEL_TOKEN`):

```dotenv
BOOTSTRAP_ADMIN_EMAIL=you@yourdomain.com
GOOGLE_OAUTH_CLIENT_ID=<your-oauth-client-id>.apps.googleusercontent.com
VAPID_PUBLIC_KEY=<from step 1>
VAPID_PRIVATE_KEY=<from step 1>
VAPID_SUBJECT=mailto:you@yourdomain.com
```

### 3. Add the `/api/*` route in Cloudflare dashboard

In the tunnel's **Public Hostname** tab, add:

| Field   | Value             |
| ------- | ----------------- |
| Path    | `/api/*`          |
| Service | `http://api:8080` |

This routes all backend traffic through the same tunnel as the frontend. The `api` hostname resolves via Docker internal DNS.

### 4. Start the stack

```bash
docker compose -f /home/deploy/expensesapp/docker-compose.yml up -d --build
```

On first run the API container runs DB migrations automatically, then creates the bootstrap admin user from `BOOTSTRAP_ADMIN_EMAIL`. Sign in with that email via Google to receive root/admin rights.

---

## Bootstrap Email Change

To transfer root ownership to a new email:

1. Edit `BOOTSTRAP_ADMIN_EMAIL` in `.env` to the new address.
2. Restart the API container:
   ```bash
   docker compose -f /home/deploy/expensesapp/docker-compose.yml restart api
   ```
3. On startup the service re-runs `EnsureBootstrap`: the old root account is demoted to a regular user (account preserved), and the new address becomes root when it first signs in.

---

## Snapshot Retention

Daily snapshots are created at 02:00 UTC by the `snapshot_daily` job via `VACUUM INTO /var/lib/expensesapp/snapshots/YYYY-MM-DD.db`. The job retains the **30 most recent** snapshot files and deletes older ones automatically.

To trigger a snapshot manually, exec into the container and run:

```bash
docker exec expensesapp-api sqlite3 /var/lib/expensesapp/data.db \
  "VACUUM INTO '/var/lib/expensesapp/snapshots/$(date +%Y-%m-%d)-manual.db'"
```

To inspect snapshot files:

```bash
docker exec expensesapp-api ls -lh /var/lib/expensesapp/snapshots/
```

---

## Restore from Disk Backup

The live database is at `/var/lib/expensesapp/data.db` inside the `apidata` Docker volume.

```bash
# 1. Stop the API so no writes race with the copy.
docker compose -f /home/deploy/expensesapp/docker-compose.yml stop api

# 2. Find the volume mount path on the host.
docker volume inspect expensesapp_apidata --format '{{ .Mountpoint }}'
# Example output: /var/lib/docker/volumes/expensesapp_apidata/_data

# 3. Copy the backup file into the volume.
sudo cp /path/to/backup/YYYY-MM-DD.db \
    /var/lib/docker/volumes/expensesapp_apidata/_data/data.db

# 4. Restart.
docker compose -f /home/deploy/expensesapp/docker-compose.yml start api
```

Migrations run automatically on startup — if the backup is from an older schema version, goose will bring it forward. Newer-schema backups should not be restored onto an older binary.

---

## Suspending a User

1. Open the admin panel at `https://your-domain/admin` (requires admin or root role).
2. Navigate to **Users** and click the user's row.
3. Click **Suspend**.

Or via the API directly (with a valid admin session cookie):

```bash
curl -X POST https://your-domain/v1/admin/users/<userId>/suspend \
  -H "X-Requested-With: fetch" \
  -b "__Host-session=<your-session-cookie>"
```

A suspended user receives 403 on all authenticated requests until unsuspended.

---

## Tailing Logs

```bash
# All services
docker compose logs -f api

# Last 100 lines then follow
docker compose logs --tail=100 -f api
```

Logs are structured JSON (`log/slog`). Fields: `time`, `level`, `msg`, `request_id`, `user_id`, `device_id`, `method`, `path`, `status`, `duration_ms`.

---

## Common 4xx / 5xx Mappings

| Status | Error code            | Meaning                                                               |
| ------ | --------------------- | --------------------------------------------------------------------- |
| 400    | `validation-error`    | Request body failed schema validation.                                |
| 401    | `unauthenticated`     | Missing or expired session cookie. Client should redirect to sign-in. |
| 403    | `forbidden`           | CSRF header missing (`X-Requested-With: fetch`) or insufficient role. |
| 403    | `admin-required`      | Endpoint requires admin/root; caller is neither.                      |
| 403    | `family-required`     | Endpoint requires an active family membership.                        |
| 403    | `account-suspended`   | User account has been suspended by an admin.                          |
| 404    | `not-found`           | Resource does not exist or belongs to a different user.               |
| 409    | `conflict`            | Duplicate or invariant violation (e.g., family already exists).       |
| 413    | `payload-too-large`   | Request body exceeds server limit.                                    |
| 429    | `rate-limit-exceeded` | Too many requests from this IP or user. Back off and retry.           |
| 500    | `internal`            | Unexpected server error. Check `docker compose logs -f api`.          |
| 503    | `service-unavailable` | Health check failing; container is restarting.                        |

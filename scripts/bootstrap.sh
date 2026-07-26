#!/usr/bin/env bash
# bootstrap.sh — first-time server setup for expensesapp
#
# Run this once on the server to start the Docker containers and bring
# the Cloudflare tunnel online. After this, all deployments go through
# GitHub Actions via the tunnel.
#
# Usage (all six variables are required):
#   CLOUDFLARE_TUNNEL_TOKEN=eyJh... BOOTSTRAP_ADMIN_EMAIL=me@example.com \
#   GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com \
#   VAPID_PUBLIC_KEY=xxx VAPID_PRIVATE_KEY=xxx VAPID_SUBJECT=mailto:me@example.com \
#   bash scripts/bootstrap.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="sudo docker compose -f $APP_DIR/docker-compose.yml"

echo "=== expensesapp bootstrap ==="
echo "App directory: $APP_DIR"
echo

# ── Required variables ────────────────────────────────────────────────────────

missing=""
for var in CLOUDFLARE_TUNNEL_TOKEN BOOTSTRAP_ADMIN_EMAIL GOOGLE_OAUTH_CLIENT_ID \
           VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT; do
    if [[ -z "${!var:-}" ]]; then
        missing="$missing $var"
    fi
done
if [[ -n "$missing" ]]; then
    echo "Error: the following required environment variable(s) are not set:$missing" >&2
    exit 1
fi

# ── Write .env ────────────────────────────────────────────────────────────────

ENV_FILE="$APP_DIR/.env"
ENV_TMP="$(mktemp -p "$APP_DIR" .env.XXXXXX)"
chmod 600 "$ENV_TMP"
{
    printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$CLOUDFLARE_TUNNEL_TOKEN"
    printf 'BOOTSTRAP_ADMIN_EMAIL=%s\n'   "$BOOTSTRAP_ADMIN_EMAIL"
    printf 'GOOGLE_OAUTH_CLIENT_ID=%s\n'  "$GOOGLE_OAUTH_CLIENT_ID"
    printf 'VAPID_PUBLIC_KEY=%s\n'        "$VAPID_PUBLIC_KEY"
    printf 'VAPID_PRIVATE_KEY=%s\n'       "$VAPID_PRIVATE_KEY"
    printf 'VAPID_SUBJECT=%s\n'           "$VAPID_SUBJECT"
} > "$ENV_TMP"
chown deploy:deploy "$ENV_TMP"
mv "$ENV_TMP" "$ENV_FILE"
echo "✓ .env written"

# ── Pull latest code ──────────────────────────────────────────────────────────

echo
echo "--- Pulling latest code ---"
sudo -u deploy git -C "$APP_DIR" pull origin main

# ── Build and start ───────────────────────────────────────────────────────────

echo
echo "--- Building images ---"
$COMPOSE build --no-cache

echo
echo "--- Starting containers ---"
$COMPOSE up -d

# ── Verify ────────────────────────────────────────────────────────────────────

echo
echo "--- Container status ---"
$COMPOSE ps

echo
echo "--- Waiting for cloudflared to register (10 s) ---"
sleep 10

echo
echo "--- cloudflared logs ---"
$COMPOSE logs --tail=20 cloudflared

echo
echo "Look for: 'Registered tunnel connection'"
echo "If you see that line, the tunnel is live and GitHub Actions can deploy via SSH."

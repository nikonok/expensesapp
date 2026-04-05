#!/usr/bin/env bash
# bootstrap.sh — first-time server setup for expensesapp
#
# Run this once on the server to start the Docker containers and bring
# the Cloudflare tunnel online. After this, all deployments go through
# GitHub Actions via the tunnel.
#
# Usage:
#   bash scripts/bootstrap.sh
#
# Or with the token passed via environment to avoid the prompt:
#   CLOUDFLARE_TUNNEL_TOKEN=eyJh... bash scripts/bootstrap.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="sudo docker compose -f $APP_DIR/docker-compose.yml"

echo "=== expensesapp bootstrap ==="
echo "App directory: $APP_DIR"
echo

# ── Tunnel token ─────────────────────────────────────────────────────────────

if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
    read -rsp "Cloudflare tunnel token (input hidden): " CLOUDFLARE_TUNNEL_TOKEN
    echo
    if [[ -z "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
        echo "Error: tunnel token cannot be empty." >&2
        exit 1
    fi
fi

# ── Write .env ────────────────────────────────────────────────────────────────

ENV_FILE="$APP_DIR/.env"
printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$CLOUDFLARE_TUNNEL_TOKEN" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "✓ .env written"

# ── Pull latest code ──────────────────────────────────────────────────────────

echo
echo "--- Pulling latest code ---"
git -C "$APP_DIR" pull origin main

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

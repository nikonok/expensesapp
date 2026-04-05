# Deployment Setup Guide

This guide covers the one-time steps to deploy the expenses PWA to a home Ubuntu server using GitHub Actions and Cloudflare Tunnel.

**Architecture overview:**

```
Browser → Cloudflare Edge (HTTPS) → outbound tunnel → cloudflared container → app container (HTTP)
```

Cloudflare terminates HTTPS. The server never handles certificates or exposes inbound ports.

---

## Prerequisites

- Ubuntu server (20.04+) reachable via SSH
- Docker and Docker Compose plugin installed on the server
- Domain managed in Cloudflare (with proxy enabled)
- GitHub repository for this project

---

## 1. Install Docker on the server

```bash
# Install Docker Engine (official script)
curl -fsSL https://get.docker.com | sh

# Verify Docker Compose plugin is available
docker compose version
```

---

## 2. Create the deploy user

The deploy user has no shell password and no sudo superpowers beyond the specific `docker compose` commands needed for deployment.

```bash
# Create user
sudo useradd -m -s /bin/bash deploy

# Set up SSH directory
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chown deploy:deploy /home/deploy/.ssh

# Grant sudo rights for docker compose only — hardcoded path prevents abuse
sudo tee /etc/sudoers.d/deploy-docker << 'EOF'
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml build *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml up *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml down *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml ps
EOF
sudo chmod 440 /etc/sudoers.d/deploy-docker

# Validate before it takes effect
sudo visudo -cf /etc/sudoers.d/deploy-docker
```

---

## 3. Generate a deploy SSH key (on your local machine)

```bash
ssh-keygen -t ed25519 -C "github-actions-expensesapp" -f ~/.ssh/expensesapp_deploy
```

This produces two files:
- `expensesapp_deploy` — **private key** → goes into GitHub Secrets
- `expensesapp_deploy.pub` — **public key** → goes onto the server

---

## 4. Add the public key to the server

```bash
# Copy the public key contents into authorized_keys with restrictions:
#   no-agent-forwarding  — prevents SSH agent hijacking
#   no-pty               — no interactive shell; commands only
#   no-user-rc           — skip .bashrc/.bash_profile
#   no-X11-forwarding    — no X11 tunneling
sudo tee /home/deploy/.ssh/authorized_keys << EOF
no-agent-forwarding,no-pty,no-user-rc,no-X11-forwarding $(cat ~/.ssh/expensesapp_deploy.pub)
EOF

sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

---

## 5. Harden SSH daemon

Add to `/etc/ssh/sshd_config` (or create `/etc/ssh/sshd_config.d/hardening.conf`):

```
PasswordAuthentication no
PermitRootLogin no

Match User deploy
    X11Forwarding no
    AllowTcpForwarding no
    AllowAgentForwarding no
```

Reload:

```bash
sudo sshd -t          # test config first
sudo systemctl reload ssh
```

---

## 6. Clone the repository on the server

```bash
sudo -u deploy git clone https://github.com/<your-org>/expensesapp.git /home/deploy/expensesapp
```

The `.env` file (containing the Cloudflare tunnel token) is written automatically on every GitHub Actions deploy run. No manual `.env` creation is needed.

---

## 7. Set up Cloudflare Tunnel

### 7a. Create the tunnel

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Zero Trust** → **Networks** → **Tunnels**
3. Click **Create a tunnel** → choose **Cloudflared** → name it `expensesapp-home`
4. On the next screen, copy the token from the install command — it looks like `eyJhIjoiY...`
   (you only need the long token string, not the full `cloudflared service install` command)
5. Click **Next**

### 7b. Configure the public hostname

Still in the tunnel creation wizard (or later via the tunnel's **Public Hostname** tab):

| Field | Value |
|---|---|
| Subdomain | your subdomain (e.g. `expenses`) |
| Domain | your Cloudflare-managed domain |
| Service type | `HTTP` |
| URL | `http://app:80` |

> **Important**: the URL must be `http://app:80` — `app` is the Docker service name, resolved via Docker internal DNS. Do not use `localhost` or `127.0.0.1`.

Click **Save tunnel**.

### 7c. SSL/TLS mode

In the Cloudflare dashboard, go to your domain → **SSL/TLS** → set mode to **Full**.

(Not "Full (strict)" — the origin is plain HTTP, so strict verification would fail.)

---

## 8. Configure GitHub Secrets

In the GitHub repository: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

| Secret name | Value |
|---|---|
| `SSH_HOST` | Server IP address or hostname |
| `SSH_USER` | `deploy` |
| `SSH_PORT` | SSH port — set to `22` unless you changed it (no default fallback in workflow) |
| `SSH_KEY` | Full contents of `~/.ssh/expensesapp_deploy` (private key, including `-----BEGIN` and `-----END` lines) |
| `APP_DIR` | Absolute path on server — `/home/deploy/expensesapp` |
| `CLOUDFLARE_TUNNEL_TOKEN` | The `eyJhIjoiY...` token from step 7a |

---

## 9. First deployment

1. Push your code to the `main` branch (or confirm it is already up to date)
2. In GitHub: **Actions** → **Deploy to Server** → **Run workflow** → **Run workflow**
3. Watch the logs — the final step (`Pull, build, and restart`) shows `docker compose ps`
4. All containers should show status `Up` and `(healthy)`

---

## 10. Verify

```bash
# On the server — check containers are running
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml ps

# Check cloudflared connected successfully
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs cloudflared
# Look for: "Registered tunnel connection"

# Verify network isolation — only app + cloudflared should appear
sudo docker network inspect expensesapp_tunnel
```

Visit `https://<your-subdomain>.<your-domain>` — the app should load over HTTPS.

---

## Ongoing maintenance

### Rotating the deploy SSH key

```bash
# 1. Generate a new key
ssh-keygen -t ed25519 -C "github-actions-expensesapp-$(date +%Y%m)" -f ~/.ssh/expensesapp_deploy_new

# 2. Add the new public key to the server (keep old key active until new one is confirmed working)
# Edit /home/deploy/.ssh/authorized_keys on the server, append new line

# 3. Update SSH_KEY secret in GitHub with the new private key

# 4. Run a test deployment to confirm it works

# 5. Remove the old public key from authorized_keys on the server
```

Rotate every 90 days or immediately if the key is suspected to be compromised.

### Rotating the Cloudflare tunnel token

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → your tunnel → **...** → **Rotate token**
2. Copy the new token
3. Update `CLOUDFLARE_TUNNEL_TOKEN` secret in GitHub
4. Run a deployment — the new token is written to `.env` and the container restarts with it

### Updating Docker base images

Run a deployment with `--no-cache` (already the default in the workflow) to pick up the latest `nginx:1.27-alpine` and `cloudflare/cloudflared:latest` patches.

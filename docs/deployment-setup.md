# Deployment Setup Guide

This guide covers the one-time steps to deploy the expenses PWA to a home Ubuntu server using GitHub Actions and Cloudflare Tunnel.

**Architecture overview:**

```
Browser → Cloudflare Edge (HTTPS) → outbound tunnel → cloudflared container → app container (HTTP)

GitHub Actions runner
  → cloudflared access ssh --hostname ssh-expenses.yourdomain.com
  → Cloudflare Edge (checks Access service token)
  → cloudflared container on server
  → localhost:22 (sshd — only listens on loopback, never exposed externally)
```

Cloudflare terminates HTTPS. The server requires no public IP and exposes no inbound ports — all connectivity is outbound via the tunnel.

---

## Prerequisites

- Ubuntu server (20.04+) — no public IP required
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
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml logs *
EOF
sudo chmod 440 /etc/sudoers.d/deploy-docker

# Validate before it takes effect
sudo visudo -cf /etc/sudoers.d/deploy-docker
```

> **Security note — docker compose and privilege escalation:** The sudoers rules above restrict `docker compose` to a hardcoded file path, but they do **not** restrict the *contents* of that file. Because `deploy` owns the git repo (and therefore `docker-compose.yml`), a compromised deploy user can rewrite the file to mount the host filesystem and gain root. This is an inherent limitation of any docker-compose-over-sudo setup — `docker` access is effectively root-equivalent when the user controls the compose file.
>
> For a personal home server this is an acceptable trade-off: the deploy user has no shell password, SSH is key-only, and no public ports are exposed. If you want to harden further, move `docker-compose.yml` to a root-owned path outside the git repo (e.g. `/etc/expensesapp/docker-compose.yml`) and update the sudoers rules and deploy workflow to point there. The `git pull` in the deploy workflow would then only update source code, and compose changes would require manual root intervention.

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

> **Critical:** The `authorized_keys` file must be owned by `deploy`, not `root`. If you run `sudo tee` to write this file, it will be owned by `root` and sshd will silently refuse to read it — key authentication will fail with no useful error on the client side. The sshd log will show: `Could not open user 'deploy' authorized keys: Permission denied`. Always run `chown` after writing the file.
>
> Verify ownership is correct:
> ```bash
> sudo ls -la /home/deploy/.ssh/
> # authorized_keys must show: -rw------- deploy deploy
> ```

---

## 5. Harden SSH daemon

Add to `/etc/ssh/sshd_config` (or create `/etc/ssh/sshd_config.d/hardening.conf`):

```
# Optional hardening: bind sshd to loopback only so it is unreachable even on the
# local network. Skip this if other users need to SSH in from the LAN.
# ListenAddress 127.0.0.1

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

### 7b. Configure the web app public hostname

Still in the tunnel creation wizard (or later via the tunnel's **Public Hostname** tab):

| Field | Value |
|---|---|
| Subdomain | your subdomain (e.g. `expenses`) |
| Domain | your Cloudflare-managed domain |
| Service type | `HTTP` |
| URL | `http://app:80` |

> **Important**: the URL must be `http://app:80` — `app` is the Docker service name, resolved via Docker internal DNS. Do not use `localhost` or `127.0.0.1`.

Click **Save tunnel**.

### 7c. Add an SSH public hostname to the same tunnel

In the tunnel's **Public Hostname** tab → **Add a public hostname**:

| Field | Value |
|---|---|
| Subdomain | `ssh-expenses` (or any name you prefer) |
| Domain | your Cloudflare-managed domain |
| Service type | `SSH` |
| URL | `host-gateway:22` |

Save. The cloudflared container on the server will now route connections to this hostname into the host's SSH daemon.

> **Why `host-gateway` and not `localhost`**: cloudflared runs inside a Docker container, so `localhost` refers to the container's own loopback — not the host machine. `host-gateway` is a Docker special value that resolves to the host's IP on the bridge network. The `extra_hosts` entry in `docker-compose.yml` makes this name available inside the container.

### 7d. Record the server's SSH host key

The GitHub Actions workflow needs to verify the server's identity, but `ssh-keyscan` cannot reach the server (no public IP). Instead, capture the host key directly on the server and store it in a GitHub Secret.

Run this **on the server**, replacing the hostname with your actual SSH subdomain:

```bash
echo "ssh-expenses.yourdomain.com $(awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub)"
```

The output looks like:
```
ssh-expenses.yourdomain.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
```

Copy this entire line — it becomes the `SSH_KNOWN_HOST` GitHub Secret.

### 7e. Create a Cloudflare Access application for SSH

This gates the SSH hostname with a policy — only requests presenting a valid service token are allowed through.

1. Zero Trust Dashboard → **Access** → **Applications** → **Add an application** → **Self-hosted**
2. **Application name**: `expensesapp SSH`
3. **Application domain**: `ssh-expenses.yourdomain.com` (your SSH subdomain from 7c)
4. Click **Next**
5. **Policy name**: `GitHub Actions deploy`
6. **Action**: select **Service Auth**

   > This is required. Other actions (Allow, Block) redirect to a browser login page, which does not work for non-interactive machine access.

7. Under **Configure rules**, add an **Include** rule:
   - Selector: **Service Token**
   - Value: *(leave blank for now — you will fill this in after step 7f)*
8. Click **Next** → **Add application**

### 7f. Create a Cloudflare Access service token

Service tokens are how GitHub Actions authenticates to Cloudflare Access without a browser.

1. Zero Trust Dashboard → **Access** → **Service Auth** → **Service Tokens** → **Create Service Token**
2. **Name**: `github-actions-expensesapp`
3. **Service Token Duration**: Non-expiring (recommended — manual rotation when needed)
4. Click **Generate token**
5. **Copy both values now** — the Client Secret is shown only once:
   - **Client ID** → `CF_ACCESS_CLIENT_ID` GitHub Secret
   - **Client Secret** → `CF_ACCESS_CLIENT_SECRET` GitHub Secret
6. Go back to the Access application created in 7e → **Edit** → edit the policy → set the **Service Token** rule value to the token you just created → **Save**

### 7g. SSL/TLS mode

In the Cloudflare dashboard, go to your domain → **SSL/TLS** → set mode to **Full**.

(Not "Full (strict)" — the origin is plain HTTP, so strict verification would fail.)

---

## 8. Configure GitHub Secrets

In the GitHub repository: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

| Secret name | Value |
|---|---|
| `SSH_HOST` | The Cloudflare SSH hostname — e.g. `ssh-expenses.yourdomain.com` |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | Full contents of `~/.ssh/expensesapp_deploy` (private key, including `-----BEGIN` and `-----END` lines) |
| `SSH_KNOWN_HOST` | The host key line from step 7d — `ssh-expenses.yourdomain.com ssh-ed25519 AAAA...` |
| `APP_DIR` | `/home/deploy/expensesapp` |
| `CLOUDFLARE_TUNNEL_TOKEN` | The `eyJhIjoiY...` token from step 7a |
| `CF_ACCESS_CLIENT_ID` | Client ID from step 7f |
| `CF_ACCESS_CLIENT_SECRET` | Client Secret from step 7f |

---

## 9. First deployment

The Cloudflare tunnel is what makes SSH possible for GitHub Actions — but the tunnel only exists once the containers are running. This means the very first start must be done **manually on the server**. After that, all future deployments go through GitHub Actions.

### 9a. Bootstrap: start the containers manually (once)

On the server (via physical access, local network SSH, or any other method you have right now):

```bash
bash /home/deploy/expensesapp/scripts/bootstrap.sh
```

The script will prompt for your Cloudflare tunnel token, write `.env`, build and start the containers, then print the cloudflared logs. Once you see `Registered tunnel connection`, the SSH hostname (`ssh-expenses.yourdomain.com`) is live and GitHub Actions can reach it.

You can also pass the token via environment to skip the prompt:

```bash
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiY... bash /home/deploy/expensesapp/scripts/bootstrap.sh
```

### 9b. All subsequent deployments: GitHub Actions

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

> **Note**: Direct SSH from outside the server no longer works — sshd only listens on `127.0.0.1`. This is intentional. All SSH goes through `cloudflared access ssh`.

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

### Rotating the Cloudflare Access service token

1. Zero Trust Dashboard → **Access** → **Service Auth** → **Service Tokens** → **Create Service Token** (new token)
2. Copy the new Client ID and Client Secret
3. Update `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` secrets in GitHub
4. Edit the Access application policy (step 7e) to point the Service Token rule at the new token — Save
5. Run a test deployment to confirm it works
6. Delete the old service token

Rotate when suspected compromised, or on your regular key rotation schedule.

### Updating Docker base images

Run a deployment with `--no-cache` (already the default in the workflow) to pick up the latest `nginx:1.27-alpine` patches.

For `cloudflared`, the `docker-compose.yml` currently uses `:latest`. It is recommended to pin this to a specific version tag for reproducible, auditable deploys:

```yaml
image: cloudflare/cloudflared:2025.x.x  # replace with the current release
```

Check the current release at https://github.com/cloudflare/cloudflared/releases, update the tag in `docker-compose.yml`, and run a deployment. Update this tag whenever you rotate the tunnel token or on your regular maintenance schedule.

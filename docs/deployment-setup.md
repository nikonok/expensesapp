# Deployment Setup Guide

End-to-end runbook for deploying the expenses PWA + API to a home Ubuntu server using GitHub Actions and Cloudflare Tunnel. Run the one-time setup sections (1–5) in order, then trigger a deploy (section 7).

---

## 1. Architecture

```mermaid
flowchart LR
  B[Browser] -->|HTTPS| CFE[Cloudflare Edge]
  CFE -->|outbound tunnel| CFD[cloudflared container]
  CFD -->|http://app:80| APP[app container - nginx + PWA]
  APP -->|proxies /api/ to api:8080| API[api container - Go]
  CFD -->|host-gateway:22| SSHD[host sshd 127.0.0.1:22]

  GH[GitHub Actions runner] -->|cloudflared access ssh| CFE
  GH -.->|service token| ACC[Cloudflare Access]
  ACC -.->|gate| CFE
```

Key properties:

- **No public IP, no inbound ports.** The server only makes outbound connections.
- **Cloudflare terminates TLS** at the edge. The tunnel speaks plain HTTP to `app:80` over the internal Docker `tunnel` network only — it never talks to the `api` container directly.
- **Path-based routing happens inside the `app` container, not in the tunnel.** cloudflared forwards everything for `APP_HOSTNAME` to `http://app:80`; nginx inside that container proxies `/api/` to `http://api:8080` (stripping the prefix) and serves the SPA for everything else. See `nginx/nginx.conf`.
- **SSH for deploys** goes through `cloudflared access ssh`, gated by a Cloudflare Access service token. The host's sshd listens on loopback only.

---

## 2. One-time server provisioning

Prerequisites: Ubuntu 20.04+ server, domain managed in Cloudflare (proxy enabled), GitHub repo for this project.

### 2a. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version   # verify the Compose plugin is available
```

### 2b. Create the `deploy` user

The deploy user has no shell password and no sudo rights beyond a narrow set of `docker compose` commands.

```bash
sudo useradd -m -s /bin/bash deploy

sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chown deploy:deploy /home/deploy/.ssh

sudo tee /etc/sudoers.d/deploy-docker << 'EOF'
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml build *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml up *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml down *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml ps
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker compose -f /home/deploy/expensesapp/docker-compose.yml logs *
EOF
sudo chmod 440 /etc/sudoers.d/deploy-docker
sudo visudo -cf /etc/sudoers.d/deploy-docker   # validate
```

> **Security note — docker compose and privilege escalation.** The sudoers rules above pin the compose file path but do not restrict its _contents_. Because `deploy` owns the git repo (and therefore `docker-compose.yml`), a compromised deploy user can rewrite the file to mount the host filesystem and gain root. This is inherent to any docker-compose-over-sudo setup. For a personal home server this is an acceptable trade-off: the deploy user has no shell password, SSH is key-only, and no public ports are exposed. To harden further, move `docker-compose.yml` to a root-owned path outside the repo and update the sudoers rules and workflow accordingly.

### 2c. Generate the deploy SSH key (on your local machine)

```bash
ssh-keygen -t ed25519 -C "github-actions-expensesapp" -f ~/.ssh/expensesapp_deploy
```

You now have two files:

- `expensesapp_deploy` — private key, goes into GitHub Secret `SSH_KEY`
- `expensesapp_deploy.pub` — public key, goes onto the server

### 2d. Install the public key on the server

```bash
sudo tee /home/deploy/.ssh/authorized_keys << EOF
no-agent-forwarding,no-pty,no-user-rc,no-X11-forwarding $(cat ~/.ssh/expensesapp_deploy.pub)
EOF

sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

> **Critical:** `authorized_keys` must be owned by `deploy`, not `root`. If you write the file via `sudo tee` and forget the `chown`, sshd silently ignores it. Verify:
>
> ```bash
> sudo ls -la /home/deploy/.ssh/
> # authorized_keys must show: -rw------- deploy deploy
> ```

### 2e. Harden sshd

Create `/etc/ssh/sshd_config.d/hardening.conf`:

```
# Optional: bind sshd to loopback so it is unreachable from the LAN.
# Skip this if other users still need to SSH from the local network.
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
sudo sshd -t                    # test config first
sudo systemctl reload ssh
```

### 2f. Clone the repository on the server

```bash
sudo -u deploy git clone https://github.com/<your-org>/expensesapp.git /home/deploy/expensesapp
```

The `.env` file is written automatically by the deploy workflow — do not create it by hand for normal operation.

---

## 3. One-time Cloudflare setup

### 3a. DNS

In Cloudflare DNS, the public hostnames (`expenses.example.com` and `ssh-expenses.example.com`) are created **automatically** as CNAMEs by the tunnel public-hostname configuration in step 3b. You do not need to create them manually. If you want them ahead of time, add proxied `CNAME` records pointing at `<tunnel-id>.cfargotunnel.com`.

### 3b. Create the tunnel (manual, one-time)

1. Cloudflare Dashboard → **Zero Trust** → **Networks** → **Tunnels**.
2. **Create a tunnel** → **Cloudflared** → name it `expensesapp-home`.
3. On the **Install connector** screen, copy the long token string (`eyJhIjoiY...`). This becomes the `CLOUDFLARE_TUNNEL_TOKEN` GitHub Secret. Ignore the install command itself — the server runs cloudflared via Docker Compose.
4. Click **Next**.
5. **Public Hostnames** — add two routes:

   | Subdomain      | Domain               | Service type | URL               |
   | -------------- | -------------------- | ------------ | ----------------- |
   | `expenses`     | your CF-managed zone | `HTTP`       | `http://app:80`   |
   | `ssh-expenses` | your CF-managed zone | `SSH`        | `host-gateway:22` |

   > Why `http://app:80` and `host-gateway:22`: cloudflared runs inside Docker. `app` resolves via Docker's internal DNS to the PWA container. `host-gateway` is Docker's special name for the host machine — required for SSH because sshd runs on the host, not in a container. Both are wired up in `docker-compose.yml`.

6. **Save tunnel.**

**There is no `/api/*` tunnel rule, and you do not need one.** If you provide `CF_API_TOKEN` (plus `CF_ACCOUNT_ID` and `CF_TUNNEL_ID`) as GitHub Secrets, the workflow's `Ensure Cloudflare tunnel ingress` step PUTs the **entire** ingress config on every deploy — always exactly three rules: the SSH hostname → `ssh://host-gateway:22`, the app hostname → `http://app:80`, and a catch-all `http_status:404`. It never adds an `/api/*` rule, and any rule you add by hand in the dashboard is silently wiped on the next deploy that runs this step. `/api/*` still works because nginx inside the `app` container proxies `/api/` to `http://api:8080` (see §1) — the tunnel only ever needs to know about `app:80`.

### 3c. SSL/TLS mode

Cloudflare dashboard → your domain → **SSL/TLS** → set mode to **Full** (not **Full (strict)** — the origin is plain HTTP, so strict verification would fail).

### 3d. Create the Cloudflare Access SSH application

Gates the SSH hostname with a service-token policy.

1. Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. **Application name**: `expensesapp SSH`.
3. **Application domain**: `ssh-expenses.example.com` (matches step 3b).
4. **Next.**
5. **Policy name**: `GitHub Actions deploy`.
6. **Action**: **Service Auth** (not Allow/Block — those require an interactive browser login).
7. **Include** rule → Selector **Service Token** → leave the value empty for now (you'll fill it after 3e).
8. **Next** → **Add application**.

### 3e. Create the Cloudflare Access service token

1. Zero Trust → **Access** → **Service Auth** → **Service Tokens** → **Create Service Token**.
2. **Name**: `github-actions-expensesapp`.
3. **Duration**: Non-expiring (recommended — manual rotation when needed).
4. **Generate token.**
5. **Copy both values now** — the secret is shown only once:
   - **Client ID** → `CF_ACCESS_CLIENT_ID` GitHub Secret
   - **Client Secret** → `CF_ACCESS_CLIENT_SECRET` GitHub Secret
6. Return to the Access application from 3d → **Edit** → set the **Service Token** rule to the token you just created → **Save**.

### 3f. Record the server's SSH host key

`ssh-keyscan` cannot reach the server (no public IP), so capture the key directly. On the server:

```bash
echo "ssh-expenses.example.com $(awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub)"
```

The single-line output (e.g. `ssh-expenses.example.com ssh-ed25519 AAAAC3Nz...`) becomes the `SSH_KNOWN_HOST` GitHub Secret.

---

## 4. One-time Google OAuth setup

The app authenticates users via Google Sign-In. The same OAuth **Client ID** is used by both the frontend (baked into the Vite bundle as `VITE_GOOGLE_OAUTH_CLIENT_ID`, a Docker build arg `docker-compose.yml` derives from `GOOGLE_OAUTH_CLIENT_ID`) and the backend (`GOOGLE_OAUTH_CLIENT_ID`, used to verify ID tokens). There is no client secret — only the public Client ID, and only one GitHub Secret to set.

1. Go to https://console.cloud.google.com and create a new project (e.g. `expensesapp`).
2. **APIs & Services** → **OAuth consent screen**:
   - **User Type**: **External**.
   - **App name**: `Expenses` (or whatever you like).
   - **User support email** and **Developer contact**: your email.
   - **Scopes**: leave default — only `openid`, `email`, `profile` are needed.
   - **Test users**: add the Google account you'll sign in with (and any family members). External apps in testing mode reject all other accounts.
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth 2.0 Client ID**:
   - **Application type**: **Web application**.
   - **Name**: `Expenses Web`.
   - **Authorized JavaScript origins**: `https://expenses.example.com` (your `APP_HOSTNAME`). For local development add `http://localhost:5173`.
   - **Authorized redirect URIs**: leave empty — Google Sign-In with the JS library uses popup/postMessage, not redirects.
4. **Create.** Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
5. Set the GitHub Secret:

   ```bash
   gh secret set GOOGLE_OAUTH_CLIENT_ID --body "1234-abc.apps.googleusercontent.com"
   ```

   There is no separate `VITE_GOOGLE_OAUTH_CLIENT_ID` secret. `docker-compose.yml` passes this same value as the `app` service's `VITE_GOOGLE_OAUTH_CLIENT_ID` Docker build arg (derived from the server `.env`'s `GOOGLE_OAUTH_CLIENT_ID`), baking it into the Vite bundle at image build time. The non-prefixed value is also read at runtime by the Go backend to verify Google ID tokens.

> While the OAuth consent screen is in **Testing** mode, only accounts listed under **Test users** can sign in. For a personal/family app you can stay in Testing mode indefinitely. Publishing to Production triggers Google's verification process — only needed if you want strangers to sign in.

---

## 5. One-time VAPID key generation

Web Push notifications require a VAPID key pair. The **public** key is shipped to the browser (bundled by Vite and surfaced by the backend), and the **private** key signs push messages from the backend.

Run on your local laptop (the keys never need to live on the server filesystem outside of `.env`):

```bash
docker run --rm node:alpine npx -y web-push generate-vapid-keys --json > vapid.json

gh secret set VAPID_PUBLIC_KEY  --body "$(jq -r .publicKey  vapid.json)"
gh secret set VAPID_PRIVATE_KEY --body "$(jq -r .privateKey vapid.json)"
gh secret set VAPID_SUBJECT     --body "mailto:you@example.com"

shred -u vapid.json
```

There is no separate `VITE_VAPID_PUBLIC_KEY` secret. `docker-compose.yml` passes `VAPID_PUBLIC_KEY` (from the server `.env`) as the `app` service's `VITE_VAPID_PUBLIC_KEY` Docker build arg, baking it into the Vite bundle at image build time.

`VAPID_SUBJECT` must be a `mailto:` URL (or an `https://` URL); push providers may use it to contact you about abuse.

> **Rotation invalidates all push subscriptions.** Browsers tie a subscription to the public key it was created with. If you rotate VAPID keys, every device must re-subscribe — users will simply stop receiving notifications until they re-open the app and accept the prompt again. Rotate only when you have reason to believe the private key is compromised.

---

## 6. GitHub Secrets

All secrets live under **Settings** → **Secrets and variables** → **Actions** in the GitHub repo. The deploy workflow refuses to start if a required secret is missing; `docker compose up` fails noisily if a `:?` env in `docker-compose.yml` is unset.

### Required secrets

| Name                      | Purpose                                                                                                                                                       | How to obtain                                   | Example (redacted)                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `SSH_HOST`                | Cloudflare SSH hostname the workflow connects to                                                                                                              | The `ssh-expenses` subdomain from §3b           | `ssh-expenses.example.com`                                                  |
| `SSH_USER`                | Server user the workflow logs in as                                                                                                                           | The user created in §2b                         | `deploy`                                                                    |
| `SSH_KEY`                 | Private key for the deploy user (full PEM, including BEGIN/END lines)                                                                                         | `cat ~/.ssh/expensesapp_deploy` (from §2c)      | `-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----` |
| `SSH_KNOWN_HOST`          | Pinned server host key — defeats SSH MITM                                                                                                                     | The single-line output from §3f                 | `ssh-expenses.example.com ssh-ed25519 AAAA…`                                |
| `APP_DIR`                 | Absolute path to the repo on the server                                                                                                                       | The clone target from §2f                       | `/home/deploy/expensesapp`                                                  |
| `CLOUDFLARE_TUNNEL_TOKEN` | Long-lived tunnel credential — boots cloudflared on the server                                                                                                | The `eyJhIjoiY…` token shown once at §3b step 3 | `eyJhIjoiY2…`                                                               |
| `CF_ACCESS_CLIENT_ID`     | Service-token ID — Access lets the workflow's SSH ProxyCommand through                                                                                        | Client ID from §3e                              | `abcd1234.access`                                                           |
| `CF_ACCESS_CLIENT_SECRET` | Service-token secret — same purpose as above                                                                                                                  | Client Secret from §3e (shown once)             | `f00bar…`                                                                   |
| `BOOTSTRAP_ADMIN_EMAIL`   | First Google account allowed to sign in; gets promoted to root                                                                                                | Your Google account email                       | `you@example.com`                                                           |
| `GOOGLE_OAUTH_CLIENT_ID`  | Backend-side OAuth Client ID — verifies Google ID tokens; also derived by `docker-compose.yml` into the `app` image's `VITE_GOOGLE_OAUTH_CLIENT_ID` build arg | Client ID from §4 step 4                        | `1234-abc.apps.googleusercontent.com`                                       |
| `VAPID_PUBLIC_KEY`        | Backend-side public key — surfaced via `/v1/push/key`; also derived by `docker-compose.yml` into the `app` image's `VITE_VAPID_PUBLIC_KEY` build arg          | From §5 (`jq -r .publicKey`)                    | `BMyP…` (base64url, 65 bytes)                                               |
| `VAPID_PRIVATE_KEY`       | Signs push messages — server-only                                                                                                                             | From §5 (`jq -r .privateKey`)                   | `_kS…` (base64url, 32 bytes)                                                |
| `VAPID_SUBJECT`           | `mailto:` or `https:` contact for push abuse reports                                                                                                          | Your support email                              | `mailto:you@example.com`                                                    |
| `APP_HOSTNAME`            | Public PWA hostname — used by the workflow's health-check                                                                                                     | The `expenses` subdomain from §3b               | `expenses.example.com`                                                      |

### Optional — automatic tunnel ingress management

Provide all three to let the workflow write the tunnel's ingress config (SSH hostname, app hostname, catch-all) on every deploy. Skip them and configure the tunnel's Public Hostnames manually per §3b instead.

| Name            | Purpose                                               | How to obtain                                                                                                                                                                                                                                                                                                                 | Example (redacted)                     |
| --------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `CF_API_TOKEN`  | Cloudflare API token authorising tunnel-config writes | Cloudflare Dashboard → **My Profile** → **API Tokens** → **Create Token** → use template **`Cloudflare Tunnel Write`** (exact name in the dashboard's API token template list; the alternatives **`Cloudflare One Connectors Write`** or **`Cloudflare One Connector: cloudflared Write`** also work). Scope to your account. | `cf_token_abcd…`                       |
| `CF_ACCOUNT_ID` | Account whose tunnel is being configured              | Dashboard → any zone → **Overview** sidebar → **Account ID**                                                                                                                                                                                                                                                                  | `1234567890abcdef`                     |
| `CF_TUNNEL_ID`  | UUID of the tunnel created in §3b                     | Zero Trust → **Networks** → **Tunnels** → click the tunnel → ID in the URL                                                                                                                                                                                                                                                    | `12345678-90ab-cdef-1234-567890abcdef` |

> **Coverage check.** Every env declared as required (`:?`) in `docker-compose.yml` is set by the workflow from a GitHub Secret of the matching name. The required envs are: `BOOTSTRAP_ADMIN_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The Cloudflare tunnel container reads `CLOUDFLARE_TUNNEL_TOKEN` (no `:?`, but the container will fail without it).

---

## 7. First deploy

You can either push to `main` (auto-trigger is up to you — currently the workflow runs only via `workflow_dispatch`) or trigger manually:

1. Confirm every required secret in §6 is set: **Settings** → **Secrets and variables** → **Actions**.
2. **Actions** → **Deploy to Server** → **Run workflow** → **Run workflow**.
3. Watch the run. The job has several steps; the ones that fail loudly when something is misconfigured are:
   - **Configure SSH** — wrong `SSH_KEY`/`SSH_KNOWN_HOST` shows up here.
   - **Ensure Cloudflare tunnel ingress** (only if `CF_API_TOKEN` is set) — wrong account/tunnel ID or insufficient token scope fails with a JSON error from the Cloudflare API.
   - **Write .env to server** — the workflow writes a temp file inside `APP_DIR` and renames it over `.env`, which only requires the `deploy` user to have write permission on the app directory itself, not ownership of the existing `.env` file. Permission errors here usually mean `APP_DIR` (e.g. `/home/deploy/expensesapp`) is not owned/writable by `deploy`; fix with `sudo chown deploy:deploy /home/deploy/expensesapp` on the server.
   - **Pull, build, and restart** — surfaces docker-compose errors. A missing `:?` env (see §6) fails here with a clear message.
   - **Health check** — final gate. Hits `https://$APP_HOSTNAME/api/v1/health` up to 6 times with 5-second backoffs. A bare `/v1/health` (no `/api` prefix) would hit the SPA fallback and vacuously return 200, so the health check must go through the `/api/` prefix. If this passes, the deploy is healthy.

After the first successful deploy:

- Visit `https://expenses.example.com` — the PWA should load over HTTPS.
- Sign in with the Google account you put in `BOOTSTRAP_ADMIN_EMAIL`. The backend auto-promotes the first sign-in matching that address to root.
- All subsequent deploys are just repeating step 2 above.

### Bootstrapping when the tunnel does not exist yet

The deploy workflow uses the tunnel to reach the server, but the tunnel only exists once cloudflared is running. For the very first start, run `bash /home/deploy/expensesapp/scripts/bootstrap.sh` on the server (via console / local network SSH). The script requires `CLOUDFLARE_TUNNEL_TOKEN`, `BOOTSTRAP_ADMIN_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to be set as environment variables — it validates all six are present up front and exits with an error listing any that are missing. It then writes all six to `.env` and starts the containers. Once cloudflared logs `Registered tunnel connection`, GitHub Actions can take over.

### Smoke checks on the server

```bash
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml ps
sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml logs cloudflared | grep -i "registered tunnel"
sudo docker network inspect expensesapp_tunnel    # app, api, cloudflared only
curl -fsS https://expenses.example.com/api/v1/health   # 200 OK from the API
```

### Debugging the SSH tunnel

Install cloudflared locally, then:

```bash
cloudflared access ssh \
  --hostname ssh-expenses.example.com \
  --id <CF_ACCESS_CLIENT_ID> \
  --secret <CF_ACCESS_CLIENT_SECRET>
```

| Output                                                       | Meaning                                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSH-2.0-OpenSSH_…` then `Invalid SSH identification string` | **Success** — tunnel + auth work; the error is cloudflared receiving no SSH client on stdin.                                                       |
| `websocket: bad handshake`                                   | Access rejected the connection. Check service token, policy action (must be **Service Auth**), and that the SSH route points to `host-gateway:22`. |
| `dial tcp … connection refused`                              | Tunnel auth works but sshd is unreachable. Check the route URL in the Cloudflare dashboard and that sshd is running on the host.                   |
| Password prompt                                              | Key auth failed — confirm `authorized_keys` ownership and that `SSH_KEY` matches the public key.                                                   |

End-to-end test including the SSH key:

```bash
ssh -i ~/.ssh/expensesapp_deploy \
    -o "ProxyCommand=cloudflared access ssh --hostname %h --id <CF_ACCESS_CLIENT_ID> --secret <CF_ACCESS_CLIENT_SECRET>" \
    deploy@ssh-expenses.example.com \
    "echo works"
```

If this prints `works`, GitHub Actions will succeed.

---

## 8. Rotating secrets

The general pattern is: update the source of truth, run `gh secret set NAME`, then trigger a deploy.

### Deploy SSH key (`SSH_KEY`)

```bash
ssh-keygen -t ed25519 -C "github-actions-expensesapp-$(date +%Y%m)" -f ~/.ssh/expensesapp_deploy_new
# Append the new public key to /home/deploy/.ssh/authorized_keys on the server (keep the old one)
gh secret set SSH_KEY < ~/.ssh/expensesapp_deploy_new
# Trigger a deploy; once green, remove the old public key from authorized_keys
```

Rotate every 90 days or immediately on suspected compromise.

### Cloudflare tunnel token (`CLOUDFLARE_TUNNEL_TOKEN`)

1. Zero Trust → **Networks** → **Tunnels** → your tunnel → **…** → **Rotate token**.
2. `gh secret set CLOUDFLARE_TUNNEL_TOKEN --body "<new-token>"`.
3. Trigger a deploy — the new token is written to `.env`, but the deploy workflow deliberately never recreates a running `cloudflared` (`up -d --no-recreate cloudflared`), so the container keeps running on the old token. After the deploy finishes, manually recreate it on the server so it picks up the new value:

   ```bash
   sudo docker compose -f /home/deploy/expensesapp/docker-compose.yml up -d --force-recreate cloudflared
   ```

### Cloudflare Access service token (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`)

1. Zero Trust → **Access** → **Service Auth** → **Service Tokens** → create a new token; copy both values.
2. `gh secret set CF_ACCESS_CLIENT_ID --body "<new-id>"` and `gh secret set CF_ACCESS_CLIENT_SECRET --body "<new-secret>"`.
3. Edit the Access application policy (§3d) — point the Service Token rule at the new token → **Save**.
4. Trigger a deploy. Once green, delete the old token.

### Google OAuth Client ID (`GOOGLE_OAUTH_CLIENT_ID`)

Create a new OAuth Client in Cloud Console (§4 step 3), then:

```bash
gh secret set GOOGLE_OAUTH_CLIENT_ID --body "<new-client-id>"
```

Trigger a deploy. `docker-compose.yml` derives the `app` image's `VITE_GOOGLE_OAUTH_CLIENT_ID` build arg from this same secret, so the frontend bundle is rebuilt with the new ID; existing browser sessions stay valid (the backend continues to honour cookies it has already issued), but any new sign-in must come through the new Client ID. Delete the old OAuth Client in Cloud Console once the deploy is green.

### VAPID keys (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`)

Regenerate per §5 and re-`gh secret set` all three entries (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` if it changed). Trigger a deploy — `docker-compose.yml` derives the `app` image's `VITE_VAPID_PUBLIC_KEY` build arg from `VAPID_PUBLIC_KEY`, so the frontend bundle is rebuilt too. As noted in §5, all existing push subscriptions are invalidated; users must re-subscribe.

### Bootstrap admin (`BOOTSTRAP_ADMIN_EMAIL`)

Only matters for first-boot promotion. After the initial root account exists in the database, changing this secret has no effect on existing data. To change root, use the admin UI inside the running app.

### Server-side `.env`

Never edit the server's `.env` by hand for normal operation. It is rewritten on every deploy from GitHub Secrets — manual edits will be silently overwritten. If you must edit it for an emergency, make sure to set the corresponding GitHub Secret afterwards so the next deploy does not regress.

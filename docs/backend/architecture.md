# Expenses App — Backend Architecture

> Companion to [`business-requirements.md`](./business-requirements.md). That doc owns **what** and **why**; this doc owns **how**.
>
> **Status:** Architecture locked. Ready for implementation.
> **Last updated:** 2026-05-17
> **Reading audience:** Claude LLM orchestrator (to break work into per-agent subtasks) and the operator (Anton).

---

## 0. How to read this doc

This document is structured for an LLM orchestrator that will dispatch implementation work to coding agents. Each section is **self-contained** — an agent assigned to "implement §5.3 sessions table" should be able to do its job by reading just §3 (stack), §4 (modules), §5.3 (the table), and the relevant flow in §8.

**Document map:**

| § | Section | Who needs it |
|---|---|---|
| 1 | TL;DR + decisions index | Everyone |
| 2 | System context | Everyone |
| 3 | Technology stack (versions) | Anyone touching `go.mod` / `package.json` |
| 4 | Component map | Anyone routing requests or adding a module |
| 5 | Data model | Anyone writing SQL or migrations |
| 6 | API contract | Anyone writing handlers or frontend sync code |
| 7 | Encryption design | Anyone touching ciphertext / envelopes / keys |
| 8 | Key flows | Anyone composing 2+ modules end-to-end |
| 9 | Frontend integration plan | Anyone touching `src/` |
| 10 | Testing strategy | Anyone writing tests |
| 11 | Observability & ops | Deployment + on-call |
| 12 | Implementation plan (phased) | Orchestrator (work breakdown) |
| 13 | Risks & mitigations | Orchestrator (risk-aware sequencing) |
| 14 | Decisions log | Anyone trying to understand "why X" |
| 15 | Glossary | Everyone |

**Conventions used:**
- File paths: `src/` = frontend (existing React app), `backend/` = new Go service repo (this doc treats it as a sibling top-level folder in the same monorepo).
- `[BR §x.y]` = pointer back to business-requirements.md section x.y.
- `[v1]` = v1 scope, `[v1.1+]` = deferred, `[future]` = no firm date.

---

## 1. TL;DR + decisions index

Backend is a **single Go 1.26 binary** behind Cloudflare Tunnel, persisting to one **SQLite** file. End-to-end encrypted from day one — server stores opaque ciphertext + a minimal cleartext metadata set. Sync uses **REST for upload + SSE for live download**. **Web Push (VAPID)** for notifications. **Docker Compose** on the operator's homeserver, alongside the existing `app` + `cloudflared` services.

### 1.1 Decisions index — every open question answered

| Open question (BR ref) | Decision | Where in this doc |
|---|---|---|
| Conflict resolution edge cases [BR §2, §3.11] | LWW on per-field `updatedAt` is safe for all current fields. Balances are derived (not stored on server). Tombstone timestamps trump edits. Concurrent rename of the same field is the only ambiguous case — last-write-wins by milliseconds, deterministic. | §7.6 |
| Root admin handoff mechanism [BR §2, §3.6] | Env var `BOOTSTRAP_ADMIN_EMAIL` edit + restart. On startup, backend reads new value, marks old root as regular user (preserves account), re-parents promotion tree to new root. No runtime command needed — restart is the act. | §8.13 |
| Background sync cadence [BR §2, §3.18] | **~4 hours** via Periodic Background Sync where supported (Chrome/Android installed PWA); foreground catch-up on app open. iOS PWA: foreground only (no PBS API). | §8.5, §9.3 |
| Sync indicator placement [BR §2, §3.28] | **Both**: small chip on Overview top-bar (read-only status); full detail + manual refresh + error reason in Settings. | §9.4 |
| Identity in shared transactions [BR §2, §3.21] | **Yes — both `addedBy` and `lastEditedBy`**, surfaced only when user opens transaction detail and taps "Authors" (not in row decoration). Both stored as cleartext metadata; both visible to server (acceptable per the family-activity digest design which already exposes `userId`). | §5.3 `record_meta`, §9.5 |
| Email infrastructure [BR §2] | **None in v1.** All invites and notifications via in-app + Web Push. No SMTP/SES, no transactional email vendor. Reconsider in v1.1+ only if a feature explicitly needs it. | §3.1 |
| Symmetric cipher [BR §2, §3.32] | **XChaCha20-Poly1305** + 32-byte HMAC-SHA256 commitment tag prepended. Random 192-bit nonces. | §7.1 |
| KDF parameters [BR §2, §3.32] | **Argon2id** with 64 MiB memory, t=3, p=1. ~500ms on Pixel 6a, ~800ms on iPhone 12 Safari. Salt derived `HKDF-SHA256(familyId, "argon2-recovery-v1", 16)`. | §7.3 |
| Asymmetric primitive [BR §2, §3.32] | **X25519 sealed-box** (libsodium `crypto_box_seal`). 80-byte envelopes. | §7.2 |
| Payload granularity [BR §2, §3.32] | **Whole-record AEAD.** One ciphertext per record. Per-field `updatedAt` lives in cleartext metadata; LWW merges happen client-side on read after the server returns conflicting versions. | §7.5 |
| Hard removal design [BR §2, §3.33] | Deferred to **v1.1+**. v1 ships soft removal only: revoke session + delete device envelope + best-effort local wipe on next sync. | §8.10 |
| Quota worst-case math [BR §2, §3.13] | Validated. 5-yr / 6-member / 200 tx-per-month / dedup'd snapshots = ~75 MB realistic, well under 200 MB. Dedup is per `(recordId, version)`, not per ciphertext hash, because new nonces make hash dedup useless. | §7.7 |
| Migration-batch atomicity [BR §2, §3.9] | Single transactional `POST /v1/family/migrate-solo` carrying all of B's re-encrypted blobs in one request body (JSONL streamed). Server stages into a temp table, commits with `INSERT ... SELECT` in one SQL transaction. Idempotent on `migrationId` (client-generated UUID v7); resumable by retrying with the same id. | §8.4 |
| Cloudflare Zero Trust dependence | Backend MUST work with CF removed. Auth is enforced inside the Go service. `CF-Connecting-IP` is used when present but `r.RemoteAddr` falls back cleanly. | §6.1 |

### 1.2 Architecture in five sentences

A Go HTTP service exposes REST endpoints for upsert/read of opaque ciphertext blobs + cleartext metadata, plus one SSE endpoint per signed-in device for live event push. SQLite holds all state (records, metadata, sessions, envelopes, snapshots, audit, push subscriptions). Google Sign-In ID tokens are verified on the backend; sessions are opaque 256-bit tokens stored hashed in SQLite, revocable per-device. All user-data encryption happens client-side in the React PWA via libsodium WASM; the server never sees plaintext or key material. Background jobs run inside the same process (no separate worker): daily snapshots via `VACUUM INTO`, tombstone compaction, dead-token GC, expired-invite sweeps.

---

## 2. System context

### 2.1 Existing topology (today)

```
Internet
   │
   ▼
Cloudflare Edge (HTTPS termination)
   │ Cloudflare Zero Trust auth gate
   ▼
Cloudflare Tunnel (cloudflared container)
   │
   ▼
[docker network: tunnel]
   │
   ▼
nginx:alpine container (serves dist/ — React PWA build)
```

Frontend = pure static SPA. IndexedDB via Dexie holds all user data. No backend.

### 2.2 Target topology (this architecture)

```
Internet
   │
   ▼
Cloudflare Edge
   │ Cloudflare Zero Trust (kept; backend independently enforces auth)
   ▼
Cloudflare Tunnel (cloudflared)
   │
   ▼
[docker network: tunnel]
   │
   ├──► nginx:alpine container  (serves dist/ — unchanged)
   │
   └──► api container           (NEW — Go 1.26 binary on :8080)
                │
                ▼
        [docker network: internal] ◄── NOT reachable from tunnel
                │
                ▼
        Bind-mount volume: /var/lib/expensesapp
        ├── data.db              (SQLite, WAL mode)
        ├── data.db-wal          (WAL companion)
        ├── data.db-shm          (shared-memory)
        ├── snapshots/           (daily VACUUM INTO outputs)
        │   ├── snap-2026-05-17.sqlite
        │   └── snap-2026-05-16.sqlite ...
        └── backups/             (operator-managed, optional)
```

Routing inside cloudflared: `/api/*` → `api:8080`, everything else → `app:80`.

### 2.3 Trust boundaries

- **Edge → Tunnel**: TLS terminated at CF; mTLS inside tunnel. Trust boundary `1`.
- **Tunnel → nginx**: HTTP. nginx is static-content only, no auth logic.
- **Tunnel → api**: HTTP. api enforces its own session check on every request. Trust boundary `2` is **inside the api**, not at the tunnel hop — removing CF must not break auth.
- **api → SQLite**: Process-local file access. No network.
- **api → Google OAuth servers**: outbound HTTPS for JWKS fetch only (no client-secret flows).
- **api → FCM / Apple Web Push endpoints**: outbound HTTPS for VAPID push delivery.

---

## 3. Technology stack

### 3.1 Backend (Go)

| Concern | Choice | Module path | Version | Notes |
|---|---|---|---|---|
| Language | Go | — | **1.26** | Per [BR §3.1]. |
| HTTP router | chi | `github.com/go-chi/chi/v5` | **v5.2.5** | Thin layer over `net/http`. Critical: does NOT wrap `http.ResponseWriter` (needed for SSE flush). |
| SQLite driver | modernc.org/sqlite | `modernc.org/sqlite` | **v1.50.1** | Pure-Go, no CGO. SQLite 3.53.x. |
| Type-safe SQL | sqlc (codegen tool) | `github.com/sqlc-dev/sqlc` | **v1.31.1** | Generates Go from `schema.sql` + `queries.sql`. Runtime uses only `database/sql`. |
| Migrations | goose | `github.com/pressly/goose/v3` | **v3.27.1** | Embedded via `//go:embed migrations/*.sql`. Runs on startup. |
| Structured logs | log/slog | stdlib | Go 1.26 | JSON handler to stdout, captured by docker logging driver. |
| Config | caarlos0/env | `github.com/caarlos0/env/v11` | **v11.4.1** | Single struct of env-tagged fields. |
| Validation | go-playground/validator | `github.com/go-playground/validator/v10` | **v10.30.2** | Struct-tag validation on request DTOs. |
| Test assertions | testify | `github.com/stretchr/testify` | **v1.11.1** | `require` + `assert`. |
| Test runner | gotestsum | `gotest.tools/gotestsum` | **v1.13.0** | Tool only; not a `require` entry. |
| SSE | hand-rolled | stdlib `net/http` + `http.Flusher` | — | ~40 LOC. No external library. |
| Web Push (VAPID) | webpush-go | `github.com/SherClockHolmes/webpush-go` | **pin master** (post-v1.4.0, see §3.1.1) | Apple Web Push `AuthScheme` fix only on master. |
| Google ID token | idtoken | `google.golang.org/api/idtoken` (parent module `google.golang.org/api`) | **v0.279.0+** | `idtoken.Validate(ctx, idToken, aud)`. |
| Rate limit | x/time/rate | `golang.org/x/time/rate` | latest | Process-local token bucket; per-IP for auth, per-user for writes. |
| BIP39 (server-side) | — | — | — | Server never touches phrases. Frontend uses `@scure/bip39`. |
| Snapshots | `VACUUM INTO` | stdlib `database/sql` | — | Cron via `time.Ticker` inside the process. |

#### 3.1.1 Web-push library pin

`webpush-go` v1.4.0 was tagged in Jan 2022. Apple Web Push (iOS 16.4+ PWA) requires `Authorization: vapid` header scheme; v1.4.0 sends `Authorization: WebPush` and Apple rejects. The fix landed on `master` April 2026. **Pin to a `v0.0.0-<date>-<sha>` pseudo-version** from master until a v1.5.0 tag exists. Document the pin commit hash in `backend/go.mod` so version bumps are intentional.

### 3.2 Frontend additions (React PWA)

Existing pinned deps from [`CLAUDE.md`](../../CLAUDE.md) remain unchanged. Add:

| Concern | Choice | Package | Version | Notes |
|---|---|---|---|---|
| Crypto (general) | libsodium WASM | `libsodium-wrappers-sumo` | **0.7.x** | "sumo" build includes XChaCha20-IETF, sealed box, HKDF, generichash. ~290 KB gzipped, lazy-loaded. |
| KDF | argon2 WASM | `argon2-browser` | **1.13.x** | SIMD WASM build. ~50 KB, lazy-loaded only on recovery flows. |
| BIP39 | @scure/bip39 | `@scure/bip39` | **1.x** | Pure JS, audited, ~10 KB. |
| Google Sign-In | GIS client | `google-identity-services` script tag | latest | `https://accounts.google.com/gsi/client` loaded async. No npm package — script tag in `index.html`. |
| Sync state | (use existing Zustand) | `zustand` 5.0.12 (already pinned) | — | New `sync-store.ts` slice. |
| Crypto worker | Web Worker | native | — | All crypto in a dedicated Worker so encrypt/decrypt never blocks the main thread. |

### 3.3 Containers & orchestration

| Concern | Choice | Version | Notes |
|---|---|---|---|
| Container runtime | Docker + Compose | existing | Extend the existing `docker-compose.yml`. |
| API image base | `golang:1.26-alpine AS build` → `gcr.io/distroless/static-debian12:nonroot` | — | Pure-Go binary, no CGO → distroless static works. |
| Cloudflare tunnel | `cloudflare/cloudflared:latest` | existing | Add `/api/*` → `api:8080` route to tunnel config. |

### 3.4 What is NOT in the stack

Explicitly rejected to keep the surface small:
- **No ORM** (no GORM/ent). sqlc is codegen, not an ORM.
- **No DI framework**. Constructor injection by hand.
- **No message queue**. Background work runs in-process with `context.Context` cancellation.
- **No Redis / external cache**. SQLite + in-process maps cover this scale.
- **No Prometheus / metrics exporter for v1**. slog logs + docker stats are sufficient. Add later if pain emerges.
- **No tracing (OpenTelemetry) for v1**. Same reasoning.
- **No email provider**. Per §1.1.
- **No JWT for sessions**. Opaque tokens, server-stored, revocable per device — see §7.8.

---

## 4. Component architecture

### 4.1 Module map (Go packages under `backend/`)

```
backend/
├── cmd/
│   └── api/
│       └── main.go           # entrypoint: load config, open DB, run migrations, mount routes, start servers
├── internal/
│   ├── config/               # env-tagged Config struct + Load()
│   ├── log/                  # slog setup, request-scoped logger
│   ├── db/
│   │   ├── migrations/       # *.sql files embedded via //go:embed
│   │   ├── schema.sql        # sqlc input: full schema (canonical)
│   │   ├── queries.sql       # sqlc input: all queries
│   │   ├── gen/              # sqlc OUTPUT — do not edit by hand
│   │   ├── open.go           # OpenDB(path) → *sql.DB with WAL + busy_timeout
│   │   └── tx.go             # WithTx(ctx, fn) helper
│   ├── auth/
│   │   ├── google.go         # ID token verification (idtoken.Validate)
│   │   ├── session.go        # mint/validate/revoke opaque tokens
│   │   ├── allowlist.go      # IsAllowed(email), suspended check
│   │   ├── middleware.go     # http.Handler middleware: requires session; loads user+device into ctx
│   │   └── reauth.go         # nonce-based fresh-google-token challenge for recovery reveal
│   ├── admin/
│   │   ├── tree.go           # promotion-tree CRUD, demotion cascade (re-parent to demoter)
│   │   ├── bootstrap.go      # on startup: ensure BOOTSTRAP_ADMIN_EMAIL is root, downgrade prior root if changed
│   │   └── handlers.go       # /v1/admin/* HTTP handlers
│   ├── family/
│   │   ├── service.go        # create / join / leave / kick / invite / accept
│   │   ├── migrate.go        # transactional solo→family data migration (§8.4)
│   │   ├── invariants.go     # 6-member cap, allowlist gate, cool-down, mutual-kick tie-break
│   │   └── handlers.go       # /v1/family/* HTTP handlers
│   ├── records/
│   │   ├── service.go        # upsert / fetch / list / delete (tombstone) record + meta + ciphertext
│   │   ├── quota.go          # byte-count accounting; reject when family.usage_bytes > 200 MB
│   │   ├── lww.go            # per-field LWW comparison on metadata.updatedAt map (server-side resolution)
│   │   └── handlers.go       # /v1/records/* HTTP handlers
│   ├── sync/
│   │   ├── pull.go           # GET /v1/sync/pull?since=<cursor>
│   │   ├── push.go           # POST /v1/sync/push (batch of upserts)
│   │   ├── cursor.go         # opaque cursor encoding (monotonic per-family seq)
│   │   └── events.go         # in-process event bus → SSE fan-out
│   ├── live/
│   │   ├── sse.go            # SSE handler: subscribe device, write events
│   │   ├── hub.go            # subscriber registry (device → channel); fan-out from event bus
│   │   └── heartbeat.go      # 25s comment-line keepalive
│   ├── push/
│   │   ├── subscription.go   # store / GC Web Push subscriptions
│   │   ├── deliver.go        # send via VAPID; track FCM/Apple failures → GC dead tokens
│   │   ├── quiet_hours.go    # hold-or-send decision; per-user TZ
│   │   ├── digest.go         # daily family-activity digest scheduler
│   │   └── handlers.go       # /v1/push/* (subscribe / unsubscribe / test)
│   ├── snapshot/
│   │   ├── service.go        # daily VACUUM INTO + manifest insert + 30-day retention prune
│   │   ├── restore.go        # admin/user-triggered point-in-time restore
│   │   └── handlers.go       # /v1/snapshots, /v1/snapshots/:date/restore
│   ├── audit/
│   │   ├── log.go            # append (actor, action, target, ts); 1-year retention
│   │   └── handlers.go       # /v1/admin/audit (admin-only)
│   ├── account/                  # user-self operations
│   │   ├── delete.go             # self-delete request → 14-day grace → purge job
│   │   ├── purge.go              # background sweep at startup + daily
│   │   └── handlers.go           # /v1/account/* (delete-request, restore, profile)
│   ├── ratelimit/
│   │   └── middleware.go     # per-IP + per-user token bucket
│   ├── jobs/                 # background workers (in-process)
│   │   ├── runner.go         # context-aware tickers; graceful shutdown
│   │   ├── snapshot_daily.go # 03:00 UTC
│   │   ├── purge_deleted.go  # 04:00 UTC; finalize 14-day deletions
│   │   ├── tombstone_gc.go   # 05:00 UTC; compact &gt; 90 days
│   │   ├── invite_expiry.go  # hourly; mark invites &gt; 30 days as expired
│   │   ├── digest_push.go    # hourly per timezone bucket; fan out family-activity digest
│   │   └── push_token_gc.go  # opportunistic on delivery failure (not scheduled)
│   ├── crypto/               # SERVER-SIDE crypto only — never key material
│   │   ├── aad.go            # canonical AAD serializer (length-prefixed, see §7.4) — golden-vector tested vs frontend
│   │   ├── tokens.go         # opaque session token gen + sha256 storage
│   │   └── version.go        # version-byte constants
│   ├── httpx/
│   │   ├── errors.go         # ProblemDetails (RFC 9457) response helper
│   │   ├── render.go         # WriteJSON / WriteError / SetCacheNoStore
│   │   └── ctx.go            # context keys for user/device/requestId
│   └── version/
│       └── version.go        # baked-in build metadata via -ldflags
```

### 4.2 Cross-cutting concerns

**Logging.** `slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, opts)))`. Every request starts a child logger with `request_id`, `user_id`, `device_id` set. **No ciphertext, no nonce, no byte counts per field** in logs [BR §3.24 audit + §3.32 cryptographic invariants].

**Request ID.** chi `middleware.RequestID` → propagated to `context.Context` → echoed in `X-Request-ID` response header.

**Error envelope.** Every 4xx/5xx is RFC 9457 ProblemDetails JSON:
```json
{"type":"about:blank","title":"forbidden","status":403,"detail":"email not on allowlist","instance":"/v1/auth/google"}
```

**Database transactions.** `db.WithTx(ctx, func(q *gen.Queries) error)` wraps `BEGIN IMMEDIATE` so SQLite writes don't deadlock under WAL.

**Graceful shutdown.** SIGTERM → 25s grace: stop accepting new HTTP, drain in-flight, close SSE subscribers, stop background tickers, `db.Close()`.

**Time.** All timestamps are RFC 3339 UTC with millisecond precision. Server clock authoritative. The frontend's `updatedAt` per-field map is trusted but server timestamps the upload itself.

---

## 5. Data model

### 5.1 SQLite settings (applied at startup, in this order)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;       -- WAL-safe; 10× faster than FULL, durability still acceptable
PRAGMA busy_timeout = 5000;        -- 5s
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;      -- 256 MB
PRAGMA cache_size = -20000;        -- 20 MB page cache
```

Connection string: `file:/var/lib/expensesapp/data.db?_pragma=journal_mode(wal)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(on)`.

### 5.2 Migration discipline

- One file per migration: `00001_init.sql`, `00002_add_X.sql`, etc.
- Each file has `-- +goose Up` and `-- +goose Down` sections.
- Migrations are embedded (`//go:embed db/migrations/*.sql`) and run automatically on startup BEFORE accepting requests.
- **Migrations never re-encrypt user data**, only schema. Crypto-version migrations are app-level (§7.6).
- Schema version tracked in `goose_db_version` (goose-managed).

### 5.3 Schema (v1)

All tables below ship in `00001_init.sql`. Foreign keys ON. Times are TEXT in RFC 3339 UTC. UUIDs are 36-char TEXT (no BLOB UUIDs, to keep things grep-friendly).

```sql
-- ─────────────────────────── identity ───────────────────────────

CREATE TABLE users (
    id              TEXT PRIMARY KEY,         -- UUID v7
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    google_sub      TEXT UNIQUE,              -- Google "sub" claim; nullable until first sign-in
    display_name    TEXT NOT NULL,            -- from Google profile, user-editable
    is_admin        INTEGER NOT NULL DEFAULT 0,
    is_root         INTEGER NOT NULL DEFAULT 0,
    promoter_id     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- promotion tree parent
    suspended_at    TEXT,                     -- not null → suspended
    delete_after    TEXT,                     -- 14-day grace deadline; not null → pending deletion
    created_at      TEXT NOT NULL,
    last_signin_at  TEXT
);
CREATE INDEX idx_users_promoter ON users(promoter_id);
CREATE INDEX idx_users_delete_after ON users(delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE allowlist (
    email           TEXT PRIMARY KEY COLLATE NOCASE,
    added_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    added_at        TEXT NOT NULL,
    note            TEXT
);

-- ─────────────────────────── families ───────────────────────────

CREATE TABLE families (
    id              TEXT PRIMARY KEY,         -- UUID v7
    created_at      TEXT NOT NULL,
    usage_bytes     INTEGER NOT NULL DEFAULT 0   -- maintained incrementally; reconciled nightly
);

CREATE TABLE family_members (
    family_id       TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TEXT NOT NULL,
    left_at         TEXT,                     -- soft-leave; rows kept for audit
    last_removed_at TEXT,                     -- for 24h re-kick cool-down
    PRIMARY KEY (family_id, user_id)
);
CREATE INDEX idx_family_members_user ON family_members(user_id) WHERE left_at IS NULL;
-- Invariant enforced in service layer: a user has at most one row WHERE left_at IS NULL.

CREATE TABLE family_invites (
    id              TEXT PRIMARY KEY,
    family_id       TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    invited_by      TEXT NOT NULL REFERENCES users(id),
    invitee_email   TEXT NOT NULL COLLATE NOCASE,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,            -- created_at + 30d
    status          TEXT NOT NULL,            -- 'pending' | 'accepted' | 'declined' | 'expired' | 'voided'
    decided_at      TEXT
);
CREATE INDEX idx_family_invites_invitee ON family_invites(invitee_email, status);

-- ─────────────────────────── devices & sessions ───────────────────────────

CREATE TABLE devices (
    id              TEXT PRIMARY KEY,         -- UUID v7
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,            -- "Samsung Galaxy S23 (2026-05-17)" — display only
    user_agent      TEXT,
    pub_key         BLOB NOT NULL,            -- X25519 32-byte public key
    status          TEXT NOT NULL,            -- 'pending' | 'awaiting_envelope' | 'active' | 'revoked' | 'rejected'
    created_at      TEXT NOT NULL,
    last_seen_at    TEXT,
    revoked_at      TEXT,
    revoke_reason   TEXT                      -- 'user_signout' | 'user_reject' | 'admin_revoke' | 'kicked_from_family'
);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_status ON devices(status);

CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,         -- UUID v7
    device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash      BLOB NOT NULL UNIQUE,     -- SHA-256(opaque token); 32 bytes
    created_at      TEXT NOT NULL,
    last_used_at    TEXT NOT NULL,
    revoked_at      TEXT
);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash) WHERE revoked_at IS NULL;

CREATE TABLE reauth_challenges (
    nonce           TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    issued_at       TEXT NOT NULL,
    used_at         TEXT,
    expires_at      TEXT NOT NULL             -- issued_at + 60s
);

CREATE TABLE reauth_grants (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    purpose         TEXT NOT NULL,            -- 'reveal_recovery_phrase' (extensible)
    expires_at      TEXT NOT NULL,
    used_at         TEXT
);

-- ─────────────────────────── envelopes (E2EE) ───────────────────────────

CREATE TABLE device_envelopes (
    device_id       TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    family_id       TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    wrapped_key     BLOB NOT NULL,            -- crypto_box_seal(familyKey, devicePubKey), 80 bytes
    version         INTEGER NOT NULL,         -- envelope-suite version byte
    created_at      TEXT NOT NULL
);

CREATE TABLE family_recovery_envelopes (
    family_id       TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
    recovery_wrap   BLOB NOT NULL,            -- Wrap(familyKey, Argon2id(phrase)) — for cold recovery
    phrase_ct       BLOB NOT NULL,            -- AEAD(familyKey, phrase) — for warm reveal after reauth
    version         INTEGER NOT NULL,
    salt            BLOB NOT NULL,            -- 16 bytes, derived per §7.3 but stored explicitly
    created_at      TEXT NOT NULL
);

-- ─────────────────────────── records (the bulk of storage) ───────────────────────────

-- Content-addressed ciphertext blobs. One row per (record, version).
-- Snapshots and the live HEAD all reference these by id; never duplicate ciphertext.
CREATE TABLE blobs (
    id              TEXT PRIMARY KEY,         -- UUID v7
    family_id       TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    ciphertext      BLOB NOT NULL,            -- [1B version | 24B nonce | 32B commit | ct | 16B tag]
    byte_count      INTEGER NOT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_blobs_family ON blobs(family_id);

-- The live HEAD pointer for each record: one row per record.
CREATE TABLE record_meta (
    record_id       TEXT PRIMARY KEY,         -- UUID v7, generated by client
    family_id       TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    record_type     TEXT NOT NULL,            -- 'transaction' | 'account' | 'category' | 'budget' | 'settings'
    blob_id         TEXT NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
    version         INTEGER NOT NULL,         -- monotonic per (family_id, record_id); next-write expects version+1
    added_by_user   TEXT NOT NULL REFERENCES users(id),
    edited_by_user  TEXT NOT NULL REFERENCES users(id),
    updated_at_map  TEXT NOT NULL,            -- JSON: {"amount":"2026-05-17T10:00:00.000Z", ...}
    deleted_at      TEXT,                     -- tombstone marker
    family_seq      INTEGER NOT NULL,         -- per-family monotonic counter; sync cursor
    created_at      TEXT NOT NULL,
    last_modified_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_record_meta_seq ON record_meta(family_id, family_seq);
CREATE INDEX idx_record_meta_family_type ON record_meta(family_id, record_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_record_meta_deleted ON record_meta(family_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- Monotonic family-wide sequence (drives sync cursors).
CREATE TABLE family_seq (
    family_id       TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
    next_seq        INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────── snapshots ───────────────────────────

CREATE TABLE snapshots (
    id              TEXT PRIMARY KEY,
    family_id       TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    snapshot_date   TEXT NOT NULL,            -- YYYY-MM-DD UTC
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,            -- created_at + 30d
    UNIQUE (family_id, snapshot_date)
);

-- A snapshot's content: pointers to (record_id, blob_id, version). No ciphertext duplication.
CREATE TABLE snapshot_entries (
    snapshot_id     TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    record_id       TEXT NOT NULL,
    blob_id         TEXT NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
    record_type     TEXT NOT NULL,
    version         INTEGER NOT NULL,
    updated_at_map  TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, record_id)
);

-- A blob can be referenced by record_meta and/or snapshot_entries. Garbage collection deletes
-- orphans: blobs not referenced by any record_meta or snapshot_entry. Runs in tombstone GC job.

-- ─────────────────────────── push ───────────────────────────

CREATE TABLE push_subscriptions (
    id              TEXT PRIMARY KEY,
    device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL,            -- FCM or Apple endpoint URL
    p256dh          BLOB NOT NULL,
    auth            BLOB NOT NULL,
    created_at      TEXT NOT NULL,
    last_success_at TEXT,
    last_failure_at TEXT
);
CREATE INDEX idx_push_device ON push_subscriptions(device_id);

CREATE TABLE notification_settings (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tz              TEXT NOT NULL DEFAULT 'UTC',
    reminder_time   TEXT,                     -- 'HH:MM' local; nullable means "off"
    quiet_start     TEXT NOT NULL DEFAULT '23:00',
    quiet_end       TEXT NOT NULL DEFAULT '07:00',
    daily_reminder  INTEGER NOT NULL DEFAULT 1,
    missed_day      INTEGER NOT NULL DEFAULT 1,
    family_digest   INTEGER NOT NULL DEFAULT 0,
    -- backup_warnings and sync_errors are mandatory; no toggle.
    updated_at      TEXT NOT NULL
);

-- Held-during-quiet-hours queue: mandatory notifications that arrive mid-quiet-hours.
CREATE TABLE held_notifications (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload         BLOB NOT NULL,            -- JSON; small
    deliver_after   TEXT NOT NULL,            -- when quiet hours end
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_held_deliver ON held_notifications(deliver_after);

-- ─────────────────────────── audit ───────────────────────────

CREATE TABLE audit_log (
    id              TEXT PRIMARY KEY,
    actor_user_id   TEXT,                     -- nullable for system actions
    actor_email     TEXT,                     -- snapshot at write time (in case user deleted later)
    action          TEXT NOT NULL,            -- enumerated; see §6.5
    target_kind     TEXT,                     -- 'user' | 'family' | 'device' | 'invite' | 'admin' | etc.
    target_id       TEXT,
    detail_json     TEXT,                     -- small structured detail; NO ciphertext, NO per-field sizes
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id);

-- ─────────────────────────── ops ───────────────────────────

CREATE TABLE bootstrap_state (
    id              INTEGER PRIMARY KEY CHECK (id = 1),    -- singleton row
    bootstrap_email TEXT NOT NULL,
    applied_at      TEXT NOT NULL
);
```

### 5.4 Index strategy summary

- `record_meta` reads are by `(family_id, record_type)` for tab lists, `(family_id, family_seq)` for sync cursor scans — both indexed.
- `blobs` are looked up by primary key during fetch; family-scoped scans only happen during quota reconciliation.
- `sessions.token_hash` is the hottest read on every authenticated request — covered by partial index excluding revoked rows.
- `family_invites.invitee_email` covers "show pending invites for this email" lookups.

### 5.5 No-orm DTO mapping

Sqlc generates `Queries` methods like `q.UpsertRecordMeta(ctx, UpsertRecordMetaParams{...})` returning `RecordMeta` structs that mirror table columns exactly. Service layer is responsible for converting between sqlc types and HTTP DTOs.

---

## 6. API contract

### 6.1 Base & conventions

- **Base path:** `/api/v1` (the `/api` prefix is set by cloudflared route; backend mounts on `/v1`).
- **Auth:** `Cookie: __Host-session=<sessionId>.<token>` on every request except `POST /v1/auth/google` and `GET /v1/health`.
- **Content type:** `application/json` for all bodies. Ciphertext blobs are base64url-encoded inside JSON. (Yes, ~33% overhead. Acceptable: SQLite stores BLOB natively, only the wire encoding is base64.)
- **Time:** RFC 3339 UTC millisecond precision.
- **Cursor:** opaque base64 string. Backend treats it as opaque even though internally it's `family_seq` integer.
- **Errors:** RFC 9457 ProblemDetails JSON.
- **CSRF:** SameSite=Lax cookie + `X-Requested-With: fetch` header check on writes (defense in depth — Cloudflare Zero Trust gates origin first).
- **Idempotency:** Mutating endpoints accept optional `Idempotency-Key` header (UUID). Server stores `(key, response)` for 24h.

### 6.2 Endpoint list

#### Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | Liveness for docker healthcheck. Returns `{ok:true, version, time}`. |
| POST | `/v1/auth/google` | Exchange Google ID token for session. Body: `{idToken, devicePubKey, deviceLabel, userAgent}`. Returns `{user, device, sessionToken}` (token only returned here, then cookie). |

#### Auth + identity

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/signout` | Revoke current session. |
| POST | `/v1/auth/signout-all` | Revoke all sessions for current user. |
| GET | `/v1/me` | Current user, current device, current family (or null), notification settings. |
| PATCH | `/v1/me` | Update display name. |
| GET | `/v1/me/devices` | List active devices. |
| POST | `/v1/me/devices/:id/revoke` | Sign out device. Deletes envelope. |
| POST | `/v1/reauth/challenge` | Issue 60s reauth nonce. |
| POST | `/v1/reauth/verify` | Submit fresh Google ID token + nonce; mint reauth_grant. |

#### Records & sync

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/sync/push` | Upload batch of records: `{records: [{recordId, recordType, blob, updatedAtMap, deletedAt?, parentVersion}]}`. Server validates AAD-binding metadata, allocates blobs, bumps `family_seq`. Returns winners-per-field for conflicts. |
| GET | `/v1/sync/pull?since=<cursor>&limit=500` | Stream records updated after cursor. Returns `{records: [...], nextCursor, hasMore}`. |
| GET | `/v1/sync/live` | **SSE.** Subscribe device to live events. Events: `record.changed`, `device.joined`, `family.changed`, `notification.dismiss`. Backend auto-sends `:keepalive` every 25s. |

#### Family

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/family/init` | Solo init: create family, store device envelope + recovery envelopes (atomic). |
| POST | `/v1/family/invites` | Send invite. Body: `{inviteeEmail}`. Validates allowlist. |
| GET | `/v1/family/invites/incoming` | List invites for current user's email. |
| POST | `/v1/family/invites/:id/accept` | Accept invite. If solo data exists, returns `409 needs-migration-decision`. |
| POST | `/v1/family/invites/:id/decline` | Decline. |
| POST | `/v1/family/migrate-solo` | After accepting with solo data — upload re-encrypted batch (§8.4). |
| POST | `/v1/family/leave` | Body: `{takeCopy: bool}`. Soft-removes; if takeCopy, server first issues a one-time export. |
| POST | `/v1/family/members/:userId/remove` | Kick a member. |
| POST | `/v1/family/devices/:id/envelope` | Upload wrapped familyKey for a new device (sender = existing device). |

#### Snapshots

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/snapshots` | List available snapshot dates (last 30 days). |
| POST | `/v1/snapshots/:date/restore` | Restore family state to that snapshot. Returns new cursor; clients re-sync. Requires confirmation flag. |

#### Push notifications

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/push/subscribe` | Body: `{endpoint, p256dh, auth}`. |
| DELETE | `/v1/push/subscribe/:id` | Unsubscribe. |
| GET | `/v1/notifications/settings` | Get current settings. |
| PATCH | `/v1/notifications/settings` | Update settings. |
| POST | `/v1/notifications/dismiss` | Body: `{notificationId}`. Server broadcasts dismiss event to other devices. |

#### Account

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/account/request-deletion` | Begins 14-day grace. Returns `deleteAfter`. |
| POST | `/v1/account/cancel-deletion` | Cancel deletion request (sign-in within 14 days). |
| POST | `/v1/account/recovery/reveal` | Returns Envelope B ciphertext for client-side decrypt. Requires `X-Reauth-Grant`. |
| POST | `/v1/account/recovery/regenerate` | Issue new recovery phrase. Replaces both envelopes atomically. Audit-logged. |
| POST | `/v1/logs/send` | User-initiated log upload from frontend (per [BR §3.24]). Body: `{logs, userConsent: true}`. |

#### Admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/admin/users` | List users with metadata: email, last sign-in, suspended, storage %. |
| POST | `/v1/admin/users/:id/suspend` | Suspend. |
| POST | `/v1/admin/users/:id/unsuspend` | Unsuspend. |
| GET | `/v1/admin/allowlist` | List allowlist. |
| POST | `/v1/admin/allowlist` | Add email. |
| DELETE | `/v1/admin/allowlist/:email` | Remove email. |
| POST | `/v1/admin/admins/:id/promote` | Promote user → admin (sets `promoter_id` = current admin). |
| POST | `/v1/admin/admins/:id/demote` | Demote. Server enforces subtree rules (§8.13). |
| GET | `/v1/admin/audit` | Paginated audit log (RFC 9457 cursors). |
| POST | `/v1/admin/devices/:id/revoke` | Admin force-revoke a device. |
| POST | `/v1/admin/account/delete-immediate` | Skip 14-day grace. **Admin self-only**, per [BR §3.19] testing-purposes button. |

### 6.3 SSE event types

All events arrive as `event: <type>\ndata: <json>\n\n`. JSON shape includes `seq` for client deduplication.

| event type | payload (JSON) | when |
|---|---|---|
| `record.changed` | `{seq, recordId, recordType, version}` | a record was upserted/deleted by another device in this family |
| `device.joined` | `{deviceId, label, createdAt}` | new device joined this user's account |
| `device.revoked` | `{deviceId, reason}` | this device or a sibling was revoked |
| `you.removed` | `{familyId, reason}` | the current user has been removed from the family — trigger local wipe |
| `family.changed` | `{kind: 'member_joined'|'member_left'|'member_removed', userId}` | family membership changed |
| `notification.dismiss` | `{notificationId}` | another device dismissed; clear locally |
| `sync.barrier` | `{cursor}` | server-issued "pull from this cursor"; sent after snapshot restore |
| `:keepalive` | (comment) | 25s heartbeat |

### 6.4 Authentication & middleware chain

Order of chi middleware on protected routes:
1. `middleware.RequestID`
2. `middleware.RealIP` (trusts `CF-Connecting-IP` if present, falls back to `X-Forwarded-For` then `RemoteAddr`)
3. `middleware.Recoverer`
4. `httpx.LoggerMiddleware`
5. `ratelimit.PerIP` (auth endpoints only) / `ratelimit.PerUser` (write endpoints)
6. `auth.SessionMiddleware` (sets `user`, `device` on context)
7. `auth.RequireFamilyMembership` (on family-scoped endpoints)
8. `auth.RequireAdmin` (on admin endpoints; also enforces no-suspend)

### 6.5 Audit log actions enumeration

Closed set; new actions require code + doc update.

```
auth.signin.success
auth.signin.fail
auth.signout
auth.signout.all
allowlist.add
allowlist.remove
admin.promote
admin.demote
user.suspend
user.unsuspend
user.delete.requested
user.delete.executed
user.delete.canceled
family.create
family.invite.send
family.invite.accept
family.invite.decline
family.invite.expire
family.invite.void
family.leave
family.member.remove
device.join
device.revoke.user
device.revoke.admin
recovery.code.regenerate
recovery.phrase.reveal
snapshot.restore
bootstrap.email.change
```

---

## 7. Encryption design

### 7.1 Symmetric cipher

**XChaCha20-Poly1305** with random 24-byte (192-bit) nonces, plus a 32-byte HMAC-SHA256 **commitment tag** prepended to the ciphertext (defends against partitioning oracle attacks; cheap insurance).

- Frontend library: `libsodium-wrappers-sumo` ≥0.7.x — `sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(...)`.
- Backend (server never decrypts user data): `golang.org/x/crypto/chacha20poly1305` — `chacha20poly1305.NewX(key)` returns the AEAD. Only used in tests for golden-vector validation.

Why XChaCha20 over AES-GCM: with independent multi-device writers across years, 96-bit AES-GCM nonce collision risk becomes non-negligible. XChaCha20's 192-bit nonce makes random nonces safe to ~2^96 messages — no coordination across devices required.

**Blob layout** (single ciphertext on the wire and at rest):

```
┌──────┬────────────┬───────────────────┬───────────┬──────────┐
│ ver  │ nonce(24B) │ commit_tag(32B)   │ ciphertext│ tag(16B) │
│ (1B) │            │                   │  (var)    │ (Poly)   │
└──────┴────────────┴───────────────────┴───────────┴──────────┘
```

`commit_tag = HMAC-SHA256(familyKey, "commit-v1" || nonce)`. Verified before decrypt.

### 7.2 Asymmetric primitive (device envelopes)

**X25519 sealed-box** via `crypto_box_seal`. Envelope = 80 bytes (32 ephemeral pubkey + 24 nonce + 32-byte key + 16-byte Poly tag in libsodium's combined sealed-box format; the underlying construction is X25519 → XSalsa20-Poly1305).

- Generate device keypair on first sign-in: `sodium.crypto_box_keypair()`.
- Persist private key in IndexedDB under key `device.privateKey` (kept in the **crypto Web Worker** scope so it's never exposed to main-thread JS).
- Public key uploaded with the very first `POST /v1/auth/google` call.

### 7.3 Recovery code → unwrap key (Argon2id)

- Library: `argon2-browser` v1.13.x SIMD WASM build.
- Parameters: **memory 65,536 KiB (64 MiB), iterations t=3, parallelism p=1, output 32 bytes**.
- Target latency: 400–800 ms on Pixel 6a class hardware. Benchmark on iPhone 12 Safari before locking — if it exceeds 1.5s, drop memory to 48 MiB and re-tune.
- Salt: `HKDF-SHA256(ikm=familyId, info="argon2-recovery-v1", L=16)` — deterministic from `familyId`, no separate salt storage strictly required, but `family_recovery_envelopes.salt` stores it explicitly anyway to remove derivation ambiguity for future migrations.

### 7.4 Authenticated Additional Data (AAD)

**Canonical AAD = length-prefixed concatenation.** Not JSON canonicalization — too many cross-language footguns.

```
AAD = "expapp-rec-v1"                       (13 bytes, fixed prefix)
   || ver_byte                                (1 byte)
   || LP(familyIdBytes)                       (LP = uint32_be(len) || bytes)
   || LP(recordIdBytes)
   || LP(recordTypeUtf8)
   || LP(addedByUserIdBytes)
   || LP(editedByUserIdBytes)
   || LP(updatedAtMapDigest)                  (SHA-256, 32 bytes)
   || LP(deletedAtUtf8 or 0-length)
   || uint32_be(plaintextByteCount)
   || LP(nonce)                               (24 bytes)
```

Where `updatedAtMapDigest = SHA-256(  for each field sorted by key:  field_name || "=" || iso8601_ms || "\n"  )`.

**This serializer MUST be byte-identical** between frontend (`src/services/crypto/aad.ts`) and backend (`internal/crypto/aad.go`). Cross-language **golden test vectors** are mandatory — kept in `backend/internal/crypto/testdata/aad-vectors.json` and re-loaded by both test suites.

### 7.5 Payload granularity

**Whole-record encryption.** One ciphertext per record contains the full record JSON.

Why not per-field: at ~200B plaintext per transaction, per-field framing overhead (24+32+16 = 72B × 10 fields ≈ 720B) destroys storage and bandwidth efficiency. With whole-record, framing is 73B once per record (~36% overhead at our record sizes — acceptable).

LWW still works because cleartext metadata records **per-field `updatedAt`** in `record_meta.updated_at_map`. Server compares timestamps and tells clients which version "wins" per field; clients merge on read.

### 7.6 Conflict resolution flow under E2EE

1. Device A and Device B each modify record R while one is offline. A updates field `amount` at t=10, B updates field `note` at t=15.
2. Both upload their fully-re-encrypted record blobs (each containing all of R's fields at their local view).
3. Server receives A's upload first: `record_meta.version = 2`, `updated_at_map = {amount: t10, note: t5}`.
4. Server receives B's upload next: B claims `parentVersion = 1` but current is 2 → **conflict response** `409 conflict` with current `version=2` blob attached.
5. B's client downloads the v=2 blob, decrypts both v=2 and its local v=2-candidate, **merges**:
   - For each field, pick the value from the version with the larger per-field `updatedAt`.
   - Result: `{amount: A's t10 value, note: B's t15 value, ...}`.
6. B re-encrypts the merged record, uploads with `parentVersion = 2`. Server accepts → `version = 3`.
7. Server emits `record.changed{recordId, version=3}` on SSE.
8. A receives the event, pulls v=3, decrypts, updates local Dexie. If A had a pending local edit that lost, **show a toast** [BR §3.11] `"Your edit was overridden by a newer change from B"`.

Edge cases:
- **Concurrent same-field edits**: t10 vs t15 → t15 wins deterministically. Tied timestamps (same millisecond) → resolved by lexicographic compare of `editedByUserId` (deterministic, no flip-flop). Toast surfaces the loss.
- **Delete vs edit**: tombstone `deletedAt > field.updatedAt` → record is dead; edits are dropped.
- **Edit vs delete**: edit `updatedAt > deletedAt` → record undeletes itself. To **guarantee zombies don't resurrect**, edits must rebuild the full record including all fields, and `deletedAt` is treated as a per-record field with its own timestamp; tombstones win only if `deletedAt_ts >= MAX(field.updatedAt)`. This is the only LWW edge that needs explicit care in the merge implementation.

### 7.7 Quota accounting & validation

**`families.usage_bytes`** is maintained incrementally on every `INSERT`/`DELETE` of `blobs`. It tracks **deduplicated** ciphertext bytes: blobs referenced by `record_meta` (current) OR `snapshot_entries` (historical) count once.

Nightly reconciliation job re-counts and corrects drift (defensive — should always match).

**Validated math** (5y, 6-member family, ~200 tx/month, dedup):

| Component | Size |
|---|---|
| Active records: ~12,000 tx × 273 B ciphertext + ~300 B metadata | ~7 MB |
| Tombstones (90-day window, ~5% churn) | ~30 KB |
| Snapshots (30 × baseline, dedup'd: ~99% blobs shared) | ~10 MB |
| Snapshot manifest rows (30 × 12,500 × 40 B pointers) | ~15 MB |
| Audit log (5y × ~500 entries/yr × 250 B) | ~0.6 MB |
| Sessions, envelopes, push subs | ~5 KB |
| **Subtotal**                                                          | **~33 MB** |
| SQLite overhead (WAL, indexes, page slack): ×2 | **~75 MB realistic** |

200 MB ceiling holds with >2.5× headroom. Tracked as `quota_validation_test` in `backend/internal/records/quota_test.go` with synthetic data.

### 7.8 Sessions

Opaque 256-bit random tokens, server-stored hashed (SHA-256). Cookie format: `__Host-session=<sessionId>.<base64urlToken>` so the cookie alone identifies which row to fetch without DB scan.

Cookie flags: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days; rolls on use).

**Refresh on use:** if `now - last_used_at > 24h`, mint new token, update `token_hash`, rotate cookie. Old token remains valid until end of request.

**Hot path optimization:** in-process LRU cache keyed by `sha256(token)` → `(userId, deviceId, exp)`, TTL 60s. ~5 ns hit. Invalidated on revoke (broadcast through process-local pub/sub since single-process; cross-instance not applicable).

### 7.9 Versioning & migration

- Every blob's first byte is the **suite version**.
- v1 suite = `0x01` = `{aead: XChaCha20-Poly1305+commit, asym: X25519-sealedbox, kdf: Argon2id-64MB-t3-p1, aad: lp-v1}`.
- Reserve ranges: `0x01-0x0F` data, `0x10-0x1F` envelopes, `0x20-0x2F` recovery.
- v2 introduction = dual-write: client decrypts old (v1) + writes new (v2). Server accepts both forever (until explicit deprecation).
- **No silent re-encryption job in v1.** Add only if a cipher needs sunsetting.

---

## 8. Key flows

> Each subsection is a sequence — read it as `actor → server` arrows. Implementation tasks ought to map 1:1 to these subsections.

### 8.1 First-time sign-in (creates user, family-of-one, devices, envelopes)

```
Frontend (onboarding step 1: Sign in with Google)
  └─ generate device keypair                              [libsodium]
  └─ Google Identity Services prompt → idToken
  └─ POST /v1/auth/google
       body: {idToken, devicePubKey, deviceLabel, userAgent}

Backend
  └─ idtoken.Validate(idToken, audience)
     ↳ extract email, email_verified, sub
  └─ check allowlist
     ↳ not found → 403 'email-not-allowed'
  └─ check user.suspended → 403 'suspended'
  └─ upsert users row by email
     ↳ if new user: is_root = (email == bootstrap_email)
  └─ insert devices row (status='active') with pub_key
  └─ mint sessionToken (32 random bytes)
  └─ insert sessions row with token_hash
  └─ audit_log(actor=user, action='auth.signin.success', target=device)
  └─ if this is user's first device AND user has no family:
       respond 200 {user, device, sessionToken, needsFamilyInit: true}
     else if user has no family but devices > 0:  /* unreachable in v1 */
     else if user already has a family:
       respond 200 {user, device, sessionToken, needsRecoveryCode: false}

Frontend (continuing onboarding step 2: Recovery code)
  └─ if needsFamilyInit:
       generate familyKey (32 bytes)
       generate 24-word BIP39 recovery phrase
       compute Argon2id(phrase, salt) → kRecovery
       wrap1 = AEAD(kRecovery, familyKey, AAD="recovery-wrap-v1"||familyId||createdAt)
       wrap2 = AEAD(familyKey, phrase,    AAD="recovery-reveal-v1"||familyId)
       deviceEnvelope = crypto_box_seal(familyKey, devicePubKey)
       POST /v1/family/init
           body: {familyId, deviceEnvelope, recovery: {wrap, phrase_ct, salt}}
       persist familyKey + devicePrivKey in IndexedDB via crypto Worker
       display 24-word phrase + "I've saved my recovery code" checkbox

Backend (POST /v1/family/init)
  └─ verify session, verify user has no active family
  └─ tx:
       insert families
       insert family_members (joined_at=now)
       insert device_envelopes
       insert family_recovery_envelopes
       seed family_seq.next_seq = 1
       audit_log('family.create')
```

### 8.2 Sign-in on second-and-later device (silent wrap path)

```
Frontend
  └─ generate device keypair
  └─ POST /v1/auth/google → response includes existing user + family (no needsFamilyInit)

Frontend (new device)
  └─ POST /v1/devices/register-self (implicit in /v1/auth/google for an existing user)
     ↳ backend creates devices row with status='pending'
     ↳ backend emits SSE device.joined to all OTHER active devices
     ↳ backend sends Web Push to subscribed endpoints with "new device joined: <label>"
  └─ frontend shows "Waiting for approval — open the app on another device"
  └─ frontend starts SSE listener AND a 30-second timer

Existing device (any)
  └─ receives SSE device.joined → user sees toast/banner
  └─ user taps "Allow" (or via the wrap timeout below, just-allow if no UI action)
  └─ device decrypts familyKey from local memory
  └─ envelope = crypto_box_seal(familyKey, newDevicePubKey)
  └─ POST /v1/family/devices/:newId/envelope {envelope}

Backend (envelope upload)
  └─ verify uploader is active in same family as new device
  └─ tx:
       insert device_envelopes (device_id=newId, wrapped_key=envelope)
       update devices set status='active' where id=newId
       audit_log('device.join', target=newId)
  └─ emit SSE device.activated{deviceId=newId, envelope} to new device

New device
  └─ receives device.activated → unwrap envelope with private key
  └─ persist familyKey in IndexedDB (crypto Worker scope)
  └─ start full sync (pull from cursor 0)

Timeout path (no envelope after 30s)
  └─ Frontend shows "Enter your recovery code"
  └─ user types 24 words → Argon2id → kRecovery
  └─ GET /v1/family/recovery-envelope (auth required)
  └─ frontend unwraps familyKey from recovery_wrap using kRecovery
  └─ frontend self-uploads its envelope: POST /v1/family/devices/:myId/envelope
  └─ proceed as above
```

### 8.3 Live sync (foreground)

```
Frontend (on app open)
  └─ open SSE: GET /v1/sync/live (Authorization via cookie)
  └─ on connect → POST a quick GET /v1/sync/pull?since=<localCursor> for catch-up
  └─ on each SSE record.changed:
       fetch the specific record blob via GET /v1/sync/pull?since=<seq-1>&limit=1
       decrypt, store in Dexie, react via useLiveQuery

Frontend (on local mutation)
  └─ encrypt record under familyKey
  └─ POST /v1/sync/push {records:[...]}
  └─ on success, store assigned version locally

Backend (POST /v1/sync/push)
  └─ for each record in batch (inside tx):
       validate AAD-binding (re-derive AAD from cleartext metadata, compare to
                              what client embedded)        ← critical anti-tamper
       check quota (family.usage_bytes + new_byte_count <= 200 MB or reject 413)
       check parentVersion == current — else 409 conflict (return current blob)
       insert blobs row
       upsert record_meta (bump version, family_seq, edited_by_user)
       update families.usage_bytes
  └─ emit SSE record.changed{seq, recordId, recordType, version} to family
  └─ respond {accepted:[...], conflicts:[{recordId, currentBlob, currentVersion}]}
```

### 8.4 Solo-to-family migration (transactional)

```
Frontend (after accepting an invite while having solo data)
  └─ user picks "Move my data"
  └─ generate migrationId (UUID v7)
  └─ for each local record:
       re-issue fresh recordId (collision-free per [BR §3.9])
       decrypt under SOLO familyKey
       re-encrypt under NEW familyKey (the inviter's)
  └─ POST /v1/family/migrate-solo
       body: {migrationId, targetFamilyId, records:[ {recordId, blob, meta, ...} ]}
       supports streaming JSONL; server reads to memory or temp table

Backend
  └─ check idempotency: if migrationId already committed → return 200 with cached response
  └─ tx (single SQL transaction, BEGIN IMMEDIATE):
       insert all blobs
       upsert all record_meta (bumping family_seq for target family)
       update families.usage_bytes
       record migrationId in idempotency cache
       audit_log('family.migrate.solo', detail={count, bytes})
  └─ respond 200 {committedAt, recordCount}

Frontend
  └─ on 200: retire solo familyKey (remove from IndexedDB)
       leave OLD solo family (server cleans up empty)
  └─ on error: keep solo familyKey, allow retry with SAME migrationId
```

### 8.5 Background sync (when app closed/inactive)

```
Frontend service worker (Chrome/Android only, installed PWA)
  └─ Periodic Background Sync API tag 'sync-records'
  └─ minInterval: 4 hours
  └─ UA may invoke earlier/later based on battery/network

On invocation:
  └─ verify session cookie still valid
  └─ POST /v1/sync/pull?since=<localCursor> (no SSE; one-shot HTTP)
  └─ decrypt and apply
  └─ no UI updates triggered (background)

iOS / Firefox / Safari (no PBS):
  └─ skip background sync entirely
  └─ rely on app-open foreground catch-up
```

### 8.6 Snapshot creation & restore

**Creation (daily cron, 03:00 UTC):**
```
For each family:
  Open new SQLite tx:
    insert snapshots row (date=today, expires_at=today+30d)
    insert snapshot_entries SELECT record_id, blob_id, record_type, version, updated_at_map
       FROM record_meta WHERE family_id = ? AND deleted_at IS NULL
  Commit.
```

Note: this does NOT use SQLite's `VACUUM INTO` for the family snapshot — that's a different mechanism for the **whole-database operator backup**. Family-level snapshots are logical (pointer rows), not physical.

**`VACUUM INTO` runs on the entire data.db separately**, at 03:30 UTC, into `/var/lib/expensesapp/snapshots/data-YYYY-MM-DD.sqlite`. Operator-facing only; documented per [BR §3.23].

**Restore:**
```
POST /v1/snapshots/:date/restore?confirm=true

Backend tx:
  for each record in snapshot_entries(snapshot_id):
    upsert record_meta(record_id, blob_id, version=current+1, deleted_at=NULL, family_seq=family_seq.next_seq++)
  for each record_meta NOT in snapshot_entries(snapshot_id) AND family_id matches:
    soft-delete: set deleted_at = now, version = current+1, family_seq = next++
  emit sync.barrier{cursor=family_seq.next_seq} via SSE to all family devices
  audit_log('snapshot.restore')

Clients pull from cursor 0 fresh, re-decrypt everything.
```

### 8.7 Family invite & accept

Reflects [BR §3.9], [BR §3.30], [BR §3.27].

```
A invites B:
  POST /v1/family/invites {inviteeEmail: B}
  Server validates: A in family, family size < 6, B on allowlist, no pending invite to B in this family
  insert family_invites (expires_at = now + 30d)
  Web Push to B's devices: "Anton invited you to join their family"
  SSE event family.invite.received to B's online devices

B sees pending invite at app open or push tap:
  GET /v1/family/invites/incoming
  user taps Accept:
    POST /v1/family/invites/:id/accept
    if B has solo data: server returns 409 needs-migration-decision
      → frontend shows Move/Discard/Cancel dialog
    if B has no solo data:
      tx: family_members(B, family_id), invite.status='accepted'
      Family activity push: "Anna joined the family"
```

### 8.8 Family member removal (soft, v1)

```
A removes B:
  POST /v1/family/members/B/remove
  tx:
    family_members.left_at = now, family_members.last_removed_at = now
    revoke ALL B's sessions for any device in this family
    delete device_envelopes for B's devices in this family
    audit_log('family.member.remove')
  emit SSE you.removed{familyId, reason} to B's devices
  emit SSE family.changed{kind: 'member_removed', userId: B} to remaining members

B's devices on receipt:
  wipe local familyKey
  wipe local Dexie family data
  show "You've been removed from this family. Your local data remains on this device for export only."
```

### 8.9 Family leave (with optional take-copy)

```
B leaves:
  POST /v1/family/leave {takeCopy: true|false}

  takeCopy = true:
    Frontend (before sending request) decrypts all family records locally,
    re-encrypts under a freshly generated SOLO familyKey,
    creates a new solo family via /v1/family/init in the same flow.
    Server receives takeCopy=true purely as metadata for audit.
    Server then proceeds with the soft removal logic (revoke session of THIS device for the OLD family,
      delete envelope for THIS device in OLD family).

  takeCopy = false:
    Server soft-removes B as in §8.8.
    Frontend wipes local family data on receipt of you.removed event.
```

### 8.10 Re-keying (DEFERRED — v1.1+, design pre-baked)

Documented here so v1 schema doesn't paint us into a corner. Not implemented in v1.

```
Trigger: hard removal of member, OR routine rotation, OR scheduled response to incident.

Ceremony:
  1. Any remaining online device runs: newFamilyKey = randomBytes(32)
  2. Device decrypts all blobs with OLD familyKey
  3. Device re-encrypts all blobs with NEW familyKey (new nonces, new commit tags, fresh AAD with the new version byte)
  4. Device generates new envelopes for all OTHER remaining devices (X25519 sealed-box each)
  5. Device wraps the new familyKey under new recovery argon2 key (regen phrase OR keep old phrase — design choice; lean toward force-regen)
  6. ATOMIC upload via POST /v1/family/rekey {newRecords:[...], newDeviceEnvelopes:[...], newRecoveryEnvelopes:{...}, oldKeyVersion, newKeyVersion}
  7. Server tx: replace blobs + record_meta + envelopes; advance suite version; audit_log('family.rekey').
  8. All remaining devices receive SSE rekey.complete and refetch their envelope.

v1 schema readiness:
  - Blob version byte already supports a second suite.
  - device_envelopes has a version column.
  - family_recovery_envelopes has a version column.
  - record_meta.version is per-record, not key-version — but rekey advances the family-level suite, not record version.
```

### 8.11 Account deletion (self-service)

```
User taps "Delete my account":
  if user is admin → 403 "demote first"
  if user is root admin → 403 "change BOOTSTRAP_ADMIN_EMAIL in env first"
  if user is in family → 403 "leave the family first"
  else:
    POST /v1/account/request-deletion
    Server: users.delete_after = now + 14d
            users.suspended_at = now           (prevents sign-in immediately)
            audit_log('user.delete.requested')
            invalidate all sessions for this user

  Within 14 days, signing in cancels: POST /v1/account/cancel-deletion (idempotent)

  Daily job (04:00 UTC) processes users where delete_after < now:
    tx:
      for each row referencing this user's records: cascade delete
      delete sessions
      delete device_envelopes
      delete devices
      delete users row
      pseudonymize audit_log entries < 90 days (replace actor_email with 'user_<hash>')
      delete audit_log entries > 90 days  /* per BR §3.19 */
      audit_log('user.delete.executed', actor=null, target=hash)
```

**Admin testing shortcut** [BR §3.19]: `POST /v1/admin/account/delete-immediate` (admin self only) skips the 14-day grace, runs the purge inline.

### 8.12 Recovery code reveal (Settings → Security)

```
1. User taps "Show my recovery code" in Settings.

2. Frontend → POST /v1/reauth/challenge
   ↳ server issues nonce, stores (nonce, sessionId, issued_at, expires_at = +60s)
   ↳ response: {nonce, expiresAt}

3. Frontend invokes Google Identity Services with:
       nonce: <reauthNonce>
       prompt: 'select_account consent'   (disables silent SSO; forces fresh interaction)

4. User completes Google flow → fresh idToken returned to frontend.

5. Frontend → POST /v1/reauth/verify {idToken}
   Server:
     idtoken.Validate(idToken, audience)
     check payload.nonce == storedNonce
     check payload.sub == session.user.google_sub
     check now - challenge.issued_at <= 60s
     check challenge.used_at IS NULL
     mark used; mint reauth_grant(purpose='reveal_recovery_phrase', expires_at=+5m)
     respond {grant: <id>}

6. Frontend → POST /v1/account/recovery/reveal
   header: X-Reauth-Grant: <grant>
   Server:
     verify grant valid, unused, matches purpose
     mark grant used
     audit_log('recovery.phrase.reveal')
     respond {phrase_ct: <Envelope B ciphertext>}

7. Frontend (in crypto Worker):
     decrypt phrase_ct with in-memory familyKey + AAD = "recovery-reveal-v1"||familyId
     display 24-word phrase
     after user confirms "Got it", clear from memory
```

### 8.13 Admin tree mutations (promote / demote / bootstrap change)

**Promote:**
```
POST /v1/admin/admins/:id/promote
Server (callerMustBeAdmin):
  set target.is_admin = 1, target.promoter_id = caller.id
  audit_log('admin.promote', target=id)
```

**Demote:**
```
POST /v1/admin/admins/:id/demote
Server (callerMustBeAdmin):
  verify target is in caller's subtree (recursive descent of promoter_id)
  tx:
    target.is_admin = 0
    re-parent target's subtree: UPDATE users SET promoter_id = caller.id WHERE promoter_id = target.id
    audit_log('admin.demote')
```

**Bootstrap admin handoff (operator action):**
1. Operator edits `.env`: `BOOTSTRAP_ADMIN_EMAIL=new@example.com`
2. Operator runs `docker compose restart api`
3. Backend startup:
   - Read `BOOTSTRAP_ADMIN_EMAIL` from env
   - Read previous bootstrap email from `bootstrap_state` table
   - If different:
     - Find user where `email = new bootstrap email`. If not on allowlist, insert allowlist row.
     - Set `is_root = 1` on that user
     - Find prior root (`is_root = 1, email = previous bootstrap`): if still on allowlist, set `is_root = 0, is_admin = 0` (downgrade); if not on allowlist, leave row alone (will fail to sign in)
     - Re-parent previous root's promotion children: `UPDATE users SET promoter_id = new_root.id WHERE promoter_id = previous_root.id`
     - Update `bootstrap_state` row.
     - audit_log('bootstrap.email.change')
4. Accept HTTP requests.

### 8.14 Admin metadata-only view

Admins fetch user list via `GET /v1/admin/users`. Response per user:
```json
{
  "id": "...",
  "email": "...",
  "displayName": "...",
  "lastSignInAt": "...",
  "suspendedAt": null,
  "isAdmin": false,
  "promoterId": "...",
  "storageUsagePct": 12,
  "familyMemberCount": 3,
  "deviceCount": 2,
  "hasRecoveryCode": true,
  "deletePending": false
}
```

No record content, no per-record sizes, no transaction counts.

---

## 9. Frontend integration plan

> Detailed enough for a worker agent to implement each section.

### 9.1 New folders & files (under `src/`)

```
src/
├── services/
│   ├── crypto/                 (NEW)
│   │   ├── sodium-init.ts      lazy-loads libsodium, returns ready promise
│   │   ├── argon-init.ts       lazy-loads argon2-browser; only on recovery paths
│   │   ├── aad.ts              canonical AAD serializer (MUST match backend internal/crypto/aad.go)
│   │   ├── envelope.ts         wrap/unwrap helpers for sealed box
│   │   ├── recovery.ts         derive recovery key from phrase; envelope wrap/unwrap
│   │   ├── record-cipher.ts    encryptRecord(plaintext, meta) / decryptRecord(blob, meta)
│   │   ├── commit.ts           HMAC-SHA256 commitment tag computation
│   │   ├── worker.ts           Web Worker entry — all crypto runs here
│   │   ├── worker-client.ts    main-thread API to call into the worker
│   │   └── version.ts          suite version constants
│   ├── sync/                   (NEW)
│   │   ├── client.ts           HTTP API client (fetch wrappers + JSON)
│   │   ├── sse.ts              EventSource subscriber with auto-reconnect
│   │   ├── engine.ts           orchestrates push/pull/merge against Dexie
│   │   ├── cursor.ts           per-family local cursor storage
│   │   └── merge.ts            field-level LWW merge for conflict responses
│   ├── auth/                   (NEW)
│   │   ├── google.ts           wraps Google Identity Services script
│   │   ├── session.ts          tracks current session state (Zustand slice)
│   │   ├── reauth.ts           reauth challenge/verify flow
│   │   └── device.ts           device keypair gen/load
│   └── (existing services unchanged)
├── stores/
│   ├── sync-store.ts           (NEW) — sync status: lastSyncAt, isSyncing, conflictsToast, errors
│   └── (existing stores unchanged)
├── pages/
│   ├── DeviceJoinWaiting.tsx   (NEW) — "Waiting for approval" screen
│   ├── RecoveryCodePage.tsx    (NEW) — onboarding step 2 + Settings → Security view
│   └── (existing pages unchanged)
├── components/
│   ├── onboarding/
│   │   └── RecoveryCodeSetup.tsx       (NEW) — generates + shows 24 words + ack
│   ├── settings/
│   │   ├── SecuritySettings.tsx        (NEW) — recovery code, devices list, sign-out-all
│   │   ├── ActiveDevicesList.tsx       (NEW) — per-device sign out
│   │   └── (existing settings unchanged)
│   ├── transactions/
│   │   ├── TransactionAuthors.tsx      (NEW) — "Added by Anna · Last edited by Bob" sheet
│   │   └── TransactionInput.tsx        (modified — adds Authors button if family && tx selected)
│   ├── shared/
│   │   ├── SyncStatusChip.tsx          (NEW) — Overview top-bar chip
│   │   ├── SyncStatusBanner.tsx        (NEW) — Settings header + manual refresh
│   │   ├── ConflictToast.tsx           (NEW) — "Your edit to X was overridden by ..."
│   │   └── DeviceJoinedBanner.tsx      (NEW) — "New device joined. This wasn't me → Revoke"
│   └── (existing components unchanged)
└── onboarding/
    └── OnboardingFlow.tsx              (modified — 7 steps per [BR §3.26])
```

### 9.2 Dexie schema additions

Add a single `db.version(2)` block (v1 was the no-backend release):

```ts
db.version(2).stores({
  // existing tables unchanged…
  syncCursors: '&familyId',                   // local sync cursor per family
  pendingUploads: '++id,recordId,attempts',   // outbox for offline mutations
  cipherKeys: '&id',                          // device privKey, current familyKey, version (encrypted at rest under sessionKey if we ever want hardening)
}).upgrade(async tx => {
  // create empty tables; no data migration since this is pre-release
});
```

### 9.3 Sync engine state machine

States (Zustand `sync-store`):
- `idle` — no sync in progress
- `syncing` — push or pull active; **disable mutation UI** per [BR §3.18]
- `error` — last sync failed; show in Settings detail
- `offline` — no network

Triggers:
- App focus → catch-up pull
- Local mutation → enqueue push
- SSE event → targeted pull (single record)
- Periodic Background Sync (Chrome/Android) → catch-up pull every ~4h

Mutation UI gate: a top-level `useSyncBlock()` hook returns `true` when state == `syncing`. Numpad, save buttons, etc. observe it and render disabled. Spinner overlay (toast-style) per [BR §3.18].

### 9.4 Sync indicator placement

- **Overview tab top-bar:** `<SyncStatusChip />` — pill button with states: `Synced just now` / `Synced 14m ago` / `Offline – saved locally` / `Sync error · tap for details` (tap → /settings#sync).
- **Settings header:** `<SyncStatusBanner />` — full readout + "Sync now" button + last error reason.

### 9.5 Transaction authors UI

Per the answered question, authors visible only when user opens a transaction's detail.

- `TransactionInput.tsx` (which doubles as detail view per existing structure): add an "Authors" link below the amount when `record.familyId !== soloFamilyId && (addedBy || editedBy)`.
- Tap → `<TransactionAuthors />` bottom sheet showing:
  ```
  Added by   Anton    on 2026-05-15
  Last edit  Anna     on 2026-05-17 09:42
  ```
- Names resolved from a local users-lookup table that the sync engine maintains (`/v1/family/members` initial pull + maintenance via SSE `family.changed`).

### 9.6 Recovery code UX

- Onboarding step 2 (only after sign-in, only first device of new account): show all 24 words + single checkbox `"I've saved my recovery code in a safe place"`. No hidden-then-reveal pattern; just show it. Acknowledge unlocks the "Continue" button.
- Settings → Security → "Show recovery code": Trigger reauth flow §8.12; show phrase with a "Copy" button (clipboard auto-clears after 30s — using `navigator.clipboard.writeText` + `setTimeout`).
- "Regenerate code": confirmation dialog → invokes `/v1/account/recovery/regenerate`. Frontend generates new phrase, re-derives Argon2, rewraps, replaces both envelopes atomically server-side.

### 9.7 Onboarding flow update [BR §3.26]

```
1. Sign in with Google (skippable; if skipped, jump to step 3)
2. Recovery code setup (ONLY if step 1 done AND new account)
3. Welcome
4. Currency
5. First account
6. Categories
7. Install prompt
```

For users who skip sign-in, "Sign in later from Settings" surfaces an in-Settings flow that runs steps 1+2 sequentially.

### 9.8 Build/dev integration

- Backend dev server: `cd backend && go run ./cmd/api` listens on `127.0.0.1:8080`.
- Frontend dev (Vite) proxies `/api/*` to `http://127.0.0.1:8080` (vite.config.ts addition).
- Task targets to add:
  - `task backend:dev` — `air -c backend/.air.toml` (live reload)
  - `task backend:test` — `gotestsum --format pkgname -- ./backend/...`
  - `task backend:sqlc` — `sqlc generate -f backend/sqlc.yaml`
  - `task backend:migrate` — `goose -dir backend/internal/db/migrations sqlite3 data.db up`

---

## 10. Testing strategy

### 10.1 Layers

**Three layers**, each owning a different concern. Test cases (TC-xxx etc.) are **not** generated here; this is the framework.

| Layer | Scope | Tooling | Lives in |
|---|---|---|---|
| **Unit** | Single function or struct; no DB, no HTTP. | Stdlib `testing` + testify. | `*_test.go` next to source. |
| **Integration** | Backend module + real SQLite (temp file or `:memory:`); HTTP via `httptest.NewServer`; no browser. | testify + a `testenv` helper that boots app with sqlite + runs migrations. | `backend/internal/<pkg>/*_integration_test.go` (build tag `integration`). |
| **End-to-end** | Whole system: backend container + frontend dev build + Playwright; mocks Google ID token. | Existing Playwright harness + a mock-google service. | `e2e/backend-*.spec.ts`. |

### 10.2 Unit tests — what they own

- **`internal/crypto/aad.go`**: golden-vector tests against `testdata/aad-vectors.json`. Same vectors loaded in the frontend test (`src/services/crypto/__tests__/aad.test.ts`) — **cross-language byte identity is the explicit success criterion**.
- **`internal/admin/tree.go`**: promotion / demotion / re-parent / subtree visibility logic. Property-based test using `testing/quick`: random tree → random demotions → assertion that subtree count is conserved.
- **`internal/family/invariants.go`**: 6-member cap, allowlist gate, 24h cool-down, mutual-kick tie-break.
- **`internal/records/lww.go`**: per-field timestamp comparison, tied-timestamp tiebreak, tombstone-vs-edit rules.
- **`internal/auth/session.go`**: token generation entropy, hash-at-rest, expiration, sliding refresh.
- **`internal/push/quiet_hours.go`**: timezone-aware hold-or-send decision for every quiet-hours edge (start straddling midnight, DST boundary).

### 10.3 Integration tests — what they own

Each integration test boots a fresh server via the `testenv.New(t)` helper that:
1. Opens an in-memory SQLite (`file::memory:?cache=shared`).
2. Runs all migrations.
3. Mounts the chi router with mock Google verifier (`internal/auth/google_mock.go`).
4. Returns `(*testenv.Env, *http.Client)`; the client carries a pre-minted session cookie.

What's tested at this layer:
- **Auth chain**: sign-in with valid mock idToken → session cookie issued. Reject paths: not on allowlist, suspended, malformed token. (`internal/auth/google_integration_test.go`)
- **Records push/pull**: round-trip a blob with realistic metadata; verify AAD validation rejects mutated metadata. (`internal/records/sync_integration_test.go`)
- **Quota**: synthesise 200 MB of pushes; assert 413 at the boundary; assert successful uploads after a delete + reconciliation. (`internal/records/quota_integration_test.go`)
- **Conflict path**: two clients push same record with different `parentVersion` → server returns conflict → second client posts merged record → server accepts. (`internal/records/conflict_integration_test.go`)
- **Family lifecycle**: create, invite, accept, leave, kick — verify membership rows and audit entries. (`internal/family/lifecycle_integration_test.go`)
- **Solo-to-family migration**: idempotent retry with same migrationId. (`internal/family/migrate_integration_test.go`)
- **Snapshot create/restore**: insert N records → run snapshot job → delete records → restore → record_meta rebuilt with new versions. (`internal/snapshot/restore_integration_test.go`)
- **SSE fanout**: connect two devices, push from device 1, assert device 2 receives event within 100ms. Uses `httptest` + manual SSE parser. (`internal/live/sse_integration_test.go`)
- **Push notification**: mock VAPID endpoint; assert payload shape and dead-token GC on simulated 410. (`internal/push/deliver_integration_test.go`)
- **Admin tree**: 4-level promote tree, demote at depth 2, assert children re-parent. (`internal/admin/tree_integration_test.go`)
- **Bootstrap handoff**: start with email A → restart with email B → assert root migrated. (`internal/admin/bootstrap_integration_test.go`)
- **Account deletion lifecycle**: request → wait simulated 14 days (`testenv.AdvanceClock`) → purge job → assert zero rows + pseudonymized audit. (`internal/account/delete_integration_test.go`)
- **Audit log retention**: insert old entries → run retention job → entries older than 1y are gone. (`internal/audit/retention_integration_test.go`)

Run target: `gotestsum --format pkgname -- -tags=integration -timeout=120s ./backend/...`.

### 10.4 End-to-end tests — what they own

The existing Playwright harness (`e2e/`) gains a backend lane. Key additions:

- A **mock Google service** (`e2e/mock-google/`) — small Go binary that signs RS256 ID tokens with a test-fixture key. Backend's `GOOGLE_OIDC_JWKS_URL` and `GOOGLE_OIDC_AUDIENCE` point at this mock during e2e. No real Google traffic.
- An **e2e harness** that, for each spec file, runs `docker compose -f docker-compose.e2e.yml up -d` (or just `task e2e:up`) bringing up: backend + mock-google + frontend dev server. Each spec gets a fresh SQLite via a `?reset_db=test_seed_X` query param on backend admin endpoint protected by a test-only header — admittedly hacky, but limited to non-prod builds via build tag.

What's tested at this layer (covering the user-visible flows):
- **Onboarding with sign-in** through the new 7-step flow, including recovery code display.
- **Cross-device sync**: open two Playwright contexts representing two devices; mutate in one; assert observation in the other within 5s.
- **Family invite + accept + solo-to-family migration**: end-to-end including key-wrap UX.
- **Recovery code reveal in Settings** with mocked Google reauth challenge.
- **Device join security alert**: device 2 signs in → device 1 receives banner with "This wasn't me — sign out" → tapping it revokes device 2.
- **Conflict toast**: simulate offline edit on device A, online edit on device B, reconnect A, assert toast appears with the right text.
- **Snapshot restore**: admin user restores a 3-day-old snapshot; assert record count + UI is consistent.
- **Storage quota**: synthetic bulk upload to >200 MB; assert quota banner appears [BR §3.13].
- **Admin panel basics**: bootstrap admin views user list with storage %; promotes/demotes via the UI.

Test policy:
- **Always close the browser** at spec end (existing pattern preserved).
- **No real Google sign-in** in CI; always the mock.
- **No real Web Push delivery** in CI; the backend's push deliverer is wired to a mock endpoint that records calls (a Go httptest server inside the e2e compose).

### 10.5 Performance & load (defer past v1)

For a <50-user deployment, no SLO. Sanity benchmarks:
- `BenchmarkRecordsPush` in `internal/records/` → must handle 100 records/second per CPU at <50 MB RSS on the deployment host (4 vCPU homeserver target).
- `BenchmarkSSEFanout` → 50 simultaneous subscribers with 10 events/sec each (well above worst case).

Add to `task ci-perf` (not run on every push; weekly nightly only).

### 10.6 Security review checklist (manual, pre-launch)

- [ ] AAD round-trips: client encrypts → server stores → client decrypts; flip any metadata bit → decrypt MUST fail.
- [ ] Session token entropy = 256 bits, stored hashed only.
- [ ] Cookie has `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] No PII/ciphertext/per-field sizes in any log line (grep `slog.JSON` output).
- [ ] Rate limits actually fire on `/v1/auth/google` (manual: 6 failed signins in 60s → 429).
- [ ] Admin panel cannot reach any decrypt path.
- [ ] Removed-member's old session yields `you.removed` event, NOT a 200.
- [ ] CORS: same-origin only — no `Access-Control-Allow-Origin: *`.
- [ ] `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` set.
- [ ] Backup file (`data-YYYY-MM-DD.sqlite`) contains zero plaintext (test: `strings data.db | rg -i 'groceries|coffee'` → 0 hits).

---

## 11. Observability & ops

### 11.1 Logs

- All logs via `slog` JSON to stdout. Captured by docker logging driver (json-file, 10MB×3 rotation per existing compose).
- Request log: one line per request — `request_id, user_id?, device_id?, method, path, status, duration_ms, bytes_out`.
- Background-job log: one line per tick — `job, started_at, duration_ms, items_processed, errors`.
- Audit log is **separate** from operational logs (lives in `audit_log` table per §5).

### 11.2 Metrics (no Prometheus in v1)

Manually exposed at `GET /v1/admin/metrics` (admin-only, plain JSON):
```json
{
  "users": 7, "active_devices": 12,
  "blobs_count": 14302, "total_bytes": 38_412_910,
  "families": 3,
  "sse_subscribers": 4,
  "sync_pushes_last_24h": 1244,
  "sync_pulls_last_24h": 3811,
  "push_notifications_sent_24h": 27,
  "push_failures_24h": 1,
  "uptime_seconds": 234567
}
```

If pain emerges later, swap to OTel + Prometheus exporter. Out of scope for v1.

### 11.3 Health & readiness

- `GET /v1/health` — returns 200 if SQLite responds to `SELECT 1` within 100ms; 503 otherwise. Used by docker healthcheck.

### 11.4 Backups (operator-facing)

Two layers:

1. **Application-level (handled by app)**: per-family logical snapshots in `snapshots` + `snapshot_entries` tables. 30-day retention. Used for "Restore to YYYY-MM-DD" UX.
2. **Database-file backup (operator)**: `VACUUM INTO '/var/lib/expensesapp/snapshots/data-YYYY-MM-DD.sqlite'` runs daily at 03:30 UTC. Operator is responsible for shipping these elsewhere (restic / borg / ZFS send / rsync). Documented in `docs/backend/operations.md` (to be authored after v1 ships).

### 11.5 Config (env vars)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | yes | — | Root admin email |
| `GOOGLE_OAUTH_CLIENT_ID` | yes | — | The `aud` value for ID token verify |
| `VAPID_PUBLIC_KEY` | yes | — | Web Push public key |
| `VAPID_PRIVATE_KEY` | yes | — | Web Push private key (kept out of frontend) |
| `VAPID_SUBJECT` | yes | — | `mailto:operator@example.com` for VAPID JWT `sub` claim |
| `DB_PATH` | no | `/var/lib/expensesapp/data.db` | SQLite file path |
| `BIND_ADDR` | no | `:8080` | HTTP listen address |
| `LOG_LEVEL` | no | `info` | `debug`/`info`/`warn`/`error` |
| `ALLOWED_ORIGINS` | yes | — | Comma-separated; CORS allowlist for browser requests |
| `COOKIE_DOMAIN` | yes | — | e.g. `expenses.example.com` |
| `TRUSTED_PROXY` | no | (auto-detect from `CF-Connecting-IP`) | When set, treat this CIDR as trusted source for real-IP |

VAPID keys generated once by operator: `go run ./backend/cmd/vapidgen` outputs base64 keys for `.env`.

### 11.6 docker-compose addition (sketch)

```yaml
api:
  build:
    context: .
    dockerfile: backend/Dockerfile
  image: expensesapp-api:local
  container_name: expensesapp-api
  restart: unless-stopped
  expose: ["8080"]
  read_only: true
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  tmpfs: ["/tmp"]
  volumes:
    - apidata:/var/lib/expensesapp
  environment:
    BOOTSTRAP_ADMIN_EMAIL: ${BOOTSTRAP_ADMIN_EMAIL:?required}
    GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:?required}
    VAPID_PUBLIC_KEY:  ${VAPID_PUBLIC_KEY:?required}
    VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:?required}
    VAPID_SUBJECT:     ${VAPID_SUBJECT:?required}
    COOKIE_DOMAIN:     ${COOKIE_DOMAIN:?required}
    ALLOWED_ORIGINS:   ${ALLOWED_ORIGINS:?required}
  deploy:
    resources:
      limits:
        cpus: "0.5"
        memory: 256M
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
  networks:
    - tunnel
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/v1/health"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s

volumes:
  apidata:
    driver: local
```

The cloudflared route gains `/api/* → api:8080` mapping (configure via Cloudflare dashboard → tunnel public hostnames or via `config.yml` if using local config).

---

## 12. Implementation plan (phased, dependency-ordered)

Each phase is a coherent unit of value that can be reviewed and merged independently. **An orchestrator should dispatch one phase at a time, allowing parallelism within a phase where called out.**

### Phase 0 — Project scaffolding (sequential, must be done first)

1. Create `backend/` directory at repo root with `go.mod`, `Dockerfile`, `cmd/api/main.go` skeleton.
2. Add `task backend:*` targets to `Taskfile.yml`.
3. Add `vite.config.ts` proxy entry for `/api/*` → `http://127.0.0.1:8080`.
4. Add `api` service to `docker-compose.yml` (commented stub initially).
5. Add `internal/config`, `internal/log`, `internal/httpx` skeletons + a `GET /v1/health` returning a static OK.
6. Wire `sqlc.yaml` + `goose` + first migration `00001_init.sql` containing the FULL §5.3 schema.
7. **Definition of done**: `task backend:dev` boots, `curl http://localhost:8080/v1/health` returns 200.

### Phase 1 — Auth + identity (parallel-safe internally)

These can be agent-parallelized:
1a. `internal/auth/google.go` — ID token verification via `idtoken.Validate`.
1b. `internal/auth/session.go` — opaque token gen, hash-at-rest, sliding refresh, in-process LRU cache.
1c. `internal/auth/allowlist.go` — IsAllowed + suspension check.
1d. `internal/auth/middleware.go` — wire chi middleware chain.
1e. `internal/admin/bootstrap.go` — startup bootstrap-email handler.
1f. Frontend `src/services/auth/google.ts` + `src/services/auth/session.ts` + onboarding step 1 integration.

Then sequential:
1g. `POST /v1/auth/google`, `POST /v1/auth/signout`, `GET /v1/me`.
1h. Integration tests `internal/auth/*_integration_test.go`.

DoD: Sign in via mock-google in dev produces a session cookie that authenticates `GET /v1/me`.

### Phase 2 — Crypto foundation (parallel-safe between fe/be)

2a. Frontend `src/services/crypto/sodium-init.ts` + `worker.ts` + lazy-load wiring.
2b. Frontend + backend `aad.ts` / `aad.go` with **shared golden vectors** in `backend/internal/crypto/testdata/aad-vectors.json`. Bytewise cross-language test passes BEFORE moving on.
2c. Frontend `record-cipher.ts`, `envelope.ts`, `recovery.ts`, `commit.ts`.
2d. Frontend `argon-init.ts` (lazy on recovery paths only).
2e. Crypto unit tests on both sides.

DoD: A frontend Storybook (or in-app dev playground) demo: encrypt → decrypt round-trip with golden AAD vectors; envelope wrap/unwrap; argon2 derivation hits 400-800 ms on a real phone.

### Phase 3 — Family init + first-device flow

3a. `internal/family/service.go` + `POST /v1/family/init`.
3b. `internal/family/handlers.go` for invite/accept/decline + the migrate-solo endpoint.
3c. Frontend `RecoveryCodePage.tsx`, `RecoveryCodeSetup.tsx`, onboarding step 2 wiring.
3d. Integration tests + e2e for first-time sign-in + recovery code shown.

DoD: A new user signs in, sees recovery code, confirms, lands in the app with a populated `family_recovery_envelopes` row.

### Phase 4 — Records: push + pull + LWW

4a. `internal/records/service.go` + `internal/sync/push.go` + `internal/sync/pull.go`.
4b. AAD validation on push (re-derive AAD from cleartext, compare).
4c. `internal/records/quota.go` byte accounting.
4d. `internal/records/lww.go` + conflict response.
4e. Frontend `src/services/sync/engine.ts` + `client.ts` + Dexie outbox `pendingUploads`.
4f. Integration tests for round-trip, AAD tamper, quota, conflict merge.
4g. E2e: single-device push/pull happy path.

DoD: A signed-in user adds a transaction in the frontend; backend stores it; signing in on another browser (fresh) sees the same data after a pull.

### Phase 5 — SSE live channel + second device

5a. `internal/live/sse.go`, `hub.go`, `heartbeat.go`.
5b. `internal/sync/events.go` event bus.
5c. `internal/family/devices.go` + `POST /v1/family/devices/:id/envelope`.
5d. Frontend `src/services/sync/sse.ts` with reconnect.
5e. `DeviceJoinWaiting.tsx`, silent-wrap UI on existing device.
5f. Integration + e2e: cross-device sync within 5s; second device join via silent wrap path.

DoD: User signs in on second browser; first browser approves silently; both stay in sync live.

### Phase 6 — Recovery code path & device security alerts

6a. Reauth challenge endpoints + grant flow.
6b. Recovery envelope reveal endpoint.
6c. Device.joined event + `<DeviceJoinedBanner />` with one-tap revoke.
6d. Recovery-code-entry flow on a fresh device (no existing approver).
6e. E2e: lose-all-devices recovery flow.

DoD: User can re-view their recovery code (gated by fresh Google reauth) and recover on a fresh browser.

### Phase 7 — Family invite, accept, migrate, leave, kick

7a. Invite create / list / accept / decline endpoints + frontend UI.
7b. Solo-to-family migration endpoint (idempotent on `migrationId`).
7c. Leave + take-copy flow.
7d. Remove + 24h cool-down + mutual-kick tie-break.
7e. Best-effort local wipe on `you.removed` event.
7f. Integration + e2e covering all four lifecycle endpoints.

DoD: Two test users go through invite + accept + collaborative editing + kick + re-invite blocked for 24h.

### Phase 8 — Snapshots: create, list, restore

8a. Daily snapshot cron job + `snapshots`/`snapshot_entries` writes (dedup'd by `(recordId, version)`).
8b. List endpoint.
8c. Restore endpoint + `sync.barrier` SSE event.
8d. `VACUUM INTO` operator backup cron.
8e. Frontend `Settings → Restore` UI.
8f. E2e: restore yesterday's snapshot recovers a deleted record.

DoD: Snapshots accumulate daily; restore round-trip works; older than 30d are pruned.

### Phase 9 — Push notifications

9a. Web Push subscription endpoints.
9b. VAPID delivery + dead-token GC.
9c. Quiet-hours + held-notifications queue.
9d. Daily family digest job.
9e. Backup-quota and sync-error mandatory pushes wired into respective services.
9f. Frontend permission-ask UX (post-signin "Enable cloud features" screen).
9g. iOS PWA graceful degradation to in-app banners.
9h. Integration tests with mock VAPID endpoint.
9i. E2e: subscribe, trigger digest, observe a banner in the receiving browser (without real push delivery).

DoD: Family digest fires on schedule respecting quiet hours; quota warnings reach users.

### Phase 10 — Admin panel

10a. Admin handlers: users list, allowlist CRUD, suspend, promote/demote, audit fetch.
10b. Audit log writes wired into every action that needs them (per §6.5).
10c. Admin tree subtree visibility + re-parent on demote.
10d. Bootstrap-email change on restart.
10e. Frontend admin panel pages (separate route tree under `/admin/*`, only accessible if `me.isAdmin`).
10f. Integration + e2e for admin flows.

DoD: Bootstrap admin can manage allowlist, suspend a user, promote another admin, view audit log.

### Phase 11 — Self-service account deletion + log upload

11a. Request-deletion / cancel-deletion endpoints.
11b. Daily purge job.
11c. Audit pseudonymization at 90 days.
11d. Admin self-immediate-delete (testing button).
11e. User-initiated `POST /v1/logs/send` from Settings.
11f. Frontend Settings → Account → Delete UI with 14-day countdown.

DoD: A test user requests deletion → 14-day suspension → simulated clock advance → all rows gone, audit pseudonymized.

### Phase 12 — Background sync + iOS fallback

12a. Frontend service-worker Periodic Background Sync registration (4h interval).
12b. Catch-up pull on app open / focus.
12c. iOS branch (no PBS) — banner explaining limitation per [BR §3.31].
12d. E2e: simulate background sync invocation; verify data refresh.

DoD: Closed PWA on Android wakes every ~4h, pulls deltas without UI; iOS shows correct in-app banners.

### Phase 13 — Hardening & launch

13a. Run security review checklist (§10.6).
13b. Worst-case quota math test passes with synthetic load.
13c. Localization scaffolding verified (all backend strings in i18n resource map ready for translation).
13d. Production docker-compose freeze + operator runbook (`docs/backend/operations.md`).
13e. Pre-launch smoke test (`/smoke-test` covers new flows).

DoD: All checklist items green; tagged release `v1.0.0-backend`.

### Parallelism guidance for the orchestrator

- Phases are **strictly ordered**; do not start phase N+1 until phase N's DoD is met.
- **Within a phase**, sub-items lettered `Na, Nb, ...` can run in parallel **unless** sequencing is called out (e.g. Phase 1's `1g` waits for `1a-1f`).
- Frontend and backend sub-items in the same phase are typically parallel-safe; the AAD work in Phase 2 is the explicit exception (golden vectors must agree before either side moves on).

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AAD serializer divergence between FE and BE | M | H — silent decrypt failures | Shared golden-vector test fixtures; CI gate that runs both test suites against same JSON. |
| WebPush v1.4.0 vs Apple PWA breakage | H (Apple endpoints reject v1.4.0) | M | Pin to a `master` pseudo-version with the AuthScheme fix; documented in `go.mod`. |
| Argon2id WASM slow on iPhone 12 Safari | M | M | Benchmark on real device; have a `mem=48 MiB` fallback parameter set; only runs on recovery, so not a hot path. |
| SQLite write contention under high concurrency | L (small user base) | M | WAL mode + busy_timeout=5s; single-process serializes writes; integration test stresses 50 concurrent push connections. |
| Snapshot dedup degrades to ~1× if nonces change every save | already mitigated | H | Dedup is by `(recordId, version)` not ciphertext hash — explicit in §7.7. |
| Cookie `__Host-` requires HTTPS + no Domain attribute → breaks behind some proxies | L | M | Cloudflare Tunnel terminates TLS upstream; verified `Secure` flag passes through. Local dev uses `http://localhost` with a tagged dev cookie name. |
| Periodic Background Sync only works in installed PWAs | High (most users don't install) | M | Documented; foreground catch-up covers the gap. |
| Removed-member device that never re-opens the app keeps reading cached data | known | M | Acknowledged in [BR §3.33] and shown in the kick-confirm dialog; hard removal in v1.1+ is the structural fix. |
| Operator loses both Google access AND `.env` write access | very low | irrecoverable | Documented as operator-owned risk per [BR §3.6]. |
| sqlc SQLite dialect quirks (e.g. unsupported `RETURNING` patterns) | L | L | Stick to `INSERT ... ON CONFLICT DO UPDATE` + explicit `SELECT`; verified against sqlc 1.31.1 SQLite engine. |

---

## 14. Decisions log

### 14.1 Locked decisions (this doc)

| # | Decision | Rationale |
|---|---|---|
| D1 | Go 1.26 + chi v5 + modernc SQLite | Per BR + research; pure-Go build, minimal cgo headaches. |
| D2 | SQLite single file, WAL mode | Operator-friendly, ample headroom for <50 users; backup is one file. |
| D3 | SSE for live transport | Simpler than WebSocket given push-direction asymmetry; chi preserves Flusher. |
| D4 | Web Push direct VAPID | No vendor dependency; works on all target browsers. |
| D5 | Docker Compose on operator's homeserver | Builds on existing setup; minimal new infra. |
| D6 | XChaCha20-Poly1305 + commit tag | 192-bit nonces safe under random selection across years and devices; partitioning-oracle defense. |
| D7 | X25519 sealed-box envelopes | 80 bytes, fast, libsodium-native. |
| D8 | Argon2id 64MB/t=3/p=1 | ~500ms on target devices; OWASP-aligned for our use case (last-line recovery, not server password). |
| D9 | Whole-record AEAD | Per-field framing overhead too high at our record sizes; LWW works fine on cleartext metadata. |
| D10 | Length-prefixed AAD (not JSON/CBOR) | Unambiguous, trivially portable between Go and JS, no canonicalization bugs. |
| D11 | Opaque server-stored session tokens | Per-device revocation is a spec requirement; JWT would require a denylist anyway. |
| D12 | sqlc + goose + slog + caarlos0/env + validator | Minimal, no-magic standard Go stack. |
| D13 | No SMTP, no metrics, no tracing, no message queue in v1 | Avoid premature complexity; revisit per signal. |
| D14 | Per-record version byte = 0x01 (v1 suite) | Forward-compat for v2 cipher migration. |
| D15 | Background sync every ~4h via Periodic Background Sync | Reliability over freshness, per user preference. |
| D16 | Sync indicator: Settings header + Overview chip | Per user preference. |
| D17 | `addedBy` + `lastEditedBy` cleartext, visible only on tx detail "Authors" tap | Per user preference. |
| D18 | No background sync on iOS (no PBS API) | Browser limitation; foreground catch-up + in-app banners. |
| D19 | Snapshot dedup keyed by `(recordId, version)` | Ciphertext-hash dedup fails because every save uses a fresh nonce. |
| D20 | All crypto in a Web Worker | Keeps private keys & familyKey off the main thread; UI never sees raw key bytes. |

### 14.2 Mapping back to BR §2 open questions

Every open question in `business-requirements.md` §2 is resolved:

- ✅ Conflict resolution edge cases → §7.6
- ✅ Root admin handoff mechanism → §8.13
- ✅ Background sync cadence → §8.5 + D15
- ✅ Sync indicator placement → §9.4 + D16
- ✅ Identity in shared transactions → D17, §9.5
- ✅ Email infrastructure (none in v1) → D13
- ✅ Cipher choices → §7.1-§7.4 + D6-D8, D10
- ✅ Payload granularity → §7.5 + D9
- ✅ Hard removal design → §8.10 (designed, deferred)
- ✅ Quota worst-case math → §7.7
- ✅ Migration-batch atomicity protocol → §8.4

---

## 15. Glossary

Extends `business-requirements.md` §5; only adds architecture-specific terms.

- **AAD** — Authenticated Additional Data. Cleartext metadata bound cryptographically to a ciphertext via the AEAD; tampering with AAD makes the ciphertext fail to decrypt.
- **AEAD** — Authenticated Encryption with Associated Data. The cipher style used here: encrypts payload + authenticates AAD.
- **Blob** — a ciphertext row in the `blobs` table. Carries `[version|nonce|commit_tag|ciphertext|poly_tag]`.
- **Bootstrap admin** — the user whose email matches `BOOTSTRAP_ADMIN_EMAIL` at startup; auto-promoted to root.
- **Commit tag** — 32-byte HMAC-SHA256 prepended to AEAD output; defends against partitioning oracle attacks.
- **Cursor** — opaque sync cursor. Internally a per-family monotonic `family_seq` integer.
- **Device envelope** — `crypto_box_seal(familyKey, devicePubKey)`. 80 bytes. One per active device.
- **Envelope A** (recovery wrap) — `AEAD(KDF(phrase), familyKey)`. Used for cold recovery after all devices are lost.
- **Envelope B** (phrase ciphertext) — `AEAD(familyKey, phrase)`. Used by a signed-in device to *re-view* the phrase after Google re-auth.
- **family_seq** — per-family monotonic counter that drives the sync cursor.
- **Goose migration** — `*.sql` file with `-- +goose Up` / `-- +goose Down` sections; ordered numerically.
- **LWW** — Last-Write-Wins. Per-field timestamps determine which client's value survives a conflict.
- **PBS** — Periodic Background Sync. Browser API that lets installed PWAs wake periodically. Chromium/Android only.
- **ProblemDetails** — RFC 9457 JSON error format used for all 4xx/5xx.
- **Recovery envelope** — colloquial for Envelope A.
- **Sealed box** — libsodium's anonymous-encryption construction: sender uses recipient's public key + an ephemeral keypair; recipient decrypts with their private key. No sender authentication (irrelevant here — the envelope is server-stored).
- **Sequence cursor** — see `family_seq` and Cursor.
- **Sliding session** — session token rotates every 24h of use; cookie max-age is 30d sliding.
- **slog** — Go 1.21+ stdlib structured logging.
- **sqlc** — codegen tool: reads `schema.sql` + `queries.sql`, emits typed Go.
- **Suite version** — single byte at offset 0 of every blob identifying the crypto suite. v1 = `0x01`.
- **VAPID** — Voluntary Application Server Identification (RFC 8292). The standard for Web Push authentication.
- **VACUUM INTO** — SQLite command producing a consistent compact copy of the entire DB into a target file.
- **WAL** — Write-Ahead Log mode in SQLite. Enables concurrent readers with a single writer.

---

*End of architecture document.*

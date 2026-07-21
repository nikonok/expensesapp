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
    usage_bytes     INTEGER NOT NULL DEFAULT 0,  -- maintained incrementally; reconciled nightly
    recovery_created_at TEXT                  -- opaque, client-supplied createdAt bound into
                                               -- the recovery-envelope AAD; verbatim, never
                                               -- reformatted. NULL falls back to created_at.
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
    id                  TEXT PRIMARY KEY,         -- UUID v7
    device_id           TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash          BLOB NOT NULL UNIQUE,     -- SHA-256(opaque token); 32 bytes
    previous_token_hash BLOB,                     -- SHA-256(previous token); accepted for one rotation grace window (B4d)
    created_at          TEXT NOT NULL,
    last_used_at        TEXT NOT NULL,
    revoked_at          TEXT
);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_previous_token_hash ON sessions(previous_token_hash) WHERE previous_token_hash IS NOT NULL AND revoked_at IS NULL;

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
    added_by_user   TEXT REFERENCES users(id),  -- captured from record_meta at snapshot
                                                 -- time; restore must reapply these verbatim
                                                 -- (they are bound into the blob's AAD).
    edited_by_user  TEXT REFERENCES users(id),
    PRIMARY KEY (snapshot_id, record_id)
);

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

-- ─────────────────────────── migrations (solo-to-family idempotency) ─────────

CREATE TABLE migrations (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    source_family_id TEXT,
    target_family_id TEXT NOT NULL,
    record_count    INTEGER NOT NULL,
    committed_at    TEXT NOT NULL
);
CREATE INDEX idx_migrations_user ON migrations(user_id);

-- ─────────────────────────── support_logs ────────────────────────────

CREATE TABLE support_logs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload    BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_support_logs_user ON support_logs(user_id);

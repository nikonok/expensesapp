-- name: Ping :one
SELECT 1 AS ok;

-- ----- users -----

-- name: UpsertUserByEmail :one
-- Insert a new user or update display_name/google_sub/last_signin_at on existing row.
-- Returns the row including the id (preserved on update).
INSERT INTO users (id, email, google_sub, display_name, is_admin, is_root, promoter_id, suspended_at, delete_after, created_at, last_signin_at)
VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, NULL, ?, ?)
ON CONFLICT(email) DO UPDATE SET
    google_sub = excluded.google_sub,
    display_name = excluded.display_name,
    last_signin_at = excluded.last_signin_at
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = ? COLLATE NOCASE LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = ? LIMIT 1;

-- name: MarkUserSuspended :exec
UPDATE users SET suspended_at = ? WHERE id = ?;

-- name: UnsuspendUser :exec
UPDATE users SET suspended_at = NULL WHERE id = ?;

-- name: PromoteUserToAdmin :exec
UPDATE users SET is_admin = 1, promoter_id = ? WHERE id = ?;

-- name: DemoteAdmin :exec
UPDATE users SET is_admin = 0 WHERE id = ?;

-- name: SetUserAsRoot :exec
UPDATE users SET is_root = 1, is_admin = 1, promoter_id = NULL WHERE id = ?;

-- name: DowngradeFromRoot :exec
UPDATE users SET is_root = 0, is_admin = 0 WHERE id = ?;

-- name: GetCurrentRoot :one
SELECT * FROM users WHERE is_root = 1 LIMIT 1;

-- name: ReparentPromoter :exec
-- Move all users whose promoter_id = old_promoter_id to a new promoter (used on demotion/root handoff).
UPDATE users SET promoter_id = ? WHERE promoter_id = ?;

-- ----- allowlist -----

-- name: IsEmailAllowed :one
SELECT EXISTS(SELECT 1 FROM allowlist WHERE email = ? COLLATE NOCASE) AS allowed;

-- name: AddAllowlistEntry :exec
INSERT INTO allowlist (email, added_by, added_at, note) VALUES (?, ?, ?, ?)
ON CONFLICT(email) DO NOTHING;

-- name: RemoveAllowlistEntry :exec
DELETE FROM allowlist WHERE email = ? COLLATE NOCASE;

-- name: ListAllowlist :many
SELECT * FROM allowlist ORDER BY added_at DESC;

-- ----- devices -----

-- name: InsertDevice :one
INSERT INTO devices (id, user_id, label, user_agent, pub_key, status, created_at, last_seen_at, revoked_at, revoke_reason)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
RETURNING *;

-- name: GetDeviceByID :one
SELECT * FROM devices WHERE id = ? LIMIT 1;

-- name: ListUserDevices :many
SELECT * FROM devices WHERE user_id = ? AND status IN ('pending','active') ORDER BY created_at DESC;

-- name: RevokeDevice :exec
UPDATE devices SET status = 'revoked', revoked_at = ?, revoke_reason = ? WHERE id = ?;

-- name: TouchDevice :exec
UPDATE devices SET last_seen_at = ? WHERE id = ?;

-- ----- sessions -----

-- name: InsertSession :exec
INSERT INTO sessions (id, device_id, token_hash, created_at, last_used_at, revoked_at)
VALUES (?, ?, ?, ?, ?, NULL);

-- name: GetSessionByTokenHash :one
-- Joins through device -> user so the middleware gets everything in one round trip.
SELECT
    s.id AS session_id,
    s.device_id,
    s.created_at AS session_created_at,
    s.last_used_at,
    d.user_id,
    d.status AS device_status,
    u.email,
    u.display_name,
    u.is_admin,
    u.is_root,
    u.suspended_at
FROM sessions s
JOIN devices d ON d.id = s.device_id
JOIN users u   ON u.id = d.user_id
WHERE s.token_hash = ? AND s.revoked_at IS NULL
LIMIT 1;

-- name: TouchSession :exec
UPDATE sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL;

-- name: RotateSessionToken :exec
UPDATE sessions SET token_hash = ?, last_used_at = ? WHERE id = ? AND revoked_at IS NULL;

-- name: RevokeSession :exec
UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL;

-- name: RevokeAllUserSessions :exec
UPDATE sessions SET revoked_at = ?
WHERE revoked_at IS NULL AND device_id IN (SELECT id FROM devices WHERE user_id = ?);

-- name: RevokeAllDeviceSessions :exec
UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND device_id = ?;

-- ----- bootstrap_state -----

-- name: GetBootstrapState :one
SELECT * FROM bootstrap_state WHERE id = 1 LIMIT 1;

-- name: UpsertBootstrapState :exec
INSERT INTO bootstrap_state (id, bootstrap_email, applied_at) VALUES (1, ?, ?)
ON CONFLICT(id) DO UPDATE SET bootstrap_email = excluded.bootstrap_email, applied_at = excluded.applied_at;

-- ----- audit_log -----

-- name: InsertAuditEntry :exec
INSERT INTO audit_log (id, actor_user_id, actor_email, action, target_kind, target_id, detail_json, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- ----- families -----

-- name: InsertFamily :exec
INSERT INTO families (id, created_at, usage_bytes) VALUES (?, ?, 0);

-- name: InsertFamilyMember :exec
INSERT INTO family_members (family_id, user_id, joined_at, left_at, last_removed_at)
VALUES (?, ?, ?, NULL, NULL);

-- name: InsertDeviceEnvelope :exec
INSERT INTO device_envelopes (device_id, family_id, wrapped_key, version, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: InsertFamilyRecoveryEnvelope :exec
INSERT INTO family_recovery_envelopes (family_id, recovery_wrap, phrase_ct, version, salt, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: InsertFamilySeq :exec
INSERT INTO family_seq (family_id, next_seq) VALUES (?, 1);

-- name: GetActiveFamilyMember :one
-- Returns the active family_members row for a user (left_at IS NULL).
SELECT * FROM family_members WHERE user_id = ? AND left_at IS NULL LIMIT 1;

-- name: GetFamilyByID :one
SELECT * FROM families WHERE id = ? LIMIT 1;

-- ----- blobs -----

-- name: InsertBlob :exec
INSERT INTO blobs (id, family_id, ciphertext, byte_count, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetBlobByID :one
SELECT * FROM blobs WHERE id = ? LIMIT 1;

-- ----- record_meta -----

-- name: GetRecordMeta :one
SELECT * FROM record_meta WHERE record_id = ? LIMIT 1;

-- name: InsertRecordMeta :exec
INSERT INTO record_meta (record_id, family_id, record_type, blob_id, version,
    added_by_user, edited_by_user, updated_at_map, deleted_at,
    family_seq, created_at, last_modified_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: UpdateRecordMeta :exec
UPDATE record_meta
SET blob_id = ?, version = ?, edited_by_user = ?,
    updated_at_map = ?, deleted_at = ?,
    family_seq = ?, last_modified_at = ?
WHERE record_id = ?;

-- name: ListRecordsSinceSeq :many
-- Returns records for a family with family_seq > afterSeq, ordered by family_seq ASC.
SELECT
    rm.record_id,
    rm.record_type,
    rm.version,
    rm.family_seq,
    rm.updated_at_map,
    rm.deleted_at,
    rm.added_by_user,
    rm.edited_by_user,
    b.ciphertext
FROM record_meta rm
JOIN blobs b ON b.id = rm.blob_id
WHERE rm.family_id = ? AND rm.family_seq > ?
ORDER BY rm.family_seq ASC
LIMIT ?;

-- ----- family_seq -----

-- name: AdvanceFamilySeq :one
-- Atomically claim the next family_seq and return it. Must run inside a write tx.
UPDATE family_seq SET next_seq = next_seq + 1
WHERE family_id = ?
RETURNING next_seq - 1;

-- ----- quota -----

-- name: IncrementFamilyUsage :exec
UPDATE families SET usage_bytes = usage_bytes + ? WHERE id = ?;

-- ----- reauth_challenges -----

-- name: InsertReauthChallenge :exec
INSERT INTO reauth_challenges (nonce, session_id, issued_at, used_at, expires_at)
VALUES (?, ?, ?, NULL, ?);

-- name: GetUnusedReauthChallenge :one
SELECT nonce, session_id, issued_at, used_at, expires_at FROM reauth_challenges
WHERE nonce = ? AND used_at IS NULL LIMIT 1;

-- name: MarkReauthChallengeUsed :exec
UPDATE reauth_challenges SET used_at = ? WHERE nonce = ?;

-- ----- reauth_grants -----

-- name: InsertReauthGrant :exec
INSERT INTO reauth_grants (id, session_id, purpose, expires_at, used_at)
VALUES (?, ?, ?, ?, NULL);

-- name: GetUnusedReauthGrant :one
SELECT id, session_id, purpose, expires_at, used_at FROM reauth_grants
WHERE id = ? AND used_at IS NULL LIMIT 1;

-- name: MarkReauthGrantUsed :exec
UPDATE reauth_grants SET used_at = ? WHERE id = ?;

-- ----- family_recovery_envelopes -----

-- name: GetFamilyRecoveryEnvelope :one
SELECT family_id, recovery_wrap, phrase_ct, version, salt, created_at FROM family_recovery_envelopes
WHERE family_id = ? LIMIT 1;

-- name: ReplaceFamilyRecoveryEnvelope :exec
UPDATE family_recovery_envelopes
SET recovery_wrap = ?, phrase_ct = ?, version = ?, salt = ?
WHERE family_id = ?;

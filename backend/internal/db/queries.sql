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
INSERT INTO sessions (id, device_id, token_hash, previous_token_hash, created_at, last_used_at, revoked_at)
VALUES (?, ?, ?, NULL, ?, ?, NULL);

-- name: GetSessionByTokenHash :one
-- Joins through device -> user so the middleware gets everything in one round trip.
-- Accepts both the current token_hash and the previous_token_hash so a rotated
-- session tolerates one in-flight request still presenting the old token (B4d).
SELECT
    s.id AS session_id,
    s.device_id,
    s.created_at AS session_created_at,
    s.last_used_at,
    s.token_hash,
    s.previous_token_hash,
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
WHERE (s.token_hash = sqlc.arg(token_hash) OR s.previous_token_hash = sqlc.arg(token_hash))
  AND s.revoked_at IS NULL
LIMIT 1;

-- name: TouchSession :exec
UPDATE sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL;

-- name: RotateSessionToken :exec
-- Sets the new token_hash, demotes the existing token to previous_token_hash so
-- one in-flight request can still complete with the old cookie (B4d).
UPDATE sessions
SET previous_token_hash = token_hash,
    token_hash          = sqlc.arg(token_hash),
    last_used_at        = sqlc.arg(last_used_at)
WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: ClearPreviousSessionToken :exec
-- Drops the previous_token_hash once the new token has been observed in use.
UPDATE sessions SET previous_token_hash = NULL WHERE id = ? AND revoked_at IS NULL;

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

-- name: DeleteFamilyCascade :exec
-- Hard-delete a family row. FK ON DELETE CASCADE removes its members, invites,
-- device envelopes, recovery envelope, family_seq, blobs, record_meta, and
-- snapshots in one shot. Used by family.Leave when the last active member
-- leaves (B4f).
DELETE FROM families WHERE id = ?;

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
UPDATE reauth_challenges SET used_at = ? WHERE nonce = ? AND session_id = ?;

-- ----- reauth_grants -----

-- name: InsertReauthGrant :exec
INSERT INTO reauth_grants (id, session_id, purpose, expires_at, used_at)
VALUES (?, ?, ?, ?, NULL);

-- name: GetUnusedReauthGrant :one
SELECT id, session_id, purpose, expires_at, used_at FROM reauth_grants
WHERE id = ? AND used_at IS NULL LIMIT 1;

-- name: MarkReauthGrantUsed :exec
UPDATE reauth_grants SET used_at = ? WHERE id = ? AND session_id = ?;

-- name: ClaimReauthGrant :one
-- Atomically mark the grant as used. Returns the row only if it was unused/unexpired.
-- Prevents TOCTOU: concurrent claims race at DB; only one gets a row back.
UPDATE reauth_grants
SET used_at = ?
WHERE id = ? AND used_at IS NULL AND expires_at > ?
RETURNING id, session_id, purpose, expires_at, used_at

-- ----- family_recovery_envelopes -----

-- name: GetFamilyRecoveryEnvelope :one
SELECT family_id, recovery_wrap, phrase_ct, version, salt, created_at FROM family_recovery_envelopes
WHERE family_id = ? LIMIT 1;

-- name: ReplaceFamilyRecoveryEnvelope :exec
UPDATE family_recovery_envelopes
SET recovery_wrap = ?, phrase_ct = ?, version = ?, salt = ?
WHERE family_id = ?;

-- ----- family_invites -----

-- name: InsertFamilyInvite :exec
INSERT INTO family_invites (id, family_id, invited_by, invitee_email, created_at, expires_at, status, decided_at)
VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL);

-- name: GetFamilyInvite :one
SELECT * FROM family_invites WHERE id = ? LIMIT 1;

-- name: ListIncomingInvites :many
-- Returns pending, non-expired invites for the given invitee email.
SELECT * FROM family_invites
WHERE invitee_email = ? COLLATE NOCASE
  AND status = 'pending'
  AND expires_at > ?
ORDER BY created_at DESC;

-- name: GetPendingInviteForEmail :one
-- Returns an existing pending invite for this family + email combo (for duplicate check).
SELECT * FROM family_invites
WHERE family_id = ? AND invitee_email = ? COLLATE NOCASE AND status = 'pending'
LIMIT 1;

-- name: UpdateInviteStatus :exec
UPDATE family_invites SET status = ?, decided_at = ? WHERE id = ?;

-- ----- family member queries -----

-- name: CountActiveFamilyMembers :one
-- Returns the count of active (left_at IS NULL) members for a family.
SELECT COUNT(*) FROM family_members WHERE family_id = ? AND left_at IS NULL;

-- name: GetFamilyMemberByUserID :one
-- Returns an active (left_at IS NULL) family_members row for given family + user.
SELECT * FROM family_members WHERE family_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1;

-- name: JoinFamily :exec
-- Insert a new active family_members row. Used in invite-accept path.
INSERT INTO family_members (family_id, user_id, joined_at, left_at, last_removed_at)
VALUES (?, ?, ?, NULL, NULL);

-- name: MarkFamilyMemberLeft :exec
-- Soft-leave: set left_at for the given family + user.
UPDATE family_members SET left_at = ? WHERE family_id = ? AND user_id = ? AND left_at IS NULL;

-- name: SetMemberLastRemoved :exec
-- Record the removal timestamp for cool-down tracking.
UPDATE family_members SET left_at = ?, last_removed_at = ? WHERE family_id = ? AND user_id = ?;

-- ----- migrations (solo-to-family idempotency) -----

-- name: InsertMigrationRecord :exec
INSERT INTO migrations (id, user_id, source_family_id, target_family_id, record_count, committed_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: GetMigrationRecord :one
SELECT * FROM migrations WHERE id = ? LIMIT 1;

-- ----- snapshots -----

-- name: InsertSnapshot :exec
INSERT INTO snapshots (id, family_id, snapshot_date, created_at, expires_at)
VALUES (?, ?, ?, ?, ?);

-- name: InsertSnapshotEntry :exec
INSERT INTO snapshot_entries (snapshot_id, record_id, blob_id, record_type, version, updated_at_map)
VALUES (?, ?, ?, ?, ?, ?);

-- name: ListSnapshotsForFamily :many
-- Returns up to 30 most recent snapshots for the family, ordered by snapshot_date DESC.
SELECT id, family_id, snapshot_date, created_at, expires_at FROM snapshots
WHERE family_id = ?
ORDER BY snapshot_date DESC
LIMIT 30;

-- name: GetSnapshotByDate :one
SELECT id, family_id, snapshot_date, created_at, expires_at FROM snapshots
WHERE family_id = ? AND snapshot_date = ?
LIMIT 1;

-- name: ListSnapshotEntries :many
SELECT snapshot_id, record_id, blob_id, record_type, version, updated_at_map
FROM snapshot_entries WHERE snapshot_id = ?;

-- name: DeleteExpiredSnapshots :exec
-- Cascading FK on snapshot_entries handles entry cleanup.
DELETE FROM snapshots WHERE expires_at < ?;

-- name: DeleteOrphanBlobs :exec
-- Delete blobs not referenced by record_meta OR snapshot_entries.
DELETE FROM blobs
WHERE id NOT IN (SELECT blob_id FROM record_meta)
  AND id NOT IN (SELECT blob_id FROM snapshot_entries);

-- name: ListFamilies :many
-- Returns all family IDs (for the daily snapshot job).
SELECT id FROM families ORDER BY id;

-- name: ListNonDeletedRecordMetaForFamily :many
SELECT record_id, blob_id, record_type, version, updated_at_map
FROM record_meta
WHERE family_id = ? AND deleted_at IS NULL;

-- name: ListAllRecordMetaForFamily :many
SELECT record_id, blob_id, record_type, version, updated_at_map,
       deleted_at, added_by_user, edited_by_user, family_seq, created_at, last_modified_at
FROM record_meta
WHERE family_id = ?;

-- ----- push_subscriptions -----

-- name: InsertPushSubscription :exec
INSERT INTO push_subscriptions (id, device_id, endpoint, p256dh, auth, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: ListPushSubscriptionsForUser :many
-- Returns active (non-deleted) push subscriptions for all devices owned by the user.
SELECT ps.id, ps.device_id, ps.endpoint, ps.p256dh, ps.auth,
       ps.created_at, ps.last_success_at, ps.last_failure_at
FROM push_subscriptions ps
JOIN devices d ON d.id = ps.device_id
WHERE d.user_id = ?
  AND (ps.last_failure_at IS NULL OR ps.last_success_at > ps.last_failure_at);

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE id = ?;

-- name: MarkPushSubscriptionSuccess :exec
UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?;

-- name: MarkPushSubscriptionFailure :exec
UPDATE push_subscriptions SET last_failure_at = ? WHERE id = ?;

-- name: ListPushSubscriptionsForDevice :many
SELECT id, device_id, endpoint, p256dh, auth, created_at, last_success_at, last_failure_at
FROM push_subscriptions
WHERE device_id = ?;

-- ----- notification_settings -----

-- name: GetNotificationSettings :one
SELECT user_id, tz, reminder_time, quiet_start, quiet_end,
       daily_reminder, missed_day, family_digest, updated_at
FROM notification_settings
WHERE user_id = ?;

-- name: UpsertNotificationSettings :exec
INSERT INTO notification_settings
    (user_id, tz, reminder_time, quiet_start, quiet_end,
     daily_reminder, missed_day, family_digest, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
    tz             = excluded.tz,
    reminder_time  = excluded.reminder_time,
    quiet_start    = excluded.quiet_start,
    quiet_end      = excluded.quiet_end,
    daily_reminder = excluded.daily_reminder,
    missed_day     = excluded.missed_day,
    family_digest  = excluded.family_digest,
    updated_at     = excluded.updated_at;

-- ----- held_notifications -----

-- name: InsertHeldNotification :exec
INSERT INTO held_notifications (id, user_id, payload, deliver_after, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: ListDueHeldNotifications :many
SELECT id, user_id, payload, deliver_after, created_at
FROM held_notifications
WHERE deliver_after <= ?
ORDER BY deliver_after ASC;

-- name: DeleteHeldNotification :exec
DELETE FROM held_notifications WHERE id = ?;

-- ----- family push helpers -----

-- name: ListActiveUserIDsForFamily :many
-- Returns user IDs of all active family members (left_at IS NULL).
SELECT user_id FROM family_members WHERE family_id = ? AND left_at IS NULL;

-- name: CountRecentChangesForFamily :one
-- Count records modified in the last 24h for digest purposes.
SELECT COUNT(*) FROM record_meta
WHERE family_id = ? AND last_modified_at >= ?;

-- ----- account deletion -----

-- name: SetUserDeleteAfter :one
-- Set delete_after to 14 days from now. Returns the updated user row.
UPDATE users SET delete_after = ? WHERE id = ? RETURNING *;

-- name: SetUserDeleteAfterIfNull :one
-- Conditional UPDATE: only sets delete_after when it is currently NULL.
-- Returns the updated row; sql.ErrNoRows if already set (idempotent TOCTOU guard).
UPDATE users SET delete_after = ?
WHERE id = ? AND delete_after IS NULL
RETURNING *;

-- name: ClearUserDeleteAfter :exec
UPDATE users SET delete_after = NULL WHERE id = ?;

-- name: ListUsersPendingDeletion :many
-- Returns users whose 14-day grace period has elapsed.
SELECT * FROM users WHERE delete_after IS NOT NULL AND delete_after <= ?;

-- name: HardDeleteUser :exec
DELETE FROM users WHERE id = ?;

-- ----- family member soft-leave for purge -----

-- name: SoftLeaveAllFamilies :exec
-- Soft-leave all active family memberships for a user before hard delete.
UPDATE family_members SET left_at = ? WHERE user_id = ? AND left_at IS NULL;

-- ----- support_logs -----

-- name: InsertSupportLog :exec
INSERT INTO support_logs (id, user_id, payload, created_at) VALUES (?, ?, ?, ?);

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

-- name: SetDevicePendingByID :exec
-- Moves an already-active device back to 'pending', requiring an existing
-- family member to wrap a fresh key envelope for it before it may sync
-- push/pull again. Used when a device gains membership in a family whose
-- key it does not yet hold (e.g. accepting a family invite).
UPDATE devices SET status = 'pending' WHERE id = ? AND status = 'active';

-- name: UpdateDevicePubKey :exec
-- Overwrites a device's stored public key. Used when a solo device (created
-- without a family, hence no X25519 key) later joins a family and supplies
-- its keypair for the first time.
UPDATE devices SET pub_key = ? WHERE id = ?;

-- name: DeleteDevicesByUser :exec
-- Cascades sessions (-> reauth_challenges/reauth_grants), device_envelopes, and
-- push_subscriptions via their ON DELETE CASCADE FKs to devices(id)/sessions(id).
-- Used by account purge for both the hard-delete and the PII-scrub path.
DELETE FROM devices WHERE user_id = ?;

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
    d.last_seen_at AS device_last_seen_at,
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
-- recovery_created_at is the opaque, client-supplied createdAt bound into the
-- recovery-envelope AAD (B9/B10); NULL when the client did not supply one
-- (legacy clients), in which case callers fall back to families.created_at.
INSERT INTO families (id, created_at, usage_bytes, recovery_created_at) VALUES (?, ?, 0, ?);

-- name: SetFamilyRecoveryCreatedAt :exec
-- Allows updating recovery_created_at when a new recovery envelope is stored
-- (regenerate path), if the request carries a createdAt value.
UPDATE families SET recovery_created_at = ? WHERE id = ?;

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

-- name: ListActiveFamilyIDsForUser :many
-- Returns family_ids the user is currently an active member of. Used by
-- account purge to find families that may become empty once this user
-- soft-leaves, so they can be cascade-deleted (data-retention requirement).
SELECT family_id FROM family_members WHERE user_id = ? AND left_at IS NULL;

-- name: GetFamilyByID :one
SELECT * FROM families WHERE id = ? LIMIT 1;

-- name: DeleteFamilyCascade :exec
-- Hard-delete a family row. FK ON DELETE CASCADE removes its members, invites,
-- device envelopes, recovery envelope, family_seq, blobs, record_meta, and
-- snapshots in one shot. Used by family.Leave when the last active member
-- leaves (B4f), and by account purge when a user's departure empties a family.
DELETE FROM families WHERE id = ?;

-- ----- blobs -----

-- name: InsertBlob :exec
INSERT INTO blobs (id, family_id, ciphertext, byte_count, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetBlobByID :one
SELECT * FROM blobs WHERE id = ? LIMIT 1;

-- ----- record_meta -----

-- name: GetRecordMeta :one
-- Family-scoped: record_id is a client-supplied UUID and record_meta.record_id
-- is a global PRIMARY KEY, so a lookup that ignores family_id would let one
-- family read another family's record via a guessed/reused recordId. Always
-- scope by the caller's family_id; a record_id that exists but belongs to a
-- different family must look identical to "not found" here.
SELECT * FROM record_meta WHERE record_id = ? AND family_id = ? LIMIT 1;

-- name: RecordIDExistsInAnyFamily :one
-- Used to reject a cross-family record_id collision at insert time (before it
-- would otherwise hit the record_meta PRIMARY KEY(record_id) and surface as a
-- generic DB error). Deliberately does NOT reveal which family owns it.
SELECT EXISTS(SELECT 1 FROM record_meta WHERE record_id = ?) AS record_exists;

-- name: InsertRecordMeta :exec
INSERT INTO record_meta (record_id, family_id, record_type, blob_id, version,
    added_by_user, edited_by_user, updated_at_map, deleted_at,
    family_seq, created_at, last_modified_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: UpdateRecordMeta :exec
-- Family-scoped for the same reason as GetRecordMeta above.
UPDATE record_meta
SET blob_id = ?, version = ?, edited_by_user = ?,
    updated_at_map = ?, deleted_at = ?,
    family_seq = ?, last_modified_at = ?
WHERE record_id = ? AND family_id = ?;

-- name: UpdateRecordMetaFamily :exec
-- Same as UpdateRecordMeta, but also rewrites family_id. Used by MigrateSolo
-- to move an existing record's ownership row from the caller's solo
-- (source) family into the target family it is migrating into -- otherwise
-- the row would keep pointing at the old family_id even though its blob
-- and family_seq have already moved to the target. The WHERE clause still
-- scopes the lookup by the record's CURRENT (source) family_id for the same
-- anti-collision reason as GetRecordMeta above; sqlc.arg names disambiguate
-- the two family_id occurrences.
UPDATE record_meta
SET family_id       = sqlc.arg(new_family_id),
    blob_id         = sqlc.arg(blob_id),
    version         = sqlc.arg(version),
    edited_by_user  = sqlc.arg(edited_by_user),
    updated_at_map  = sqlc.arg(updated_at_map),
    deleted_at      = sqlc.arg(deleted_at),
    family_seq      = sqlc.arg(family_seq),
    last_modified_at = sqlc.arg(last_modified_at)
WHERE record_id = sqlc.arg(record_id) AND family_id = sqlc.arg(old_family_id);

-- name: CountRecordMetaRefsForUser :one
-- Counts record_meta rows (across all families) that still reference userID
-- as added_by_user or edited_by_user. record_meta has NO ON DELETE clause on
-- those FKs (RESTRICT), and rewriting them would break the AAD binding on the
-- referenced blob, so account purge uses this to decide hard-delete vs a
-- PII-scrubbed tombstone.
SELECT COUNT(*) FROM record_meta
WHERE added_by_user = sqlc.arg(user_id) OR edited_by_user = sqlc.arg(user_id);

-- name: CountSnapshotEntryRefsForUser :one
-- Counts snapshot_entries rows that still reference userID as added_by_user
-- or edited_by_user. Those columns have NO ON DELETE clause (see migration
-- 00005) and are captured verbatim from record_meta at snapshot time, bound
-- into the referenced blob's AAD (see InsertSnapshotEntry) -- rewriting them
-- would make the ciphertext undecryptable, same constraint as record_meta.
-- Expired snapshots are removed by DeleteExpiredSnapshots, which cascades to
-- their entries via snapshot_entries.snapshot_id ON DELETE CASCADE, so a
-- plain COUNT(*) here already reflects only live (non-expired) snapshots.
-- Account purge ORs this into the same hard-delete-vs-scrub decision as
-- CountRecordMetaRefsForUser.
SELECT COUNT(*) FROM snapshot_entries
WHERE added_by_user = sqlc.arg(user_id) OR edited_by_user = sqlc.arg(user_id);

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

-- name: ReconcileFamilyUsageBytes :exec
-- Recomputes usage_bytes for every family from the live sum of blobs.byte_count,
-- correcting any drift left by incremental updates (e.g. PruneOrphanBlobs
-- deletes rows without decrementing usage_bytes). Self-healing; safe to run
-- repeatedly on a schedule.
UPDATE families
SET usage_bytes = COALESCE((SELECT SUM(b.byte_count) FROM blobs b WHERE b.family_id = families.id), 0);

-- ----- reauth_challenges -----

-- name: InsertReauthChallenge :exec
INSERT INTO reauth_challenges (nonce, session_id, issued_at, used_at, expires_at)
VALUES (?, ?, ?, NULL, ?);

-- name: GetUnusedReauthChallenge :one
SELECT nonce, session_id, issued_at, used_at, expires_at FROM reauth_challenges
WHERE nonce = ? AND used_at IS NULL LIMIT 1;

-- name: MarkReauthChallengeUsed :exec
UPDATE reauth_challenges SET used_at = ? WHERE nonce = ? AND session_id = ?;

-- name: DeleteOldReauthChallenges :exec
-- Periodic cleanup: reauth_challenges have a 60s TTL, but expired/used rows are
-- never otherwise removed. cutoff is normally "now - 24h".
DELETE FROM reauth_challenges WHERE expires_at < ?;

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
RETURNING id, session_id, purpose, expires_at, used_at;

-- name: DeleteOldReauthGrants :exec
-- Periodic cleanup: reauth_grants have a 60s TTL, but expired/used rows are
-- never otherwise removed. cutoff is normally "now - 24h".
DELETE FROM reauth_grants WHERE expires_at < ?;

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

-- name: DeleteMigrationsByUser :exec
-- Removes solo-to-family migration idempotency records for the user. Called
-- during account purge (both hard-delete and PII-scrub paths); these rows
-- also have a NOT NULL FK to users(id) with no ON DELETE clause.
DELETE FROM migrations WHERE user_id = ?;

-- ----- snapshots -----

-- name: InsertSnapshot :exec
INSERT INTO snapshots (id, family_id, snapshot_date, created_at, expires_at)
VALUES (?, ?, ?, ?, ?);

-- name: InsertSnapshotEntry :exec
-- added_by_user/edited_by_user are captured verbatim from record_meta at
-- snapshot time so restore can reapply them (they are bound into the blob's
-- AAD; rewriting them to the restoring caller would make the ciphertext
-- undecryptable).
INSERT INTO snapshot_entries (snapshot_id, record_id, blob_id, record_type, version, updated_at_map, added_by_user, edited_by_user)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

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
SELECT snapshot_id, record_id, blob_id, record_type, version, updated_at_map, added_by_user, edited_by_user
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
SELECT record_id, blob_id, record_type, version, updated_at_map, added_by_user, edited_by_user
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

-- name: ListNotificationSettingsForDigest :many
-- Returns users with an eligible reminder configured, for the hourly digest-push job.
SELECT user_id, tz, reminder_time, daily_reminder, family_digest
FROM notification_settings
WHERE (daily_reminder = 1 OR family_digest = 1)
  AND reminder_time IS NOT NULL;

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

-- name: ScrubUserPII :exec
-- Replaces PII on a user row without deleting it, for a user whose
-- record_meta references (added_by_user/edited_by_user) still survive in a
-- shared family; those FKs have no ON DELETE clause, and rewriting the
-- referenced record_meta rows would break their AAD binding. Keeps the row
-- (and its id) alive as a scrubbed tombstone instead of hard-deleting it.
UPDATE users
SET email = ?, display_name = ?, google_sub = NULL, is_admin = 0, is_root = 0,
    promoter_id = NULL, suspended_at = NULL, delete_after = NULL
WHERE id = ?;

-- ----- family member soft-leave for purge -----

-- name: SoftLeaveAllFamilies :exec
-- Soft-leave all active family memberships for a user before hard delete.
UPDATE family_members SET left_at = ? WHERE user_id = ? AND left_at IS NULL;

-- ----- pre-purge cleanup for non-CASCADE FKs -----

-- name: DeleteAllowlistByAddedBy :exec
-- Removes allowlist entries added by the given user.
-- Called before HardDeleteUser to satisfy the RESTRICT FK.
DELETE FROM allowlist WHERE added_by = ?;

-- name: DeleteFamilyInvitesByInvitedBy :exec
-- Removes pending invites created by the user.
DELETE FROM family_invites WHERE invited_by = ?;

-- ----- support_logs -----

-- name: InsertSupportLog :exec
INSERT INTO support_logs (id, user_id, payload, created_at) VALUES (?, ?, ?, ?);

-- ----- admin: user list -----

-- name: ListAdminUsers :many
SELECT
    u.id,
    u.email,
    u.display_name,
    u.last_signin_at,
    u.suspended_at,
    u.is_admin,
    u.is_root,
    u.promoter_id,
    u.delete_after,
    COALESCE(f.usage_bytes, 0)           AS usage_bytes,
    COUNT(DISTINCT CASE WHEN fm.left_at IS NULL THEN fm.user_id END) AS family_member_count,
    COUNT(DISTINCT d.id)                 AS device_count,
    CASE WHEN fre.family_id IS NOT NULL THEN 1 ELSE 0 END AS has_recovery_code
FROM users u
LEFT JOIN family_members fm2 ON fm2.user_id = u.id AND fm2.left_at IS NULL
LEFT JOIN families f          ON f.id = fm2.family_id
LEFT JOIN family_members fm   ON fm.family_id = fm2.family_id AND fm.left_at IS NULL
LEFT JOIN devices d            ON d.user_id = u.id AND d.status IN ('pending','active')
LEFT JOIN family_recovery_envelopes fre ON fre.family_id = fm2.family_id
GROUP BY u.id
ORDER BY u.created_at DESC
LIMIT ? OFFSET ?;

-- ----- admin: audit log -----

-- name: ListAuditLog :many
SELECT id, actor_user_id, actor_email, action, target_kind, target_id, detail_json, created_at
FROM audit_log
WHERE (id < sqlc.narg(after_id) OR sqlc.narg(after_id) IS NULL)
ORDER BY id DESC
LIMIT sqlc.arg(limit);

-- ----- admin: get promoter chain for subtree check -----

-- name: GetUserPromoterID :one
-- Returns the promoter_id for a user. Used for subtree walks.
SELECT promoter_id FROM users WHERE id = ? LIMIT 1;

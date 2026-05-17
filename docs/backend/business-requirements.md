# Expenses App — Backend Business Requirements

> Status: **Business requirements gathered. Ready for technical design.**
> Last updated: 2026-05-16

## Table of contents

1. [Background & Goal](#1-background--goal)
2. [Open questions for the technical phase](#2-open-questions-for-the-technical-phase)
3. [Decisions (confirmed)](#3-decisions-confirmed) — the full spec, organized by topic
4. [Non-goals (v1)](#4-non-goals-v1)
5. [Glossary](#5-glossary)

## TL;DR

The backend is a **self-hosted Go 1.26 service** for a small private user base (Anton, family, friends — EU, primarily Poland). All four features (Google sign-in, cloud backup, push notifications, family sharing) ship together in v1.

Key shape:

- **Access:** Google Sign-In only, gated by an admin-managed allowlist. Bootstrap admin set via env var; admins form a delegated promotion tree. Admins cannot see user data — only metadata.
- **Sync:** Continuous, real-time when app is foreground; periodic in background. Offline-first; conflicts resolved by last-write-wins per field, with toast on override.
- **Backup:** 200 MB per user; covers ≥ 5 years. Daily snapshots retained for 30 days for point-in-time recovery. Hitting quota blocks new uploads with a clean nudge banner.
- **Family:** Co-equal household model, max 6 members, one family per user, full data sharing (no private). Invites are in-app + push, blocked if invitee isn't on the allowlist.
- **Notifications:** Per-user time + quiet hours. Backup/sync warnings mandatory; daily reminder, missed-day reminder, family-activity digest are opt-in.
- **Sessions:** Last forever; silent refresh; revocable per-device from Settings.
- **Data protection:** **End-to-end encryption from v1**. All data — including foreign keys and the relationship graph — is encrypted client-side with a per-family key. Server stores only ciphertext + a tightly-scoped cleartext metadata set (recordId, recordType, familyId, userId, timestamps, byte counts, version bytes, AEAD nonce/tag, emails, device labels). Onboarding includes a 24-word recovery code (re-viewable only after a fresh Google reauth). Cost: lost-all-devices-and-recovery-code = unrecoverable data; hard family removal (with key rotation) deferred to v1.1+; soft removal in v1 carries a 24h cool-down to prevent removal-thrash.
- **Out of scope:** receipt photos, public API, webhooks, email/password, content-search.

---

## 1. Background & Goal

The Expenses App is currently a **client-only PWA** (React 19 + IndexedDB via Dexie). All data lives in the browser.

We want to add a **Go 1.26 backend** to enable four new capabilities:

1. **Server-pushed notifications** — backup reminders, missing-transaction nudges (Android primary, iOS secondary).
2. **Account registration** — Google Sign-In only; no email/password; transparent credential refresh.
3. **Cloud backup** — size-limited per user; must hold ≥ 5 years of data; user is notified when limit is reached.
4. **Family sharing** — multiple users co-edit shared accounts/transactions, acting as one logical database.

---

## 2. Open questions for the technical phase

Most business decisions are locked in (see § 3). A few items remain for the technical phase to resolve:

- **Conflict resolution edge cases.** Are any fields unsafe for naive last-write-wins per field? (Balances are recomputed and should be fine, but to be reviewed.)
- **Root admin handoff.** How does the bootstrap admin hand off to a new root admin (env config change + runtime command)? What happens to the existing promotion tree?
- **Background sync cadence.** Exact polling interval when the app is closed/inactive (minutes? hours? once a day?). To be tuned with battery/data trade-off in mind.
- **Sync indicator placement.** Where exactly in the UI does "last synced X ago" live — Settings header, Overview chip, both?
- **Identity in shared transactions.** Should family transactions visibly tag who added them ("added by Anna")? Useful for accountability; minor UI work.
- **Email infrastructure.** Currently zero email is needed (v1 uses in-app + push). Confirm no near-term feature requires it.
- **Cipher choices.** Symmetric algorithm (AES-256-GCM vs XChaCha20-Poly1305), key-derivation function and parameters for the recovery code (Argon2id with what cost?), asymmetric primitive for device envelopes (X25519 vs RSA). All technical-phase decisions; § 3.32 cryptographic invariants lock the business shape.
- **Payload granularity.** Whole-record encryption (one ciphertext per record, decrypt to get all fields) vs per-field encryption (decrypt only what's needed). Both work for the spec; tech-phase decision based on perf and update granularity.
- **Hard removal design (for v1.1+).** Already known to need key rotation; specifics deferred until v1 ships.
- **Quota worst-case math validation.** With per-record AEAD overhead, dedup'd 30-day snapshots, 90-day tombstones, and a 6-member family editing actively for 5 years — verify the 200 MB ceiling actually holds.
- **Migration-batch atomicity protocol.** Wire-format details for the "move solo data into family" transactional upload (§ 3.9).

---

## 3. Decisions (confirmed)

### 3.1 Tech direction

- Backend language: **Go 1.26**
- Auth: **Google Sign-In only** (no email/password)
- Backup must hold **≥ 5 years** of transaction history
- Limit-reached state must be **surfaced to the user**
- **Performance bias: read-optimized.** Reads (list views, balance lookups, sync pull) are the hot path and must be fast. Writes can complete asynchronously in the background; brief write-path latency is acceptable as long as the local optimistic update is immediate.

### 3.2 Distribution & monetization

- **Self-hosted**, not a SaaS. Single deployment, operated by Anton.
- **Fully free** to its users — no tiers, no payments.
- **Not for sale or public distribution.** Intended users: Anton, wife, friends.
  → Implication: backend must support access control (allowlist), not open sign-up.

### 3.3 Audience

- **Solo and family use are equally first-class.** Family sharing is a core feature, not an upsell.

### 3.4 Geography & compliance

- **Phase 1:** EU only, mainly Poland.
- **Phase 2:** Add Belarus.
- Compliance posture: pragmatic. Not a regulated product, but follow GDPR-style hygiene (data is the user's, deletable on request, end-to-end encrypted per § 3.32).

### 3.5 Release scope

- **No MVP slicing.** All four features (auth, backup, push, family sharing) ship together in v1.
- Reason: this is a personal/private product, no need to phase to validate market.
- **Version reset.** No production data exists yet — all version identifiers (app version, PWA manifest/service-worker, DB schema) are reset to v1 for the release. No frontend-schema upgrade path is required from prior dev builds.

### 3.6 Access control

- **Cloudflare Zero Trust** sits in front of the app today, but the backend MUST enforce its own access control independently — removing Cloudflare must require zero code changes.
- A **bootstrap admin email** is set via startup config (env var). On first boot, that user becomes the **root admin**.
- Sign-in flow: Google auth → backend checks email against allowlist → grant or refuse with a clean message.
- **User profile.** The user's display name is initially taken from their Google profile and can be edited from Settings. Email is fixed (it's the allowlist key and the user's identity).

#### Admin panel capabilities

- Manage **allowlist** of Google emails permitted to sign in.
- **View users & status**: list, last sign-in, suspended state, **current storage usage in %**.
- **Suspend / unsuspend** users (blocks sign-in without removing them from allowlist).
- View server-side **audit log** of admin/auth events.
- **Promote / demote admins** under a delegated-trust tree (see below).
- **Admins CANNOT see user data** (transactions, account balances, notes, money values). Only metadata: emails, timestamps, storage usage %, family membership counts. This is a privacy invariant.

#### Admin promotion tree (delegated trust)

- The bootstrap admin (root, set via env var) is the apex.
- Each admin promotion creates a parent → child edge: if A promotes B, A is B's promoter.
- An admin can demote **anyone in their own subtree** (transitively — direct or via intermediate admins).
- An admin **cannot** demote their parent, ancestors, or peers.
- Example: A1 (root) → A2 → A3. A1 can demote A2 and A3. A2 can demote A3 only. A3 can demote no one.
- Open questions to lock down later:
  - When an admin is demoted, what happens to the admins they promoted (subtree)? Cascade demote, or re-parent to the demoter? _(Resolved in § 3.17 — re-parent to demoter.)_
- **Bootstrap email change grants no decryption capability.** Changing the bootstrap admin email at runtime only affects access-control/promotion-tree rights. Under E2EE (§ 3.32) the server holds no plaintext, so no admin action — including swapping the root admin — gains the ability to read user data.

#### Bootstrap admin recovery

The root admin's Google account could theoretically be deleted/disabled by Google, locking out the only person who can manage the allowlist and admin tree. Mitigation is **operator-side, not in-app**:

- The `.env` file MUST support **changing the bootstrap admin email** by editing it and restarting the service.
- On startup, the backend reads the configured bootstrap email and treats that user as root. The previous root (different email) is automatically downgraded to a regular user (or removed entirely if no longer on the allowlist).
- Any admins the previous root had promoted remain admins; their tree re-parents to the new root (treated as a promotion tree edit).
- No automatic failover — this is a deliberate operator action requiring shell access to the host.
- **Documented operator risk.** If the operator both loses access to the bootstrap Google account AND cannot access the host to edit `.env`, the deployment is bricked. For a single-operator self-hosted setup, the operator owns this risk.

### 3.7 Online/offline behavior

- App must remain fully usable **without an account** (local-only, no cloud backup). No forced sign-in.
- When the user signs in and enables backup, all local data is **uploaded to the cloud** (first sync).
- App must remain fully usable **offline while signed in** — changes are saved locally and sync to the server when connectivity returns.
- Backup model: **continuous sync** (server is canonical when online; client is canonical when offline).
- No existing production data — we can ignore migration of pre-existing local data; test data may be dropped freely.

### 3.8 Family sharing — scope

- **Full sharing, no private data.** When two users are in the same family, they see and edit the same accounts, transactions, categories, budgets. There is no "personal" carve-out within a family.

### 3.9 Family sharing — lifecycle

- **Invite flow:** in-app invite by email. User A opens family settings, types user B's email, sends invite. User B sees a pending invite on next app open and accepts/declines. The server stores a pending-invite record and notifies B's devices (push + in-app).
- **Pending invite expiration:** **30 days.** After 30 days without accept/decline, the invite auto-expires and is removed from B's pending list. A can re-issue.
- **Invitee suspended or de-allowlisted mid-flow:** any pending invite for a user who is then suspended (§ 3.6) or removed from the allowlist (§ 3.27) is automatically **voided**. The inviter sees _"Invite expired — recipient's access has been revoked."_
- **Accepting an invite — solo-data handling:** when User B accepts and B already has solo data of their own, B is shown a dialog: **"Joining Anton's family. You currently have X accounts and Y transactions. Move them into the shared family, discard them, or cancel?"**
  - **Move:** B's device decrypts its solo data with B's solo family key, re-encrypts it under A's family key, uploads. Solo key is retired.
  - **Discard:** B's solo data is deleted (after a soft-delete grace per existing rules); B's view becomes the family's view.
  - **Cancel:** invite remains pending; nothing changes.
- **Move atomicity.** The move-into-family migration MUST be all-or-nothing from B's perspective. The client uploads under a single server-side transactional "migration batch" that commits atomically or rolls back; B's solo key is retired ONLY after the server acknowledges full commit. Interrupted migrations are resumable. ID collisions with existing family records are resolved by re-issuing fresh IDs on B's side before upload.
- **Key exchange on accept:** A's device wraps the family key for each of B's signed-in devices using their public keys, uploads envelopes. B's devices unwrap on next sync. The server never sees the family key. A must be online at some point for the wrapping to happen.
- **Race: two devices create a family simultaneously.** If two of a user's devices both try to create a family from solo state at the same time (e.g. both come online after offline solo use), the **first server-acknowledged `CREATE_FAMILY` request wins**. The losing device sees an error, refreshes from the server, and re-runs the move/discard dialog to reconcile its local solo data.
- **Leaving / removal:** on leave (voluntary or kicked), the family's data stays intact with the remaining members. The leaver is shown a dialog: **"Take a copy of the data with you, or walk away clean?"** — if they take a copy, a snapshot is restored to their local space using their newly-derived solo key; if they walk away, their local state becomes empty.
- **Removal mechanics:** see § 3.33 — v1 ships **soft removal** (session + envelope revoke). Hard removal with key rotation is a v1.1+ follow-up.

### 3.10 Multi-device per user

- **No hard limit** on simultaneous active sessions.
- Settings screen shows **list of active devices** with device label, last-used timestamp, and a **per-device "Sign out" button**.
- Signing out a device revokes its tokens server-side AND deletes its envelope (E2EE — the device cannot decrypt new data even if it returns). Local cached data on the device remains readable until the device wipes itself on next sync attempt.
- **Stale envelopes are garbage-collected.** When a device is signed out, suspended, or revoked, its envelope is purged. Dead push tokens (delivery-failure responses from FCM/APNS) are GC'd on first failure.
- **Adding a new device:**
  - There should be info screen saying that user should open app on another device to continue (it shoudn't be blocking, but should communicated)
  - **If at least one existing device is "available"**, that device wraps the family key for the new device and uploads the envelope. New device unwraps and syncs. Silent UX. "Available" means actively foregrounded or with a live socket — backgrounded mobile PWAs are NOT reliably available. If wrapping does not complete within **30 seconds**, the flow falls back to recovery code (next bullet).
  - **If no existing device is available** (or the 30s timeout fires), the new device prompts the user for their **recovery code**. Entering it lets the new device derive the unwrap key, fetch the recovery envelope, and reconstruct the family key. The new device then issues its own envelope so future devices can be added silently.
- **Device join security alert:** see § 3.34. Whenever any new device joins, all other devices get a push + in-app banner with a one-tap revoke.
- Each device should get human readable ID derived from the devices name and sign in date, like "Samsung Galaxy S23 (2023-01-01)" or "MacBook Pro (2023-01-01)". That is required for UI/UX only

### 3.11 Conflict resolution

- **Last-write-wins per field.** Each editable field on a record (transaction, account, category, budget) has its own `updatedAt` per field. On sync, the server **compares timestamps only** and keeps the entry with the latest one. The server never decrypts field values — `updatedAt` is part of the cleartext metadata while field values themselves are ciphertext.
- **Metadata authenticity (anti-tampering).** Because `updatedAt`, record ID, record type, family ID, and prior-version pointer are stored in cleartext for the server to use, they MUST be authenticated as **AEAD associated data** bound to the ciphertext blob. A malicious or compromised server cannot mutate these fields (e.g. roll a record back to an older version by rewriting timestamps) without the client detecting the mismatch on decrypt and rejecting the blob.
- **Tombstones over edits.** A delete with timestamp T overrides any edits with timestamp < T. (Prevents "zombie" records from coming back.)
- **User-facing transparency:** when the local device discovers its offline edit was overridden by a newer remote edit on sync, show a toast (e.g. _"Your edit to 'Groceries' was overridden by a newer change from Anna's phone"_) — non-blocking, dismissible.
- Open question: are there any fields where LWW is unsafe and we need special handling? (Balances are recomputed from transactions, so they should be fine. To be reviewed in technical phase.)

### 3.12 Notifications

All types of notifications are enabled by default if user allows notifications.

Server-sent push notifications cover four event types:

| Event | User-configurable? | Default |
|---|---|---|
| **Backup quota warnings / sync errors** | ❌ Mandatory, cannot be disabled | ON |
| Daily reminder to log expenses | ✅ Yes (on/off + time) | ON |
| Missed-day reminder | ✅ Yes | ON |
| Family activity (someone added/edited tx) | ✅ Yes | OFF (to avoid spam) |

- Per-user notification settings.
- Per-event opt-out (except quota/sync warnings, which are mandatory).
- Open questions: notification scheduling details, quiet hours, per-device vs per-user delivery — see next round.

### 3.13 Storage & quota

- **200 MB per user.** Comfortable for 5+ years even at heavy use.
- **Quota-reached behavior:** new uploads are blocked; app shows a banner prompting the user to delete old data or export & archive. Local editing continues unaffected. No data loss; existing cloud data is preserved.
- **Admin panel** shows storage usage **as a percentage** for each user.
- **Snapshot deduplication.** Snapshots (§ 3.14) MUST deduplicate by ciphertext content hash — a record unchanged for N days occupies one stored blob, referenced from each snapshot. Without dedup, 30 × snapshot multiplier blows the quota for heavy users. The 200 MB quota is measured AFTER dedup + tombstone compaction.
- **Tombstone retention.** Deleted records leave tombstones for LWW correctness. Tombstones are retained for **90 days** after the deletion timestamp (long enough to cover offline devices catching up), then **compacted**: server publishes a family-wide watermark, and tombstones older than the watermark are purged. Devices that come online with edits to records older than the watermark MUST refresh from the server before re-uploading.
- **Worst-case math validation** is a technical-phase task: confirm that a 6-member family editing ~200 tx/month under E2EE (with per-record AEAD overhead, 30-day snapshot dedup, 90-day tombstones) fits well within 200 MB at 5 years.
- delete old data - means that there will be snapshot of current account done but all the transactions will be lost (like clear init). Make sure it is communicated to the user.

### 3.14 Point-in-time recovery

- Server keeps **daily snapshots** of each user/family's state for the **last 30 days**.
- Snapshots are bundles of the same ciphertext records the server already holds — no plaintext is ever created on the server. Storage is deduplicated by content hash (§ 3.13).
- App settings → Restore offers "Restore to..." with the available snapshot dates.
- Restoring replaces current state with the snapshot (with confirmation). Local devices then re-sync from the new server state and decrypt client-side as normal.
- **Soft-deleted records and snapshots interact.** A record deleted on day 5 still appears in snapshots from days 1–4 until those snapshots roll off (max 30 days). This is intentional — it's what makes "restore to last Tuesday" actually restore deleted records. Users should be aware that the "delete" they did today persists in recent snapshots for up to 30 days. **Hard account deletion** (§ 3.19), by contrast, purges the user from all snapshots.

### 3.15 Notification scheduling

- **Per-user reminder time** (e.g. "remind me at 21:00 local").
- **Per-user quiet hours** (e.g. "do not disturb 23:00 – 07:00"). Quiet hours apply to ALL notifications, including mandatory quota/sync warnings — mandatory notifications are HELD until quiet hours end, not dropped.
- All times in user's local timezone.

### 3.16 Family invariants

- A user can be in **at most one family at a time.**
- Family size cap: **6 members.**
- Open: who can invite new members — anyone in the family, or only a designated family owner? (See next round.)

### 3.17 Admin tree — demotion cascade

- When an admin is demoted, admins they had promoted (their subtree) are **re-parented to the demoter**.
- Example: A1 promoted A2; A2 promoted A3 and A4. If A1 demotes A2, then A3 and A4 become direct children of A1.
- The demoter inherits responsibility for the orphaned subtree; admin coverage is preserved.

### 3.18 Sync model — foreground vs background

- **Foreground (app active):** real-time sync. Changes from other devices/family members appear within seconds. Implemented via a live push channel (WebSocket / SSE — to be chosen in tech phase).
- **Background (app closed/inactive):** periodic sync — frequency on the order of minutes to a day, optimized for battery and data. Detailed cadence to be decided in tech phase.
- Trade-off accepted: family members who are passively co-watching the app on the same shopping trip see live updates; offline/background users see stale views until app is reopened.
- **E2EE impact:** sync payloads are ciphertext + metadata. Client encrypts before upload and decrypts after download; server is a blind transport. No change to the sync model otherwise.
- While syncing, add spinner to indicate the process. Spinner is a toast overlay on the app UI and cannot be dismissed but it should not cover the entire content. Also users cannot make changes while syncing - simply disable any action to do changes from UI (make buttons disabled)

### 3.19 Account deletion (self-service)

- **Solo user:**
  - Click "Delete my account" → confirmation.
  - **14-day grace period**: account suspended, no sign-in, but data preserved. User can recover by signing in within 14 days.
  - After 14 days: hard purge runs:
    - All user data (ciphertext blobs, envelopes, snapshots, pending invites) deleted.
    - All sessions revoked.
    - All push tokens revoked at FCM/APNS and deleted locally.
    - Audit log entries: entries **older than 90 days** are **pseudonymized** (actor email replaced with a stable hash like `user_<hex>`) so security forensics can still link related events; entries **newer than 90 days** are deleted. This balances forensic value against right-to-be-forgotten.
- **User in a family:**
  - Must **leave the family first** (see § 3.9 — choose between "take a copy" or "walk away clean").
  - After leaving, proceed as solo deletion above.
- **Admins:**
  - Admins must be demoted before they can delete their account. If they are an admin with a subtree, the demote rules apply (re-parent to demoter).
  - Admins have additional button on UI to delete their account immediatly withou grace period - that is for testing purposes only
- **Root admin:**
  - Cannot self-delete while their email is configured as the bootstrap admin. Admin must update env config first or hand off (TBD how — see open questions).

### 3.20 Push notification delivery

- **Fan out to all signed-in devices.**
- **Auto-dismiss elsewhere on read**: when a user dismisses or opens a notification on one device, server tells the others to clear it. This requires a live device-to-device channel (the same one used for foreground sync, § 3.18) and per-device delivery state. Offline devices receive the dismissal on next reconnect; eventual consistency is acceptable (a dismissed notification may flash on a long-offline device for seconds before clearing).
- Server tracks per-device push tokens; cleaning up dead tokens is a server responsibility. Tokens are GC'd on first delivery-failure response from FCM/APNS.

### 3.21 Family activity notifications — format

- Single **daily digest** per family member.
- Contains **summary counts only** (e.g. _"Today in your family: Anna made 4 changes. Bob made 1 change."_).
- **No exact amounts, categories, or notes** in the push payload — keeps sensitive data out of FCM/APNS pipelines.
- The user opens the app to see specifics.
- **Quiet hours interaction (§ 3.15):** if the digest would fire during quiet hours, it is **held until quiet hours end** and delivered then (same policy as mandatory notifications). It is never dropped.

### 3.22 Family roles

- **Co-equal household model.** No "owner" role.
- Any family member can:
  - Invite a new member (subject to 6-member cap and allowlist rules).
  - Remove any other member (including the original family creator).
- Trust model: invite only people you trust completely — this is your household, not an org.

#### Removal safeguards

To prevent removal-thrash in disputes (e.g. a couple in conflict, or a flatmate fallout), v1 imposes two soft safeguards:

- **24-hour cool-down on re-kick.** When User X is removed from the family, X cannot be added to the family again, AND any member X added during their membership cannot be removed by X-equivalent actors, for 24 hours from the removal. _More plainly:_ if A kicks B, B cannot turn around and kick A back within 24 hours (B has been removed and lost their kick rights anyway). If B is re-invited within the cool-down window, they accept normally but their removal-of-others rights are restored only after 24h since their original removal.
- **Mutual-kick tie-break: server-receive-order wins.** If A and B issue removals of each other within milliseconds, the first removal request the server accepts is the one that stands. The losing request is rejected with a clean error.
- **Explicit UI warning at remove-confirm time:** _"Removing **{name}** stops their future access to this family. Anything they have already seen or downloaded stays with them on their device. Full revocation (re-encrypting all family data) is planned for a later release. Continue?"_

### 3.23 Server-side operational backup

- The backend is **self-hosted**. The admin running the server is responsible for backing up the server's own data directory (where SQLite/Postgres files, snapshots, audit logs live).
- The app **documents** the data directory location and provides a recommended backup approach (restic / borg / ZFS snapshot / rsync — to be detailed in the deployment doc).
- The app does NOT bundle its own infra-level backup mechanism for the server's storage. (Per-user point-in-time snapshots, § 3.14, are a separate concern handled inside the app.)

### 3.24 Audit log

- **Scope:** authentication events (sign-in success/failure, sign-out), allowlist changes, admin promotions/demotions, user suspensions, family creation/invite/accept/leave/remove. Plus **E2EE-related security events**: device join, device revoke/sign-out, recovery code regenerated, family key rotated (v1.1+).
- **Not in scope:** individual data edits (transactions, accounts, categories) — too high volume, low ops value, raises privacy questions.
- **Retention: 1 year.** After 1 year, log entries are deleted.
- **Visibility:** only admins can see the audit log. The log shows actor email, action, target (where applicable), timestamp.
- **Server logs must not include any ciphertext bodies, per-field byte counts, or any quantity that could narrow plaintext.** Aggregate counts (e.g. "X records uploaded") are fine; per-record sizes are not. This is an operational rule for both the audit log and ordinary server logs.

The app in the settings where export logs button is available, should have a button to send logs to server. The user should be notified that logs can contain sensitive information and by sending the logs, they are consenting to the collection and use of such information. Then admin can review the logs on the server from admin panel.

### 3.25 Session lifetime

- **Sessions live forever** until one of: user signs out, admin revokes the device, admin suspends the account, or the email is removed from the allowlist.
- Refresh tokens roll silently in the background — the user does not see a re-auth prompt during normal use. (This is the "creds auto-refresh, no mandatory sign-in" guarantee.)
- A removed/suspended user's next sync attempt fails with a clean message ("Your access has been revoked"); local data remains intact.

### 3.26 Onboarding integration

Onboarding order changes from the current 5 steps to 7, and one of the new steps appears **only if** the user signs in:

1. **Sign in with Google** _(skippable — user can do this from Settings later; required for backup / family / cloud notifications)_ - let user know that without account the app has no cloud sync capabilities
2. **Recovery code setup** _(shown ONLY if step 1 completed AND the user is creating a brand-new account — generates the family key, displays the 24-word phrase, requires a soft acknowledge checkbox)_
3. Welcome
4. Currency
5. First account
6. Categories
7. Install prompt

- "Works without an account" principle preserved — if the user skips sign-in, they skip the recovery code step too. Local-only users have no server-side data and need no recovery path.
- If a user signs in later from Settings, the recovery code setup runs at that moment (single screen, same UX as in onboarding).
- **Sign-in on a device N≥2 of an existing account.** Step 2 is **skipped entirely**. The device follows the silent-wrap or recovery-code-entry flow from § 3.10 instead. Generating a new family key on a subsequent device would orphan all existing data — the spec is explicit that this MUST NOT happen.

### 3.27 Invite vs. allowlist interaction

- If User A tries to invite User B (by email) into the family, but B's email is **not on the allowlist**, the invite is **blocked** with a clear message: _"This email isn't allowed yet. Ask an admin to add `email@example.com` to the allowlist, then try again."_
- Rationale: the allowlist is the single master gate. Family invites do not bypass it.

### 3.28 Sync visibility

- App shows a **"last synced X ago"** indicator in a discoverable location (e.g. Settings header or a small chip on the Overview tab — exact placement is design's call).
- States to convey:
  - Synced just now
  - Synced X minutes / hours ago
  - Offline — changes saved locally
  - Sync error (with tap-to-see-detail)
- **Conflict toasts** are shown when a local offline edit was overridden by a newer remote edit on sync (already part of § 3.11).

### 3.29 Localization

- **v1 ships English only**, matching the current app.
- Backend strings (invite messages, push notification text, admin panel labels, error messages) must be **structured for i18n from day one** — translatable resource files, locale-aware formatting — so adding Polish, Belarusian, or other languages later is purely a translation task, not a code change.

### 3.30 Family invite delivery

- **In-app + push notification**, no email.
- When User A submits an invite for B's email:
  - A "pending invite" record is created server-side, scoped to B's email.
  - B's signed-in devices receive a push notification (assuming B has enabled them — see § 3.31).
  - On B's next app open (or instantly on a push tap), the app shows an "Accept / Decline" sheet.
- No email infrastructure required for v1.

### 3.31 Push notification permission ask

- Asked **right after sign-in completes**, during a short "Enable cloud features" step:
  - Brief explanation of value ("Get reminded to log expenses, stay updated on family activity, see backup status").
  - Single permission ask.
- If declined, user can re-enable later from Settings → Notifications (which will re-trigger the browser permission prompt).
- Mandatory notifications (backup quota / sync errors) only fire if the user has granted permission — if not, those warnings are surfaced as in-app banners instead.
- **iOS web push fallback.** Web push on iOS requires the PWA to be installed to the home screen AND iOS ≥ 16.4. For iOS users who don't meet both conditions, **all four push event types degrade gracefully to in-app banners on next foreground**. Mandatory quota/sync warnings additionally surface in the sync-status chip (§ 3.28). No email fallback in v1. Make sure for such users the limitation is communicated clearly so they would not wonder why they don't receive push notifications.

### 3.32 Data protection — end-to-end encryption (E2EE)

The app ships with **end-to-end encryption from v1**. All user data is encrypted on the client device before it leaves it; the server only ever holds ciphertext and metadata. A server admin with full sudo on the host cannot read user data — only crack 256 bits of entropy through a slow KDF, which is not a path anyone will walk. Make sure that is communicated as the first screen of onboarding so it will encourage users to sign in.

#### Threat model

| Threat | Defended? | How |
|---|---|---|
| Sudo on the host reads the database | ✅ Yes | DB rows are opaque ciphertext blobs |
| Stolen / leaked backup file (snapshot tarball, restic repo) | ✅ Yes | Backups inherit the ciphertext |
| Cloud provider snapshots the volume | ✅ Yes | Same |
| Web admin panel exposes user data | ✅ Yes | Admins see metadata only (§ 3.6) AND cannot decrypt anyway |
| Compromised backend process | ✅ Yes | Server has no key material to leak |
| Network in transit | ✅ Yes | TLS required for all backend traffic |
| Compromised Google account → attacker signs in on a new device | ⚠️ Partially | Attacker can add a new device, BUT existing devices get a security alert ("new device joined") and recovery code is still required if no other devices are present. User has a chance to react. |
| User loses ALL signed-in devices AND recovery code | ❌ Data is unrecoverable | The hard cost of E2EE. Explicit in the UX. |

#### Key model

| Key | Generated by | Lives where | Purpose |
|---|---|---|---|
| **Family key** (symmetric) | Client device | Inside each authorized device's secure storage; never on the server in plaintext | Encrypts all user/family data |
| **Device keypair** (asymmetric) | Each device at first sign-in | Public key on server; private key stays on device, non-extractable | Lets existing devices wrap the family key for new devices without server visibility |
| **Recovery key** (symmetric, derived) | Derived on demand from the user's 24-word recovery phrase | Nowhere by default | Last-resort unwrap when all devices are lost |

Every user has a family key from day one (a solo user is just "a family of one" internally). The same mechanism handles solo and family use uniformly.

#### What the server stores

- Ciphertext blobs of every record (transactions, accounts, categories, budgets, snapshots).
- A **minimal** set of cleartext **metadata** the server needs to function — see "Cleartext metadata scope" below. Notably, **foreign keys** (transaction → account, transaction → category, transferGroupId, etc.) are NOT cleartext — they live inside the encrypted payload. The server cannot see the relationship graph of who-paid-whom.
- One **device envelope** per signed-in device: `Wrap(familyKey, devicePublicKey)`.
- One **recovery envelope** per family: `Wrap(familyKey, KDF(recoveryPhrase))` using a slow KDF (Argon2id or equivalent — technical-phase choice). This is what unwraps the family key when the user enters their recovery phrase on a fresh device.
- One **recovery-phrase envelope** per family: `AEAD(familyKey, recoveryPhrase)`. This is what powers the Settings → Security → Recovery Code re-view: any device holding the family key can open it to display the phrase. It is independent from the recovery envelope above — losing all devices makes this envelope unusable (no family key), but the recovery envelope still works because the user's phrase derives the unwrap key directly. Correctness: writing both envelopes must be atomic on family creation so the two never get out of sync.
- Pending invites (metadata only).

#### Recovery code

- **Format:** 24-word BIP39 phrase (~256 bits entropy).
- **Shown:** during onboarding, immediately after Google sign-in completes — and **only if** the user signed in AND this is the first device of a brand-new account. Local-only users have no server-side data and do not need a recovery code; N≥2 devices skip this step (§ 3.26).
- **Enforcement:** soft acknowledge — single "I've saved my recovery code" checkbox. Trade-off accepted: some users will skip it, which means data loss risk is theirs. The simpler UX is the priority.
- **Re-view:** available later from Settings → Security → Recovery Code. **Re-view requires a fresh Google sign-in challenge completed within the last 60 seconds** — the app pops the Google re-auth flow before displaying the phrase. This prevents a borrowed/stolen phone from exfiltrating the family in one tap. The legitimate user just clicks "continue" through Google's silent re-auth in most cases. Once re-auth succeeds, any signed-in device fetches the recovery-phrase envelope (`AEAD(familyKey, phrase)`), decrypts it with its in-memory family key, and displays the phrase. If the user has wiped every device, re-view is no longer possible — they must use the recovery phrase itself (the recovery envelope path) to get back in.

#### Cross-feature compatibility

All existing spec items still hold; here is how each interacts with E2EE:

| Feature | Impact |
|---|---|
| Conflict resolution (§ 3.11, LWW per field) | Unaffected — server compares `updatedAt` timestamps (metadata), never values |
| Continuous sync (§ 3.18) | Unaffected — payloads are ciphertext + metadata |
| Daily snapshots (§ 3.14) | Snapshots are bundles of ciphertext records; restore is client-side |
| Quota (§ 3.13, 200 MB) | Ciphertext is slightly larger than plaintext (AEAD tag + IV per record). 200 MB still covers ≥5 years comfortably. |
| Family activity push (§ 3.21, counts only) | Already metadata-only; perfect fit |
| Mandatory quota / sync-error pushes | Server knows quota state and sync errors (metadata); can send |
| Admin panel | Admin still sees only metadata; now metadata is the ONLY thing readable, period |
| Audit log | Unaffected — emails + admin actions, no financial content |

#### Cleartext metadata scope (what the server sees and what it does NOT)

This table is the contract. Anything not listed as cleartext is encrypted inside the payload.

| Field | Cleartext on server? | Reason |
|---|---|---|
| `recordId` (opaque UUID) | ✅ Cleartext | Needed for upsert/lookup |
| `recordType` (transaction / account / category / budget / settings) | ✅ Cleartext | Needed for routing and storage layout |
| `familyId` (opaque UUID) | ✅ Cleartext | Needed for tenancy / access control |
| `userId` (opaque UUID, for "who uploaded this") | ✅ Cleartext | Needed for family-activity counts (§ 3.21) and "added by" attribution if enabled |
| Per-field `updatedAt` timestamps | ✅ Cleartext | Needed for LWW conflict resolution (§ 3.11) |
| `deletedAt` (tombstone marker) | ✅ Cleartext | Needed for tombstone semantics |
| Ciphertext byte count | ✅ Cleartext | Needed for quota (§ 3.13) |
| Version byte (cipher/envelope) | ✅ Cleartext | Needed for migration safety |
| AEAD nonce | ✅ Cleartext | Standard AEAD requirement |
| AEAD tag | ✅ Cleartext | Standard AEAD requirement |
| Owner-user email (on user records only) | ✅ Cleartext | Needed for sign-in, invites, allowlist |
| Device label (on device records only) | ✅ Cleartext | Needed for the active-devices list and security alerts (§ 3.34) |
| **Foreign keys** (accountId on tx, categoryId on tx, parentCategoryId, transferGroupId, etc.) | ❌ ENCRYPTED inside payload | Privacy: server must not be able to reconstruct the relationship graph |
| **Amount, currency, note, account name, category name/icon/color, budget amounts, settings values, anything user-typed** | ❌ ENCRYPTED inside payload | All user data |

**Consequence:** the server can see _"family X has Y records of type Z modified at these times by these users, totaling N bytes against quota"_ — and nothing else. It cannot see which transaction belongs to which account, cannot reconstruct transfers, cannot count "how many groceries transactions" per family. Referential integrity, account/category linkage, and all semantic validation are the client's responsibility (§ 3.32 cryptographic invariants).

#### Cryptographic invariants (business-level — tech phase MUST honor these)

The exact ciphers and parameters are technical-phase choices, but the spec already commits to these properties:

- **Nonce/IV safety.** Every ciphertext blob carries an explicit nonce. The technical phase MUST specify a nonce strategy that is collision-safe across all devices and all edits over the family key's lifetime. Nonce reuse on the same key is a CRITICAL bug — it can leak plaintext. Safe options include random 192-bit nonces (XChaCha20) or key-committing AEAD constructions. The doc does not pick the cipher; the doc requires that the choice be safe.
- **Authenticated metadata.** All cleartext metadata that the server uses for routing/sync/LWW (recordId, recordType, familyId, per-field `updatedAt`, prior-version pointer, version byte) MUST be bound to the ciphertext as **AEAD associated data (AAD)**. Clients reject blobs whose AAD doesn't match the metadata the server returned. This prevents a hostile or compromised server from silently rolling records back, swapping ownership, or mixing snapshots across families.
- **Cipher and envelope versioning.** Every ciphertext blob and every envelope MUST carry a **version byte** (or short prefix). Servers MUST refuse uploads with unknown versions; clients MUST refuse to decrypt blobs whose version they don't understand. Future cipher upgrades are migrations done by dual-write — old blobs are not stranded, new blobs are tagged with the new version.
- **No plaintext in logs.** Server logs (operational + audit) MUST NOT include ciphertext bodies, per-record byte counts, per-field sizes, or anything else that could narrow plaintext. Aggregate counts are fine.
- **Server validation scope under E2EE.** The server validates **envelope structure** (well-formed AEAD, correct version, AAD matches metadata), **byte budget** against quota, and **authorization** (this device may write to this family). It does NOT perform any semantic validation of the encrypted payload — that would be impossible. All semantic validation (record shape, currency code sanity, amount sign rules, etc.) is the client's responsibility.

#### Out of scope for v1 (deferred to later)

- **Hard family removal with key rotation** — see § 3.33. v1 ships with **soft removal** only.
- **Periodic re-verification of recovery code** ("type 3 words to confirm you still have it") — friendly safety net deferred.
- **Search by content** — never planned; structurally impossible under E2EE without sacrificing the model.
- **TOFU-style server response signing** (client pins server public key on first contact, detects malicious server swap). Considered for v1.1+ as defense-in-depth.

### 3.33 Family removal — v1 soft removal, v1.1+ hard removal

E2EE makes member removal a heavy operation. v1 ships a **soft** version; a proper hard removal is a follow-up.

#### v1 — soft removal

- When a member is removed (kicked) or leaves, the server **revokes their session tokens and deletes their device envelopes** for the family.
- Effect: the removed member can no longer fetch new data — the server denies them on auth.
- Limitation: the removed member's devices still have the family key in their local cache. Any data they already pulled remains readable to them indefinitely, and they could have exfiltrated it during their membership.
- **Best-effort local wipe.** When a removed member's device next attempts to sync, the server responds with a "you have been removed" signal. The client app MUST then wipe its local cache of family ciphertext, family key, and envelope. This is best-effort, not a security guarantee — a removed member who never reopens the app, or who modifies the client, can defeat the wipe. The spec already acknowledges this limitation; the wipe simply makes the common case (cooperative leaver who reopens the app) honest.
- This is explicitly called out to the family in the UI: _"Removing a member stops their future access. Anything they already saw stays with them. For full revocation, see the upcoming key-rotation release."_

#### v1.1+ — hard removal (deferred)

- Triggers a **key rotation ceremony**: a remaining family device generates a new family key, re-encrypts all family data under the new key, uploads new envelopes for remaining devices, retires the old key.
- Heavy operation (proportional to data size); requires at least one remaining device to be online to perform it.
- Designed but not built in v1. Scope-cut to keep v1 shippable; rare enough in a 6-person private app to be acceptable.

### 3.34 Device join security alert

Whenever a new device successfully joins an existing user's account:

- **Push notification** fires on all other signed-in devices: _"New device joined: <device label> · just now"_.
- **In-app banner** appears on those devices, with a **"This wasn't me — sign out"** action that immediately revokes the new device (deletes its envelope and session).
- Same pattern as Google / Apple / Signal account-security alerts.
- **Exception: first device.** When a user's very first device signs in (no other devices exist), there is no one to alert — the join is silent. Only second-and-later devices trigger the alert.

This is the user's primary defense against a Google account takeover: even if an attacker gets into the user's Google account and signs in on a new device, the legitimate user gets immediate notice and a one-tap revoke.

### 3.35 Admin metadata — E2EE additions

In addition to what § 3.6 already allows admins to see, admins can also see:

- **Per-user active device count.**
- **Per-user recovery code status** (set / not set).

Both are metadata; no user data is exposed. Useful for support conversations ("Have you saved your recovery code yet?" / "Looks like you've got 4 devices signed in — that intentional?") without violating the privacy invariant.

### 3.36 GDPR data subject rights — limitations under E2EE

The app aims for GDPR-style hygiene (§ 3.4), but E2EE structurally limits what the operator can offer:

| Right | Can operator honor? | How |
|---|---|---|
| Right of access (Art. 15) — "give me a copy of my data" | ⚠️ Only via the user's own working device | The operator has only ciphertext. The user can export their decrypted data from the app on any device where they're signed in. If the user is locked out (lost all devices + recovery code), the operator cannot help. |
| Right to portability (Art. 20) — machine-readable export | ⚠️ Same as above | Same: in-app export from the user's device, not server-side. |
| Right to erasure (Art. 17) — "delete my data" | ✅ Yes | Operator can purge all ciphertext, envelopes, snapshots, audit entries for the user (see § 3.19). This works even when the user is locked out. |
| Right to rectification (Art. 16) | ⚠️ Only via the user's device | Same — operator has no plaintext to rectify. |
| Right to restrict / object | ✅ Yes | Account suspension by admin (§ 3.6) implements this. |

These limitations MUST be disclosed in any user-facing privacy notice before sign-in. The user is opting into a system where their data is theirs alone — the operator cannot read it, cannot help them recover it, but also cannot be compelled to surrender it.

---

## 4. Non-goals (v1)

Features explicitly **out of scope** for this backend phase:

- **Receipt photo attachments.** Not in the app today; would significantly change storage math and sync semantics. Revisit later.
- **Hard family member removal with key rotation.** v1 ships **soft removal** only (see § 3.33). The full ceremony — generating a new family key, re-encrypting all data, rotating envelopes — is deferred to v1.1+. Removed members lose future access immediately but retain whatever they already cached.
- **Content-based search.** Server stores only ciphertext, so server-side search is structurally impossible. Client-side search on locally-decrypted data is fine and may exist already.
- **Public API for third-party clients.** No documented external API.
- **Webhooks / external integrations** (Zapier, IFTTT, etc.).
- **Email/password sign-in.** Google only.
- **Light theme.** (Existing app rule — dark only.)
- **Other "future stub" features** already marked as such in the client (recurring transactions, passcode, savings interest, debt auto-interest). Backend should not assume they exist.

---

## 5. Glossary

- **Family** — a group of users co-editing a shared set of accounts/transactions. Solo users are internally "a family of one" sharing the same encryption mechanism.
- **Backup** — server-side persistent copy of the user's data (ciphertext + metadata).
- **Main currency** — the user's display currency (already set during onboarding).
- **Minor units** — smallest currency unit (cents/pence). All amounts in the app are stored this way.
- **Family key** — the symmetric encryption key under which all data for a family is encrypted. Generated client-side; never visible to the server.
- **Device keypair** — an asymmetric keypair generated by each signed-in device. Public key on server; private key non-extractable on the device.
- **Envelope** — the family key wrapped (encrypted) under another key. **Device envelope:** family key wrapped under a device's public key (lets that device decrypt the family key). **Recovery envelope:** family key wrapped under a key derived from the recovery code.
- **Recovery code** — a 24-word BIP39 phrase generated at first sign-in. The user's last-resort access if all devices are lost. Re-viewable from Settings while at least one device is signed in.
- **Soft removal** — v1 family-member removal. Revokes the removed member's session and envelope; does NOT rotate the family key. Removed member loses future access; retains anything they already cached.
- **Hard removal** — v1.1+ family-member removal. Rotates the family key, re-encrypts all data, removes the old member fully. Heavy operation.
- **E2EE** — end-to-end encryption. In this app: data is encrypted on the client device before upload and decrypted on the client device after download. The server holds only ciphertext + metadata and cannot read user data under any circumstance.
- **Solo user** — a user who has signed in but is not in a multi-person family. Internally treated as "a family of one" sharing the same encryption mechanism. Becomes a multi-person family only when an invite is accepted.
- **AEAD** — authenticated encryption with associated data. The cipher style this app uses: encrypts the payload AND authenticates additional cleartext metadata bound to it, so neither can be tampered with separately.
- **AAD** — associated data: the cleartext metadata bound to a ciphertext under AEAD. See § 3.32 cryptographic invariants.
- **Tombstone** — a record marker indicating "this was deleted at time T". Required for LWW correctness so a stale offline edit doesn't resurrect a deleted record. Retained 90 days, then compacted (§ 3.13).

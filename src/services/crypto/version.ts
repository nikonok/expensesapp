// Suite-version constants per docs/backend/architecture.md §7.9.
// Reserve ranges: 0x01-0x0F data, 0x10-0x1F envelopes, 0x20-0x2F recovery.

export const SUITE_VERSION_V1 = 0x01; // XChaCha20-Poly1305 + commit + X25519 sealed box + Argon2id
export const ENVELOPE_VERSION_V1 = 0x10;
export const RECOVERY_VERSION_V1 = 0x20;

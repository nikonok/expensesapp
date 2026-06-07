// Zustand slice — pending device-join notification (Phase 5e, architecture §8.2).
//
// Written by the sync engine when a `device.joined` SSE event arrives.
// Read by DeviceJoinedBanner to show the explicit Approve / Reject prompt
// described in WORK_PLAN.md brief B5a.

import { create } from "zustand";

export interface PendingDeviceJoin {
  deviceId: string;
  label: string;
  /** Device public key (base64url). Present if the SSE event carried it.
   *  Null means we'll fetch it lazily via GET /api/v1/me/devices/{id}. */
  pubKey: string | null;
  /** 13-char base32 fingerprint of the pubkey, computed by the crypto worker
   *  via `crypto_generichash(8, pubKey)`. Used to show a human-verifiable
   *  identifier next to Approve / Reject. Null if computation failed or no
   *  pubkey was present in the event. */
  fingerprint: string | null;
  /** Short excerpt of the joining device's user agent (best-effort). */
  userAgent: string | null;
  /** Server-issued createdAt for the join event, if any. */
  createdAt: string | null;
}

interface DeviceJoinStore {
  pendingDeviceJoin: PendingDeviceJoin | null;
  setPendingDeviceJoin: (join: PendingDeviceJoin) => void;
  clear: () => void;
}

export const useDeviceJoinStore = create<DeviceJoinStore>((set) => ({
  pendingDeviceJoin: null,
  setPendingDeviceJoin: (join) => set({ pendingDeviceJoin: join }),
  clear: () => set({ pendingDeviceJoin: null }),
}));

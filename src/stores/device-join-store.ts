// Zustand slice — pending device-join notification (Phase 5e, architecture §8.2).
//
// Written by the sync engine when a `device.joined` SSE event arrives.
// Read by DeviceJoinedBanner to show the "New device joined" notification.

import { create } from "zustand";

export interface PendingDeviceJoin {
  deviceId: string;
  label: string;
  /** Device public key (base64url). Present if the SSE event carried it.
   *  Null means we'll fetch it lazily via GET /api/v1/me/devices/{id}. */
  pubKey: string | null;
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

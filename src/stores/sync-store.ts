// Zustand slice for sync UI state (Phase 4e, architecture §6.2).
// Provides: isSyncing, lastSyncAt, lastError.
// Written to by the sync engine; read by UI components.

import { create } from "zustand";

interface SyncStore {
  /** ISO-8601 UTC of the last successful sync (push or pull); null if never synced. */
  lastSyncAt: string | null;
  /** True while a push flush or pull is in progress. */
  isSyncing: boolean;
  /** Error message from the last sync failure; null if last sync succeeded. */
  lastError: string | null;

  setLastSyncAt: (ts: string) => void;
  setIsSyncing: (v: boolean) => void;
  setLastError: (err: string | null) => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  lastSyncAt: null,
  isSyncing: false,
  lastError: null,

  setLastSyncAt: (ts) => set({ lastSyncAt: ts }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setLastError: (err) => set({ lastError: err }),
}));

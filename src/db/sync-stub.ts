export interface SyncConfig {
  serverUrl: string;
  authToken: string;
}

export function initSync(_config: SyncConfig): void {
  // Stub: no-op. Future implementation will use Dexie Cloud or custom sync.
  console.info("[Sync] Sync not implemented. Stub initialized.");
}

export function isSyncEnabled(): boolean {
  return false;
}

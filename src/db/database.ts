import Dexie, { type EntityTable } from "dexie";
import type {
  Account,
  Category,
  Transaction,
  Budget,
  ExchangeRateCache,
  Setting,
  Backup,
  Log,
  PendingUpload,
  SyncCursor,
  RecordMapping,
} from "./models";
import { COLOR_PALETTE, PRIMARY_ACCENT_COLOR } from "../utils/constants";

export const DB_NAME = "expenses-app-db";

const db = new Dexie(DB_NAME) as Dexie & {
  accounts: EntityTable<Account, "id">;
  categories: EntityTable<Category, "id">;
  transactions: EntityTable<Transaction, "id">;
  budgets: EntityTable<Budget, "id">;
  exchangeRates: EntityTable<ExchangeRateCache, "id">;
  settings: EntityTable<Setting, "key">;
  backups: EntityTable<Backup, "id">;
  logs: EntityTable<Log, "id">;
  pendingUploads: EntityTable<PendingUpload, "id">;
  syncCursors: EntityTable<SyncCursor, "familyId">;
  recordMappings: EntityTable<RecordMapping, "uuid">;
};

// v1 — initial release schema (all development migrations collapsed)
db.version(1).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
});

// v2 — add logs table
db.version(2).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
});

// v3 — add cipherKeys table for device key material (Phase 3, architecture §9.2)
db.version(3).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
});

// v4 — add sync outbox + cursor tables (Phase 4e, architecture §6.2)
db.version(4).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id, recordId, attempts",
  syncCursors: "&familyId",
});

// v5 — extend pendingUploads with editor IDs (no new indexes; field-only change).
// Dexie still requires re-declaring the full schema in the new version block.
db.version(5).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id, recordId, attempts",
  syncCursors: "&familyId",
});

// v6 — main-thread Dexie no longer references `cipherKeys`; raw key material
// lives in a worker-only IndexedDB (`expenses-app-keys`). The table itself is
// kept in the schema (Dexie requires all prior stores to be re-declared) so the
// worker can migrate any pre-existing rows on first run after deploy. Reads /
// writes from the main thread are removed (see B5d). Once the worker has
// migrated the rows it clears the legacy store; the table definition can be
// dropped in a future v7 migration.
db.version(6).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id, recordId, attempts",
  syncCursors: "&familyId",
});

// v7 — normalize legacy `var(--swatch-N)` / `var(--color-primary)` colors on
// accounts + categories to literal oklch values (accountSchema/categorySchema
// only accept literal `oklch(...)`, so non-conforming seeded records were
// silently dropped by the sync pull path). Also drops indexes that are never
// queried via `.where()`/`.orderBy()` (verified by grep across the codebase)
// — including the boolean `isTrashed` indexes, which are invalid IndexedDB
// keys in some browsers.
export function resolveLegacyColor(color: string): string | null {
  if (color === "var(--color-primary)") return PRIMARY_ACCENT_COLOR;
  const match = /^var\(--swatch-(\d+)\)$/.exec(color);
  if (match) {
    const swatch = COLOR_PALETTE.find((s) => s.id === Number(match[1]));
    if (swatch) return swatch.value;
  }
  return null;
}

db.version(7)
  .stores({
    accounts: "++id, type",
    categories: "++id, type, displayOrder",
    transactions: "++id, date, accountId, categoryId, type, transferGroupId",
    budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
    exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
    settings: "key",
    backups: "++id, createdAt",
    logs: "++id, timestamp, level",
    cipherKeys: "name",
    pendingUploads: "++id",
    syncCursors: "&familyId",
  })
  .upgrade(async (tx) => {
    await tx
      .table<Account, number>("accounts")
      .toCollection()
      .modify((account) => {
        const resolved = resolveLegacyColor(account.color);
        if (resolved) account.color = resolved;
      });
    await tx
      .table<Category, number>("categories")
      .toCollection()
      .modify((category) => {
        const resolved = resolveLegacyColor(category.color);
        if (resolved) category.color = resolved;
      });
  });

// v8 — add `recordMappings`: the canonical local↔server record-identity table
// shared by the live sync engine and the solo→family migration path. Primary
// key is the server-facing `uuid` (globally unique); `&[recordType+localId]`
// is a unique compound index used to resolve/mint a mapping for a local row
// on push. See src/services/sync/record-mapping.ts.
db.version(8).stores({
  accounts: "++id, type",
  categories: "++id, type, displayOrder",
  transactions: "++id, date, accountId, categoryId, type, transferGroupId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id",
  syncCursors: "&familyId",
  recordMappings: "uuid, &[recordType+localId]",
});

// v9 — index `pendingUploads.recordId` so `enqueuePush` can coalesce rapid
// successive edits to the same logical record into a single outbox row
// (`.where("recordId").equals(...)`) instead of a full-table scan.
db.version(9).stores({
  accounts: "++id, type",
  categories: "++id, type, displayOrder",
  transactions: "++id, date, accountId, categoryId, type, transferGroupId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id, recordId",
  syncCursors: "&familyId",
  recordMappings: "uuid, &[recordType+localId]",
});

export { db };

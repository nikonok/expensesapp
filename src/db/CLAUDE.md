# src/db

[root CLAUDE.md](../../CLAUDE.md)

## Purpose

Dexie (IndexedDB) database definition: schema versions, TypeScript models, default seeds, and the legacy no-op sync stub.

## Key files

- `database.ts` — Dexie instance, all `db.version(N).stores(...)` migrations, typed `EntityTable` map.
- `models.ts` — TypeScript interfaces for every Dexie table (`Account`, `Category`, `Transaction`, `Budget`, `ExchangeRateCache`, `Setting`, `Backup`, `Log`, `CipherKey`, `PendingUpload`, `SyncCursor`) plus enum literals.
- `seed.ts` — default category presets + currency list used by onboarding.
- `sync-stub.ts` — historical no-op stub kept for compatibility; new sync code lives in `src/services/sync/`.
- `database.test.ts` — schema upgrade + open tests.

## Public surface

- `db` (`database.ts`) — single Dexie instance imported everywhere.
- All model interfaces from `models.ts`.
- `defaultCategoryPresets`, `currencyList` from `seed.ts`.

## Conventions

- **Schema is collapsed for first release at v1**; subsequent additions append new versions: v2 (`logs`), v3 (`cipherKeys`), v4 (`pendingUploads` + `syncCursors`). **To add fields or tables, append `db.version(N+1).stores({...})`** — never edit an existing `db.version(N)` block.
- Repeat all prior tables in every new `stores({...})` call (Dexie requires the full schema per version).
- **All monetary amounts stored in minor units** (`Account.balance`, `Transaction.amount`, `Transaction.amountMainCurrency`, `Budget.plannedAmount`, etc.).
- **Soft-delete only**: set `isTrashed = true`. Never call `db.<table>.delete(...)` on domain records. (Outbox / cipherKeys / syncCursors / exchangeRates may hard-delete — they are infrastructure tables.)
- `Transaction.date` = local wall-clock `"YYYY-MM-DD"`. `Transaction.timestamp` = full UTC ISO-8601. Do not conflate them.
- Transfers are TWO `Transaction` rows sharing `transferGroupId` (UUID v4); one `transferDirection: "OUT"`, one `"IN"`.
- `exchangeRate` on a transaction = 1 unit of account currency = X units of main currency.

## Gotchas

- `database.ts` declares the typed table map via an intersection cast; update both the cast AND `stores(...)` when adding a table.
- `PendingUpload` and `SyncCursor` are infrastructure for the sync engine (`services/sync/`); main-thread code should not write to them outside of `services/sync/`.
- `CipherKey` rows live in the main DB only for non-secret material; raw `familyKey` / device private keys live inside the crypto Worker's own IndexedDB scope — never mirror them here.
- `integrity.service.ts` runs at startup; if you add a required table, update the integrity checks.

## Tests

- `database.test.ts` — exercises schema open + upgrade. Add a case there when adding a new version.

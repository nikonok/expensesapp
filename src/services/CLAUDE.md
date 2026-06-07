# src/services

[root CLAUDE.md](../../CLAUDE.md)

## Purpose

Domain services and infrastructure used by pages, hooks, and components. Everything that talks to Dexie, the backend, crypto, or external APIs lives here.

## Key files

- `balance.service.ts` — `applyTransaction` / `updateTransaction` / `deleteTransaction`. The ONLY allowed mutator of `Account.balance`. Throws `QuotaError` on full IndexedDB.
- `backup.service.ts` — JSON full-DB backup/restore + scheduled auto-backup runner.
- `debt-payment.service.ts` — mortgage math: payment split, term-saved, monthly payment.
- `exchange-rate.service.ts` — fetch + 24h-cache rates from open.er-api.com.
- `export.service.ts` — XLSX export of transactions for a date range.
- `integrity.service.ts` — startup DB health check; failure triggers `IntegrityErrorScreen`.
- `notification.service.ts` — daily reminder scheduling via Web Notifications API.
- `log.service.ts` — structured logger writing to Dexie `logs` table.
- `math-parser.ts` — arithmetic expression evaluator for the Numpad (PEMDAS, minor-unit output).
- `reset.service.ts` — clears local Dexie state (sign-out / `you.removed` path).
- `auth/`, `crypto/`, `family/`, `sync/`, `push/`, `notifications/`, `admin/`, `account/`, `snapshots/` — see each subpackage's own `CLAUDE.md`.

## Public surface

- Everything exported from these files is meant to be called from `hooks/`, `pages/`, or `components/`.
- `log.service.ts` `logger` — use instead of `console.log` so events end up in the in-app log viewer.

## Conventions

- All monetary amounts are in **minor units** (cents). Never construct an amount in major units; use `formatAmount()` from `utils/currency-utils.ts` only for display.
- All balance mutations MUST go through `balance.service.ts` inside a `db.transaction("rw", …)` block — never write to `accounts.balance` directly.
- Soft-delete only (`isTrashed = true`) — never `db.<table>.delete()` for domain records.
- Wrap IndexedDB writes with `wrapQuotaError` (pattern in `balance.service.ts`) so callers can surface a friendly storage-full message.
- Use `logger` (`log.service.ts`); never `console.log`.

## Gotchas

- `balance.service.ts` is the only file that should mutate `Account.balance`. New write paths must funnel through it. See WORK_PLAN.md brief B1 for outstanding sync-engine wiring.
- `exchange-rate.service.ts` caches by `[baseCurrency+date]` — if you bypass the cache (e.g. force refresh) keep the schema constraint in mind.
- `integrity.service.ts` runs **before** settings load; do not import the settings store from it.

## Tests

- Co-located `*.service.test.ts` files (Vitest). Run with `npm test`.
- For new services, add a `<name>.service.test.ts` next to the source.

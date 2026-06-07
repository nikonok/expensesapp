# src/hooks

[root CLAUDE.md](../../CLAUDE.md)

## Purpose

React hooks that wrap reactive Dexie queries (`useLiveQuery`), service singletons, and platform APIs. The contract between pages/components and `src/services/` + `src/db/`.

## Key files

- `use-accounts.ts` — `useAccounts(includeTrashed?)`, `useAccount(id)`.
- `use-budgets.ts` — `useBudgets(month)`.
- `use-categories.ts` — `useCategories(type?, includeTrashed?)`, `useCategory(id)`.
- `use-exchange-rate.ts` — `useExchangeRate(from, to)` wrapper over `exchange-rate.service.ts`.
- `use-install-prompt.ts` — PWA `beforeinstallprompt` state.
- `use-sw-update.ts` — service-worker update prompt.
- `use-total-balance.ts` — net worth across accounts, currency-converted.
- `use-transactions.ts` — `useTransactions({ filter, accountId?, categoryId?, noteContains? })`.
- `use-translation.ts` — re-export of `useTranslation` from `react-i18next`.
- `__tests__/` — Vitest specs.

## Public surface

- All `useX` exports from each file. These are the canonical reactive accessors — pages/components should not query Dexie directly.

## Conventions

- Reactive reads only — Dexie writes belong in `src/services/` (`balance.service.ts` for transactions/balances).
- Hooks should return `undefined` while `useLiveQuery` is hydrating; downstream components must handle that state.
- Currency formatting happens at the **render** boundary (`AmountDisplay`, `formatAmount`), not inside hooks. Hooks return minor-unit numbers.
- Filter parameters should be plain JSON-serialisable values so React can memoise dependencies cleanly.
- Use `useTranslation()` from `use-translation.ts` rather than importing `react-i18next` directly — keeps the re-export point single.

## Gotchas

- `useLiveQuery` re-renders on any matching table change; avoid expensive transforms inside the query callback — derive in a `useMemo` afterwards.
- `useTotalBalance` calls `exchange-rate.service.ts`; if rates are unavailable it falls back to per-account balance without conversion.
- `useExchangeRate` is async-cached; assume one render cycle of `undefined` even on cache hits.

## Tests

- `__tests__/*.test.ts(x)` next to the hooks. Use `fake-indexeddb` for Dexie isolation (already configured in the Vitest setup).

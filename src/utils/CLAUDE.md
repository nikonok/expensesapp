# src/utils

[root CLAUDE.md](../../CLAUDE.md)

## Purpose

Pure helpers and Zod validation schemas. No React, no Dexie writes, no network calls. Everything here is safe to call from any layer (worker, hook, component, service).

## Key files

- `constants.ts` — `COLOR_PALETTE` (24 oklch swatches), `ICON_LIST` (Lucide names), `CHAR_LIMITS`, defaults.
- `currency-utils.ts` — `formatAmount`, `formatAmountNoSymbol`, `convertAmount`, `getCurrencySymbol`.
- `currency-search.ts` — fuzzy currency lookup for `CurrencyPicker`.
- `date-utils.ts` — `parsePeriodFilter`, `formatDate`, `shiftPeriod`, `autoScaleChartBuckets`, etc.
- `numpad-utils.ts` — `formatNumpadDisplay` for arithmetic expression strings.
- `transaction-utils.ts` — `isDebtPayment`, `isExpenseForReporting`, `getDayTotals`.
- `backup-validation.ts` — schema check for restore payloads.
- `validation.ts` — Zod schemas: `accountSchema`, `categorySchema`, `transactionSchema`, `budgetSchema`, settings schemas.
- `__tests__/` — unit tests for currency, date, math-parser, numpad helpers; `transaction-utils.test.ts` is a peer.

## Public surface

- All named exports from each file. Stable, breaking changes require updating call sites in `services/`, `hooks/`, `components/`.

## Conventions

- **All amounts in minor units.** `formatAmount(value, currency)` divides by 100 internally; do not pre-divide before calling.
- Pure functions only — no `Date.now()` inside helpers that claim to be pure (take a `now` parameter instead).
- Zod schemas in `validation.ts` are the canonical shape definitions; if you change a model in `db/models.ts`, update the schema and the matching `safeParse` callers in `services/sync/engine.ts:writeDecryptedRecord`.
- `currency-utils.ts:convertAmount` rounds half-up to the nearest minor unit; do not change rounding without auditing reports and budgets.
- `date-utils.ts` uses local wall-clock dates for `"YYYY-MM-DD"` parsing — do not switch to UTC.

## Gotchas

- `formatAmount` honours the user's `Intl` locale; tests should mock or pin a locale.
- `transaction-utils.isDebtPayment` distinguishes the OUT leg of a TRANSFER whose destination is a DEBT account; mirror this in any new reporting helpers.
- `validation.ts` schemas are also used by `services/sync/engine.ts` to validate decrypted payloads — keep them in sync with `db/models.ts`.
- `math-parser.ts` lives in `src/services/` (not here) because it has its own tests and is consumed by the Numpad component.

## Tests

- `__tests__/*.test.ts` next to the helpers. Add tests for any new function — these helpers underpin reports, budgets, and sync validation, so coverage matters.

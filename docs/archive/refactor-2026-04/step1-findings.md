# Step 1 — Codebase Audit Findings

**Date**: 2026-04-13  
**Scope**: Full audit of `src/`, `e2e/`, `docs/`, `scripts/`, config files vs. existing `CLAUDE.md` and `README.md`.  
**Output files updated**: `CLAUDE.md`, `README.md`

---

## Summary of changes made

### CLAUDE.md

The existing CLAUDE.md had an accurate but sparse project structure section and was missing several services, hooks, components, and architectural facts that are now in the code. All design rules, data rules, and "What NOT to do" constraints were preserved unchanged.

#### Added / corrected

**Services**

- `integrity.service.ts` — DB health check that runs at cold start before anything else. Not documented at all. Shows `IntegrityErrorScreen` on failure.
- `math-parser.ts` — listed under `utils/` in CLAUDE.md but lives in `services/`. Moved to correct location.
- `debt-payment.service.ts` — was in the services list but details (functions: `calculatePaymentSplit`, `calculateMortgagePayment`, `calculateTermSaved`, `getMonthlyRate`) not described.

**Hooks** (all missing from original)

- `use-budgets.ts`
- `use-exchange-rate.ts`
- `use-install-prompt.ts`
- `use-total-balance.ts`
- `use-translation.ts` (thin re-export of react-i18next)

**Utils** (missing)

- `numpad-utils.ts` — `formatNumpadDisplay()` for arithmetic expression display formatting
- `transaction-utils.ts` — `isDebtPayment()`, `isExpenseForReporting()`, `getDayTotals()` — used widely across components and tests

**Shared components** (missing)

- `CalendarPicker.tsx` — custom inline calendar (no library dependency)
- `CurrencyPicker.tsx` — searchable currency dropdown using `Intl.DisplayNames`
- `EmptyState.tsx`
- `ErrorBoundary.tsx`
- `FilterChips.tsx`
- `IntegrityErrorScreen.tsx` — full-screen recovery UI when DB is unreadable
- `ConfirmDialog.tsx`

**Layout**

- `TabLayout.tsx` — not listed; it's the shell wrapping TopBar + ContentColumn + BottomNav for all tab routes

**Transaction components** (missing)

- `TransactionDayHeader.tsx` — date group header with daily income/expense totals
- `TransactionFilters.tsx` — filter sheet (note, category, account filters)

**Categories components** (missing)

- `TrashedCategories.tsx` — trash view nested inside `/categories`

**Accounts components** (missing)

- `TrashedAccounts.tsx` — full-screen trash route at `/accounts/trash`

**Routing corrections**

- `/accounts/new` and `/accounts/:id` are nested routes under the tab layout (rendered as overlays)
- `/categories/trash` is a nested route within the categories tab
- `/accounts/trash` is a full-screen route (no BottomNav)
- BudgetPage, OverviewPage, and TransactionInput are code-split via `React.lazy`

**Architecture facts added**

- All monetary amounts stored and passed in **minor units** (cents). Divide by 100 at display only.
- App startup sequence documented: integrity check → settings load → onboarding guard → startup tab redirect → auto-backup check.
- `QuotaError` class in balance.service for IndexedDB storage exhaustion.
- DB is at schema **version 5** (was undocumented).
- `@` path alias resolves to `./src/`.
- Exchange rate API: `open.er-api.com` (24h TTL, pruned after 90 days).
- Inline `style={{}}` with CSS tokens is the styling pattern — no Tailwind utility classes in JSX.

**Commands section**

- Added `npm run preview`, `npm run screenshots`
- Added Task commands: `task clean`, `task preview`, `task docker:logs`, `task docker:rebuild`
- Corrected `task ci` command (runs `npm test -- --run` not just `npm test`)

**Tech stack**

- Added `vitest@4.1.2`, `prettier@3.8.1`, `eslint@10.1.0` (present in package.json but not listed)

---

### README.md

The README was mostly accurate. Changes:

- **Features section**: added "debt/mortgage" accounts, note search, bulk delete, seed categories in onboarding description
- **Tech stack table**: corrected Recharts entry to "(bar) + custom SVG donut"; added Vitest + Playwright rows; clarified i18next as "English only"
- **Architecture Overview section** added: data model table, balance accounting rule (minor units), state management layers, routing structure, startup sequence, path alias
- **Testing section** expanded: location convention for test files, Vitest environment note, Playwright device emulation note, link to manual smoke test plan
- **Docker section**: added `docker:logs` and `docker:rebuild` task commands
- **Docs table**: added CLAUDE.md entry; corrected test plan count (77 cases, TC-001–TC-077)

---

## Things that are NOT in CLAUDE.md by design (but noted here for context)

- The `docs/archive/` specs are acknowledged as potentially outdated — correct per current instruction.
- `src/db/seed.ts` contains `DEFAULT_CATEGORY_PRESETS` and `DEFAULT_CURRENCIES` used during onboarding and by `CurrencyPicker`. Not a standalone service.
- `scripts/` contains `bootstrap.sh`, `generate-icons.cjs`, `generate-pwa-screenshots.ts` — only the screenshots script is surfaced (via `npm run screenshots`).
- E2E spec files: `accounts.spec.ts`, `mortgage-overpayment.spec.ts`, `onboarding-overview.spec.ts`, `smoke.spec.ts` with `helpers.ts`.
- `src/components/categories/debtAccountTotals.test.ts` is a standalone logic test (no component) for the debt-payment bucketing logic in CategoryList.

---

## No breaking issues found

All documented constraints and patterns were confirmed present in the code. No features are implemented that are supposed to be stubs. No imports or file references appear to be broken.

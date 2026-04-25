# Expenses App — Claude Code Project Context

> This file is auto-loaded by Claude Code. Every agent working in this repo gets this context automatically.

## What this project is

A personal finance tracking **Progressive Web App** (PWA). React 19 + TypeScript + Vite + Tailwind CSS 4 + Dexie (IndexedDB). Primary platform: Android mobile. Works in any browser.

## Historical specs

Initial planning specs live in `docs/archive/` (may be outdated — trust the code over these):

- `docs/archive/spec.md` — original business logic / feature requirements
- `docs/archive/design_spec.md` — visual design tokens, typography, component specs
- `docs/archive/architect_spec.md` — technical architecture, data model, module contracts

## Manual testing

Run tests with the `/smoke-test` slash command (uses Playwright MCP, viewport 390×844):

- `/smoke-test` — runs all P0 smoke tests
- `/smoke-test onboarding` — runs only onboarding cases
- `/smoke-test TC-007` — runs a specific test case
- `/smoke-test P1` — runs all P1 priority cases

The command always closes the browser when done.

## Tech stack (pinned — do not change versions)

```
react@19.2.4          react-dom@19.2.4       typescript@6.0.2
vite@8.0.3            tailwindcss@4.2.2      @tailwindcss/vite@4.2.2
vite-plugin-pwa@1.2.0 dexie@4.4.1            dexie-react-hooks@4.4.0
react-router@7.13.2   zustand@5.0.12         lucide-react@1.7.0
date-fns@4.1.0        i18next@26.0.1         react-i18next@17.0.1
@dnd-kit/core@6.3.1   @dnd-kit/sortable@10.0.0  zod@4.3.6
recharts@3.8.1        xlsx@0.18.5            workbox-window@7.4.0
vitest@4.1.2          prettier@3.8.1         eslint@10.1.0
```

## Project structure (src/)

```
db/
  database.ts       Dexie DB definition, schema (v1 — all dev migrations collapsed for release), indexes
  models.ts         TypeScript interfaces: Account, Category, Transaction, Budget, etc.
  seed.ts           Default category presets, currency list used during onboarding
  sync-stub.ts      No-op server sync stub (future feature)
stores/
  ui-store.ts       Zustand: ephemeral UI state — filters, selection, edit mode
  settings-store.ts Zustand: settings cache (reads DB on load, writes back on change)
services/
  balance.service.ts    Stored-balance mutations; applyTransaction / updateTransaction / deleteTransaction
  backup.service.ts     JSON full-DB backup/restore + scheduled auto-backup
  debt-payment.service.ts  Mortgage/debt math: payment split, term-saved, monthly payment
  exchange-rate.service.ts  Fetch + cache rates from open.er-api.com (24h TTL)
  export.service.ts     XLSX export of transactions for a date range
  integrity.service.ts  DB health check (runs at app startup before settings load)
  math-parser.ts        Arithmetic expression evaluator for the Numpad (PEMDAS, minor-unit output)
  notification.service.ts   Daily reminder scheduling via Web Notifications API
hooks/
  use-accounts.ts       useAccounts(includeTrashed?), useAccount(id)
  use-budgets.ts        useBudgets(month)
  use-categories.ts     useCategories(type?, includeTrashed?), useCategory(id)
  use-exchange-rate.ts  useExchangeRate(from, to) — React hook wrapper around exchangeRateService
  use-install-prompt.ts useInstallPrompt() — PWA install prompt state
  use-total-balance.ts  useTotalBalance() — net worth across all accounts, currency-converted
  use-transactions.ts   useTransactions({ filter, accountId?, categoryId?, noteContains? })
  use-translation.ts    Re-export of useTranslation from react-i18next
pages/
  AccountsPage.tsx      Accounts tab (also handles nested /accounts/new, /accounts/:id sheets)
  BudgetPage.tsx        Budget tab — lazy loaded
  CategoriesPage.tsx    Categories tab (also handles /categories/trash nested route)
  OnboardingPage.tsx    Wrapper for OnboardingFlow
  OverviewPage.tsx      Overview tab — lazy loaded
  SettingsPage.tsx      Full-screen settings page
  TransactionsPage.tsx  Transactions tab
components/
  layout/
    BottomNav.tsx       5-tab bottom navigation bar
    BottomSheet.tsx     Slide-up modal sheet (with test)
    ContentColumn.tsx   Scrollable content area, max-width centered
    TabLayout.tsx       Shell for tab pages: TopBar + ContentColumn + BottomNav
    TopBar.tsx          Fixed page header
  shared/
    AmountDisplay.tsx   Semantic amount with color/glow (income/expense/transfer)
    CalendarPicker.tsx  Custom inline calendar (no date-fns, pure calculation)
    ColorPicker.tsx     24-swatch oklch color picker
    ComingSoonStub.tsx  Greyed-out wrapper with toast for unimplemented features
    ConfirmDialog.tsx   Reusable destructive/default confirmation dialog
    CurrencyPicker.tsx  Searchable currency dropdown with Intl display names
    EmptyState.tsx      Centered empty-state with icon, heading, optional CTA
    ErrorBoundary.tsx   React error boundary; shows reload button in prod
    FilterChips.tsx     Horizontal scrollable chip group for filter selection
    IconPicker.tsx      Lucide icon picker (ICON_LIST from constants.ts)
    IntegrityErrorScreen.tsx  Full-screen DB error recovery (restore from backup)
    Numpad.tsx          Calculator-style input with arithmetic expression support (with test)
    PeriodFilter.tsx    Period selector with prev/next navigation
    Toast.tsx           Toast notification system (ToastProvider + useToast)
  accounts/
    AccountCard.tsx     Account list row with balance and type badge (with test)
    AccountDetail.tsx   Account detail sheet (edit, delete, transactions) (with test)
    AccountForm.tsx     Create/edit account form (with test)
    AccountList.tsx     Sorted list of account cards
    TotalWealth.tsx     Net worth header with multi-currency aggregation (with test)
    TrashedAccounts.tsx Full-screen trash view for accounts (/accounts/trash)
  categories/
    CategoryCard.tsx    Category row with spend/budget bar
    CategoryForm.tsx    Create/edit category form
    CategoryList.tsx    Category list with drag-reorder
    DebtPaymentCard.tsx Debt account payment card with mortgage calculator (with test)
    DonutChart.tsx      Custom SVG donut chart — no Recharts (with test)
    TrashedCategories.tsx  Trash view nested inside /categories
  transactions/
    SelectionToolbar.tsx  Bulk-select toolbar (delete/trash selected)
    TransactionDayHeader.tsx  Date group header with daily income/expense totals
    TransactionFilters.tsx    Filter bottom sheet (note, category, account)
    TransactionInput.tsx  Full-screen create/edit transaction form — lazy loaded (with test)
    TransactionList.tsx   Grouped-by-date transaction list with virtual scroll
    TransactionRow.tsx    Single transaction row
  budget/
    BudgetCard.tsx      Category budget row with progress bar
    BudgetNumpad.tsx    Inline numpad for editing budget amounts (with test)
    BudgetSection.tsx   Budget section grouping (expense/income/debt)
    BudgetStats.tsx     Budget summary header
  overview/
    CategoryBreakdown.tsx  Per-category spend table (with test)
    DailyAverages.tsx     Daily/weekly/monthly average spend callout
    OverviewSummary.tsx   Income vs expense summary cards
    SpendingBarChart.tsx  Recharts bar chart of spending over time
  settings/
    BackupSettings.tsx    Backup/restore/auto-backup settings (with test)
    ExportSettings.tsx    XLSX export date-range settings (with test)
    InstallSetting.tsx    PWA install prompt button
    LanguageSetting.tsx   Language selector (currently English only)
    MainCurrencySetting.tsx   Main currency picker
    NotificationSetting.tsx   Daily reminder time setting
    SettingsView.tsx      Full settings layout with section headers (with test)
    StartupScreenSetting.tsx  Default startup tab picker
    ThemeSetting.tsx      Dark/light toggle (light shows humor dialog)
onboarding/
  OnboardingFlow.tsx    5-step onboarding: welcome → currency → first account → categories → install prompt
i18n/
  index.ts              i18next setup
  locales/en.json       All English translations (single locale)
utils/
  constants.ts          COLOR_PALETTE (24 swatches), ICON_LIST, CHAR_LIMITS, defaults
  currency-utils.ts     formatAmount, formatAmountNoSymbol, convertAmount, getCurrencySymbol
  date-utils.ts         parsePeriodFilter, formatDate, shiftPeriod, autoScaleChartBuckets, etc.
  numpad-utils.ts       formatNumpadDisplay — formats arithmetic expression strings for display
  transaction-utils.ts  isDebtPayment, isExpenseForReporting, getDayTotals
  validation.ts         Zod schemas: accountSchema, categorySchema, transactionSchema, budgetSchema, settingSchemas
  __tests__/            Unit tests for currency-utils, date-utils, math-parser, numpad-utils
types/
  index.ts              PeriodFilter, PeriodFilterType, TabName, CategoryViewType
styles/
  index.css             Tailwind base + all CSS design tokens (--color-*, --text-*, --space-*, etc.)
sw.ts                   Service worker (Workbox InjectManifest strategy)
sw-register.ts          SW registration, install prompt events, periodic sync helpers
App.tsx                 BrowserRouter, route tree, DB integrity check on startup, settings load
main.tsx                React root mount + i18n init
vite-env.d.ts           Vite env type declarations
```

## Key design rules

- **Dark theme only.** `oklch()` colors throughout. No light theme.
- **Fonts**: Syne 700 (headings), DM Sans 400/500 (body/labels), JetBrains Mono 500/600 (all amounts).
- **Numbers are the hero** — amounts always rendered in JetBrains Mono with semantic color + subtle glow.
- **Glow is an accent, not atmosphere** — use sparingly.
- All CSS values from `--token` variables defined in `src/styles/index.css`.
- Mobile-first (Android PWA), max content width 480px centered on desktop.
- All interactive targets: min 44×44px.
- All styling uses inline `style={{}}` objects referencing CSS tokens — no Tailwind utility classes in component JSX.

## Key data rules

- **Balances are stored**, not derived. Updated by `balance.service.ts` on every tx add/edit/delete.
- **All monetary amounts in minor units (cents/pence/etc.)** — divide by 100 for display.
- **Transfers = 2 Transaction records** sharing `transferGroupId` (UUID v4).
- **Soft delete only** — `isTrashed = true`. Trash views exist for accounts (`/accounts/trash`) and categories (nested in `/categories`).
- Transaction `date` = `"YYYY-MM-DD"` local wall-clock. `timestamp` = full UTC ISO-8601.
- `exchangeRate` on a transaction = 1 unit of account currency = X units of main currency.
- All balance mutations inside `db.transaction('rw', ...)` for atomicity.
- `QuotaError` (from balance.service) is thrown when IndexedDB storage is full — callers should handle it.
- DB is at schema version 1 (all development migrations collapsed for first release). Future schema changes add `db.version(2).stores({...})` in `src/db/database.ts`.

## State management

- **Dexie + useLiveQuery** → all persistent domain data (reactive DB reads).
- **Zustand ui-store** → ephemeral UI state (filters, selection, edit mode) — resets on app close.
- **Zustand settings-store** → settings cache (reads DB on startup, writes back on change).

## Routing

React Router 7. Tab layout at `/accounts`, `/categories`, `/transactions`, `/budget`, `/overview`.

Full-screen views (no bottom nav):

- `/transactions/new` — create transaction (lazy)
- `/transactions/:id/edit` — edit transaction (lazy)
- `/accounts/trash` — trashed accounts list
- `/settings` — settings
- `/onboarding` — first-run onboarding flow

Nested within tab layout (rendered as overlays/sheets):

- `/accounts/new`, `/accounts/:id` — account form/detail sheet
- `/categories/trash` — trashed categories within the categories tab

## App startup sequence

1. `checkDatabaseIntegrity()` — if it fails, show `IntegrityErrorScreen` (recovery: restore from backup)
2. `useSettingsStore.load()` — hydrate settings from DB
3. If `!hasCompletedOnboarding` → redirect to `/onboarding`
4. If configured `startupScreen` differs from cold-start path → redirect to configured tab
5. `checkAndRunAutoBackup()` — run auto-backup if interval elapsed

## Path alias

`@` resolves to `./src` — e.g. `import { db } from '@/db/database'`.

## Commands

```bash
npm run dev        # start dev server (http://localhost:5173)
npm run build      # TypeScript check + production build → dist/
npm run preview    # serve production build locally (http://localhost:4173)
npm test           # Vitest unit tests
npm run test:e2e   # Playwright e2e tests (auto-starts dev server)
npm run lint       # ESLint
npm run format     # Prettier (auto-fix)
npm run screenshots # generate PWA screenshot assets
```

With [Task](https://taskfile.dev):

```bash
task setup         # npm install + Playwright browsers
task ci            # lint → test → build (full CI pass)
task format:check  # check formatting without writing
task clean         # remove dist/, test-results/, e2e/screenshots/
task docker:build  # build multi-stage Docker image
task docker:up     # start at http://localhost:80
task docker:down   # stop container
task docker:logs   # tail container logs
task docker:rebuild # rebuild from scratch + restart
```

## What NOT to do

- Do not change pinned dependency versions.
- Do not implement features marked as "future stubs" (recurring transactions, passcode, server sync, savings interest, debt auto-interest). Show them as greyed-out `ComingSoonStub` UI only.
- Do not hard-delete accounts or categories — always soft-delete (`isTrashed = true`).
- Do not implement light theme. Show humor dialog per spec (see `ThemeSetting.tsx`).
- Do not use Spring physics for animations — mechanical timing only.
- Do not use Recharts for the donut chart (Categories tab) — it must be a custom SVG (`DonutChart.tsx`).
- Do not add unsolicited features, comments, or docstrings.
- Do not use Tailwind utility classes in component JSX — use inline `style={{}}` with CSS token variables.

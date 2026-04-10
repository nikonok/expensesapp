# Expenses App — Claude Code Project Context

> This file is auto-loaded by Claude Code. Every agent working in this repo gets this context automatically.

## What this project is

A personal finance tracking **Progressive Web App** (PWA). React 19 + TypeScript + Vite + Tailwind CSS 4 + Dexie (IndexedDB). Primary platform: Android mobile. Works in any browser.

## Specs (source of truth)

| File | Contents |
|---|---|
| `docs/spec.md` | Business logic, all feature requirements, user flows |
| `docs/design_spec.md` | Visual design — color tokens, typography, component specs, motion |
| `docs/architect_spec.md` | Technical architecture, data model, library versions, code contracts |

**Always read the relevant spec section before implementing anything.** The specs are authoritative. If you find a conflict between specs, or a spec problem, **stop and ask the user** with your proposed solution.

## Task tracking

`TASKS.md` — 26 tasks for AI agents. Each task has a self-contained prompt.
- `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
- Mark `[~]` before starting, `[x]` when done.

## Manual testing

`docs/test-plan.md` — 77 manual smoke test cases (TC-001–TC-076) covering all feature areas.

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
```

## Project structure (src/)

```
db/           Dexie database, models, seed data, sync stub
stores/       Zustand stores (ui-store, settings-store)
services/     exchange-rate, balance, backup, export, notification, math-parser
hooks/        useLiveQuery wrappers (use-accounts, use-transactions, etc.)
pages/        Route-level page components (AccountsPage, TransactionsPage, etc.)
components/
  layout/     BottomNav, TopBar, ContentColumn, BottomSheet
  shared/     PeriodFilter, Numpad, ColorPicker, IconPicker, AmountDisplay, Toast, ...
  accounts/   AccountCard, AccountList, AccountForm, AccountDetail, TotalWealth, ...
  categories/ DonutChart, CategoryCard, CategoryList, CategoryForm, ...
  transactions/ TransactionList, TransactionRow, TransactionInput, SelectionToolbar, ...
  budget/     BudgetCard, BudgetSection, BudgetNumpad, BudgetStats
  overview/   OverviewSummary, SpendingBarChart, DailyAverages, CategoryBreakdown
  settings/   SettingsView and per-setting sub-components
onboarding/   OnboardingFlow (first-run setup)
i18n/         i18next setup + locales/en.json
utils/        constants, validation (Zod), date-utils, currency-utils
types/        Shared TypeScript types (PeriodFilter, TabName, etc.)
styles/       index.css — Tailwind + all CSS design tokens
sw.ts         Service worker (PWA, Workbox-based, built by vite-plugin-pwa)
sw-register.ts  Service worker registration + install prompt logic
```

## Key design rules (from design_spec.md)

- **Dark theme only.** `oklch()` colors throughout. No light theme.
- **Fonts**: Syne 700 (headings), DM Sans 400/500 (body/labels), JetBrains Mono 500/600 (all amounts).
- **Numbers are the hero** — amounts always rendered in JetBrains Mono with semantic color + subtle glow.
- **Glow is an accent, not atmosphere** — use sparingly.
- All CSS values from `--token` variables defined in `src/styles/index.css`.
- Mobile-first (Android PWA), max content width 480px centered on desktop.
- All interactive targets: min 44×44px.

## Key data rules (from architect_spec.md)

- **Balances are stored**, not derived. Updated by `balance.service.ts` on every tx add/edit/delete.
- **Transfers = 2 Transaction records** sharing `transferGroupId` (UUID v4).
- **Soft delete only** — `isTrashed = true`. Trash cannot be emptied (intentional).
- Transaction `date` = `"YYYY-MM-DD"` local wall-clock. `timestamp` = full UTC ISO-8601.
- `exchangeRate` on a transaction = 1 unit of account currency = X units of main currency.
- All balance mutations inside `db.transaction('rw', ...)` for atomicity.

## State management

- **Dexie + useLiveQuery** → all persistent domain data (reactive DB reads).
- **Zustand ui-store** → ephemeral UI state (filters, selection, edit mode) — resets on app close.
- **Zustand settings-store** → settings cache (reads DB on startup, writes back on change).

## Routing

React Router 7. Tab layout at `/accounts`, `/categories`, `/transactions`, `/budget`, `/overview`.
Full-screen views (no bottom nav): `/transactions/new`, `/transactions/:id/edit`, `/settings`, `/onboarding`.

## Commands

```bash
npm run dev      # start dev server
npm run build    # TypeScript check + production build
npm test         # Vitest unit tests
npm run lint     # ESLint
npm run format   # Prettier
```

## What NOT to do

- Do not change pinned dependency versions.
- Do not implement features marked as "future stubs" (recurring transactions, passcode, server sync, savings interest, debt auto-interest). Show them as greyed-out `ComingSoonStub` UI only.
- Do not hard-delete accounts or categories — always soft-delete (`isTrashed = true`).
- Do not implement light theme. Show humor dialog per spec.
- Do not use Spring physics for animations — mechanical timing only.
- Do not use Recharts for the donut chart (Categories tab) — it must be a custom SVG.
- Do not add unsolicited features, comments, or docstrings.

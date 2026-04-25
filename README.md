# Expenses App

A personal finance tracking **Progressive Web App** built with React 19, TypeScript, and Tailwind CSS 4. Designed as a mobile-first Android PWA with full offline support — no server, no account, no cloud.

## Screenshots

<table>
  <tr>
    <td><img src="public/screenshots/screenshot-accounts.png" alt="Accounts" width="220"/></td>
    <td><img src="public/screenshots/screenshot-transactions.png" alt="Transactions" width="220"/></td>
    <td><img src="public/screenshots/screenshot-overview.png" alt="Overview" width="220"/></td>
  </tr>
  <tr>
    <td align="center">Accounts</td>
    <td align="center">Transactions</td>
    <td align="center">Overview</td>
  </tr>
</table>

## Features

- **Accounts** — track multiple accounts (cash, bank, crypto, savings, debt/mortgage) with real-time balances
- **Transactions** — income, expenses, and transfers with category tagging, note search, and bulk edit/delete
- **Categories** — custom categories with drag-reorder, budgets, and an interactive donut chart breakdown
- **Budget** — monthly budget tracking per category and debt account, with visual progress bars
- **Overview** — spending trends, daily averages, per-category breakdowns, and a Recharts bar chart
- **Multi-currency** — live exchange rates (open.er-api.com, 24h cache) with per-account currency and automatic conversion
- **Debt tracking** — mortgage and loan tracking with payment split calculator, overpayment term-saved display
- **Offline-first** — all data stored locally in IndexedDB via Dexie, no server required
- **PWA** — installable on Android (and desktop), works without internet, full-screen app experience
- **Backup / Export** — export transactions to XLSX, full JSON data backup and restore, scheduled auto-backup
- **Onboarding** — 5-step first-run flow: language/currency, first account, seed categories, install prompt

## Tech Stack

| Layer       | Library                             |
| ----------- | ----------------------------------- |
| UI          | React 19 + TypeScript 6             |
| Build       | Vite 8 + Tailwind CSS 4             |
| Routing     | React Router 7                      |
| Database    | Dexie 4 (IndexedDB)                 |
| State       | Zustand 5                           |
| Charts      | Recharts 3 (bar) + custom SVG donut |
| Drag & drop | dnd-kit 6/10                        |
| i18n        | i18next 26 (English only)           |
| Validation  | Zod 4                               |
| PWA         | vite-plugin-pwa 1 + Workbox 7       |
| Unit tests  | Vitest 4 + Testing Library          |
| E2E tests   | Playwright (Pixel 7 device)         |

## Getting Started

```bash
npm install
npm run dev       # http://localhost:5173
```

Or with [Task](https://taskfile.dev):

```bash
task setup        # npm install + Playwright browsers
task dev
```

The app opens to the configured startup tab (default: Transactions). On first launch it runs a 5-step onboarding flow to pick currency, create an account, and seed categories.

## Scripts

| Command               | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `npm run dev`         | Development server with HMR (http://localhost:5173)    |
| `npm run build`       | TypeScript check + production build → `dist/`          |
| `npm run preview`     | Serve production build locally (http://localhost:4173) |
| `npm test`            | Vitest unit tests                                      |
| `npm run test:e2e`    | Playwright end-to-end tests (auto-starts dev server)   |
| `npm run lint`        | ESLint                                                 |
| `npm run format`      | Prettier (auto-fix)                                    |
| `npm run screenshots` | Regenerate PWA screenshot assets                       |
| `task ci`             | Full CI pass: lint → test → build                      |
| `task format:check`   | Check formatting without writing                       |
| `task clean`          | Remove dist/, test-results/, e2e/screenshots/          |
| `task docker:up`      | Run in Docker (nginx, http://localhost:80)             |

## Architecture Overview

### Data model

All data lives in IndexedDB (via Dexie, database name `expenses-app-db`, currently schema version 5). The main tables:

- **accounts** — assets, savings, and debt accounts; each has a stored `balance` in minor units (cents)
- **categories** — expense and income categories, drag-sorted via `displayOrder`
- **transactions** — income, expense, and transfer records; transfers are two rows sharing `transferGroupId`
- **budgets** — planned amounts per category or debt account, keyed by `"YYYY-MM"` month
- **exchangeRates** — cached rate responses from open.er-api.com, pruned after 90 days
- **settings** — key-value store for app preferences
- **backups** — full JSON snapshots created manually or on a schedule

All monetary amounts are stored and passed in **minor units** (cents, pence, etc.). Division by 100 happens only at display time.

### Balance accounting

Balances are **stored, not derived**. `balance.service.ts` updates the account balance atomically in a Dexie transaction on every add, update, or delete. The `QuotaError` class signals IndexedDB storage exhaustion.

### State management layers

1. **Dexie + useLiveQuery** — reactive DB reads for all domain data
2. **Zustand `ui-store`** — ephemeral UI state (period filters, transaction selection, category edit mode); lost on page reload
3. **Zustand `settings-store`** — hydrated from DB on startup, written back on change

### Routing

Five tab routes (`/accounts`, `/categories`, `/transactions`, `/budget`, `/overview`) share the `TabLayout` shell (TopBar + ContentColumn + BottomNav). Heavy tabs (Budget, Overview) and the transaction input form are code-split with `React.lazy`.

Full-screen routes (no BottomNav): `/transactions/new`, `/transactions/:id/edit`, `/accounts/trash`, `/settings`, `/onboarding`.

### Startup sequence

On every cold start the app:

1. Runs `checkDatabaseIntegrity()` — shows a recovery screen on failure
2. Loads settings from DB into Zustand
3. Redirects to `/onboarding` if not yet completed, otherwise to the configured startup tab
4. Runs scheduled auto-backup if the interval has elapsed

### Path alias

`@` resolves to `src/` — e.g. `import { db } from '@/db/database'`.

## Testing

**Unit tests** (Vitest, `node` environment, `fake-indexeddb`):

```bash
npm test
# or to run once (CI mode):
npm test -- --run
```

Test files live co-located next to the source file they test (e.g. `AccountForm.test.tsx` beside `AccountForm.tsx`), except pure utility tests which go in `src/utils/__tests__/`.

**End-to-end tests** (Playwright, Pixel 7 device emulation):

```bash
npm run test:e2e
```

Tests are in `e2e/`. The dev server is started automatically. Specs cover onboarding, accounts, transactions, and mortgage overpayment flows.

**Manual smoke tests**: 77 test cases in `docs/test-plan.md`, runnable via the `/smoke-test` Claude Code slash command (Playwright MCP, 390×844 viewport).

## Pre-commit Hooks

Formatting and lint-fix run automatically on staged files via **husky** + **lint-staged**. No manual step needed.

## Docker

A multi-stage Docker image (Node builder → nginx runtime) is included.

```bash
task docker:build   # build image
task docker:up      # start at http://localhost:80
task docker:down    # stop
task docker:logs    # tail container logs
task docker:rebuild # rebuild from scratch + restart
```

The nginx config is in `nginx/nginx.conf`. The `docker-compose.yml` is in the project root.

## Docs

| File                                                   | Contents                                          |
| ------------------------------------------------------ | ------------------------------------------------- |
| [`docs/test-plan.md`](docs/test-plan.md)               | 77 manual smoke test cases (TC-001–TC-077)        |
| [`docs/deployment-setup.md`](docs/deployment-setup.md) | Cloudflare Tunnel + Docker deployment guide       |
| [`docs/archive/`](docs/archive/)                       | Initial planning specs (may be outdated)          |
| [`CLAUDE.md`](CLAUDE.md)                               | Agent context: conventions, constraints, patterns |

## Built with Claude Code

The frontend UI — components, animations, data flows, and overall architecture — was developed using [Claude Code](https://claude.ai/code) with a variety of skills and agents.

## License

MIT

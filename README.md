# Expenses App

A personal finance tracking **Progressive Web App** built with React 19, TypeScript, Vite, and Tailwind CSS 4. Designed as a mobile-first Android PWA with full offline support via IndexedDB (Dexie).

## Features

- **Accounts** — track multiple accounts (cash, bank, crypto, etc.) with real-time balances
- **Transactions** — income, expenses, and transfers with category tagging
- **Categories** — custom categories with budgets and a donut chart breakdown
- **Budget** — monthly budget tracking per category with progress visualization
- **Overview** — spending trends, daily averages, and category breakdowns
- **Multi-currency** — live exchange rates with per-account currency support
- **Offline-first** — all data stored locally in IndexedDB, no server required
- **PWA** — installable on Android, works without internet

## Tech Stack

| Layer | Library |
|---|---|
| UI | React 19 + TypeScript |
| Build | Vite 8 + Tailwind CSS 4 |
| Routing | React Router 7 |
| Database | Dexie 4 (IndexedDB) |
| State | Zustand 5 |
| Charts | Recharts 3 + custom SVG donut |
| i18n | i18next 26 |
| PWA | vite-plugin-pwa |

## Getting Started

```bash
npm install
npm run dev       # start dev server at http://localhost:5173
```

## Scripts

```bash
npm run dev       # development server with HMR
npm run build     # TypeScript check + production build → dist/
npm test          # Vitest unit tests
npm run lint      # ESLint
npm run format    # Prettier
```

## Docs

Full specifications live in `docs/`:

- [`docs/spec.md`](docs/spec.md) — business logic and feature requirements
- [`docs/design_spec.md`](docs/design_spec.md) — visual design tokens, typography, component specs
- [`docs/architect_spec.md`](docs/architect_spec.md) — technical architecture, data model, module contracts

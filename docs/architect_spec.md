# Architecture Specification — Expenses App

**Source of truth for business logic**: `docs/spec.md`
**Source of truth for visual design**: `docs/design_spec.md`
**This document**: Technical architecture, data model, module boundaries, library choices, and implementation contracts.

---

## 1. Technology Stack (Pinned Versions)

| Package | Version | Purpose |
|---|---|---|
| `react` | `19.2.4` | UI framework |
| `react-dom` | `19.2.4` | DOM renderer |
| `typescript` | `6.0.2` | Type safety |
| `vite` | `8.0.3` | Build tool, dev server |
| `vite-plugin-pwa` | `1.2.0` | Service worker generation, PWA manifest |
| `workbox-window` | `7.4.0` | Service worker registration/lifecycle |
| `dexie` | `4.4.1` | IndexedDB wrapper, persistence layer |
| `dexie-react-hooks` | (bundled with dexie 4.x) | `useLiveQuery` for reactive DB reads |
| `tailwindcss` | `4.2.2` | Utility-first CSS |
| `@tailwindcss/vite` | `4.2.2` | Tailwind Vite integration |
| `react-router` | `7.13.2` | Client-side routing |
| `zustand` | `5.0.12` | Ephemeral UI state management |
| `lucide-react` | `1.7.0` | Icon library (tree-shakable) |
| `date-fns` | `4.1.0` | Date manipulation (tree-shakable, no locale bloat) |
| `i18next` | `26.0.1` | i18n framework |
| `react-i18next` | `17.0.1` | React bindings for i18next |
| `@dnd-kit/core` | `6.3.1` | Drag-and-drop primitives |
| `@dnd-kit/sortable` | `10.0.0` | Sortable list support |
| `zod` | `4.3.6` | Runtime schema validation |
| `recharts` | `3.8.1` | Charts (Overview bar chart only) |
| `xlsx` | `0.18.5` | Spreadsheet export (.xlsx) |

> **Note on React version**: This architecture uses React 19 (latest stable). All listed dependencies are compatible with React 19.

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `vitest` | `4.1.2` | Unit/integration testing |
| `@testing-library/react` | `16.3.2` | Component testing |
| `eslint` | `10.1.0` | Linting |
| `prettier` | `3.8.1` | Formatting |

---

## 2. Project Structure

```
src/
├── main.tsx                          # React entry point
├── App.tsx                           # Root component: router + providers
├── sw-register.ts                    # Service worker registration + install prompt handling
│
├── db/
│   ├── database.ts                   # Dexie database class, schema versions, migrations
│   ├── models.ts                     # TypeScript interfaces for all DB entities
│   ├── seed.ts                       # Default data (currencies list, default category presets for onboarding)
│   └── sync-stub.ts                  # Future sync infrastructure stub (no-op)
│
├── stores/
│   ├── ui-store.ts                   # Zustand: ephemeral UI state (filters, selection, active tab)
│   └── settings-store.ts             # Zustand: settings cache (reads from DB, writes back)
│
├── services/
│   ├── exchange-rate.service.ts      # Fetch, cache, and retrieve exchange rates
│   ├── backup.service.ts             # Create/restore/export/import backups
│   ├── export.service.ts             # Transaction export to .xlsx
│   ├── notification.service.ts       # Daily reminder + export-complete notifications
│   ├── balance.service.ts            # Account balance recalculation logic
│   └── math-parser.ts               # Numpad expression evaluator (PEMDAS)
│
├── hooks/
│   ├── use-accounts.ts               # Dexie live queries for accounts
│   ├── use-categories.ts             # Dexie live queries for categories
│   ├── use-transactions.ts           # Dexie live queries for transactions (with filters)
│   ├── use-budgets.ts                # Dexie live queries for budgets
│   ├── use-exchange-rate.ts          # Hook wrapping exchange rate service
│   ├── use-period-filter.ts          # Shared period filter logic
│   ├── use-currency-format.ts        # Format amounts with correct currency symbol/decimals
│   └── use-install-prompt.ts         # PWA install prompt (beforeinstallprompt)
│
├── components/
│   ├── layout/
│   │   ├── BottomNav.tsx             # 5-tab bottom navigation
│   │   ├── TopBar.tsx                # Per-tab top app bar (includes install chip when available)
│   │   ├── ContentColumn.tsx         # Max-width wrapper for desktop centering
│   │   └── BottomSheet.tsx           # Reusable bottom sheet/modal
│   │
│   ├── shared/
│   │   ├── PeriodFilter.tsx          # Period selection UI (shared across tabs)
│   │   ├── ColorPicker.tsx           # Shared 24-color palette picker
│   │   ├── IconPicker.tsx            # Icon/emoji picker
│   │   ├── CurrencyPicker.tsx        # Currency selection list
│   │   ├── EmptyState.tsx            # Generic empty state component
│   │   ├── ComingSoonStub.tsx        # Greyed-out future feature with tooltip
│   │   ├── ConfirmDialog.tsx         # Reusable confirmation dialog
│   │   ├── AmountDisplay.tsx         # Formatted amount with semantic color + glow
│   │   ├── Numpad.tsx                # Transaction/budget numpad with math support
│   │   ├── FilterChips.tsx           # Horizontal scrolling filter pills
│   │   └── Toast.tsx                 # Toast/snackbar notification component
│   │
│   ├── accounts/
│   │   ├── AccountList.tsx           # Account list grouped by type
│   │   ├── AccountCard.tsx           # Single account card
│   │   ├── AccountDetail.tsx         # Account detail bottom sheet
│   │   ├── AccountForm.tsx           # Create/edit account form
│   │   ├── TotalWealth.tsx           # Assets/debts breakdown table
│   │   └── TrashedAccounts.tsx       # Trash view for accounts
│   │
│   ├── categories/
│   │   ├── CategoryList.tsx          # Category cards grid/list
│   │   ├── CategoryCard.tsx          # Single category card
│   │   ├── CategoryForm.tsx          # Create/edit category form
│   │   ├── DonutChart.tsx            # Expense/income donut chart (custom SVG, stroke-based per design spec — not Recharts)
│   │   └── TrashedCategories.tsx     # Trash view for categories
│   │
│   ├── transactions/
│   │   ├── TransactionList.tsx       # Reverse-chronological grouped list
│   │   ├── TransactionRow.tsx        # Single transaction row
│   │   ├── TransactionDayHeader.tsx  # Day group header
│   │   ├── TransactionInput.tsx      # Full add/edit transaction flow
│   │   ├── TransactionFilters.tsx    # Note/category/account filter panel
│   │   └── SelectionToolbar.tsx      # Bottom toolbar for selection mode
│   │
│   ├── budget/
│   │   ├── BudgetSection.tsx         # Single budget section (expenses/income/savings/debt)
│   │   ├── BudgetCard.tsx            # Budget card with progress bar
│   │   ├── BudgetNumpad.tsx          # Budget-specific numpad (stats button)
│   │   └── BudgetStats.tsx           # Average/last month/last budget popup
│   │
│   ├── overview/
│   │   ├── OverviewSummary.tsx       # Net balance, income/expense totals
│   │   ├── SpendingBarChart.tsx      # Auto-scaled bar chart
│   │   ├── DailyAverages.tsx         # Average/today/this week figures
│   │   └── CategoryBreakdown.tsx     # Sorted category list with progress bars
│   │
│   └── settings/
│       ├── SettingsView.tsx          # Full settings page
│       ├── LanguageSetting.tsx
│       ├── ThemeSetting.tsx          # Includes light-theme humor dialog
│       ├── StartupScreenSetting.tsx
│       ├── NotificationSetting.tsx
│       ├── MainCurrencySetting.tsx
│       ├── BackupSettings.tsx        # All backup/restore/export UI
│       └── ExportSettings.tsx        # Date range picker + export trigger
│
├── onboarding/
│   └── OnboardingFlow.tsx            # First-run guided setup (currency, account, categories)
│
├── i18n/
│   ├── index.ts                      # i18next initialization
│   └── locales/
│       └── en.json                   # English translations (only locale for now)
│
├── utils/
│   ├── constants.ts                  # Color palette, currency list, icon list, limits
│   ├── validation.ts                 # Zod schemas for all user inputs
│   ├── date-utils.ts                 # Date helpers (period calculations, formatting)
│   └── currency-utils.ts             # Currency formatting, conversion helpers
│
├── types/
│   └── index.ts                      # Shared TypeScript types not tied to DB models
│
└── styles/
    └── index.css                     # Tailwind directives, CSS custom properties, font imports
```

---

## 3. Data Model (Dexie / IndexedDB)

### 3.1 Database Schema

Database name: `expenses-app-db`

All tables use auto-incrementing `id` (number) as primary key unless noted. All entities include `createdAt` and `updatedAt` (UTC ISO-8601 strings).

```typescript
// db/database.ts
import Dexie, { type EntityTable } from 'dexie';

const db = new Dexie('expenses-app-db') as Dexie & {
  accounts: EntityTable<Account, 'id'>;
  categories: EntityTable<Category, 'id'>;
  transactions: EntityTable<Transaction, 'id'>;
  budgets: EntityTable<Budget, 'id'>;
  exchangeRates: EntityTable<ExchangeRateCache, 'id'>;
  settings: EntityTable<Setting, 'key'>;
  backups: EntityTable<Backup, 'id'>;
};

db.version(1).stores({
  accounts:     '++id, type, name, isTrashed, currency',
  categories:   '++id, type, name, isTrashed, displayOrder',
  transactions: '++id, date, accountId, categoryId, type, [date+displayOrder], [accountId+date], transferGroupId',
  budgets:      '++id, categoryId, accountId, month, [categoryId+month], [accountId+month]',
  exchangeRates:'++id, baseCurrency, &[baseCurrency+date]',
  settings:     'key',
  backups:      '++id, createdAt',
});

export { db };
```

### 3.2 Entity Interfaces

```typescript
// db/models.ts

// ── Accounts ──

type AccountType = 'REGULAR' | 'DEBT' | 'SAVINGS';

interface Account {
  id?: number;
  name: string;                    // max 64 chars
  type: AccountType;
  color: string;                   // oklch value from shared palette
  icon: string;                    // Lucide icon name or emoji
  currency: string;                // ISO 4217 code (e.g. "PLN", "USD")
  description: string;             // max 255 chars
  balance: number;                 // current stored balance (updated on tx add/edit/delete/manual adjust)
  startingBalance: number;         // initial balance at creation (informational, never changes)
  includeInTotal: boolean;         // include in total balance / Total Wealth
  isTrashed: boolean;              // soft delete

  // Savings-specific
  savingsGoal?: number | null;     // optional target amount
  savingsInterestRate?: number | null; // future feature stub: annual interest rate as decimal

  // Debt-specific
  interestRateMonthly?: number | null;    // stored as decimal (e.g. 0.01 = 1%)
  interestRateYearly?: number | null;     // stored as decimal
  mortgageLoanAmount?: number | null;
  mortgageStartDate?: string | null;      // ISO-8601
  mortgageTermYears?: number | null;
  mortgageInterestRate?: number | null;   // stored as decimal

  // Future feature stub
  autoAccrueInterest?: boolean;           // debt auto-interest accrual (not implemented)

  createdAt: string;               // ISO-8601 UTC
  updatedAt: string;               // ISO-8601 UTC
}
```

> **Debt account totals**: The spec mentions two toggles: "Include current debt in totals" and "Include total debt in totals." Per product decision, only current debt (remaining balance) matters. The `includeInTotal` toggle (shared by all account types) controls whether the account's current balance is included in Total Balance and Total Wealth. The "total debt" (original loan amount) is never included in totals — it is informational only, displayed in the debt account detail view. No separate toggles are needed.

```typescript
// ── Categories ──

type CategoryType = 'EXPENSE' | 'INCOME';

interface Category {
  id?: number;
  name: string;                    // max 64 chars
  type: CategoryType;              // immutable after creation
  color: string;                   // oklch value from shared palette
  icon: string;                    // Lucide icon name or emoji
  displayOrder: number;            // drag-reorder position; lower = first
  isTrashed: boolean;              // soft delete

  createdAt: string;
  updatedAt: string;
}

// ── Transactions ──

type TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER';

interface Transaction {
  id?: number;
  type: TransactionType;
  date: string;                    // local date as "YYYY-MM-DD" (wall-clock date at entry time)
  timestamp: string;               // full ISO-8601 UTC (creation moment, for ordering within a day)
  displayOrder: number;            // user-reorderable position within the day; lower = first

  accountId: number;               // FK to accounts.id
  categoryId: number | null;       // FK to categories.id; null for transfers

  currency: string;                // ISO 4217 — account's currency AT THE TIME of transaction creation
                                   // (spec §1b: old transactions always display their original currency,
                                   //  not the account's current currency if it was changed)

  amount: number;                  // in account's currency; always positive
  amountMainCurrency: number;      // converted to main currency; always positive
  exchangeRate: number;            // rate used: 1 unit of account currency = X main currency
                                   // Example: account=USD, main=PLN, 1 USD=4 PLN → exchangeRate=4.0
                                   // Conversion: amountMainCurrency = amount × exchangeRate

  note: string;                    // max 255 chars

  // Transfer-specific
  transferGroupId: string | null;  // shared UUID linking the two halves of a transfer
  transferDirection: 'OUT' | 'IN' | null; // OUT = source, IN = destination

  // Future feature stub
  recurringRule?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    endDate?: string;              // ISO-8601, optional
  } | null;

  createdAt: string;
  updatedAt: string;
}

// ── Budgets ──

interface Budget {
  id?: number;
  categoryId: number | null;       // FK to categories.id; null when budget is for an account
  accountId: number | null;        // FK to accounts.id (DEBT or SAVINGS only); null when budget is for a category
  month: string;                   // "YYYY-MM" format
  plannedAmount: number;           // positive number

  createdAt: string;
  updatedAt: string;
}
```

> **Budget target types**: A budget always has exactly one of `categoryId` or `accountId` set (never both, never neither). Category budgets track spending on expense/income categories. Account budgets track planned payments toward debt accounts or planned deposits into savings accounts. Transfers to a debt or savings account count as "spending" against that account's budget. The Zod schema enforces this mutual exclusivity.

```typescript
// ── Exchange Rate Cache ──

interface ExchangeRateCache {
  id?: number;
  baseCurrency: string;            // ISO 4217
  date: string;                    // "YYYY-MM-DD"
  rates: Record<string, number>;   // { "EUR": 0.85, "GBP": 0.73, ... }
  fetchedAt: string;               // ISO-8601 UTC
}

// ── Settings (key-value) ──

interface Setting {
  key: string;                     // primary key
  value: unknown;                  // JSON-serializable value
}

// Predefined setting keys:
// - "mainCurrency"           : string (ISO 4217, default "USD")
// - "language"               : string (default "en")
// - "startupScreen"          : string (tab name, default "transactions")
// - "notificationEnabled"    : boolean (default false)
// - "notificationTime"       : string ("HH:MM", default "20:00")
// - "lastUsedAccountId"      : number | null
// - "autoBackupIntervalHours": number | null (null = disabled)
// - "lastAutoBackupAt"       : string | null (ISO-8601 UTC)
// - "hasCompletedOnboarding" : boolean (default false)

// ── Backups ──

interface Backup {
  id?: number;
  createdAt: string;               // ISO-8601 UTC
  data: string;                    // JSON-serialized full database snapshot
  isAutomatic: boolean;            // true if created by scheduled backup
}
```

### 3.3 Transfer Storage Model

A transfer is stored as **two Transaction records** sharing the same `transferGroupId` (UUID v4):

1. Record 1: `accountId` = source account, `transferDirection` = `'OUT'`, `categoryId` = null
2. Record 2: `accountId` = destination account, `transferDirection` = `'IN'`, `categoryId` = null

Both records have `type` = `'TRANSFER'`. The `amount` on each record is in that record's account currency. The `amountMainCurrency` is the converted value.

**Why two records**: Enables filtering transactions by account (each account sees its half). Simplifies balance calculation (each account's balance is a simple sum of its own transactions). Matches export requirement (two rows per transfer).

**Display merging**: In the unfiltered transaction list, both halves are merged into a single displayed row by grouping on `transferGroupId`. The row shows "Source → Destination" with the source amount. When filtering by a specific account, only that account's half is shown. The `TransactionList` component performs this grouping before rendering.

**Different-currency transfers**: When the source and destination accounts have different currencies, the user enters the source amount first, then a second field appears for the destination amount (auto-filled via exchange rate, editable). Each half of the transfer stores its own `currency`, `amount`, and `amountMainCurrency` independently.

**Deletion**: Deleting a transfer deletes both records. Editing a transfer edits both records atomically (Dexie transaction).

**Budget impact of transfers**: Transfers to DEBT or SAVINGS accounts count as "spending" against that account's budget (the OUT half's `amountMainCurrency`). Transfers between REGULAR accounts do not affect any budget.

### 3.4 Balance Calculation

Account balance is a **stored value**, not derived. It is updated:

1. **On transaction create**: `balance += amount` (income/transfer-in) or `balance -= amount` (expense/transfer-out)
2. **On transaction edit**: Reverse old effect, apply new effect (atomic Dexie transaction)
3. **On transaction delete**: Reverse the effect
4. **On manual adjust**: User sets balance directly; stored value overwritten; no transaction created

All balance mutations happen inside `balance.service.ts` using Dexie transactions to ensure atomicity. If any operation within `db.transaction()` throws, all changes are rolled back. On IndexedDB quota exceeded, show an error toast suggesting the user export data and clear old backups.

### 3.5 Database Migrations

Use Dexie's `version().stores().upgrade()` chain. Each schema change increments the version number. The `upgrade()` callback transforms data. Never delete old version declarations — Dexie needs the chain for users upgrading from any version.

### 3.6 Sync Stub

`db/sync-stub.ts` exports:

```typescript
export interface SyncConfig {
  serverUrl: string;
  authToken: string;
}

export function initSync(_config: SyncConfig): void {
  // Stub: no-op. Future implementation will use Dexie Cloud or custom sync.
  console.info('[Sync] Sync not implemented. Stub initialized.');
}

export function isSyncEnabled(): boolean {
  return false;
}
```

All entities include `createdAt`/`updatedAt` fields to support future conflict resolution.

### 3.7 Soft Delete and Data Integrity

Categories and accounts use soft delete (`isTrashed = true`). The trash cannot be emptied — this is an intentional design decision that ensures:

1. Foreign key resolution: Transactions store `categoryId` and `accountId`. Since trashed entities remain in the database, these FKs always resolve.
2. Historical display: Trashed categories/accounts can always be displayed on old transactions.
3. Export correctness: The original category/account name is always available.

**If hard-delete is ever added**, denormalized `categoryName` and `accountName` fields would need to be added to the Transaction interface to preserve historical names.

---

## 4. State Management Architecture

### 4.1 Two-Layer Approach

| Layer | Tool | What it holds | Persistence |
|---|---|---|---|
| **Persistent** | Dexie + `useLiveQuery` | All domain data (accounts, categories, transactions, budgets, settings, rates) | IndexedDB — survives app close |
| **Ephemeral** | Zustand | UI-only state (active filters, selection mode, current period, bottom sheet open/close) | Memory — resets on app close |

### 4.2 Why Zustand for ephemeral state

- Spec requires filter state to **reset on app close** — Zustand stores reset naturally.
- Multiple components read the same filter state (period filter affects list + chart + totals). Zustand avoids prop drilling and unnecessary re-renders.
- Selection mode in Transactions tab needs shared state between list rows and toolbar.
- Zustand is ~1KB, has no providers/context wrappers, and works well with concurrent React.

### 4.3 Zustand Store Slices

```typescript
// stores/ui-store.ts

interface PeriodFilter {
  type: 'all' | 'today' | 'custom' | 'day' | 'week' | 'month' | 'year';
  startDate: string;    // "YYYY-MM-DD"
  endDate: string;      // "YYYY-MM-DD"
}

interface UIStore {
  // Per-tab period filters (spec: "filter settings are per-tab")
  categoriesFilter: PeriodFilter;
  transactionsFilter: PeriodFilter;
  overviewFilter: PeriodFilter;
  budgetMonth: string;  // "YYYY-MM"

  // Categories tab: which list is shown (toggled by donut chart tap)
  categoriesViewType: 'EXPENSE' | 'INCOME';   // default: 'EXPENSE'

  // Categories tab: edit mode
  categoriesEditMode: boolean;

  // Transaction tab additional filters
  transactionNoteFilter: string;
  transactionCategoryFilter: number | null;
  transactionAccountFilter: number | null;

  // Selection mode
  selectedTransactionIds: Set<number>;

  // Derived
  hasActiveTransactionFilters: () => boolean;  // true if any of note/category/account filter is non-default

  // Actions
  setCategoriesFilter: (f: PeriodFilter) => void;
  setTransactionsFilter: (f: PeriodFilter) => void;
  setOverviewFilter: (f: PeriodFilter) => void;
  setBudgetMonth: (m: string) => void;
  toggleCategoriesViewType: () => void;         // toggles between EXPENSE and INCOME
  setCategoriesEditMode: (on: boolean) => void;
  setTransactionNoteFilter: (note: string) => void;
  setTransactionCategoryFilter: (id: number | null) => void;
  setTransactionAccountFilter: (id: number | null) => void;
  clearTransactionFilters: () => void;
  toggleTransactionSelection: (id: number) => void;
  clearSelection: () => void;
}
```

`hasActiveTransactionFilters()` returns `true` if any of `transactionNoteFilter !== ''`, `transactionCategoryFilter !== null`, or `transactionAccountFilter !== null`. This drives the visibility of the "Clear filters" button.

**Selection mode dismissal**: If `selectedTransactionIds` becomes empty (last item deselected), or user taps outside the transaction list area, call `clearSelection()`. The `TransactionList` component handles the click-outside detection.

### 4.4 Settings Store

```typescript
// stores/settings-store.ts
// Hydrates from Dexie on app start, writes back on change.

interface SettingsStore {
  mainCurrency: string;
  language: string;
  startupScreen: string;
  notificationEnabled: boolean;
  notificationTime: string;
  lastUsedAccountId: number | null;
  autoBackupIntervalHours: number | null;
  lastAutoBackupAt: string | null;
  hasCompletedOnboarding: boolean;
  isLoaded: boolean;

  load: () => Promise<void>;                    // reads all settings from Dexie
  update: (key: string, value: unknown) => Promise<void>; // writes to Dexie + updates store
}
```

---

## 5. Routing

### 5.1 Route Structure

```
/                          → Redirect to startup screen setting
/accounts                  → Accounts tab
/accounts/trash            → Trashed accounts
/accounts/:id              → Account detail (bottom sheet over accounts list)
/accounts/new              → Create account (bottom sheet)
/categories                → Categories tab
/categories/trash          → Trashed categories
/transactions              → Transactions tab
/transactions/new          → Add transaction (full-screen view)
/transactions/new?type=expense&categoryId=5       → Pre-selected from category tap (skip steps)
/transactions/new?type=income&accountId=3          → Shortcut: add income to account
/transactions/new?type=expense&accountId=3         → Shortcut: add expense from account
/transactions/:id/edit     → Edit transaction (full-screen view)
/budget                    → Budget tab
/overview                  → Overview tab
/settings                  → Settings (full-screen push, no bottom nav)
```

### 5.2 Layout Routes

```tsx
// App.tsx
<Routes>
  <Route element={<TabLayout />}>     {/* renders BottomNav + TopBar + ContentColumn */}
    <Route path="accounts" element={<AccountsTab />}>
      <Route path="trash" element={<TrashedAccounts />} />
      <Route path="new" element={<AccountForm />} />
      <Route path=":id" element={<AccountDetail />} />
    </Route>
    <Route path="categories" element={<CategoriesTab />}>
      <Route path="trash" element={<TrashedCategories />} />
    </Route>
    <Route path="transactions" element={<TransactionsTab />} />
    <Route path="budget" element={<BudgetTab />} />
    <Route path="overview" element={<OverviewTab />} />
  </Route>
  <Route path="transactions/new" element={<TransactionInput />} />
  <Route path="transactions/:id/edit" element={<TransactionInput />} />
  <Route path="settings" element={<SettingsView />} />
  <Route path="onboarding" element={<OnboardingFlow />} />
  <Route path="*" element={<Navigate to="/accounts" />} />
</Routes>
```

Transaction input, settings, and onboarding are **outside** the tab layout — they are full-screen views without the bottom nav.

**Onboarding redirect**: In `App.tsx`, check `hasCompletedOnboarding` from the settings store on initial render. If `false` (or not set), redirect to `/onboarding`. The onboarding flow navigates to the startup screen on completion or skip, and sets `hasCompletedOnboarding = true`.

Account detail, account form, and trashed views render as **bottom sheets/overlays** on top of their parent tab via nested routes.

### 5.3 Navigation Flows

**Category tap (normal mode, spec §2c)**: When user taps a category card outside of edit mode, navigate to `/transactions/new?type={expense|income}&categoryId={id}`. The `TransactionInput` component detects these query params and **skips** the tab selection and category picker steps — it goes directly to the amount/detail view with the category and type pre-selected.

**Account detail shortcuts (spec §1c)**:
- "Add incoming transaction" button → navigate to `/transactions/new?type=income&accountId={id}`
- "Add withdrawal" button → navigate to `/transactions/new?type=expense&accountId={id}`
- "View transactions" button → call `setTransactionAccountFilter(accountId)` on the UI store, then navigate to `/transactions`

---

## 6. Service Layer

### 6.1 Exchange Rate Service

**API**: `https://open.er-api.com/v6/latest/{BASE}` — free, no API key, daily updates.

```typescript
// services/exchange-rate.service.ts

interface ExchangeRateService {
  /**
   * Get rate for converting `from` currency to `to` currency.
   * 1. Check IndexedDB cache for today's rates.
   * 2. If cache miss or stale (>24h), fetch from API.
   * 3. If fetch fails, return most recent cached rate.
   * 4. If no cache exists at all, return null (caller shows 1:1 fallback banner).
   */
  getRate(from: string, to: string): Promise<number | null>;

  /**
   * Force-fetch fresh rates for a base currency.
   * Called on app startup and when main currency changes.
   */
  fetchAndCacheRates(baseCurrency: string): Promise<void>;

  /**
   * Get the rate that was cached on or closest before a given date.
   * Used when viewing/editing historical transactions.
   */
  getHistoricalRate(from: string, to: string, date: string): Promise<number | null>;
}
```

**Exchange rate direction convention**:
- The API returns rates where `baseCurrency` is the base: `rates["PLN"]` on a USD base means 1 USD = X PLN.
- On a Transaction, `exchangeRate` means: 1 unit of account currency = X units of main currency.
- Example: account currency is USD, main currency is PLN, API reports 1 USD = 4.0 PLN → `exchangeRate = 4.0`, `amountMainCurrency = amount × 4.0`.
- All conversions in the app are `accountCurrency → mainCurrency`, so a single fetch per day (for the main currency as base) suffices.

**Fetch failure behavior**:
- Show a dismissible toast/banner: "Could not fetch exchange rates. Using cached rates." (if cache exists)
- Show a persistent banner: "No exchange rate available — using 1:1 conversion." (if no cache at all)
- The banner must be visible on any screen where conversion is happening.

**Caching strategy**:
- Cache keyed by `(baseCurrency, date)` in `exchangeRates` table.
- On app startup, fetch rates for the main currency. On success, cache. On failure, log and use stale cache.
- Keep last 90 days of cached rates. Prune older entries on startup.

**Main currency change — recalculation**:

When the user changes the main currency, all historical transactions must be recalculated. This is handled by a dedicated method:

```typescript
/**
 * Recalculate amountMainCurrency and exchangeRate on ALL transactions
 * for a new main currency. Runs inside a single Dexie transaction.
 *
 * For each transaction:
 *   newRate = getRate(transaction.currency, newMainCurrency)
 *   transaction.amountMainCurrency = transaction.amount × newRate
 *   transaction.exchangeRate = newRate
 *
 * If rates are unavailable for any currency, throws an error
 * listing the missing currencies (caller blocks the change).
 *
 * Shows a progress indicator via a callback.
 */
recalculateAllMainCurrencyAmounts(
  newMainCurrency: string,
  onProgress?: (done: number, total: number) => void
): Promise<void>;
```

This method is called after the confirmation dialog and before updating the `mainCurrency` setting. If it throws, the setting is not changed.

### 6.2 Balance Service

```typescript
// services/balance.service.ts

interface BalanceService {
  /**
   * Apply a new transaction's effect on account balance.
   * Runs inside a Dexie transaction.
   */
  applyTransaction(tx: Transaction): Promise<void>;

  /**
   * Reverse a transaction's effect (for delete or pre-edit).
   */
  reverseTransaction(tx: Transaction): Promise<void>;

  /**
   * Manually set an account's balance (no transaction created).
   */
  adjustBalance(accountId: number, newBalance: number): Promise<void>;

  /**
   * Recalculate an account's balance from scratch.
   * balance = startingBalance + sum(income/transfer-in) - sum(expense/transfer-out)
   * Safety net — called if data integrity is suspected.
   */
  recalculateBalance(accountId: number): Promise<void>;
}
```

Balance effect rules:
- `INCOME` transaction on account: `balance += amount`
- `EXPENSE` transaction on account: `balance -= amount`
- `TRANSFER OUT` on source account: `balance -= amount`
- `TRANSFER IN` on destination account: `balance += amount`

**Debt balance convention**: Debt account balances are positive numbers representing the amount owed. A `TRANSFER IN` to a debt account represents a payment and reduces the balance (`balance -= amount`). An `EXPENSE` on a debt account increases the amount owed (`balance += amount`, reversing the normal sign). The balance service must check `account.type` to apply the correct sign for DEBT accounts.

### 6.3 Math Expression Parser

```typescript
// services/math-parser.ts

/**
 * Evaluates a numpad math expression string.
 * Supports: +, -, ×, ÷ with standard PEMDAS order of operations.
 * Returns result rounded to 2 decimal places.
 * Trailing operator is ignored.
 * Returns null if expression is invalid.
 *
 * Examples:
 *   "100+50" → 150.00
 *   "100+50×2" → 200.00 (PEMDAS: 50×2=100, 100+100=200)
 *   "100+" → 100.00 (trailing operator ignored)
 *   "" → null
 *   "abc" → null
 */
export function evaluateExpression(expr: string): number | null;
```

Implementation approach: tokenize into numbers and operators, build a simple recursive descent parser or use the shunting-yard algorithm. No `eval()` — ever.

### 6.4 Backup Service

```typescript
// services/backup.service.ts

interface BackupService {
  /**
   * Create an on-device backup. Serializes all Dexie tables to JSON,
   * stores in the `backups` table.
   */
  createBackup(isAutomatic?: boolean): Promise<number>; // returns backup ID

  /**
   * List all on-device backups (id, createdAt, isAutomatic).
   */
  listBackups(): Promise<BackupMeta[]>;

  /**
   * Restore from an on-device backup. DESTRUCTIVE: clears all tables
   * EXCEPT the `backups` table, then populates from backup data.
   * Must show confirmation dialog first.
   */
  restoreFromBackup(backupId: number): Promise<void>;

  /**
   * Export a backup as a downloadable .json file.
   * Triggers browser download — file saved to user's default download directory.
   * (PWAs cannot programmatically choose a save location.)
   */
  exportToFile(): Promise<void>;

  /**
   * Import a backup from a .json file. DESTRUCTIVE: same as restore.
   * Validates JSON structure against expected schema before restoring.
   * Rejects malformed files with "Invalid backup file format" error dialog.
   */
  importFromFile(file: File): Promise<void>;

  /**
   * Schedule automatic backups (stores schedule in settings).
   */
  setAutoBackupSchedule(intervalHours: number | null): Promise<void>;

  /**
   * Check if auto-backup is due. Called on app startup.
   * If now - lastAutoBackupAt > autoBackupIntervalHours, creates ONE backup
   * (not multiple catch-ups for missed intervals).
   */
  checkAndRunAutoBackup(): Promise<void>;
}
```

**Backup format**: JSON containing:
```json
{
  "version": 1,
  "exportedAt": "2026-03-29T12:00:00Z",
  "appVersion": "1.0.0",
  "tables": {
    "accounts": [...],
    "categories": [...],
    "transactions": [...],
    "budgets": [...],
    "settings": [...],
    "exchangeRates": [...]
  }
}
```

**Restore behavior**: Clears all tables **except** the `backups` table (preserves backup history for recovery). This is a design exception to the spec's "completely overwrites" — preserving backup history protects the user from accidental data loss. The confirmation dialog warns: "This will delete all current data and replace it with the backup. This cannot be undone."

### 6.5 Export Service

```typescript
// services/export.service.ts

interface ExportService {
  /**
   * Export transactions in a date range to .xlsx file.
   *
   * Columns:
   *   Date (dd.mm.yyyy) | Note | Income (main currency) | Expense (main currency) | Category | Account
   *
   * Rules:
   * - Income transactions: amount in "Income" column, "Expense" column empty
   * - Expense transactions: amount in "Expense" column, "Income" column empty
   * - Transfers: two rows (one per account), Category = "Transfer",
   *   OUT half → amount in "Expense" column, IN half → amount in "Income" column
   * - All amounts are positive numbers
   * - Foreign currency: uses amountMainCurrency stored at tx time
   * - Deleted category/account: original name as plain text (resolved via soft-deleted entity)
   *
   * Runs async. On completion:
   * - If app is in foreground: show toast "Export complete" + trigger download
   * - If app is backgrounded: send OS notification via Notification API
   *
   * PWA limitation: file saved to browser's default download directory
   * (cannot programmatically choose save location).
   */
  exportTransactions(startDate: string, endDate: string): Promise<void>;
}
```

### 6.6 Notification Service

```typescript
// services/notification.service.ts

interface NotificationService {
  /**
   * Request notification permission from the user.
   * Returns true if granted.
   */
  requestPermission(): Promise<boolean>;

  /**
   * Schedule a daily notification at the given wall-clock time.
   * Uses the service worker to fire at the correct time.
   * On platforms where service worker timers are unreliable (iOS),
   * falls back to checking on app open and showing a "Did you log today?" prompt.
   */
  scheduleDailyReminder(time: string): Promise<void>;

  /**
   * Cancel the daily reminder.
   */
  cancelDailyReminder(): Promise<void>;

  /**
   * Check if notifications are supported on this platform.
   */
  isSupported(): boolean;

  /**
   * Show a one-off notification (used by export service, etc.).
   * Falls back to in-app toast if Notification API unavailable.
   */
  showNotification(title: string, body: string): Promise<void>;
}
```

**Platform behavior**:
- **Android (Chrome PWA)**: Full support — service worker + `showNotification()`. Use `periodicSync` if available, otherwise use `setTimeout` recalculated on each service worker wake.
- **iOS (Safari PWA)**: Notifications supported since iOS 16.4 in installed PWAs. Same approach, but `periodicSync` is not available. Fallback: on app open, check if today's reminder was missed and show an in-app prompt.
- **Desktop browser**: Use standard `Notification` API. No persistent scheduling — only fires if tab is open. Show a note in settings: "Desktop notifications only work when the app is open."

---

## 7. Validation Layer

All user input is validated using Zod schemas before writing to the database.

```typescript
// utils/validation.ts

import { z } from 'zod';

export const accountSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(['REGULAR', 'DEBT', 'SAVINGS']),
  color: z.string(),
  icon: z.string(),
  currency: z.string().length(3),
  description: z.string().max(255).default(''),
  startingBalance: z.number().finite(),
  includeInTotal: z.boolean().default(true),
  savingsGoal: z.number().positive().nullable().optional(),
  savingsInterestRate: z.number().min(0).max(1).nullable().optional(),
  interestRateMonthly: z.number().min(0).max(1).nullable().optional(),
  interestRateYearly: z.number().min(0).max(1).nullable().optional(),
  mortgageLoanAmount: z.number().positive().nullable().optional(),
  mortgageStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  mortgageTermYears: z.number().positive().int().nullable().optional(),
  mortgageInterestRate: z.number().min(0).max(1).nullable().optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(['EXPENSE', 'INCOME']),
  color: z.string(),
  icon: z.string(),
});

export const transactionSchema = z.object({
  type: z.enum(['EXPENSE', 'INCOME', 'TRANSFER']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable(),
  currency: z.string().length(3),
  amount: z.number().positive().finite(),
  amountMainCurrency: z.number().positive().finite(),
  exchangeRate: z.number().positive().finite(),
  note: z.string().max(255).default(''),
  transferGroupId: z.string().uuid().nullable().optional(),
  transferDirection: z.enum(['OUT', 'IN']).nullable().optional(),
});

export const budgetSchema = z.object({
  categoryId: z.number().int().positive().nullable(),
  accountId: z.number().int().positive().nullable(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  plannedAmount: z.number().positive().finite(),
}).refine(
  (data) => (data.categoryId != null) !== (data.accountId != null),
  { message: 'Budget must target exactly one of categoryId or accountId' }
);

export const settingSchemas = {
  mainCurrency: z.string().length(3),
  language: z.string().min(2).max(10),
  startupScreen: z.enum(['accounts', 'categories', 'transactions', 'budget', 'overview']),
  notificationEnabled: z.boolean(),
  notificationTime: z.string().regex(/^\d{2}:\d{2}$/),
  autoBackupIntervalHours: z.number().positive().int().nullable(),
};
```

Validation errors are surfaced to the UI via the form components. Character counters are shown on text inputs as specified in design_spec.md.

---

## 8. PWA Configuration

### 8.1 Vite PWA Plugin Config

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',           // show update prompt to user
      includeAssets: ['fonts/**/*'],     // cache custom fonts
      manifest: {
        name: 'Expenses',
        short_name: 'Expenses',
        description: 'Personal expense and finance tracker',
        theme_color: '#0A0B12',          // --color-bg
        background_color: '#0A0B12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/open\.er-api\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'exchange-rates',
              expiration: { maxAgeSeconds: 86400 },  // 24h
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
});
```

> **No Google Fonts runtime caching**: Fonts are self-hosted (see §12). The Google Fonts caching rule is removed.

### 8.2 Service Worker Registration

```typescript
// sw-register.ts
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    // Show "New version available" toast with "Update" button
    // On confirm: updateSW(true) reloads the page
  },
  onOfflineReady() {
    // Show "App ready for offline use" toast
  },
});
```

### 8.3 Install Prompt Handling

```typescript
// hooks/use-install-prompt.ts

/**
 * Intercepts the `beforeinstallprompt` event.
 * Returns { canInstall: boolean, promptInstall: () => void }.
 *
 * When `canInstall` is true, the TopBar shows a subtle "Add to Home Screen" chip.
 * After the user dismisses the prompt (accept or decline), the chip is hidden.
 * The chip auto-dismisses after one user dismissal per session.
 */
```

---

## 9. i18n Architecture

### 9.1 Setup

```typescript
// i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },  // React handles XSS
});

export default i18n;
```

### 9.2 Adding a New Locale

1. Create `src/i18n/locales/{locale}.json` with the same key structure as `en.json`.
2. Import it in `i18n/index.ts` and add to `resources`.
3. Add the locale code to the language picker in settings.

No code changes needed beyond these three steps. All user-facing strings are wrapped in `t()` calls.

### 9.3 Translation Key Conventions

```
tabs.accounts, tabs.categories, tabs.transactions, tabs.budget, tabs.overview
accounts.create, accounts.edit, accounts.trash, accounts.totalWealth
categories.create, categories.edit, categories.trash
transactions.add, transactions.edit, transactions.noData
budget.planned, budget.spent, budget.stats
overview.netBalance, overview.income, overview.expenses
settings.language, settings.theme, settings.currency, ...
common.save, common.cancel, common.delete, common.confirm
errors.required, errors.maxLength, errors.invalidAmount
```

---

## 10. Key Algorithms

### 10.1 Total Balance Calculation

```
Total Balance (in main currency) =
  SUM over non-trashed accounts where includeInTotal == true:
    For REGULAR and SAVINGS accounts: + account.balance × getRate(account.currency, mainCurrency)
    For DEBT accounts:               - account.balance × getRate(account.currency, mainCurrency)
```

> Debt balances are positive numbers representing amount owed, so they are subtracted from total balance.

For the Total Wealth sub-view (§1a), group by currency before converting:
- Assets = SUM(balance) for REGULAR + SAVINGS accounts, grouped by currency
- Debts = SUM(balance) for DEBT accounts, grouped by currency
- Exclude: trashed accounts AND accounts where includeInTotal == false

### 10.2 Period Filter Date Range Resolution

```typescript
function resolvePeriod(filter: PeriodFilter, referenceDate: Date): { start: Date; end: Date } {
  switch (filter.type) {
    case 'all':    return { start: new Date(0), end: new Date('9999-12-31') };
    case 'today':  return { start: startOfDay(ref), end: endOfDay(ref) };
    case 'day':    return { start: startOfDay(filter.date), end: endOfDay(filter.date) };
    case 'week':   return { start: startOfWeek(filter.date, { weekStartsOn: 1 }), end: endOfWeek(...) };
    case 'month':  return { start: startOfMonth(filter.date), end: endOfMonth(filter.date) };
    case 'year':   return { start: startOfYear(filter.date), end: endOfYear(filter.date) };
    case 'custom': return { start: filter.startDate, end: filter.endDate };
  }
}
```

Navigation with `<` `>` buttons: increment/decrement the anchor date by the period unit. For month navigation (Budget tab), anchor to day 1 to avoid the Jan 31 → Feb 28 problem (spec §4).

### 10.3 Bar Chart Auto-Scaling (Overview §5)

```
Given period in calendar days:
  1 day           → group by hour (0–23), one bar per hour
  2–30 days       → group by day, one bar per day
  31–90 days      → group by ISO week (Mon–Sun), one bar per week
  > 90 days       → group by month, one bar per month
```

Partial weeks/months at boundaries get their own bar.

### 10.4 Daily Averages (Overview §5)

```
averagePerDay = totalExpenses / calendarDaysInPeriod  (including zero-spend days)
todaySpend    = SUM(expenses where date == today)     (only if today ∈ period)
thisWeekSpend = SUM(expenses where date ∈ currentWeek) (only if period overlaps current week)
```

### 10.5 Debt Account Calculations (§1c)

On-demand when opening debt account detail:

```
remainingBalance    = account.balance  (this IS the remaining balance)
monthlyPayment      = mortgageLoanAmount × (r(1+r)^n) / ((1+r)^n - 1)
                      where r = monthlyInterestRate, n = mortgageTermYears × 12
                      (standard amortization formula; shown only if mortgage fields are set)
timeLeftToPayOff    = derived from remaining balance and monthly payment
accruedInterest     = principal × annualRate × (daysSinceCreation / 365)
                      (simple interest, 365-day year, as specified in spec)

Interest rate precedence for accruedInterest:
  1. Use interestRateYearly if set
  2. Else if interestRateMonthly is set: annualRate = interestRateMonthly × 12
  3. Else if mortgageInterestRate is set: use as fallback
  4. Else: do not show accrued interest

mortgageInterestRate is used exclusively for mortgage-specific calculations
(monthlyPayment, timeLeftToPayOff) — not for accruedInterest unless it is
the only rate available.
```

These are **display-only** calculations. They never modify the stored balance.

### 10.6 Transaction Display Order

Each transaction has a `displayOrder` field (integer). Within a day:
- New transactions get `displayOrder = MAX(displayOrder for that day) + 1`
- Drag-reorder updates the `displayOrder` values for all affected transactions in the day
- When a transaction's date is changed via edit, its `displayOrder` is set to `MAX(displayOrder for new day) + 1` (bottom of the new day)
- Transactions are queried with compound index `[date+displayOrder]` for efficient sorted retrieval
- **Drag constraint**: Transaction drag-and-drop uses `@dnd-kit/sortable` with separate sortable contexts per day group. Items cannot be dragged between day groups. To move a transaction to a different day, use the calendar picker in the edit view.

### 10.7 Category Display Order

Same pattern as transaction display order. Categories have a `displayOrder` field:
- Initially set alphabetically (by insertion order if created one at a time)
- Drag-reorder in edit mode updates `displayOrder` for all affected categories
- Queried with index on `displayOrder`

### 10.8 Budget Stats (Budget Tab Numpad §4)

When the "stats" button is tapped on the budget numpad, compute three values:

```
Average monthly spend (all time):
  = Total spending in this category (or account) across all months
    ÷ Number of distinct months that have at least one transaction for this target
  If no history: show "N/A"

Last month's actual spend:
  = SUM(transactions for this category/account in the previous calendar month)
  If no transactions last month: show "0" (not N/A — the month happened, spending was zero)

Last set budget:
  = Most recent Budget record for this categoryId/accountId, ordered by `month` DESC, take first
  If no budget ever set: show "N/A"
```

### 10.9 Default "From" Account Selection

When opening the add-transaction flow:

```
1. Read lastUsedAccountId from settings
2. If it refers to a non-trashed account → use it
3. If it refers to a trashed account or is null:
   a. Query transactions ordered by date DESC
   b. Find the first transaction whose accountId refers to a non-trashed account
   c. Use that account
4. If no transactions exist at all:
   a. Query accounts where isTrashed == false, ordered by name ASC
   b. Use the first one
5. If no accounts exist: prompt user to create an account first
```

### 10.10 Donut Chart Data (Categories Tab §2)

The donut chart **always** displays expense category data regardless of the active view toggle:
- **Slices**: One per expense category, sized proportionally to that category's share of total expenses in the selected period. Colored by that category's color.
- **Center text**: Total expenses in `--color-expense` (red) and total income in `--color-income` (green).
- **Tap behavior**: Toggles `categoriesViewType` between `'EXPENSE'` and `'INCOME'`. The chart itself does not change appearance — only the category list below it changes. This is intentional per spec.

### 10.11 Budget Calculations for Debt/Savings Accounts

For the "Savings accounts" and "Debt accounts" sections of the Budget tab:

```
Spent/deposited this month for an account =
  SUM(amountMainCurrency) of TRANSFER IN transactions
  where accountId = this account AND date falls in the selected month

This counts transfers TO the debt/savings account as "spending toward" that budget.
Regular income/expense transactions on these accounts are NOT counted —
only transfers represent intentional payments/deposits.
```

A budget can be planned for a DEBT or SAVINGS account just like for a category. The progress bar shows how much of the planned monthly payment/deposit has been made.

---

## 11. Data Flow Patterns

### 11.1 Adding a Transaction (end-to-end)

```
User taps + → TransactionInput renders
  → If query params present (type, categoryId, accountId):
      skip tab selection and/or category picker, go directly to amount view
  → Otherwise:
      User selects tab (Income/Expense/Transfer)
      → User picks category (or accounts for transfer)
  → User enters amount on Numpad
  → User taps Save

Save handler:
  1. evaluateExpression(rawInput) → amount (or show error if null)
  2. Validate via transactionSchema.parse(...)
  3. Fetch exchange rate: getRate(accountCurrency, mainCurrency)
     - If null → show 1:1 banner, use rate = 1
  4. Begin Dexie transaction:
     a. Create Transaction record(s) (2 for transfers)
        - Set `currency` to the account's current currency at this moment
     b. Call balanceService.applyTransaction() for each record
  5. Update lastUsedAccountId in settings
  6. Navigate back (router.back())

All Dexie live queries auto-update: account cards show new balance,
transaction list shows new entry, charts recalculate.
```

**"Use last note" behavior**: When a category is selected, query the most recent transaction with that `categoryId`, ordered by `timestamp` DESC. If found, display its `note` as a suggestion in the notes field (lighter color per design spec). A "Use last note" chip allows one-tap acceptance. Tapping into the field clears the suggestion and allows fresh input.

**Foreign currency dual-amount field (spec §3a)**: If the selected account's currency differs from the main currency:
1. Primary field: amount in account's currency (user types here)
2. Secondary field: amount in main currency (auto-calculated as `amount × exchangeRate`)
3. Secondary field becomes **editable only after** user enters a value in the primary field
4. Editing the primary field **always recalculates** and overwrites the secondary field
5. Editing the secondary field **overrides** the conversion for this transaction only; the primary field is not affected
6. The transaction stores both amounts and the exchange rate used

**Transfer between different-currency accounts**: Same dual-field pattern applies to the destination amount. User enters source amount, destination amount auto-fills via exchange rate, user can override.

### 11.2 Editing a Transaction

```
1. Load existing transaction by ID
2. Pre-fill TransactionInput with all values
3. If the transaction's categoryId refers to a trashed category:
   - Show the old category name greyed out as a read-only label
   - Mark the category field as invalid — user MUST select a new active category before saving
4. On save:
   a. Begin Dexie transaction:
      - balanceService.reverseTransaction(oldTx)
      - Update transaction record
      - balanceService.applyTransaction(newTx)
      - If date changed: reset displayOrder to bottom of new day
      - If transfer: update both records
   b. Navigate back
```

### 11.3 Deleting Transactions

```
1. For each selected transaction:
   a. Begin Dexie transaction:
      - balanceService.reverseTransaction(tx)
      - If transfer: also reverse and delete the paired record
      - Delete the transaction record
2. Clear selection
```

### 11.4 Reactive Data Flow

```
IndexedDB (Dexie)
    ↓ useLiveQuery (auto-subscribes to table changes)
React Component
    ↓ renders UI
User Interaction
    ↓ calls service method
Service writes to Dexie
    ↓ triggers useLiveQuery re-evaluation
React Component re-renders with new data
```

No manual cache invalidation. No event bus. Dexie's reactivity handles it.

---

## 12. Offline Behavior

The app is **offline-first**. All features work without a network connection except:

| Feature | Online | Offline |
|---|---|---|
| Core app (all CRUD) | Works | Works |
| Exchange rates | Fetches fresh | Uses cached rates; if no cache → 1:1 fallback with banner |
| Font loading | Self-hosted — no network needed | Works from service worker cache |
| App updates | Detects and prompts | Uses cached version |

### Font Caching Strategy

Self-host the three fonts (Syne, DM Sans, JetBrains Mono) as `.woff2` files in `/public/fonts/`. This eliminates the Google Fonts dependency and ensures fonts are available offline on first install. Use `font-display: swap` to avoid invisible text during load.

---

## 13. Testing Strategy

| Layer | Tool | What to test |
|---|---|---|
| Math parser | Vitest | All expression edge cases, PEMDAS, trailing operators, invalid input |
| Validation schemas | Vitest | Boundary values, invalid inputs, type coercion, budget mutual exclusivity |
| Balance service | Vitest + Dexie (fake-indexeddb) | Balance mutations, atomicity, edge cases |
| Exchange rate service | Vitest (mocked fetch) | Cache hit/miss, fallback behavior, stale cache |
| Backup/restore | Vitest + Dexie | Round-trip serialization, version compatibility |
| Period filter logic | Vitest | All period types, boundary dates, navigation |
| Budget calculations | Vitest | Category budgets, account budgets, transfer counting |
| Components | @testing-library/react | Critical user flows (add tx, edit account, etc.) |

---

## 14. Performance Considerations

1. **Dexie indexes**: All query patterns are covered by declared indexes. The `[date+displayOrder]` compound index is critical for transaction list performance. The `[categoryId+month]` and `[accountId+month]` compound indexes enable efficient budget lookups.
2. **useLiveQuery scoping**: Each live query should be scoped as narrowly as possible (e.g., transactions for the current period only, not all transactions).
3. **Virtualized lists**: If transaction list exceeds ~200 visible items, consider `react-window` or similar. Not needed in MVP — evaluate if performance degrades.
4. **Chart rendering**: The donut chart is a custom SVG component (stroke-based per design spec). The Overview bar chart uses Recharts (React-based SVG), which is adequate for its needs.
5. **Bundle size**: Lucide is tree-shakable — import only used icons. SheetJS is large (~200KB); load it dynamically only when export is triggered (`import('xlsx')`).
6. **Font loading**: Self-hosted woff2 files with `font-display: swap` to avoid invisible text during load.

---

## 15. Currency List

The full currency list is derived from the exchange rate API response. On first app startup, fetch rates and store the list of supported currency codes. This list is used in the currency picker (account creation, main currency setting).

Fallback if API is unreachable on first startup: embed a static list of ~30 common currencies (USD, EUR, GBP, PLN, BYN, RUB, etc.) as a constant. The full list replaces it once a successful fetch occurs.

---

## 16. Shared Color Palette

Defined as a constant array of 24 oklch color values matching design_spec.md exactly. Used in `ColorPicker` component for both accounts and categories. Colors are stored as the oklch string on the entity. No uniqueness constraint.

```typescript
// utils/constants.ts
export const COLOR_PALETTE: string[] = [
  // 4 reds/pinks
  'oklch(65% 0.22 0)',     // true red
  'oklch(65% 0.22 10)',    // warm red
  'oklch(65% 0.22 340)',   // pink-red
  'oklch(65% 0.22 355)',   // cool red
  // 3 oranges
  'oklch(65% 0.22 30)',    // orange
  'oklch(65% 0.22 45)',    // amber
  'oklch(65% 0.22 60)',    // yellow-orange
  // 3 yellows
  'oklch(65% 0.22 75)',    // gold
  'oklch(65% 0.22 90)',    // yellow
  'oklch(65% 0.22 100)',   // lime-yellow
  // 3 greens
  'oklch(65% 0.22 130)',   // lime
  'oklch(65% 0.22 150)',   // green
  'oklch(65% 0.22 165)',   // teal-green
  // 4 blues/cyans
  'oklch(65% 0.22 180)',   // cyan
  'oklch(65% 0.22 200)',   // sky
  'oklch(65% 0.22 220)',   // blue
  'oklch(65% 0.22 240)',   // deep blue
  // 3 purples
  'oklch(65% 0.22 270)',   // blue-purple
  'oklch(65% 0.22 290)',   // purple
  'oklch(65% 0.22 310)',   // magenta-purple
  // 4 neutrals (lower chroma)
  'oklch(65% 0.08 30)',    // warm brown
  'oklch(65% 0.06 60)',    // sand
  'oklch(65% 0.04 265)',   // cool gray
  'oklch(48% 0.03 265)',   // dark slate
];
```

---

## 17. Future Feature Stubs

Each stub has:
1. A visible but disabled UI entry point (opacity 40%, "Coming soon" tooltip on tap)
2. A schema/model that won't need breaking changes when implemented

| Feature | UI Stub Location | Schema Stub |
|---|---|---|
| Recurring transactions | "Repeat" option below numpad in TransactionInput | `recurringRule` field on Transaction interface (nullable, defined in §3.2) |
| Passcode / biometric | Settings → "Passcode" row | None needed — will use Web Authentication API |
| Server sync | Settings → "Sync" row (below backup) | `sync-stub.ts` already defined in §3.6 |
| Savings interest rate | Account form → "Interest rate" field for savings | `savingsInterestRate` field on Account interface (defined in §3.2) |
| Debt auto-interest | Account detail → "Auto-accrue interest" toggle | `autoAccrueInterest` field on Account interface (defined in §3.2) |

---

## 18. Error Handling Strategy

| Error type | Handling |
|---|---|
| Validation error | Inline field errors + character counters. Do not submit to DB. |
| Dexie write failure | Toast with retry option. Log to console. On quota exceeded: suggest exporting data and clearing old backups. |
| Exchange rate fetch failure | Dismissible banner. Use cached or 1:1 fallback. Never block the user. |
| Backup restore failure | Error dialog with details. Do not partially restore — all-or-nothing via Dexie transaction. |
| Export failure | Toast with error details. |
| Notification permission denied | Show explanation in settings. Do not re-prompt. |
| Invalid backup file import | Error dialog: "Invalid backup file format." |

General principle: **never block the user from using the app**. Network failures degrade gracefully. Storage failures show actionable errors.

---

## 19. Security Considerations

1. **No eval()**: The math parser must never use `eval()` or `Function()`.
2. **Input sanitization**: All text inputs are validated via Zod schemas. Max lengths enforced. React's JSX escaping prevents XSS.
3. **No sensitive data in service worker cache**: Exchange rates are not sensitive, but if future features add auth tokens, exclude them from Workbox caching.
4. **Backup file validation**: On import, validate the JSON structure matches the expected schema before restoring. Reject malformed files.
5. **CSP**: Set a strict Content-Security-Policy in the HTML template: `default-src 'self'; connect-src 'self' https://open.er-api.com; font-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'` (unsafe-inline needed for Tailwind).

---

## 20. Build & Deployment

```bash
# Development
npm run dev          # Vite dev server, HMR, no service worker

# Production build
npm run build        # Vite build → dist/
npm run preview      # Preview production build locally

# Testing
npm run test         # Vitest
npm run test:ui      # Vitest UI
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

The production build outputs static files to `dist/`. Deploy to any static hosting (Nginx, Cloudflare Pages, Vercel, GitHub Pages). The server serves only the bundle — all data is on-device.

---

## 21. Transaction Filters — Archived Accounts

The TransactionFilters component (spec §3) shows a filter-by-account UI with two sections:

1. **Active accounts**: Listed first, sorted alphabetically
2. **Archived section**: Collapsible, labeled "Archived". Lists trashed accounts. Collapsed by default. When a user selects a trashed account, all historical transactions for that account are shown.

This enables viewing full transaction history for removed accounts without restoring them.

# Expenses App — Agent Task List

> **Status legend**: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
>
> **When starting a task**: change `[ ]` → `[~]`, when done: `[~]` → `[x]`
> **Working directory**: `/home/anton/Project/expensesapp/`
> **Specs**: `docs/spec.md`, `docs/design_spec.md`, `docs/architect_spec.md`
>
> If you find a significant problem with a spec, **do not silently work around it**.
> Stop, ask the user with your proposed solution, wait for approval.

---

## Task Index

| ID | Task | Phase | Status | Depends on |
|---|---|---|---|---|
| [T00](#t00--repo-cleanup--project-init--) | Repo Cleanup & Project Init | 0 — Setup | `[x]` | — |
| [T01](#t01--project-scaffold--) | Project Scaffold | 1 — Foundation | `[x]` | T00 |
| [T02](#t02--database-layer--) | Database Layer | 1 — Foundation | `[~]` | T01 |
| [T03](#t03--core-utilities--) | Core Utilities | 1 — Foundation | `[~]` | T01 |
| [T04](#t04--i18n-setup--) | i18n Setup | 1 — Foundation | `[x]` | T01 |
| [T05](#t05--zustand-state-stores--) | Zustand State Stores | 1 — Foundation | `[x]` | T01, T03 |
| [T06](#t06--exchange-rate-service--) | Exchange Rate Service | 2 — Services | `[ ]` | T02 |
| [T07](#t07--balance-service--) | Balance Service | 2 — Services | `[ ]` | T02 |
| [T08](#t08--layout-shell--routing--) | Layout Shell & Routing | 3 — Layout | `[ ]` | T01, T03, T04, T05 |
| [T09](#t09--shared-ui-components--) | Shared UI Components | 3 — Layout | `[ ]` | T01, T03, T04 |
| [T10](#t10--numpad-component--) | Numpad Component | 3 — Layout | `[ ]` | T01, T03, T05 |
| [T11](#t11--period-filter-component--) | Period Filter Component | 3 — Layout | `[ ]` | T03, T04, T08 |
| [T12](#t12--onboarding-flow--) | Onboarding Flow | 4 — Features | `[ ]` | T08, T09, T04, T05 |
| [T13](#t13--accounts-tab--) | Accounts Tab | 4 — Features | `[ ]` | T08, T09, T05, T06, T07 |
| [T14](#t14--categories-tab--) | Categories Tab | 4 — Features | `[ ]` | T08, T09, T05 |
| [T15](#t15--transactions-tab--) | Transactions Tab | 4 — Features | `[ ]` | T08, T09, T05 |
| [T16](#t16--transaction-input-add--edit--) | Transaction Input (Add/Edit) | 4 — Features | `[ ]` | T09, T10, T06, T07, T05 |
| [T17](#t17--budget-tab--) | Budget Tab | 4 — Features | `[ ]` | T08, T09, T10, T05, T02, T06, T07 |
| [T18](#t18--overview-tab--) | Overview Tab | 4 — Features | `[ ]` | T08, T09, T05 |
| [T19](#t19--settings-view--) | Settings View | 4 — Features | `[ ]` | T08, T09, T04, T05, T06 |
| [T20](#t20--backup-service--) | Backup Service | 5 — Polish | `[ ]` | T02 |
| [T21](#t21--export-service--) | Export Service | 5 — Polish | `[ ]` | T02, T03 |
| [T22](#t22--notification-service--) | Notification Service | 5 — Polish | `[ ]` | T01 |
| [T23](#t23--pwa-configuration--) | PWA Configuration | 5 — Polish | `[ ]` | T01, T22 |
| [T24](#t24--drag-and-drop-reordering--) | Drag-and-Drop Reordering | 5 — Polish | `[ ]` | T13, T14, T15 |
| [T25](#t25--accessibility--performance-pass--) | Accessibility & Performance Pass | 5 — Polish | `[ ]` | all |

---

## How to trigger agents (for the developer)

Each task below has a ready-to-paste Claude Code prompt. To run a task:

```bash
# In the project directory:
cd /home/anton/Project/expensesapp

# Start Claude Code and paste the task's "Agent prompt" block.
# Claude Code will use the appropriate skill automatically.
claude
```

**Running tasks in parallel** — open multiple terminal tabs, one Claude Code session per tab, each with a different task prompt. Tasks within the same phase have no inter-dependencies and can run simultaneously.

**Recommended skill usage per task type**:
- Foundation/service tasks → Claude works directly (no special skill needed)
- UI feature tasks → Agent will invoke `/feature-dev` skill automatically
- Visual/design-heavy tasks → Agent will invoke `/frontend-design` or `/frontend-polish`
- After a feature is done → run `/frontend-audit` in a separate session to score quality

---

## Phase 0 — Repository Setup

### T00 · Repo Cleanup & Project Init `[x]`

**Skills**: none (infra task)

**Goal**: Clean up the repo, move specs to `docs/`, set up git, `.gitignore`, VS Code workspace.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp

TASK T00 — Repo Cleanup & Project Init

Mark this task [~] in TASKS.md before starting, [x] when done.

1. Create docs/ directory and move all three spec files into it:
   - spec.md → docs/spec.md
   - design_spec.md → docs/design_spec.md
   - architect_spec.md → docs/architect_spec.md

2. Update all cross-references inside the spec files:
   - architect_spec.md line 3-4 references "spec.md" and "design_spec.md" → update to "docs/spec.md" etc.

3. Create .gitignore appropriate for a React + TypeScript + Vite + Node project:
   node_modules/, dist/, .env, .env.local, *.local, .DS_Store, Thumbs.db,
   coverage/, .vite/, *.tsbuildinfo, public/icons/ (placeholder icons only)

4. Initialize git repo (if not already):
   git init
   git remote add origin git@github.com:nikonok/expensesapp.git
   Fetch from remote (it has a LICENSE.md): git fetch origin
   Create main branch tracking origin/main: git checkout -b main --track origin/main
   Do NOT force-push or overwrite remote history. If remote has commits, merge or rebase appropriately.

5. Create .vscode/extensions.json with recommended extensions:
   {
     "recommendations": [
       "dbaeumer.vscode-eslint",
       "esbenp.prettier-vscode",
       "bradlc.vscode-tailwindcss",
       "dsznajder.es7-react-js-snippets",
       "ms-vscode.vscode-typescript-next",
       "PKief.material-icon-theme",
       "GitHub.copilot",
       "eamodio.gitlens",
       "streetsidesoftware.code-spell-checker",
       "usernamehw.errorlens"
     ]
   }

6. Create .vscode/settings.json:
   {
     "editor.defaultFormatter": "esbenp.prettier-vscode",
     "editor.formatOnSave": true,
     "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
     "typescript.tsdk": "node_modules/typescript/lib",
     "tailwindCSS.experimental.classRegex": [["clsx\\(([^)]*)\\)", "'([^']*)'"]],
     "files.exclude": { "**/node_modules": true }
   }

7. Create a minimal README.md (do NOT overwrite if remote already has one — check first):
   # Expenses App
   Personal finance tracking PWA built with React 19 + TypeScript + Vite.
   See docs/ for full specifications.
   ## Dev: npm install && npm run dev
   ## Build: npm run build

8. Stage and commit everything created in this task (docs/, .gitignore, .vscode/, README.md, TASKS.md).
   Commit message: "chore: initialize project structure, move specs to docs/"
   Do NOT push without user confirmation.

Verification:
- git status shows clean working tree after commit
- docs/ contains all 3 spec files
- .gitignore prevents node_modules from being tracked
- .vscode/extensions.json opens correctly in VS Code
```

---

## Phase 1 — Foundation (run T01–T05 in parallel after T00)

### T01 · Project Scaffold `[x]`

**Skills**: none (infra task)
**Depends on**: T00 complete

**Goal**: Set up React 19 + TypeScript + Vite + Tailwind CSS 4 + PWA scaffold with all dependencies.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/architect_spec.md (§1 Technology Stack, §2 Project Structure)
      docs/design_spec.md (§Android PWA Specifics, §Typography)

TASK T01 — Project Scaffold

Mark this task [~] in TASKS.md before starting, [x] when done.

Create the full React + TypeScript project scaffold. The directory already has docs/ and .vscode/ from T00.

1. Create package.json with exact pinned versions from docs/architect_spec.md §1:
   Dependencies:
     react@19.2.4, react-dom@19.2.4, typescript@6.0.2
     vite@8.0.3, @tailwindcss/vite@4.2.2, tailwindcss@4.2.2
     vite-plugin-pwa@1.2.0, workbox-window@7.4.0
     react-router@7.13.2, zustand@5.0.12, lucide-react@1.7.0
     date-fns@4.1.0, i18next@26.0.1, react-i18next@17.0.1
     dexie@4.4.1, @dnd-kit/core@6.3.1, @dnd-kit/sortable@10.0.0
     zod@4.3.6, recharts@3.8.1, xlsx@0.18.5
   Dev dependencies:
     vitest@4.1.2, @testing-library/react@16.3.2, @vitejs/plugin-react
     eslint@10.1.0, prettier@3.8.1, @types/react, @types/react-dom
     fake-indexeddb (for tests)
   Scripts: dev, build, preview, test, lint, format

2. Run: npm install

3. Create vite.config.ts:
   - @tailwindcss/vite plugin
   - vite-plugin-pwa (basic setup; full manifest in T24)
   - path alias: @/* → ./src/*

4. Create tsconfig.json:
   - strict: true, target: ES2022, module: ESNext, moduleResolution: bundler
   - paths: { "@/*": ["./src/*"] }
   - include: ["src"]

5. Create index.html with PWA meta tags (docs/design_spec.md §Android PWA Specifics):
   - theme-color: #0A0B12
   - viewport: width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual
   - apple-mobile-web-app-capable, mobile-web-app-capable
   - Google Fonts preconnect links (Syne, DM Sans, JetBrains Mono)

6. Create src/styles/index.css with ALL design tokens from docs/design_spec.md:
   - @import "tailwindcss" (Tailwind 4 syntax)
   - @import for Google Fonts
   - :root { } block with:
     * All --color-* variables (§Color System)
     * All --swatch-1 through --swatch-24 (§Account/Category Color Palette)
     * All --text-* type scale variables (§Type Scale)
     * All --space-* spacing variables (§Spacing)
     * All --z-* z-index variables (§Z-Index Scale)
     * All --radius-* border radius variables (§Border Radius) — name them: --radius-card:12px, --radius-btn:8px, --radius-chip:6px, --radius-icon:10px, --radius-input:8px, --radius-sheet:20px, --radius-numpad:10px, --radius-tooltip:6px, --radius-avatar:9999px
     * --nav-height: calc(64px + env(safe-area-inset-bottom))
   - @property --card-color (§Animatable Card Color)
   - .skeleton + @keyframes shimmer (§Skeleton/Loading State)
   - @media (prefers-reduced-motion: reduce) block (§Motion)
   - html, body base styles: overscroll-behavior:none, background, color, font-family DM Sans
   - .scroll-container { overscroll-behavior: contain }
   - Top app bar scroll-driven border animation (§Top App Bar)

7. Create src/main.tsx — React 19 root, imports styles/index.css, renders <App />

8. Create src/App.tsx — placeholder: just <div style={{color:'white'}}>Expenses App</div>

9. Create src/sw-register.ts — empty export placeholder

10. Create all directory stubs from docs/architect_spec.md §2 (empty .gitkeep files):
    src/db/, src/stores/, src/services/, src/hooks/
    src/components/layout/, src/components/shared/
    src/components/accounts/, src/components/categories/
    src/components/transactions/, src/components/budget/
    src/components/overview/, src/components/settings/
    src/onboarding/, src/i18n/locales/, src/utils/, src/types/

11. Create vitest.config.ts, .eslintrc, .prettierrc with sensible defaults.

Verification:
- npm run dev starts without error, page renders in browser
- npm run build produces dist/ without TypeScript errors
- CSS variables visible in browser DevTools :root
- Background color is near-black (#0A0B12)
```

---

### T02 · Database Layer `[~]`

**Skills**: none (data layer task)
**Depends on**: T01 complete

**Goal**: Dexie database schema, all TypeScript entity interfaces, and sync stub.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/architect_spec.md §3 (Data Model — read this section fully before writing any code)

TASK T02 — Database Layer

Mark this task [~] in TASKS.md before starting, [x] when done.

Implement the complete database layer in src/db/.

1. src/db/models.ts — All TypeScript interfaces exactly as in docs/architect_spec.md §3.2:
   - AccountType = 'REGULAR' | 'DEBT' | 'SAVINGS'
   - Account interface (all fields including optional savings/debt fields)
   - CategoryType = 'EXPENSE' | 'INCOME'
   - Category interface
   - TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER'
   - Transaction interface (note: date="YYYY-MM-DD" local, timestamp=full UTC ISO)
   - Budget interface (categoryId OR accountId, never both, never neither)
   - ExchangeRateCache interface
   - Setting interface (key as primary key)
   - Backup interface

2. src/db/database.ts — Dexie instance exactly as in §3.1:
   db.version(1).stores({
     accounts:     '++id, type, name, isTrashed, currency',
     categories:   '++id, type, name, isTrashed, displayOrder',
     transactions: '++id, date, accountId, categoryId, type, [date+displayOrder], [accountId+date], transferGroupId',
     budgets:      '++id, categoryId, accountId, month, [categoryId+month], [accountId+month]',
     exchangeRates:'++id, baseCurrency, &[baseCurrency+date]',
     settings:     'key',
     backups:      '++id, createdAt',
   });
   Export: { db }

3. src/db/seed.ts — Export:
   - DEFAULT_CURRENCIES: string[] — ~170 ISO 4217 codes
   - DEFAULT_CATEGORY_PRESETS: Array<{name, type, icon, color}> — 6 presets:
     Food (utensils, --swatch-5, EXPENSE), Transport (car, --swatch-16, EXPENSE),
     Housing (home, --swatch-17, EXPENSE), Entertainment (gamepad-2, --swatch-18, EXPENSE),
     Salary (briefcase, --swatch-12, INCOME), Freelance (laptop, --swatch-14, INCOME)

4. src/db/sync-stub.ts — Implement exactly as in §3.6 (SyncConfig, initSync no-op, isSyncEnabled→false)

5. Unit tests src/db/database.test.ts (uses fake-indexeddb):
   - Can insert and retrieve an account
   - Can insert and retrieve a transaction
   - Compound index [date+displayOrder] works (insert two tx same date, query by date)
   - Settings table uses 'key' as primary key (not auto-increment)

Key rules:
- isTrashed entities are NEVER hard-deleted
- Transfer = 2 Transaction records sharing transferGroupId
- date on Transaction = "YYYY-MM-DD" local wall-clock; timestamp = full UTC ISO-8601

Verification:
- npm test — all database tests pass
- npm run build — TypeScript compiles, no errors
```

---

### T03 · Core Utilities `[~]`

**Skills**: none
**Depends on**: T01 complete

**Goal**: Shared constants, Zod validation schemas, date utilities, currency utilities, math parser.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §5 (chart bucket logic), docs/design_spec.md §Color System, §Account/Category Color Palette
      docs/architect_spec.md §3.2 (for validation constraints)

TASK T03 — Core Utilities

Mark this task [~] in TASKS.md before starting, [x] when done.

1. src/types/index.ts:
   export type PeriodFilterType = 'all'|'today'|'custom'|'day'|'week'|'month'|'year';
   export interface PeriodFilter { type: PeriodFilterType; startDate: string; endDate: string; }
   export type TabName = 'accounts'|'categories'|'transactions'|'budget'|'overview';
   export type CategoryViewType = 'EXPENSE'|'INCOME';

2. src/utils/constants.ts:
   - COLOR_PALETTE: Array<{id:number, value:string, cssVar:string}> — all 24 swatches
     e.g. {id:1, value:'oklch(65% 0.22 0)', cssVar:'--swatch-1'}
   - CHAR_LIMITS: { name:64, description:255, note:255 }
   - DEFAULT_MAIN_CURRENCY = 'USD'
   - DEFAULT_STARTUP_SCREEN = 'transactions'
   - DEFAULT_NOTIFICATION_TIME = '20:00'
   - ICON_LIST: string[] — ~40 Lucide icon names:
     ['wallet','credit-card','home','car','utensils','shopping-cart','heart','plane',
      'coffee','book','music','gamepad-2','briefcase','laptop','phone','gift','scissors',
      'baby','dumbbell','cat','shirt','pill','graduation-cap','building','tree','sun',
      'star','flag','globe','leaf','zap','shield','wrench','map','camera','bitcoin',
      'bar-chart-2','piggy-bank','fuel','shopping-bag']

3. src/utils/validation.ts — Zod schemas:
   - accountSchema: name(max 64), currency(required), type(enum), description(max 255),
     balance(number), startingBalance(number), includeInTotal(bool)
   - categorySchema: name(max 64), type(enum EXPENSE|INCOME), color(string), icon(string)
   - transactionSchema: amount(positive), note(max 255), date(YYYY-MM-DD format), type(enum),
     accountId(positive int), categoryId(positive int or null)
   - budgetSchema: plannedAmount(positive), exactly one of categoryId/accountId (use .refine())

4. src/utils/date-utils.ts:
   - getLocalDateString(): string — today as "YYYY-MM-DD" in local timezone
   - getUTCISOString(): string — current UTC ISO-8601
   - parsePeriodFilter(filter: PeriodFilter): {start: Date, end: Date}
     'all' → Jan 1 2000 to Dec 31 2099
     'today' → start/end of today
     'day' → start/end of filter.startDate
     'week' → Mon–Sun of filter.startDate's week
     'month' → 1st to last day of filter.startDate's month
     'year' → Jan 1 to Dec 31 of filter.startDate's year
     'custom' → filter.startDate to filter.endDate
   - formatDate(dateStr:string): string — formats "YYYY-MM-DD" for display (e.g. "Mar 29, 2026")
   - getWeekRange(date:Date): {start:Date, end:Date} — Mon–Sun
   - getMonthRange(date:Date): {start:Date, end:Date}
   - getPeriodLabel(filter:PeriodFilter): string — human label e.g. "March 2026", "This week"
   - autoScaleChartBuckets(start:Date, end:Date): 'hour'|'day'|'week'|'month'
     single day (start===end) → 'hour'
     2–31 days → 'day'   (covers any calendar month)
     32–90 days → 'week'
     >90 days → 'month'
   - shiftPeriod(filter:PeriodFilter, direction:1|-1): PeriodFilter — advance/retreat one unit

5. src/utils/currency-utils.ts:
   - formatAmount(amount:number, currency:string, locale?:string): string
     Uses Intl.NumberFormat style:'currency'. Example: PLN → "1 000,00 zł", USD → "$1,000.00"
   - formatAmountNoSymbol(amount:number, currency:string, locale?:string): string — number only
   - convertAmount(amount:number, rate:number): number — amount×rate, rounded 2 decimals
   - getCurrencySymbol(currency:string, locale?:string): string

6. src/services/math-parser.ts:
   - evaluateExpression(expr:string): number
   - Supported operators: + - × ÷ (Unicode multiply/divide chars from numpad)
   - Standard PEMDAS: × and ÷ before + and -
   - Trailing operator silently stripped before evaluation
   - Empty/invalid → return null (per architect_spec.md §6.3)
   - Result rounded to 2 decimal places
   - Examples: "100+50"→150, "10×5+2"→52, "100÷4"→25, "100+"→100, ""→null

7. Unit tests src/utils/__tests__/:
   math-parser.test.ts: all examples above + division by zero (→ Infinity, document it)
   date-utils.test.ts: autoScaleChartBuckets boundaries, shiftPeriod for month/week, parsePeriodFilter
   currency-utils.test.ts: PLN formatting (space thousands, comma decimal), USD formatting

Verification:
- npm test — all utility tests pass
- npm run build — no TypeScript errors
```

---

### T04 · i18n Setup `[x]`

**Skills**: none
**Depends on**: T01 complete

**Goal**: i18next with comprehensive English translations covering every user-facing string.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md (all sections — read for exact wording of UI strings)
      docs/design_spec.md (coming soon tooltip, light theme error dialog)

TASK T04 — i18n Setup

Mark this task [~] in TASKS.md before starting, [x] when done.

1. src/i18n/index.ts:
   import i18next from 'i18next';
   import { initReactI18next } from 'react-i18next';
   import en from './locales/en.json';
   i18next.use(initReactI18next).init({
     lng: 'en', fallbackLng: 'en',
     resources: { en: { translation: en } },
     interpolation: { escapeValue: false },
   });
   export default i18next;

2. src/i18n/locales/en.json — Comprehensive translations. Structure:
   {
     "nav": {
       "accounts": "Accounts", "categories": "Categories",
       "transactions": "Transactions", "budget": "Budget", "overview": "Overview"
     },
     "common": {
       "save": "Save", "cancel": "Cancel", "delete": "Delete", "confirm": "Confirm",
       "skip": "Skip", "edit": "Edit", "done": "Done", "close": "Close",
       "comingSoon": "Coming soon", "getStarted": "Get Started", "restore": "Restore",
       "add": "Add", "remove": "Remove", "create": "Create", "back": "Back",
       "all": "All", "today": "Today", "week": "Week", "month": "Month",
       "year": "Year", "custom": "Custom range", "clearFilters": "Clear filters",
       "noData": "N/A", "income": "Income", "expense": "Expense", "transfer": "Transfer"
     },
     "accounts": {
       "title": "Accounts", "newAccount": "New Account", "editAccount": "Edit Account",
       "totalBalance": "Total Balance", "assets": "Assets", "debts": "Debts",
       "trashedAccounts": "Archived Accounts",
       "types": { "regular": "Regular", "debt": "Debt", "savings": "Savings" },
       "fields": {
         "name": "Account name", "color": "Color", "icon": "Icon",
         "currency": "Currency", "description": "Description",
         "startingBalance": "Starting balance", "includeInTotal": "Include in total balance",
         "savingsGoal": "Savings goal", "interestRateMonthly": "Monthly interest rate",
         "interestRateYearly": "Yearly interest rate",
         "mortgageLoanAmount": "Loan amount", "mortgageStartDate": "Start date",
         "mortgageTermYears": "Term (years)", "mortgageInterestRate": "Mortgage interest rate"
       },
       "detail": {
         "adjustBalance": "Adjust balance", "viewTransactions": "View transactions",
         "addIncome": "Add income", "addWithdrawal": "Add withdrawal",
         "remainingBalance": "Remaining balance", "monthlyPayment": "Monthly payment",
         "timeLeft": "Time left", "accruedInterest": "Accrued interest",
         "goalProgress": "Goal progress",
         "currencyChangeWarning": "Existing transactions will keep their original amounts. You will need to manually correct the balance."
       },
       "removal": { "confirm": "Archive this account? Its transaction history will be preserved." },
       "restore": { "confirm": "Restore this account?" },
       "empty": "No accounts yet. Tap + to create one."
     },
     "categories": {
       "title": "Categories", "newCategory": "New Category", "editCategory": "Edit Category",
       "trashedCategories": "Archived Categories",
       "fields": { "name": "Category name", "color": "Color", "icon": "Icon" },
       "empty": "No categories. Tap the donut chart to switch views, then Edit → + to create one.",
       "removal": { "confirm": "Archive this category? It will remain on historical transactions." }
     },
     "transactions": {
       "title": "Transactions", "newTransaction": "New Transaction",
       "editTransaction": "Edit Transaction",
       "tabs": { "income": "Income", "expense": "Expense", "transfer": "Transfer" },
       "fields": {
         "amount": "Amount", "note": "Note", "date": "Date",
         "account": "Account", "category": "Category",
         "from": "From", "to": "To"
       },
       "noteHint": "Use last note",
       "repeat": "Repeat",
       "noExchangeRate": "No exchange rate available — using 1:1 conversion.",
       "staleExchangeRate": "Could not fetch exchange rates. Using cached rates.",
       "empty": "No transactions for this period.",
       "deleteConfirm_one": "Delete {{count}} transaction? This cannot be undone.",
       "deleteConfirm_other": "Delete {{count}} transactions? This cannot be undone.",
       "filters": {
         "title": "Filter transactions",
         "note": "Note contains",
         "category": "Category",
         "account": "Account",
         "archived": "Archived accounts"
       },
       "transfer": { "from": "{{from}} → {{to}}" }
     },
     "budget": {
       "title": "Budget",
       "sections": {
         "expenses": "Expenses", "income": "Income",
         "savings": "Savings accounts", "debt": "Debt accounts"
       },
       "planned": "Planned", "spent": "Spent",
       "stats": {
         "title": "Budget stats",
         "avgMonthly": "Average monthly", "lastMonth": "Last month", "lastBudget": "Last set budget"
       },
       "empty": "No budget data for this month."
     },
     "overview": {
       "title": "Overview",
       "netBalance": "Net balance", "totalIncome": "Total income", "totalExpenses": "Total expenses",
       "dailyAverages": "Daily averages",
       "avgPerDay": "Average per day", "today": "Today", "thisWeek": "This week",
       "categoryBreakdown": "By category",
       "empty": "No data for this period."
     },
     "settings": {
       "title": "Settings",
       "sections": { "general": "General", "notifications": "Notifications", "data": "Data" },
       "language": { "label": "Language", "english": "English" },
       "theme": {
         "label": "Theme", "dark": "Dark", "light": "Light",
         "lightError": "The developer dislikes light theme and will never implement it."
       },
       "startupScreen": { "label": "Startup screen" },
       "passcode": { "label": "Passcode" },
       "notification": {
         "label": "Daily reminder", "time": "Reminder time",
         "enabled": "Enabled", "disabled": "Disabled"
       },
       "mainCurrency": {
         "label": "Main currency",
         "changeConfirm": "All historical amounts will be recalculated to {{currency}}. This may take a moment.",
         "missingRates": "Cannot change currency: no exchange rate available for {{currencies}}.",
         "recalculating": "Recalculating..."
       },
       "backup": {
         "label": "Backup & Restore",
         "create": "Create backup", "export": "Export to file",
         "restore": "Restore from backup", "restoreFile": "Restore from file",
         "schedule": "Auto-backup interval",
         "scheduleOff": "Off",
         "restoreConfirm": "This will delete all current data and replace it with the backup. This cannot be undone.",
         "created": "Backup created.", "restored": "Data restored."
       },
       "export": {
         "label": "Export data", "button": "Export",
         "complete": "Export complete. Your file has been downloaded."
       }
     },
     "onboarding": {
       "welcome": { "title": "Expenses", "subtitle": "Your personal finance tracker.", "cta": "Get Started" },
       "currency": { "title": "Choose your main currency", "subtitle": "Used for all totals and reports." },
       "account": { "title": "Create your first account", "subtitle": "You can add more accounts later." },
       "categories": {
         "title": "Choose your categories",
         "subtitle": "Select the ones you want to track.", "acceptAll": "Accept all"
       },
       "complete": { "title": "You're all set!", "subtitle": "Start tracking your expenses.", "cta": "Go to App" }
     },
     "errors": {
       "required": "This field is required.",
       "maxLength": "Maximum {{max}} characters.",
       "positiveNumber": "Must be a positive number.",
       "invalidDate": "Invalid date.",
       "sameAccount": "Source and destination must be different.",
       "quotaExceeded": "Storage full. Export your data and clear old backups.",
       "generic": "Something went wrong. Please try again."
     }
   }

3. src/hooks/use-translation.ts:
   export { useTranslation } from 'react-i18next';

4. Initialize i18n in src/main.tsx: import './i18n/index' (before React render)

Verification:
- npm run build — no errors
- In a test component: const { t } = useTranslation(); renders t('common.save') → "Save"
```

---

### T05 · Zustand State Stores `[x]`

**Skills**: none
**Depends on**: T01, T03 complete

**Goal**: Zustand UI store (ephemeral state) and settings store (DB-backed).

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/architect_spec.md §4 (State Management — read all sub-sections)

TASK T05 — Zustand State Stores + Dexie Hooks

Mark this task [~] in TASKS.md before starting, [x] when done.

1. src/stores/ui-store.ts — Full UIStore as in docs/architect_spec.md §4.3:
   - All PeriodFilter slices (categoriesFilter, transactionsFilter, overviewFilter)
   - budgetMonth: string (default = current "YYYY-MM")
   - categoriesViewType: 'EXPENSE'|'INCOME' (default: 'EXPENSE')
   - categoriesEditMode: boolean
   - transactionNoteFilter, transactionCategoryFilter, transactionAccountFilter
   - selectedTransactionIds: Set<number>
   - hasActiveTransactionFilters(): boolean
   - All action functions (setCategoriesFilter, etc.)
   Default period filter values: type='month', startDate/endDate = current month boundaries

2. src/stores/settings-store.ts — SettingsStore as in §4.4:
   - All settings fields with defaults:
     mainCurrency:'USD', language:'en', startupScreen:'transactions',
     notificationEnabled:false, notificationTime:'20:00', lastUsedAccountId:null,
     autoBackupIntervalHours:null, lastAutoBackupAt:null, hasCompletedOnboarding:false, isLoaded:false
   - load(): reads all keys from db.settings, applies defaults if missing
   - update(key,value): writes to db + updates store

3. src/hooks/use-accounts.ts (useLiveQuery wrappers):
   - useAccounts(includeTrashed?:boolean): Account[]
   - useAccount(id:number): Account|undefined

4. src/hooks/use-categories.ts:
   - useCategories(type?:'EXPENSE'|'INCOME', includeTrashed?:boolean): Category[]
     Sorted by displayOrder ascending
   - useCategory(id:number): Category|undefined

5. src/hooks/use-transactions.ts:
   - useTransactions(opts:{filter:PeriodFilter, accountId?:number, categoryId?:number, noteContains?:string})
     Returns Transaction[] for date range, sorted by date DESC, displayOrder ASC
     Filter by accountId/categoryId/noteContains when provided

6. src/hooks/use-budgets.ts:
   - useBudgets(month:string): Budget[] for "YYYY-MM"

7. src/hooks/use-exchange-rate.ts:
   - useExchangeRate(from:string, to:string): {rate:number|null, isLoading:boolean}
     (calls exchange rate service from T07; just stub it for now returning null)

Verification:
- npm run build — no TypeScript errors
- ui-store: hasActiveTransactionFilters() returns false by default, true after setTransactionNoteFilter('x')
```

---

## Phase 2 — Services (run in parallel after T02)

### T06 · Exchange Rate Service `[ ]`

**Skills**: none
**Depends on**: T02 complete

**Goal**: Fetch, cache, and retrieve exchange rates. Handle recalculation when main currency changes.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/architect_spec.md §6.1 (Exchange Rate Service — read fully)

TASK T06 — Exchange Rate Service

Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/services/exchange-rate.service.ts.

API: https://open.er-api.com/v6/latest/{BASE} (free, no API key, daily updates)

Interface (implement all methods):
  getRate(from:string, to:string): Promise<number|null>
    - from===to → return 1
    - Read mainCurrency internally from db.settings (key 'mainCurrency')
    - Check today's ExchangeRateCache in db for baseCurrency=mainCurrency
    - If found and fetchedAt within 24h: derive cross-rate
    - If stale: call fetchAndCacheRates(mainCurrency), then derive rate
    - If fetch fails: use most recent cached entry (any date)
    - If no cache at all: return null
    - Rate derivation: base=mainCurrency, rates={USD:1.1, PLN:4.0, ...}
      API returns: 1 BASE = rates[TARGET]. If base=PLN, rates['USD']=0.25 means 1 PLN = 0.25 USD.
      To get USD→PLN rate: 1/rates['USD'] = 1/0.25 = 4.0 PLN per USD. So exchangeRate=4.0. ✓
      Cross-rate when neither currency is base: rateA=rates[from], rateB=rates[to]
      result = rateB / rateA

  fetchAndCacheRates(baseCurrency:string): Promise<void>
    - Fetch https://open.er-api.com/v6/latest/{baseCurrency}
    - On success: upsert ExchangeRateCache (baseCurrency, date=today, rates, fetchedAt=now)
    - Prune entries older than 90 days from db.exchangeRates
    - On failure: throw

  getHistoricalRate(from:string, to:string, date:string): Promise<number|null>
    - Read mainCurrency internally from db.settings
    - Find ExchangeRateCache for baseCurrency=mainCurrency with date<=requested_date, most recent
    - Apply same rate derivation as getRate()

  recalculateAllMainCurrencyAmounts(
    newMainCurrency:string,
    onProgress?: (done:number, total:number) => void
  ): Promise<void>
    - Fetch fresh rates for newMainCurrency first
    - Get all transactions from db
    - For each: newAmountMain = amount × historical_rate(currency, newMainCurrency, date)
    - If any currency has no rate: throw Error listing which currencies are missing
    - Write all updated transactions in a single db.transaction()
    - Call onProgress(done, total) after each batch of 50 so UI can show progress

Unit tests src/services/exchange-rate.service.test.ts:
- Mock fetch globally
- Test: cache hit returns correct rate without fetching
- Test: cache miss triggers fetch
- Test: cross-rate calculation correct
- Test: null returned when no cache and fetch fails

Verification:
- npm test — all tests pass
```

---

### T07 · Balance Service `[ ]`

**Skills**: none
**Depends on**: T02 complete

**Goal**: Atomic balance mutation service — all account balance changes go through this.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/architect_spec.md §3.4 (Balance Calculation), §3.3 (Transfer Storage Model)

TASK T07 — Balance Service

Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/services/balance.service.ts.

ALL operations must run inside db.transaction('rw', [db.accounts, db.transactions], ...) for atomicity.

Balance logic:
  INCOME on account A: account.balance += tx.amount
  EXPENSE on account A: account.balance -= tx.amount
  TRANSFER OUT from A: accountA.balance -= txOut.amount
  TRANSFER IN to B: accountB.balance += txIn.amount
  Revert = inverse

  DEBT ACCOUNT EXCEPTIONS — check account.type === 'DEBT' before applying:
    EXPENSE on DEBT account: balance += amount   (more owed, balance grows)
    INCOME on DEBT account:  balance -= amount   (reduces what is owed)
    TRANSFER IN to DEBT:     balance -= amount   (payment reduces debt)
    TRANSFER OUT from DEBT:  balance += amount   (borrowing more)
  Debt balance is always positive representing amount owed. Zero = fully paid off.
  ALWAYS check account.type before determining sign direction.

Implement:
  applyTransaction(tx: Transaction): Promise<void>
    - Update account.balance per tx.type (INCOME adds, EXPENSE subtracts)
    - Save updated transaction to db (sets id, createdAt, updatedAt, displayOrder)
    - displayOrder = max existing displayOrder for that date + 1

  revertTransaction(tx: Transaction): Promise<void>
    - Inverse balance update, delete transaction from db

  replaceTransaction(oldTx: Transaction, newTx: Transaction): Promise<void>
    - Revert old balance effect, apply new
    - Update transaction record in db
    - If date changed: newTx.displayOrder = max for new date + 1 (else preserve)

  applyTransfer(outTx: Transaction, inTx: Transaction): Promise<void>
    - Both must have same transferGroupId (UUID v4, generated by caller)
    - Update both account balances, save both tx records

  revertTransfer(transferGroupId: string): Promise<void>
    - Find both records by transferGroupId
    - Revert both balances, delete both records

  replaceTransfer(transferGroupId: string, outTx: Transaction, inTx: Transaction): Promise<void>
    - Atomic: revert old, apply new

  adjustBalance(accountId: number, newBalance: number): Promise<void>
    - Directly set account.balance = newBalance (no transaction created)

Error handling:
  Catch DOMException with name==='QuotaExceededError'
  Re-throw as: class QuotaError extends Error { name = 'QuotaError' }
  (UI catches this to show "Storage full" toast)

Unit tests src/services/balance.service.test.ts (uses fake-indexeddb):
- Add income → balance increases by correct amount
- Add expense → balance decreases
- Delete expense → balance restored
- Edit expense (change amount) → balance correctly updated
- Add transfer → both accounts updated correctly
- Delete transfer → both balances restored
- adjustBalance → sets exact value

Verification:
- npm test — all tests pass
```

---

## Phase 3 — Layout & Shared UI (run in parallel after T01, T03, T04, T05)

### T08 · Layout Shell & Routing `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T01, T03, T04, T05 complete

**Goal**: App shell — routing, bottom nav, top bar, content column, bottom sheet.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/architect_spec.md §5 (Routing — read all sub-sections)
      docs/design_spec.md §Bottom Navigation Bar, §Top App Bar, §Bottom Sheet, §Motion

TASK T08 — Layout Shell & Routing

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement the app shell with routing and all layout components.

1. src/App.tsx — Full routing setup per docs/architect_spec.md §5.2:
   - On mount: call settingsStore.load(), check hasCompletedOnboarding
   - If not completed: redirect to /onboarding
   - Otherwise: redirect / to startupScreen setting
   - Route structure: TabLayout wrapping 5 tab routes + nested routes for accounts
   - TransactionInput, SettingsView, OnboardingFlow are OUTSIDE TabLayout (no bottom nav)
   - Tab transitions using View Transitions API:
     document.startViewTransition(() => flushSync(() => navigate(newPath)))
     Degrade gracefully if unsupported.

2. src/components/layout/BottomNav.tsx (design_spec.md §Bottom Navigation Bar):
   - 5 tabs: Accounts(wallet), Categories(tag), Transactions(arrow-left-right), Budget(target), Overview(layout-dashboard)
   - Icons: Lucide, 20px, 1.5px stroke
   - Height: calc(64px + env(safe-area-inset-bottom))
   - Background: var(--color-surface) + backdrop-filter:blur(20px) + border-top: 1px solid var(--color-border)
   - Active: icon + label, var(--color-primary) + drop-shadow glow, animated 2px top indicator (150ms ease-out)
   - Inactive: icon only (no label), var(--color-text-disabled)
   - Touch target: full column × full height
   - aria-label on all buttons

3. src/components/layout/TopBar.tsx:
   - Height: 56px
   - Left: settings gear → navigate('/settings')
   - Center: tab title prop (Syne 700, var(--text-heading))
   - Right: contextual action slot (accepts ReactNode prop)
   - Scroll-driven border bottom animation (CSS only, no JS):
     @keyframes show-border { from{border-bottom-color:transparent} to{border-bottom-color:var(--color-border)} }
     animation-timeline: scroll(nearest block); animation-range: 0px 1px

4. src/components/layout/ContentColumn.tsx:
   - max-width: 480px, centered on desktop, var(--color-bg) flanks
   - padding-bottom: max(env(safe-area-inset-bottom), 8px) (for Chrome 135+ edge-to-edge)

5. src/components/layout/BottomSheet.tsx:
   - Open: translateY(100%)→translateY(0), 300ms cubic-bezier(0.32, 0.72, 0, 1)
   - Close: 220ms ease-in
   - Drag handle: 36×4px pill, var(--color-border-strong), centered 12px from top
   - Backdrop: rgba(0,0,0,0.7) + backdrop-filter:blur(4px), 200ms fade
   - Dismiss: swipe down ≥40% sheet height OR tap backdrop
   - visualViewport resize → translateY sheet to keep input visible (do not resize sheet)
   - z-index: var(--z-overlay) on backdrop, var(--z-sheet) on panel
   - Props: isOpen, onClose, title?, children

6. Placeholder tab components (just div with tab name) in src/pages/ or co-located.

Verification:
- All 5 tabs navigate, active state highlights correctly
- Settings icon navigates to /settings placeholder
- BottomSheet opens/closes with animation
- Swipe down OR tap backdrop closes the sheet
- On desktop (≥768px), content centered at max 480px
```

---

### T09 · Shared UI Components `[ ]`

**Skills**: `/frontend-design`
**Depends on**: T01, T03, T04 complete

**Goal**: Reusable shared UI components — the building blocks for all features.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/design_spec.md §Empty States, §Toast/Snackbar, §Coming Soon Stubs,
      §Filter Chips, §Input Fields, §Buttons, §Component Specs

TASK T09 — Shared UI Components

Use the /frontend-design skill to build these components.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement in src/components/shared/:

1. EmptyState.tsx:
   Props: icon:LucideIcon, heading:string, body?:string, action?:{label:string,onClick:()=>void}
   min-height: 50dvh, flex column center, icon 64px var(--color-text-disabled)
   heading: Syne 700 var(--text-heading) var(--color-text-secondary)
   body: DM Sans var(--text-body) var(--color-text-secondary)
   action: secondary button

2. Toast system — useToast hook + ToastContainer component:
   useToast(): { show(msg:string, variant?:'info'|'success'|'error'|'coming-soon', duration?:number): void }
   ToastContainer: renders up to 1 active toast at a time
   Position: fixed bottom: calc(64px + env(safe-area-inset-bottom) + 8px), centered, max-width 320px
   Background: var(--color-surface-raised), 12px radius, 1px border var(--color-border)
   Animation in: translateY(8px)→0 + opacity 0→1, 200ms ease-out; out: reverse 150ms
   Auto-dismiss: 3s default, 1.5s for coming-soon
   z-index: var(--z-toast)
   Mount ToastContainer in App.tsx root

3. ConfirmDialog.tsx:
   Props: isOpen, title, body, confirmLabel, cancelLabel?, onConfirm, onCancel, variant:'default'|'destructive'
   Renders inside BottomSheet
   Destructive confirm: var(--color-expense-dim) bg, var(--color-expense) text+border

4. AmountDisplay.tsx:
   Props: amount:number, currency:string, type:'income'|'expense'|'transfer'|'neutral', size:'lg'|'md'|'sm'
   Income: + prefix, var(--color-income) + text-shadow: 0 0 12px oklch(73% 0.23 160 / 45%)
   Expense: − prefix, var(--color-expense) + text-shadow: 0 0 12px oklch(62% 0.28 18 / 45%)
   Transfer: var(--color-transfer), opacity 0.5, no prefix
   Neutral: var(--color-text), no prefix
   Font: JetBrains Mono, size from --text-amount-{lg|md|sm}
   Use Intl.NumberFormat for amount formatting

5. ColorPicker.tsx:
   Props: value:string, onChange:(v:string)=>void
   Shows all 24 swatches as 36px circles
   Selected swatch: 2px ring in var(--color-primary)

6. IconPicker.tsx:
   Props: value:string, onChange:(v:string)=>void
   Grid of icons from ICON_LIST (render as Lucide icons) + emoji input
   If value not in ICON_LIST, render as emoji text

7. CurrencyPicker.tsx:
   Props: value:string, onChange:(v:string)=>void
   Searchable list, shows currency code + full name
   (Use Intl.DisplayNames for currency names)

8. ComingSoonStub.tsx:
   Props: children:ReactNode
   opacity: 0.4, cursor: not-allowed, pointer-events: none on children
   Wrapper div: aria-disabled="true", aria-describedby="coming-soon-desc"
   Hidden span id="coming-soon-desc": "Coming soon"
   On click on wrapper: show toast 'Coming soon' variant (1.5s)

9. FilterChips.tsx:
   Props: options:{id:string,label:string}[], value:string|null, onChange:(id:string|null)=>void
   Horizontal scrollable, scrollbar-width:none
   Inactive: var(--color-surface) bg, var(--color-border) border, 6px radius, 36px height
   Active: var(--color-primary) bg, var(--color-bg) text, primary drop-shadow

Verification:
- All components render without errors
- Toast shows and auto-dismisses at correct timing
- AmountDisplay renders correct color and sign for each type
- ColorPicker shows 24 swatches with correct oklch colors
- ComingSoonStub shows "Coming soon" toast when tapped
```

---

### T10 · Numpad Component `[ ]`

**Skills**: `/frontend-design`
**Depends on**: T01, T03, T05 complete

**Goal**: The transaction and budget numpad with PEMDAS math support.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/design_spec.md §Transaction Input (Numpad) — read the full section including both layouts

TASK T10 — Numpad Component

Use the /frontend-design skill to implement this.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/components/shared/Numpad.tsx.

Two layout variants (design_spec.md §Transaction Input):
1. Transaction variant (with operators): 4 columns:
   Full variant — 5 columns:
     [Operators] [Digits A] [Digits B] [Digits C] [Actions]
     Operators:  +, −, ×, ÷
     Digits A:   7, 4, 1, (empty)
     Digits B:   8, 5, 2, 0
     Digits C:   9, 6, 3, .
     Actions:    ⌫, 📅 (or stats), (empty), SAVE [spans last 2 rows]
   Transfer/budget variant — 4 columns: Operators column hidden, rest unchanged

2. Transfer variant: operator column hidden (3+1 columns)

Props:
  interface NumpadProps {
    value: string;              // raw expression string e.g. "100+50"
    onChange: (v:string) => void;
    onSave: (result:number) => void;
    onCalendarPress?: () => void;
    variant: 'transaction' | 'budget';  // budget: calendar→stats button
    onStatsPress?: () => void;
    isTransfer?: boolean;       // hides operators column
  }

Key behaviors:
- Digit/operator press: append char to value string
  Use × and ÷ Unicode chars (not * and /)
- Backspace: remove last char from value
- Save: call evaluateExpression(value) from src/services/math-parser.ts
  Strip trailing operator before evaluating. Call onSave(result).
  If evaluateExpression returns null (empty/invalid expression): do nothing (do not call onSave).
- Display of current expression: NOT this component's responsibility — parent shows it

Styles (design_spec.md):
- Key min-height: 60px, border-radius: var(--radius-numpad) = 10px
- Digit/decimal: bg var(--color-surface), border 1px var(--color-border), text var(--color-text)
- Operator: bg var(--color-surface-raised), text var(--color-text-secondary)
- Backspace/Calendar: bg var(--color-surface-raised), icon only (Lucide delete/calendar)
- Save: spans 2 rows, bg var(--color-primary), Syne 700, text var(--color-bg),
        box-shadow: 0 4px 16px oklch(72% 0.22 210 / 30%)
- Press animation: scale(0.93) + filter:brightness(1.25), 80ms ease-out
- aria-label on every key

Unit tests src/components/shared/Numpad.test.tsx:
- Pressing 1,0,0 builds value "100"
- Pressing backspace removes last char
- Pressing save calls onSave(100) for value "100"
- Trailing operator stripped: value "100+" → onSave(100)
- PEMDAS: value "10×5+2" → onSave(52)

Verification:
- npm test — all numpad tests pass
- Visual: numpad renders with correct layout, save button spans 2 rows
```

---

### T11 · Period Filter Component `[ ]`

**Skills**: `/frontend-design`
**Depends on**: T03, T04, T08 complete

**Goal**: Shared period filter chip + sheet used on all tabs.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/design_spec.md §Period Filter, docs/spec.md §2 (filter options), §4 (budget month-only)

TASK T11 — Period Filter Component

Use the /frontend-design skill to implement this.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/components/shared/PeriodFilter.tsx.

Props:
  interface PeriodFilterProps {
    value: PeriodFilter;          // from src/types/index.ts
    onChange: (f:PeriodFilter) => void;
    variant?: 'full' | 'month-only';  // month-only for Budget tab
  }

Layout: [This month ▾]  [<]  [>]
  Chip: 36px height, var(--color-surface) bg, var(--color-border) border, 6px radius
  Label: DM Sans 500, --text-body, trailing ▾ chevron (ChevronDown Lucide)
  Active custom range: var(--color-primary-dim) bg, var(--color-primary) border
  < > arrows: 32×32px, visible ONLY for navigable periods (today/day/week/month/year)
              hidden for 'all' and 'custom'

Chip tap → BottomSheet with radio list of options:
  Full variant: All time | Today | Single day | Week | Month | Year | Custom range
  Month-only variant: just month navigation (no sheet needed — just < > arrows)

Custom range option in sheet:
  Two date inputs (from/to), type="date", min tap target 44px

Arrow behavior (shiftPeriod from date-utils.ts):
  day: ±1 day
  week: ±7 days (Mon anchored)
  month: ±1 month (anchors to 1st of month)
  year: ±1 year
  today: pressing > moves to 'day' type for tomorrow

When variant='month-only':
  Show only "[Month Year ▾]  [<]  [>]"
  No bottom sheet — < > always visible
  < > shift by 1 month

Use getPeriodLabel() from date-utils for chip label.
Connect to Zustand ui-store in the parent component — PeriodFilter itself is controlled.

Verification:
- Chip opens bottom sheet with all options
- Selecting Month → arrows appear, arrows navigate months
- Selecting All time → arrows hidden
- Custom range → chip turns primary colored
- Month-only variant shows only month navigation
```

---

## Phase 4 — Features (run in parallel after Phase 3)

### T12 · Onboarding Flow `[ ]`

**Skills**: `/frontend-design`
**Depends on**: T08, T09, T04, T05 complete

**Goal**: First-run 5-step setup flow.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §First-Run Setup (read fully)

TASK T12 — Onboarding Flow

Use the /frontend-design skill to build this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/onboarding/OnboardingFlow.tsx.
Route: /onboarding (outside TabLayout — full screen, no bottom nav)

5 steps:
1. Welcome: "Expenses" heading (Syne 700 large), subtitle, "Get Started" CTA button, "Skip" link
2. Currency: CurrencyPicker, default = navigator locale currency or 'USD'
   Detect: try Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).resolvedOptions().currency
3. First account: name input (default "Cash"), type select (Regular/Debt/Savings),
   currency defaults to chosen main currency, starting balance via Numpad component
4. Category presets: 6 cards from DEFAULT_CATEGORY_PRESETS (docs/db/seed.ts),
   each toggleable on/off, all on by default
   "Accept All" button, "Skip" link
5. Complete: "You're all set!" heading, "Go to App" button

Navigation:
- "Skip" at any step → go to step 5 directly (set step=5)
- "Get Started" / "Next" → step+1
- On step 5 "Go to App":
  1. Save mainCurrency to settings
  2. If step 3 completed: create account via balance.service.applyTransaction (starting balance as income type)
     Actually: just insert account directly to db.accounts (starting balance is not a transaction per spec)
  3. Create selected category presets in db.categories (displayOrder = array index)
  4. Set hasCompletedOnboarding=true via settingsStore.update()
  5. navigate to settingsStore.startupScreen

Design:
- Full screen dark, no bottom nav
- Progress dots at top (5 dots, active = var(--color-primary))
- Slide transition between steps (translateX)
- CTA buttons: primary style (var(--color-primary) bg)

Verification:
- Navigate to /onboarding — flow renders
- Complete full flow → account + categories in db, redirects to main tabs
- Skip from step 1 → goes to step 5 → sets hasCompletedOnboarding → redirects
- After onboarding, app never shows onboarding again (App.tsx checks setting)
```

---

### T13 · Accounts Tab `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T08, T09, T05, T06, T07 complete

**Goal**: Full accounts tab — list, total wealth, account card, create/edit form, detail view, trash.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §1, §1a, §1b, §1c (read all Account sections)
      docs/design_spec.md §Account Card, §Total Wealth Table, §Floating Action Button

TASK T13 — Accounts Tab

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement all components in src/components/accounts/:

1. AccountCard.tsx — (design_spec.md §Account Card):
   Layout:
   ┌─[3px var(--card-color) border-left]────────────────────┐
   │  [36px icon circle]  Account Name         [type chip]   │
   │                              1 240.00 PLN               │
   └─────────────────────────────────────────────────────────┘
   CSS var --card-color = account.color on the element
   Icon circle: bg = color-mix(in oklch, var(--card-color) 20%, transparent), icon color = var(--card-color)
   Balance: JetBrains Mono --text-amount-md var(--color-text)
   Debt accounts: balance in var(--color-expense) + expense glow
   Savings with goal: small progress bar below balance
   Type chip: caption size, var(--color-surface-raised) bg, 6px radius
   Press: scale(0.98) 80ms → navigate to /accounts/:id
   Skeleton loading state
   Props: account:Account, onPress:()=>void

2. TotalWealth.tsx — (design_spec.md §Total Wealth Table):
   Table: ASSETS column + DEBTS column, rows grouped by currency
   Assets = Regular + Savings balances; Debts = Debt balances
   Only accounts where includeInTotal=true and isTrashed=false
   Convert to main currency using getRate() for grand total row
   Asset amounts: var(--color-income); Debt amounts: var(--color-expense); zero: var(--color-text-disabled)
   Currency code: JetBrains Mono, left-aligned
   Column headers: caption, uppercase, text-secondary

3. AccountList.tsx (= the Accounts tab page):
   - TotalWealth above the list
   - Accounts grouped by type: Regular → Debt → Savings section headers
   - useAccounts(false) for active accounts list
   - TopBar title="Accounts", right action = Trash icon → navigate('/accounts/trash')
   - FAB: 56×56px circle, fixed, var(--color-primary), + icon, var(--color-bg) text
     Position: bottom: calc(var(--nav-height) + 16px), right: 16px
     Press: scale(0.92) 80ms → navigate('/accounts/new')
   - Empty state if no accounts

4. AccountForm.tsx (create/edit — renders as BottomSheet):
   Route: /accounts/new and /accounts/:id/edit (or as overlay)
   All fields from spec.md §1b:
   General: Name(max 64, counter), Color(ColorPicker), Icon(IconPicker), Currency(CurrencyPicker),
            Description(textarea max 255, counter), Starting balance(numpad), Include in total(toggle)
   Savings extra: Savings goal (optional, numpad)
   Debt extra: interestRateMonthly, interestRateYearly, mortgageLoanAmount, mortgageStartDate,
               mortgageTermYears, mortgageInterestRate
   Validate with Zod accountSchema from validation.ts
   On submit (create): insert to db.accounts directly (starting balance is NOT a transaction)
   On submit (edit): update db.accounts; if currency changed → show warning dialog first

5. AccountDetail.tsx (bottom sheet, route /accounts/:id):
   Sections:
   - Account info (icon, name, balance)
   - Edit name/icon/color inline or via form
   - Adjust balance: numpad to set exact balance (calls adjustBalance())
   - Shortcut buttons: "Add income"→/transactions/new?type=income&accountId=X
                       "Add withdrawal"→/transactions/new?type=expense&accountId=X
                       "View transactions"→setTransactionAccountFilter(id)+navigate('/transactions')
   - "Remove" button (destructive) → ConfirmDialog → set isTrashed=true
   Debt accounts extra:
     Calculate and display (on-open, not stored):
     - Remaining balance = account.balance
     - Monthly payment (mortgage): P×r×(1+r)^n / ((1+r)^n - 1) where r=monthly rate, n=months
     - Time left: months remaining
     - Accrued interest: balance × annualRate × (days_since_createdAt / 365) (simple interest)
       Use interestRateYearly; if null use interestRateMonthly×12; if null use mortgageInterestRate
   Savings accounts: progress bar if savingsGoal set

6. TrashedAccounts.tsx (route /accounts/trash):
   List of isTrashed accounts, Restore button per item → set isTrashed=false

Verification:
- Create account → appears in list with correct balance
- Account card tap → detail sheet with all info
- "Add income" shortcut → transaction input opens pre-filled
- Remove → moves to trash; Restore → reappears in list
- Total Wealth table groups assets and debts by currency correctly
- Savings goal shows progress bar in card and detail
```

---

### T14 · Categories Tab `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T08, T09, T05 complete

**Goal**: Categories tab with custom SVG donut chart, category cards, edit mode, and trash.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §2, §2a, §2b, §2c, §2d
      docs/design_spec.md §Donut Chart, §Category Card

TASK T14 — Categories Tab

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement in src/components/categories/:

1. DonutChart.tsx — Custom SVG (NOT Recharts — per docs/architect_spec.md note):
   Stroke-based SVG, stroke-width = 10% of radius (r=80, stroke-width=8, viewBox 0 0 200 200)
   Gap between slices: 2px var(--color-bg) stroke (add strokeDashoffset to create visual gap)
   Empty state: full circle in var(--color-border), center "0"
   Center text: expense total in var(--color-expense) / income total in var(--color-income)
     (center always shows both — it does NOT change based on view toggle)
   Load animation: each slice stroke draws in 400ms staggered 40ms per slice, ease-out
   Hover/tap on slice: filter:brightness(1.3) + drop-shadow, others → opacity:0.35
   ENTIRE SVG tap → toggleCategoriesViewType() in Zustand (switches expense↔income list)

   Props: slices:{categoryId:number,color:string,amount:number}[], totalExpense:number, totalIncome:number

   Slice rendering:
   - Calculate each slice's strokeDasharray/strokeDashoffset based on its fraction of total
   - Use cx=100 cy=100, r=80 circle with transform="rotate(-90 100 100)" to start at 12 o'clock

2. CategoryCard.tsx:
   Layout: (design_spec.md §Category Card)
   ┌─[var(--card-color) 3px border-left]──────────────────┐
   │  [icon]  Category Name                               │
   │          Budget: 500    Spent: 320                   │
   │  [████████░░░░░░░░░]  ← 4px bar flush bottom        │
   └────────────────────────────────────────────────────── ┘
   --card-color CSS var = category.color on element
   Progress bar: var(--card-color) fill, var(--color-border) track
   Over-budget: fill=var(--color-expense), card bg=var(--color-expense-dim)
   No budget: no bar, planned shows "—"
   Edit mode shows: grip handle (right), remove button (×), plus button hidden (on list level)

3. CategoryList.tsx (= Categories tab page):
   - TopBar: title="Categories", right = Edit button (or Done in edit mode)
   - PeriodFilter at top (connects to categoriesFilter Zustand)
   - DonutChart below period filter
   - Category cards below chart (expense or income based on categoriesViewType)
   - Cards order: by displayOrder; fallback alphabetical if all displayOrder=0
   - Edit mode (categoriesEditMode Zustand):
     * Drag handles visible on cards (drag implementation in T25)
     * + button: opens CategoryForm for new category (type = current view type)
     * × button per card: ConfirmDialog → isTrashed=true
     * Trash icon in TopBar right → navigate('/categories/trash')
   - Normal mode tap on category → navigate('/transactions/new?type={type}&categoryId={id}')
   - Empty state: empty ring donut + "No categories" + "Create category" button

4. CategoryForm.tsx (BottomSheet):
   Fields: Name(max 64, counter), Color(ColorPicker), Icon(IconPicker)
   Type: fixed = categoriesViewType Zustand when creating; immutable after creation
   On submit: insert to db.categories with displayOrder = max existing + 1

5. TrashedCategories.tsx (route /categories/trash):
   List isTrashed categories, Restore button → isTrashed=false
   Note: trashed categories remain on historical transactions as greyed read-only labels

Verification:
- Donut chart renders with category colors and animates on load
- Tapping chart toggles expense↔income category list
- Creating category → appears in list
- Category tap in normal mode → pre-populates transaction input
- Edit mode: drag handles appear, × removes to trash
- Over-budget category card shows red background
```

---

### T15 · Transactions Tab `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T08, T09, T05 complete

**Goal**: Transaction list with day grouping, sticky headers, filters, and selection mode.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §3 (Transactions Tab — read all)
      docs/design_spec.md §Transaction Row, §Selection Toolbar

TASK T15 — Transactions Tab

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement in src/components/transactions/:

1. TransactionDayHeader.tsx:
   Sticky: position:sticky, top:var(--sticky-offset,56px), z-index:var(--z-sticky), bg:var(--color-bg)
   Left: large day number (Syne 700, --text-day-num) + small "Mon, Mar 2026" (caption, text-secondary)
   Right: income total (var(--color-income)) + expense total (var(--color-expense)), --text-amount-sm JetBrains Mono
   --sticky-offset updated via ResizeObserver watching topbar + filter bar heights
   Props: date:string, totalIncome:number, totalExpense:number, currency:string

2. TransactionRow.tsx:
   Min-height 60px, padding --space-3 vertical --space-4 horizontal
   Left: 32px icon circle (category icon+color, or arrow-left-right for transfer)
   Center: category name (--text-body) + note (caption, text-secondary, 1 line ellipsis)
   Right: AmountDisplay component (sign + color + glow)
   Transfer row: opacity:0.5, var(--color-transfer) amount, shows "From → To"

   Tap anywhere EXCEPT grip handle → toggle selection (selectedTransactionIds Zustand)
   Selected: bg var(--color-primary-dim), checkbox appears left (24px circle, primary fill)

   Grip handle: grip-vertical Lucide, right side, min 44×44px touch target
   Grip handle does NOT trigger selection — used for drag (T25)

   Wrap day groups in: content-visibility:auto; contain-intrinsic-size:auto 200px

   Skeleton loading state

   Props: transaction:Transaction, account:Account, category:Category|null, isSelected:boolean, onSelect:()=>void

3. TransactionFilters.tsx (BottomSheet):
   Note contains: text input
   Category: dropdown/picker from active categories (non-trashed)
   Account: active accounts first; collapsible "Archived" section with trashed accounts below
   State from/to Zustand (transactionNoteFilter, transactionCategoryFilter, transactionAccountFilter)
   "Clear" button resets all

4. SelectionToolbar.tsx (replaces bottom nav when selection active):
   Height: calc(56px + env(safe-area-inset-bottom))
   Fixed bottom:0, full content width
   bg: var(--color-surface-raised), border-top: 1px solid var(--color-border-strong)
   z-index: var(--z-nav)
   Animation: translateY(100%)→0, 200ms ease-out; bottom nav: 0→translateY(100%) simultaneously
   Single selected: Edit (secondary button) + Remove (destructive button)
   Multiple selected: Remove only (destructive)
   Dismiss: clearSelection() when selectedTransactionIds is empty

5. TransactionList.tsx (= Transactions tab page):
   - TopBar: title="Transactions", right = filter icon button → show TransactionFilters sheet
   - PeriodFilter at top (connects to transactionsFilter Zustand)
   - "Clear filters" button below filter bar when hasActiveTransactionFilters()
   - FAB: → navigate('/transactions/new')
   - useTransactions(filter, accountId, categoryId, noteContains) for data
   - Group by date, render TransactionDayHeader + TransactionRow per group
   - Transfer grouping: in unfiltered view, merge pairs by transferGroupId into single row
     When filtering by accountId, show only that account's half
   - SelectionToolbar rendered when selectedTransactionIds.size > 0
   - Remove button:
     ConfirmDialog: "Delete N transaction(s)? This cannot be undone."
     On confirm: for each selected tx, call revertTransaction() or revertTransfer()
     Then clearSelection()
   - Edit button (single selection): navigate('/transactions/:id/edit')
   - Empty state: "No transactions for this period"

Verification:
- Transactions grouped by day, sticky day headers scroll correctly
- Day header income/expense totals correct
- Tap row → selection mode, checkbox appears
- Select multiple → only Remove button shown
- Delete: confirmation dialog → removes transactions + updates account balances
- Filter by category: only matching transactions shown
- Filter by account: shows only that account's transactions (transfers: only that account's half)
- SelectionToolbar slides up when selection active, bottom nav slides down
```

---

### T16 · Transaction Input (Add / Edit) `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T09, T10, T06, T07, T05 complete

**Goal**: The full transaction add/edit flow — income, expense, transfer with foreign currency support.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §3a, §3b (read both sections fully — this is the most complex UI)
      docs/design_spec.md §Transaction Input (Numpad) — both Income/Expense and Transfer layouts

TASK T16 — Transaction Input (Add/Edit)

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/components/transactions/TransactionInput.tsx
Routes: /transactions/new, /transactions/:id/edit

ENTRY MODES (from URL):
- /transactions/new → full flow (step 1 + step 2)
- /transactions/new?type=expense&categoryId=5 → skip to step 2 with category pre-selected
- /transactions/new?type=income&accountId=3 → skip to step 2 with account+type pre-selected
- /transactions/:id/edit → load existing tx, go directly to step 2 pre-filled

STEP 1 — Tab + first selection (shown only when no query params pre-select):
  Tabs: Income | Expense | Transfer
  Income/Expense: show category list (same visual as CategoryCard but no period amounts — just name+icon)
    Tap category → go to step 2
  Transfer: show account list → tap source account → show account list again → tap destination
    After source: show "→ Select destination" header
  No back button to tabs once a tab is selected? Actually: allow switching tabs (clears selection)

STEP 2 — Detail view:
  Header row: "From [account ▾]  →  To [category/account ▾]"
    Tap account → account picker (all active accounts)
    Tap category → category picker (filtered by type: EXPENSE or INCOME)

  Default "From" account (per spec.md §3a):
    1. Non-trashed account with the most recent transaction date across all its transactions
    2. If no transactions exist for any account: first non-trashed account alphabetically

  Amount field: --text-amount-lg JetBrains Mono, shows evaluated expression

  FOREIGN CURRENCY (account.currency ≠ mainCurrency):
    Second field below: "≈ {mainAmount} {mainCurrency}" (caption, mono)
    Primary field (account currency): always editable
    Secondary field (main currency): editable ONLY after primary has value
    Editing primary → recalculate secondary using getRate(); any manual secondary override discarded
    Editing secondary → stores override, primary unchanged
    Banner if no rate: "No exchange rate available — using 1:1 conversion."

  Notes field: max 255 chars
    Pre-fill suggestion: last note used for this category (lighter text color, italic)
    "Use last note ×" chip (one-tap accept; × dismisses)
    Tapping field clears suggestion, allows fresh input

  Numpad: use <Numpad> component
    variant="transaction", isTransfer={type==='transfer'}
    onCalendarPress: show date picker (date-fns, inline or sheet), defaults today
    onSave: validate + save

  Coming soon stub: greyed "Repeat" label below numpad (ComingSoonStub wrapper)

TRANSFER-SPECIFIC:
  Operator column hidden in numpad
  No category selection
  If source.currency ≠ dest.currency: show two amount fields (source amount, dest amount)
    dest amount: auto-calculated, editable to override

ON SAVE:
  1. Evaluate expression → amount (must be > 0, else show error)
  2. Get exchange rate: getRate(account.currency, mainCurrency)
  3. If manual override of main amount: use that; else = amount × rate
  4. Create Transaction: {
       type, date (selected date as "YYYY-MM-DD"), timestamp (UTC ISO now),
       displayOrder: 0 (applyTransaction will set correct order),
       accountId, categoryId (null for transfer),
       currency: account.currency, amount, amountMainCurrency, exchangeRate,
       note, transferGroupId (null for non-transfer), transferDirection (null for non-transfer)
     }
  5. For transfer: create OUT and IN records with same transferGroupId (uuid v4)
  6. Call applyTransaction() or applyTransfer() from balance service
  7. navigate(-1) or back to /transactions

ON EDIT SAVE:
  Load existing tx from db by route :id
  Call replaceTransaction() or replaceTransfer() from balance service
  Date change → applyTransaction will reset displayOrder

VALIDATION:
  Amount > 0
  Account selected
  Category selected (non-transfer)
  Source ≠ dest (transfer): show error "Source and destination must be different"

Verification:
- Add expense → transaction in list, account balance decremented
- Add income → balance incremented
- Add transfer → both account balances updated
- Edit transaction → balance correctly updated (old reversed, new applied)
- Pre-selected category (from Categories tab) → step 1 skipped
- Foreign currency account → dual amount fields appear
- Numpad math: 50+30 → saves 80.00
- Trailing operator → saved correctly (100+ → 100)
```

---

### T17 · Budget Tab `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T08, T09, T10, T05, T02, T06, T07 complete

**Goal**: Budget tab with four sections, progress bars, and budget input numpad with stats.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §4 (Budget Tab — read fully)
      docs/design_spec.md §Category Card (for budget card visual)

TASK T17 — Budget Tab

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement in src/components/budget/:

1. BudgetStats.tsx:
   Shown in a popup when stats button pressed in BudgetNumpad
   Props: categoryId?:number, accountId?:number
   Displays (query from db.transactions for the target):
   - Average monthly spend: all transactions / months_of_history
     For savings/debt: sum of TRANSFER IN amounts per month
   - Last month's actual spend: sum for previous calendar month
   - Last set budget: most recent Budget record for this category/account
   Shows "N/A" for each if no data

2. BudgetNumpad.tsx:
   Extends Numpad component with stats button replacing calendar button
   onStatsPress → show BudgetStats popup (inside a BottomSheet)
   onSave → upsert Budget record for {categoryId/accountId, month, plannedAmount}
   Props: categoryId?:number, accountId?:number, currentMonth:string, currentPlanned?:number

3. BudgetCard.tsx:
   Same visual as CategoryCard but with budget data:
   - Name, icon, color from category or account
   - Planned amount (formatted) or "—" if not set
   - Spent amount
   - Progress bar (4px, var(--card-color) fill) if planned > 0
   - Over-budget: var(--color-expense) fill + var(--color-expense-dim) card bg
   - Tap → opens BudgetNumpad sheet to set/update planned amount
   Props: item:{id,name,icon,color,planned:number|null,spent:number}, type:'category'|'account'

4. BudgetSection.tsx:
   Props: title:string, items:BudgetCardProps[], isLoading?:boolean
   Sort: items with planned budget first (by planned desc), then unbudgeted alphabetically
   Items with planned budget: pinned to top

5. Budget Tab (src/pages/BudgetTab.tsx or inline in router):
   - TopBar: title="Budget"
   - PeriodFilter variant="month-only" (connects to budgetMonth Zustand)
   - 4 BudgetSections: Expenses | Income | Savings accounts | Debt accounts

   Data loading for each section:
   EXPENSES section: useCategories('EXPENSE') + for each: sum transactions where categoryId=X in month
   INCOME section: useCategories('INCOME') + same
   SAVINGS section: useAccounts() filter type='SAVINGS' + for each: sum TRANSFER IN transactions to that account in month
   DEBT section: useAccounts() filter type='DEBT' + same (transfer IN = debt payment)

   For each section item: join with useBudgets(month) to get plannedAmount

   Empty state: "No budget data for this month" when no budgets and no transactions for month

Verification:
- Budget sections render with correct categories and accounts
- Tap a card → budget numpad opens with stats button
- Stats button shows average/last month/last budget (or N/A)
- Setting a budget → progress bar appears
- Spending over budget → red card
- Savings/debt sections show transfer amounts as "spent"
- Month navigation (< >) changes data correctly
```

---

### T18 · Overview Tab `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T08, T09, T05 complete

**Goal**: Overview tab with net balance, Recharts bar chart, daily averages, and category breakdown.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §5 (Overview Tab — read fully, all 5 items)
      docs/design_spec.md §Bar Chart (Overview)

TASK T18 — Overview Tab

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement in src/components/overview/:

1. OverviewSummary.tsx:
   Net balance = total income − total expenses for period
   Net balance: --text-display JetBrains Mono, green (var(--color-income)) if positive, red (var(--color-expense)) if negative
   Total income: var(--color-income) JetBrains Mono
   Total expenses: var(--color-expense) JetBrains Mono

2. SpendingBarChart.tsx (uses Recharts BarChart):
   Auto-scale buckets via autoScaleChartBuckets(start,end) from date-utils:
     single day (start===end) → hourly buckets
     2–31 days → daily buckets  (covers any full calendar month)
     32–90 days → weekly buckets (weeks start Monday; partial weeks at period boundaries get own bar)
     >90 days → monthly buckets
   Aggregate expense transactions into buckets

   Bar: var(--color-primary) at 70% opacity, borderRadius:[4,4,0,0] (top corners only)
   Active bar: full var(--color-primary) + box-shadow glow
   Grid: CartesianGrid horizontal only, var(--color-border) 50% opacity
   Axis labels: caption size, var(--color-text-secondary)
   Empty bars (0 value): still show as 2px stub, var(--color-border)
   Animation: bars grow from 0, 300ms staggered ease-out (Recharts animationDuration)

   Recharts responsive container, CustomTooltip styled to match dark theme

3. DailyAverages.tsx:
   Average per day = total spending ÷ calendar days in period (INCLUDING zero-spend days)
   Today = sum of expenses with date = getLocalDateString() — show only if today in period
   This week = sum of expenses Mon–Sun of current week — show only if period overlaps current week
   Each figure: JetBrains Mono var(--color-text), label in text-secondary caption

4. CategoryBreakdown.tsx:
   All expense categories for period, sorted by amount DESC
   Each row: icon, category name, progress bar (100% = total period spending), amount
   Zero-spend categories: bottom, var(--color-text-disabled), alphabetical

5. Overview Tab page:
   - TopBar: title="Overview"
   - PeriodFilter (full variant, connects to overviewFilter Zustand)
   - OverviewSummary
   - SpendingBarChart
   - DailyAverages
   - CategoryBreakdown
   - Empty state: "No data for this period" when no transactions in period

Verification:
- Period filter changes update all components
- 1-day period: bar chart shows hourly buckets
- 1-month period: bar chart shows daily bars
- 100-day period: bar chart shows monthly bars
- Category breakdown percentages sum to 100% (within rounding)
- Net balance green for net income, red for net expense
- "Today" and "This week" figures appear/disappear based on period
```

---

### T19 · Settings View `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T08, T09, T04, T05, T06 complete

**Goal**: Full settings view with all 8 settings options.

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §6 (Settings — read all items)
      docs/design_spec.md §Settings View

TASK T19 — Settings View

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/components/settings/SettingsView.tsx and sub-components.

Route: /settings — full screen push (slides from right), back arrow top-left, NO bottom nav shown

Layout (design_spec.md §Settings View):
- Section headers: Syne 700, var(--color-text-secondary), uppercase, letter-spacing:0.12em, caption
- Rows: 52px min-height, border-bottom: 1px solid var(--color-border)
- Toggles: var(--color-primary) when on, var(--color-border) track when off, 150ms slide
- Disabled stub rows: opacity:0.4, aria-disabled, tap → "Coming soon" toast

SETTING ROWS:

1. Language (LanguageSetting.tsx):
   Shows current language ("English"), tap opens picker
   Only "English" available; infrastructure ready for more (i18next.changeLanguage())
   On change: settingsStore.update('language', lang)

2. Theme (ThemeSetting.tsx):
   "Dark" option: selected/active
   "Light" option: tapping shows ConfirmDialog variant='default':
     title: "Light Theme", body: "The developer dislikes light theme and will never implement it."
     Only a close/OK button (no confirm action — it's intentional humor)
   This is NOT a bug — keep as-is.

3. Startup Screen (StartupScreenSetting.tsx):
   Radio-style picker: Accounts | Categories | Transactions | Budget | Overview
   On change: settingsStore.update('startupScreen', tabName)

4. Passcode — ComingSoonStub wrapper around a disabled row

5. Daily Notification (NotificationSetting.tsx):
   Toggle: enable/disable
   When enabling: request Notification.permission
     If denied: show error toast, don't enable
   Time picker (HH:MM): shown when enabled
   Default: 20:00
   On change: settingsStore.update('notificationEnabled', bool) + update('notificationTime', 'HH:MM')
   Call notification.service.ts scheduleDailyReminder(time) or cancelDailyReminder()

6. Main Currency (MainCurrencySetting.tsx):
   Shows current main currency
   Tap → CurrencyPicker
   On selection: ConfirmDialog:
     "All historical amounts will be recalculated to {currency}. This may take a moment."
   On confirm:
     Show progress indicator (linear progress bar, 0–100%)
     Call: await exchangeRateService.recalculateAllMainCurrencyAmounts(newCurrency, (done, total) => {
       setProgress(Math.round((done / total) * 100));
     });
     (It is a Promise<void> with onProgress callback — NOT an async generator)
     If throws with missing currencies: show error dialog listing them
     On success: settingsStore.update('mainCurrency', currency), dismiss
   On cancel: do nothing

7. Backup (BackupSettings.tsx):
   Rows:
   - "Create backup" → backupService.createBackup() → toast "Backup created"
   - "Auto-backup" → interval picker (Off / 6h / 12h / 24h / 48h)
     Calls backupService.setAutoBackupSchedule(hours|null)
   - "Export to file" → backupService.exportToFile() (T21)
   - "Restore from file" → file input (hidden, accept=".json") → ConfirmDialog → backupService.importFromFile(file)
   - "Restore from backup" → shows list of on-device backups (date, auto/manual) → tap → ConfirmDialog → backupService.restoreFromBackup(id)
   Both restore flows: ConfirmDialog "This will delete all current data and replace it with the backup. This cannot be undone."

8. Export Data (ExportSettings.tsx):
   PeriodFilter component for date range selection (full variant, but no filter type restriction)
   "Export" button → export.service.exportTransactions(start, end, mainCurrency) (T22)
   Shows loading state while exporting
   Notification on complete (T23)

Verification:
- Language setting changes i18n language immediately in UI
- Light theme: tap Light → humor dialog appears, not an error
- Startup screen setting saves and used on next app start
- Notification: enable → browser permission prompt
- Main currency change: confirmation → progress indicator → all transaction amountMainCurrency updated
- Create backup → backup appears in restore list
- Export to file → download prompt appears
```

---

## Phase 5 — Services & Polish

### T20 · Backup Service `[ ]`

**Skills**: none
**Depends on**: T02 complete

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §6 item 7 (Backup behavior)

TASK T20 — Backup Service

Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/services/backup.service.ts.

Backup JSON format (nested under "tables" — restore code must match this structure):
{
  "version": 1,
  "exportedAt": "ISO-8601",
  "appVersion": "1.0.0",
  "tables": {
    "accounts": [...],
    "categories": [...],
    "transactions": [...],
    "budgets": [...],
    "exchangeRates": [...],
    "settings": [...]
  }
  // db.backups table is EXCLUDED from backup snapshots
}

Methods (use these exact names — T19 calls them):
  createBackup(isAutomatic=false): Promise<void>
    Serialize tables to JSON (nested format above), store as Backup record in db.backups

  listBackups(): Promise<Backup[]>
    Return all records sorted by createdAt desc

  restoreFromBackup(backupId:number): Promise<void>
    Load backup record, parse data.data JSON string, call _restoreData(parsed)

  exportToFile(): Promise<void>
    Serialize tables → JSON blob → download as 'expenses-backup-YYYY-MM-DD.json'
    Use URL.createObjectURL + temporary <a> click

  importFromFile(file:File): Promise<void>
    Read file as text, parse JSON, validate version field, call _restoreData(parsed)

  setAutoBackupSchedule(intervalHours:number|null): void
    If null: clear any scheduled interval
    If number: setInterval to call createBackup(true) every intervalHours*3600000ms
    On app start (called from App.tsx): check lastAutoBackupAt + autoBackupIntervalHours setting;
    if overdue, call createBackup(true) immediately

  checkAndRunAutoBackup(): Promise<void>
    Read settings, compare lastAutoBackupAt vs now vs interval, create backup if overdue

  private _restoreData(data: BackupJSON): Promise<void>
    In a single db.transaction('rw', [db.accounts, db.categories, db.transactions,
                                      db.budgets, db.exchangeRates, db.settings]):
      Clear ONLY those 6 tables — DO NOT clear db.backups (preserves backup history)
      Bulk insert from data.tables.accounts, data.tables.categories, etc.
    After complete: window.location.reload()

Verification:
- Create backup → db.backups has a record with correct JSON data
- Export to file → triggers download
- Restore from on-device backup → all data matches backup
- Restore from file → same
```

---

### T21 · Export Service `[ ]`

**Skills**: none
**Depends on**: T02, T03 complete

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §6 item 8 (Export Data — read column spec carefully)

TASK T21 — Export Service

Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/services/export.service.ts.

exportTransactions(startDate:string, endDate:string, mainCurrency:string): Promise<void>

Steps:
1. Fetch all transactions where date >= startDate and date <= endDate, sorted by date ASC
2. Fetch all accounts and categories (including trashed — names must always resolve)
3. Build spreadsheet rows:
   Header: ["Date (dd.mm.yyyy)", "Note", `Income (${mainCurrency})`, `Expense (${mainCurrency})`, "Category", "Account"]

   Per transaction:
   - Date: format date "YYYY-MM-DD" → "DD.MM.YYYY"
   - Note: transaction.note
   - Income col: if type=INCOME: transaction.amountMainCurrency (else empty)
   - Expense col: if type=EXPENSE: transaction.amountMainCurrency (else empty)
   - Category: category.name (look up from categories list; if trashed, still shows name)
                null categoryId (transfers): "Transfer"
   - Account: account.name (look up from accounts list)

   TRANSFER rows: emit TWO rows per transfer pair
     OUT half: Expense column = outTx.amountMainCurrency, Category = "Transfer"
     IN half: Income column = inTx.amountMainCurrency, Category = "Transfer"

   All amounts: positive numbers

4. Generate .xlsx using xlsx package:
   const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
   const wb = XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
   const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});

5. Download:
   const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url; a.download = `expenses_${startDate}_to_${endDate}.xlsx`; a.click();
   setTimeout(() => URL.revokeObjectURL(url), 10000);

6. After download triggered: call notification.service.sendNotification('Export complete', 'Your file has been downloaded.')

Verification:
- Export with date range → downloads .xlsx file
- File opens in LibreOffice/Excel with correct columns
- Transfer appears as two rows
- Trashed account/category names still appear correctly
```

---

### T22 · Notification Service `[ ]`

**Skills**: none
**Depends on**: T01 complete

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §6 item 5 (Daily Notification)

TASK T22 — Notification Service

Mark this task [~] in TASKS.md before starting, [x] when done.

Implement src/services/notification.service.ts.

  scheduleDailyReminder(time:string): void
    time = "HH:MM" wall-clock
    Parse time → compute next occurrence:
      If current time < target time today: schedule for today
      Else: schedule for tomorrow
    Use setTimeout for in-session scheduling
    On trigger: sendNotification('Expenses', 'Time to log your expenses!'), then reschedule for next day
    Store timeoutId to allow cancellation

  cancelDailyReminder(): void
    clearTimeout(stored timeoutId)

  sendNotification(title:string, body?:string): void
    if (Notification.permission !== 'granted') return
    new Notification(title, {body, icon:'/icons/icon-192.png'})

  requestPermission(): Promise<boolean>
    const result = await Notification.requestPermission()
    return result === 'granted'

Export singleton: const notificationService = new NotificationService()
Re-export functions: scheduleDailyReminder, cancelDailyReminder, sendNotification, requestPermission

On app startup (App.tsx): if notificationEnabled setting is true, call scheduleDailyReminder(notificationTime)

Verification:
- Enable notifications in Settings → browser permission prompt
- Set time to 1-2 minutes ahead → notification fires
- Disable → notification cancelled
- Export calls sendNotification (manual test)
```

---

### T23 · PWA Configuration `[ ]`

**Skills**: none
**Depends on**: T01, T22 complete

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/design_spec.md §Android PWA Specifics

TASK T23 — PWA Configuration

Mark this task [~] in TASKS.md before starting, [x] when done.

1. vite.config.ts — Complete VitePWA configuration:
   VitePWA({
     registerType: 'autoUpdate',
     manifest: {
       name: 'Expenses', short_name: 'Expenses',
       description: 'Personal finance tracker',
       start_url: '/', scope: '/',
       theme_color: '#0A0B12', background_color: '#0A0B12',
       display: 'standalone', orientation: 'portrait',
       'edge-to-edge': true,
       icons: [
         {src:'/icons/icon-192.png', sizes:'192x192', type:'image/png', purpose:'any'},
         {src:'/icons/icon-512.png', sizes:'512x512', type:'image/png', purpose:'maskable'}
       ]
     },
     workbox: {
       runtimeCaching: [
         { urlPattern: /^https:\/\/fonts\.gstatic\.com\//i, handler:'CacheFirst',
           options:{cacheName:'google-fonts-webfonts', expiration:{maxAgeSeconds:365*24*60*60, maxEntries:30}} },
         { urlPattern: /^https:\/\/fonts\.googleapis\.com\//i, handler:'StaleWhileRevalidate',
           options:{cacheName:'google-fonts-stylesheets'} },
         { urlPattern: /^https:\/\/open\.er-api\.com\//i, handler:'NetworkFirst',
           options:{cacheName:'exchange-rates', networkTimeoutSeconds:5,
                   expiration:{maxAgeSeconds:24*60*60, maxEntries:10}} }
       ]
     }
   })

2. Create placeholder icons in public/icons/:
   icon-192.png: 192×192 dark background (#0A0B12) with white letter "E" (Syne font style)
   icon-512.png: 512×512 same design (maskable: safe area = center 80%)
   Use Canvas API in a one-off script, or create SVG and convert. Keep it simple.

3. src/sw-register.ts — Full implementation:
   import { Workbox } from 'workbox-window';

   Register SW on load:
   if ('serviceWorker' in navigator) {
     const wb = new Workbox('/sw.js');
     wb.register();
   }

   beforeinstallprompt handling:
   let deferredPrompt: BeforeInstallPromptEvent | null = null;
   window.addEventListener('beforeinstallprompt', (e) => {
     e.preventDefault();
     deferredPrompt = e as BeforeInstallPromptEvent;
     installPromptStore.setCanInstall(true);  // Zustand store
   });
   window.addEventListener('appinstalled', () => {
     installPromptStore.setCanInstall(false);
     deferredPrompt = null;
   });
   export async function triggerInstall() { ... deferredPrompt.prompt() ... }
   export function dismissInstall() { installPromptStore.setCanInstall(false); }

4. src/hooks/use-install-prompt.ts:
   Returns {canInstall:boolean, install:()=>Promise<void>, dismiss:()=>void}
   Reads from small Zustand store (add canInstall to ui-store or separate small store)

5. TopBar.tsx — Add install chip:
   When canInstall: show small chip right of title area
   Text: "Add to Home Screen" (or just "Install")
   Tap: call install()
   × button: call dismiss()
   Never blocks UI, auto-hides after dismiss

Verification:
- npm run build then serve dist/ locally (npx serve dist)
- Chrome DevTools → Application → Service Workers: registered
- Application → Manifest: all fields correct
- Network tab offline: app still loads from cache
- Install prompt appears in Chrome
- Google Fonts load from cache when offline (after first visit)
```

---

### T24 · Drag-and-Drop Reordering `[ ]`

**Skills**: `/feature-dev`
**Depends on**: T13, T14, T15 complete

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/spec.md §2 (category drag-reorder), §3 (transaction drag-reorder)
      docs/design_spec.md §Transaction Row - Drag-to-reorder, §Category Card - Drag-to-reorder

TASK T24 — Drag-and-Drop Reordering

Use the /feature-dev skill to implement this feature.
Mark this task [~] in TASKS.md before starting, [x] when done.

Uses @dnd-kit/core and @dnd-kit/sortable (already installed).

TRANSACTION REORDERING:
In TransactionList.tsx:
  - Wrap each day group in <DndContext> + <SortableContext items={dayTransactionIds}>
  - DndContext is SCOPED PER DAY (cannot drag across days — this is by design)
  - onDragEnd: if same day, recompute displayOrder for all transactions in that day
    New displayOrder = index in new order (0-based or sequential)
    db.transactions.bulkPut(reorderedTransactions)

In TransactionRow.tsx:
  - Use useSortable({id: transaction.id})
  - Attach {listeners} ONLY to the grip handle element (grip-vertical icon)
  - Other row content: does NOT receive drag listeners (only selection tap)
  - Grip handle: min 44×44px touch target, aria-label="Reorder {categoryName}"
  - Active drag state (isDragging): scale(1.03), box-shadow:0 8px 24px rgba(0,0,0,0.5), opacity:0.95, z-index:var(--z-sheet)
  - Drop indicator: 2px line in var(--color-primary) between rows (use DragOverlay or custom)

CATEGORY REORDERING (edit mode only):
In CategoryList.tsx edit mode:
  - Wrap category cards in <DndContext> + <SortableContext>
  - Same drag visual spec as transactions
  - onDragEnd: update displayOrder for all categories of current type
    db.categories.bulkPut(reorderedCategories)
  - Drag handles visible only when categoriesEditMode is true

displayOrder persistence:
  After drag: assign displayOrder = new array index * 10 (leave gaps for future insertions)
  When a transaction's date is edited: set displayOrder = max(existing in new day) + 10

KEYBOARD accessibility (dnd-kit provides this natively via KeyboardSensor):
  Add KeyboardSensor to DndContext sensors alongside PointerSensor

Verification:
- Drag transaction by grip handle → reorders within day, persists after reload
- Tapping row (not grip) → selection mode, NOT drag
- Attempting to drag to different day → snaps back (DnD is day-scoped)
- Drag category in edit mode → reorders, persists
- Order persists after app reload (displayOrder saved to DB)
- Keyboard: focus grip handle, use arrow keys to reorder
```

---

### T25 · Accessibility & Performance Pass `[ ]`

**Skills**: `/frontend-audit`, `/frontend-polish`
**Depends on**: All other tasks complete

**Agent prompt**:
```
Working directory: /home/anton/Project/expensesapp
Specs: docs/design_spec.md §Accessibility, §Motion

TASK T25 — Accessibility & Performance Pass

Run /frontend-audit to score the current UI, then /frontend-polish to fix issues.
Mark this task [~] in TASKS.md before starting, [x] when done.

ACCESSIBILITY CHECKLIST — verify and fix each item:

1. [ ] All interactive elements: min 44×44px touch targets
       Audit: open DevTools → Elements, check computed size of all buttons/icons
       Fix: add padding or min-width/min-height as needed

2. [ ] Focus rings: outline: 2px solid var(--color-primary); outline-offset: 2px
       On ALL focusable elements (:focus-visible). Never opacity-only.
       Fix: add global CSS rule in index.css:
         *:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

3. [ ] <html lang="en"> set in index.html

4. [ ] All icon-only buttons have aria-label
       Grep for <button without aria-label where no visible text
       Fix: add descriptive aria-label to each

5. [ ] Balance totals that update dynamically: role="status" on the element
       (Accounts tab total balance, account card balance)

6. [ ] Amounts: always + or − prefix AND color-coded (never color alone as only indicator)
       Verify: AmountDisplay always renders sign character

7. [ ] Drag handles: aria-label="Reorder {item name}", keyboard operable

8. [ ] Coming soon stubs: aria-disabled="true" + aria-describedby (NOT aria-hidden)

9. [ ] ConfirmDialog: focus trapped inside modal when open
       Use: focus first button on open, return focus to trigger on close
       Keyboard: Escape closes dialog

10.[ ] Body text contrast ≥ 4.5:1, large text/icons ≥ 3:1
        Test: DevTools → color picker contrast checker
        var(--color-text) on var(--color-bg): oklch(94%) on oklch(8%) — should pass
        var(--color-text-secondary) on var(--color-surface): may be borderline — verify

PERFORMANCE CHECKLIST:

11.[ ] Transaction day groups: content-visibility:auto; contain-intrinsic-size:auto 200px
        Verify in TransactionList.tsx day group wrappers

12.[ ] @media (prefers-reduced-motion: reduce) block active in index.css
        Test: DevTools → Rendering → Emulate CSS media → prefers-reduced-motion: reduce
        All animations should be instant (0.01ms duration)

13.[ ] Skeleton states shown while useLiveQuery loads (Dexie returns undefined initially)
        Verify: AccountCard, TransactionRow, CategoryCard all have skeleton state

14.[ ] Run Lighthouse audit (in Chrome DevTools):
        Accessibility score ≥ 90
        PWA: all checks green
        Performance: LCP < 2.5s on simulated mobile

15.[ ] Test on Android device or Chrome DevTools mobile emulation:
        Safe area insets respected (no content behind notch/navbar)
        Scrolling smooth, no jank
        Touch targets reachable

FIX any issues found. Document any intentional deviations from accessibility guidelines.

Verification:
- Lighthouse Accessibility ≥ 90
- All 15 checklist items above resolved
- App usable entirely via keyboard
- App works offline (service worker active)
```

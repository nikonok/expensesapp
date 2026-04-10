# Expenses App

The idea is to develop the expense and finance tracking app.

---

## Technical Stack

- **Framework**: React 19 + TypeScript
- **Build / PWA**: Vite + vite-plugin-pwa (installable on Android, openable in any browser)
- **Local storage**: Dexie.js (IndexedDB wrapper)
- **Currency conversion**: exchangerate-api.com (rates cached on-device; see §3a for offline behavior)
- **Styling**: Tailwind CSS

The application is a Progressive Web App. Primary platform is mobile (Android). It must work in a browser on desktop, but desktop layout polish is not the primary goal.

---

## Core Technical Requirements

1. Data is stored on-device (IndexedDB). The server only serves the application bundle. Include infrastructure stubs to support future database sync to a server, but do not implement sync now.
2. Transaction timestamps are stored as UTC ISO-8601 strings. The displayed date is always derived from the local wall-clock date at the time of entry, so an expense added on a given day always stays on that day regardless of timezone changes.
3. All text inputs must be validated. Enforce reasonable character limits (e.g. names ≤ 64 chars, notes ≤ 255 chars) and communicate limits to the user.
4. All text input is UTF-8, supporting EN, PL, BY, RU and any other Unicode scripts.
5. Displayed amounts follow locale-appropriate formatting via `Intl.NumberFormat` (e.g., 1,000.00 for EN, 1 000,00 for PL). The numpad always uses `.` as decimal separator (standard calculator behavior).

---

## Core Concepts

These terms are used throughout this document:

- **Main currency**: A global user setting. Used for all totals, summaries, and charts. Amounts in other currencies are converted to the main currency for display purposes using the exchange rate stored at transaction time.
- **Account balance**: A stored numeric value. It is updated automatically when a transaction is added, edited, or deleted. The user can also manually adjust the balance (e.g. to correct a discrepancy); this modifies the stored value directly without creating a transaction record.
- **Category type**: Every category is either `EXPENSE` or `INCOME`, set at creation time and immutable. The UI prevents using an expense category on an income transaction and vice versa.
- **On-device backup**: A full snapshot of the IndexedDB database stored in the app's own IndexedDB space (a separate key).
- **Transfer**: A movement of money between two of the user's own accounts. Transfers are not income or expenses and do not affect category or budget calculations.
- **Debt balance convention**: A debt account's balance is a positive number representing the amount owed. A starting balance of 50,000 on a mortgage means 50,000 is owed. Payments (transfers to the debt account) reduce the balance toward zero. In Total Balance and Total Wealth calculations, debt balances are subtracted (they reduce net worth).

---

## Future Features (Not Implemented — Stubs Only)

The following features are planned but not built. Each should have a visible but greyed-out entry point in the UI with a "Coming soon" tooltip, and a schema/code stub so they can be added without breaking changes:

- **Recurring transactions**: A "Repeat" option in the add-transaction flow (daily / weekly / monthly / yearly, with optional end date).
- **Passcode / biometric lock**: In Settings.
- **Server sync**: Backend database sync infrastructure.
- **Savings account interest rate**: Optional interest rate field on savings accounts.
- **Debt account auto-interest accrual**: Automatic interest transactions for debt accounts.

---

## Color Palette

A single shared palette of ~24–32 predefined colors is used for both accounts and categories. Colors can be reused across objects. There is no uniqueness constraint.

---

## First-Run Setup

On first app launch (no accounts exist), a guided setup flow appears:

1. Welcome screen with app name/logo and a "Get Started" button
2. Main currency selection (defaults based on device locale if detectable, otherwise USD)
3. Create first account (simplified form: name, type, currency, starting balance)
4. Offer default category presets (e.g. Food, Transport, Housing, Entertainment, Salary, Freelance) — user can accept all, toggle individual ones, or skip
5. Setup complete — navigate to the startup screen

The flow can be skipped at any step via a "Skip" link. A `hasCompletedOnboarding` setting tracks completion. The flow never appears again once completed or skipped.

---

## The Views of the App

### 1. Accounts Tab

The Accounts tab shows:

1. List of user accounts
2. Balance for each account in that account's currency
3. Total balance across all accounts (in main currency, excluding accounts marked as excluded)
4. Button to create a new account

Accounts are divided into three types:

1. **Regular** — cash, debit card, etc.
2. **Debt** — credit card, mortgage, loan, etc.
3. **Savings** — savings account, goal, etc.

A trash icon on this tab opens the trashed accounts view (see §1c).

#### 1a. Total Wealth Sub-view

Shows a table of total assets and debts grouped by currency:

|     | ASSETS | DEBTS  |
| --- | ------ | ------ |
| PLN | 13 000 | 50 000 |
| USD | 5      | 0      |

**Scope**: Assets = sum of Regular and Savings account balances, grouped by currency. Debts = sum of Debt account balances, grouped by currency. Accounts marked as "exclude from total balance" and trashed accounts are both excluded from this table.

#### 1b. Account Creation (bottom sheet / modal)

Appears when the user taps the "create account" button.

**General fields (all account types):**

1. Name (text input, max 64 chars)
2. Color (selection from the shared color palette)
3. Icon (emoji or icon from a large predefined set)
4. Currency (selection from a predefined list; defaults to the current main currency setting)
5. Description (text input, max 255 chars)
6. Starting balance (mandatory; stored directly on the account — not recorded as a transaction; does not appear in the Transactions tab or exports)
7. Include in total balance (toggle) — if off, this account is excluded from the total balance and Total Wealth calculations

**Savings account additional fields:**

1. Savings goal (optional target amount)

**Debt account additional fields:**

1. Monthly / yearly interest rate (optional; informational only — see §1c)
2. Mortgage fields (optional): loan amount, start date, term in years, interest rate

> **Note on debt in totals**: Only the current debt (remaining balance) is relevant for totals. The original loan amount is informational only and is never included in Total Balance or Total Wealth calculations. The shared "Include in total balance" toggle (in General fields above) controls whether the debt account's current balance appears in totals.

**Note on currency after creation**: Currency can be changed in account settings after creation, with a warning dialog explaining that existing transactions will retain their original amounts and the stored balance will not be auto-converted — the user must correct the balance manually. In the transaction edit view, old transactions always display their original currency, not the account's new currency.

#### 1c. Tapping an Account

Opens an account detail view where the user can:

- Rename the account
- Change the icon or color
- Manually adjust the current balance (modifies stored balance; no transaction created)
- Remove the account
- Shortcut buttons: add incoming transaction, add withdrawal
- **"View transactions" shortcut**: navigates to the Transactions tab with this account pre-applied as a filter

**Debt account detail**: Shows calculated values (informational only, updated on-demand each time the account detail is opened):

- Remaining balance
- Monthly payment
- Time left to pay off
- Accrued interest (if interest rate is set) — calculated as: `principal × annual_rate × (days_since_account_creation ÷ 365)` using simple interest (non-compounding); 365-day year. Uses `interestRateYearly`; if only monthly is set, yearly = monthly × 12. If no general rate is set but `mortgageInterestRate` is, the mortgage rate is used as fallback. `mortgageInterestRate` is otherwise used exclusively for mortgage-specific calculations (monthly payment, time left).

These calculations do not modify the stored balance or create transactions.

**Savings account detail**: If a savings goal is set, shows a progress bar toward the goal amount.

**Account removal**: The account is moved to a trash folder. Its transaction history is fully preserved and visible in the Transactions tab. The account no longer appears in transaction creation flows. The trash cannot be emptied (intentional — preserves audit history). Removed accounts can be restored from the trash (accessible via the trash icon on the Accounts tab).

---

### 2. Categories Tab

Shows a summary of spending (or income) per category for the selected period.

**Period filter** (top of screen): When tapped, opens a sub-dialog with options:

- All time
- Today
- Custom range (from date to date)
- Single day
- Week
- Month
- Year

When filtering by day / week / month / year, the main screen shows `<` and `>` buttons to jump to the previous or next period.

Filter settings are per-tab and reset when the app is closed.

**Empty state**: If no categories exist, the donut chart is still rendered as an empty ring (tappable to toggle expense/income view), with a "Create category" button below. The button opens the category creation form directly (bypasses edit mode). The category type (EXPENSE or INCOME) is determined by the currently active view.

**Category cards**: Each category is shown as a card. Cards are ordered by the custom drag-reorder order set in edit mode; if never reordered, they are sorted alphabetically. The card displays:

- Category icon and name
- Planned budget for the period (from Budget tab; shown as 0 if no budget is set)
- Actual amount spent (or earned) in the selected period

**Donut chart**: Below the category cards is a donut chart. The chart is always rendered and tappable, even when no categories or transactions exist (shown as an empty ring). It is visible regardless of which view (expense or income) is active. Each slice represents a category's share of total spending, colored by that category's color. Inside the chart: total spending in red, total income in green.

Tapping the donut chart toggles which category list is displayed below it (expense or income). The chart itself does not change appearance — only the category list changes. This is intentional design.

**Edit mode button**: Allows drag-to-reorder of category cards. Also exposes add (+) and remove controls per category. A trash icon in edit mode opens the trashed categories view.

#### 2a. Tapping a Category in Edit Mode

The user can:

1. Rename it
2. Change icon
3. Change color
4. Remove it

**Category removal**: The category is moved to a trash folder. It remains visible on historical transactions (displayed as a greyed read-only label). Editing a transaction that had this category forces the user to select an active category. The deleted category does not appear in any picker, chart, or budget UI. Removed categories can be restored from the trash (accessible via trash icon in edit mode). The trash cannot be emptied.

#### 2b. Adding a New Category (+ in edit mode)

Input fields:

1. Category name (max 64 chars)
2. Category color (shared palette)
3. Category icon

The category type (`EXPENSE` or `INCOME`) is determined by which view is active when the user taps +: expense view creates expense categories, income view creates income categories.

#### 2c. Tapping a Category (normal mode)

Navigates directly to the transaction detail view (§3a) with the category and its type (EXPENSE or INCOME) pre-selected. The initial tab selection (Income / Expense / Transfer) and the category picker step are both skipped.

#### 2d. Income Categories

To view or edit income categories, the user taps the donut chart to switch to the income view, then enters edit mode.

---

### 3. Transactions Tab

**Period filter**: Same filtering options as the Categories tab. Filter settings are per-tab and reset when the app is closed.

**Additional filter button** (top of screen): Filters transactions by:

1. Note (contains match)
2. Category
3. Account (active accounts listed first; a collapsible "Archived" section below shows trashed accounts — filtering by a trashed account shows all its historical transactions)

A "Clear filters" button appears when any filter is active and resets all filters on this tab.

Transactions are displayed in reverse-chronological order, grouped by day. Within a day, transactions are initially ordered by creation timestamp. The user can manually reorder them by drag-and-drop; drag-to-reorder is initiated exclusively by pressing and dragging the grip handle icon on the right side of the row. Tapping anywhere else on the row triggers selection mode. The grip handle has a distinct touch target and does not trigger selection. The custom order is stored as a `display_order` field and persists across sessions. When a transaction is re-dated via the edit view, its `display_order` is reset to the bottom of the new day. Drag-and-drop cannot move a transaction across day boundaries; use the calendar picker in the edit view to change a transaction's date.

Each day header shows:

- Large day number, small grayed day-of-week, small month and year (left side)
- Total income and total expense for that day in the main currency (right side)

**Empty state**: If no transactions exist for the selected period, show a "No transactions for this period" message.

**Transfers** appear in the list as a single greyed-out row, showing "Source account → Destination account" with the source amount. Internally, transfers are stored as two records; the list groups them by transfer ID and displays one merged row. When filtering by a specific account, only that account's half of the transfer is shown (as a single row with the other account named). Transfers are not counted toward any income or expense total.

**Selection mode**: Tapping a transaction selects it (checkbox appears). A bottom toolbar appears with:

- Single transaction selected: **Edit** button and **Remove** button both active.
- Multiple transactions selected: only **Remove** button is active.

Tapping a selected transaction deselects it. Tapping anywhere outside the list (or selecting zero items) dismisses selection mode.

**Deletion confirmation**: Tapping "Remove" shows a confirmation dialog: "Delete [N] transaction(s)? This cannot be undone." The dialog uses a destructive-style confirm button. The deletion proceeds only on explicit confirmation.

#### 3a. Adding a Transaction (floating + button)

Tapping the + button opens a view with three tabs: **Income** | **Expense** | **Transfer**.

**Income / Expense tabs**: Show the category list (same visual as Categories tab, without the chart). The user selects a category first.

**Transfer tab**: Shows the account list. The user selects the source account, then the destination account.

After the first selection, the transaction detail view appears:

1. **Header row**: "From [account]" → "To [category]" (or "To [account]" for transfers). Tapping either side opens a selector to change the value. Default "From" account is the most recently used non-trashed account (determined by the most recent transaction date on that account); if no transactions exist, the first account alphabetically. For transfers, after selecting the source account the user must select a destination account.
2. **Amount field**: Amount and currency of the selected account.
3. **Notes field**: Free-text input (max 255 chars). Pre-filled in suggestion style (lighter color) with the last note used for this category. A small "Use last note" chip allows one-tap acceptance; tapping into the field clears the suggestion and allows fresh input.
4. **Numpad**:
   - Left column: basic math operators (`+`, `-`, `×`, `÷`) — evaluated using standard order of operations (PEMDAS) on save; a trailing operator is ignored
   - Middle: digits and `.`; results are rounded to 2 decimal places
   - Right column: backspace, calendar (to select transaction date), and a large Save button
5. **Recurring transactions (future feature stub)**: A greyed-out "Repeat" option below the numpad with a "Coming soon" tooltip.

**Foreign currency accounts**: If the selected account's currency differs from the main currency, a second input field appears below the primary amount. The primary field is the account's currency; it auto-converts to the main currency field using the cached exchange rate.

- The main currency field becomes editable only after the user has entered a value in the primary field.
- Editing the primary field always recalculates and overwrites the main currency field (any manual override is discarded).
- Editing the main currency field overrides the conversion for this transaction; the primary field is not affected.
- The transaction stores: the account-currency amount, the main-currency amount, and the exchange rate used.

**Offline behavior (no cached rate)**: A banner is shown: "No exchange rate available — using 1:1 conversion." The main currency amount defaults to the same numeric value as the account currency amount. The user may override it manually. The 1:1 rate is stored with the transaction.

#### 3b. Editing a Transaction

Tapping a transaction selects it; tapping **Edit** in the bottom toolbar opens the same view as the add-transaction flow, pre-filled with all existing values. All fields are editable, including the date (via the calendar button in the numpad row). Saving overwrites the transaction record; the `display_order` within its day is preserved unless the date is changed (date change resets `display_order` to the bottom of the new day).

---

### 4. Budget Tab

Contains four sections:

1. Expenses (expense categories)
2. Income (income categories)
3. Savings accounts
4. Debt accounts

**Period filter**: Calendar month only, with `<` and `>` buttons to navigate months. When navigating, the app anchors to the first day of each month (e.g. Jan 31 → Feb 1). Filter state resets when the app is closed.

**Empty state**: If no budgets are planned and no transactions exist for the selected month, show a "No budget data for this month" message.

Each section contains category or account cards stacked vertically, sorted in descending order by amount spent/received.

If a budget is planned for a category or account, a progress bar spanning the full screen width shows how much of the budget has been used. Items with a planned budget are pinned to the top of the section, sorted by planned amount (descending). Each such card shows:

- Planned amount
- Spent amount (red background if it exceeds the budget)

**Savings and Debt account sections**: Budgets can be planned for individual savings and debt accounts, just like for categories. The "spent" amount for these accounts is calculated as the sum of transfers TO the account during the selected month. A transfer to a debt account represents a debt payment; a transfer to a savings account represents a deposit. These transfers count as "spending toward" the account's budget.

**Budget input numpad**: Same layout as the transaction numpad, except the calendar button is replaced by a "stats" button. The stats button shows:

- Average monthly spend (all time history)
- Last month's actual spend
- Last set budget for this category or account

If no history exists for a given stat, it shows "N/A".

---

### 5. Overview Tab

**Period filter**: Same options as Categories and Transactions tabs. Filter state resets when the app is closed.

**Empty state**: If no transactions exist for the selected period, show a "No data for this period" message.

Displays in order:

1. **Net balance** for the period (income minus expenses): green if positive, red if negative
2. **Total income** and **total expenses** as two numbers
3. **Auto-scaled bar chart** of spending over time:
   - For a single day: hourly bars (or one bar total)
   - For a single month: one bar per day
   - For a 1–3 month range (31–90 calendar days): one bar per week (weeks start Monday; partial weeks at the boundary get their own bar)
   - For ranges longer than 90 days: one bar per month
4. **Daily averages**: three figures shown when applicable:
   - _Average per day_ = total spending ÷ number of calendar days in the period (including zero-spend days)
   - _Today_ = sum of expenses dated today (local date); shown only when today falls within the selected period
   - _This week_ = sum of expenses dated Mon–Sun of the current calendar week; shown only when the period includes at least one day of the current week
5. **Category breakdown**: categories sorted descending by amount spent, each with a progress bar where 100% = total spending for the period. Categories with zero spending are shown at the bottom, greyed out, sorted alphabetically.

---

### 6. Settings View

Accessible via a settings button in the top-left corner of all main tabs (not shown in sub-dialogs).

Options:

1. **Language**: Select app language. Only English is currently translated; the infrastructure must support adding more locales without code changes.
2. **Theme**: Only Dark theme is implemented. When the user selects Light, display an error dialog explaining that the developer dislikes light theme and will never implement it. This is intentional humor, not a bug.
3. **Startup screen**: Select which tab opens on app launch.
4. **Passcode**: Greyed out — future feature stub (see §Future Features).
5. **Daily notification**: Send a daily reminder to log expenses at a user-selected time. Default: 20:00 local time. The time is stored as a wall-clock "HH:MM" value; the OS handles daylight saving adjustments automatically. Toggle to enable/disable.
6. **Main currency**: Select from the full list provided by exchangerate-api.com. When the user changes the main currency, all historical transactions are recalculated: each transaction's main-currency amount is recomputed using the transaction's original amount and currency with current exchange rates. A confirmation dialog warns: "All historical amounts will be recalculated to [NEW CURRENCY]. This may take a moment." If exchange rates are unavailable for any currency used in existing transactions, the change is blocked with an error explaining which currencies lack rates. A progress indicator is shown during recalculation.
7. **Backup**:
   1. Create on-device backup (IndexedDB snapshot)
   2. Schedule automatic on-device backups
   3. Export backup to a file (download to device)
   4. Restore from a file
   5. Restore from on-device backup

   **Restore behavior**: Restoring always **completely overwrites** all current app data. Before proceeding, a confirmation dialog warns the user: "This will delete all current data and replace it with the backup. This cannot be undone." The user must explicitly confirm.

8. **Export data**: Select a date range using the same picker as the Transactions tab period filter. The export always includes all transactions in the date range regardless of any active Transactions tab filters. The export runs asynchronously and sends a notification when complete. The exported file is downloaded to the browser's default download directory. Output format: spreadsheet with one transaction per row.

   Columns:

   | Date (dd.mm.yyyy) | Note | Income (main currency) | Expense (main currency) | Category | Account |
   | ----------------- | ---- | ---------------------- | ----------------------- | -------- | ------- |
   - Income transactions: amount in the "Income" column, "Expense" column empty.
   - Expense transactions: amount in the "Expense" column, "Income" column empty.
   - All amounts are positive numbers.
   - Amounts for foreign-currency transactions use the main-currency amount stored at transaction time (1:1 if rate was unknown at the time).
   - Transfers are exported as two rows (one per account), with "Transfer" as the Category value. The OUT half goes in the "Expense" column, the IN half goes in the "Income" column.
   - If a category or account was deleted after the transaction was recorded, the original name is shown as plain text.

# Expenses App — Manual Smoke Test Plan

**Title**: Expenses App Manual Smoke Test Plan  
**Version**: 1.1  
**Date**: 2026-04-05  
**Author**: QA Engineering  

---

## Coverage Summary

| Section | Test Cases |
|---|---|
| 1. Onboarding | 6 |
| 2. Accounts | 13 |
| 3. Categories | 10 |
| 4. Transactions | 17 |
| 5. Budget | 8 |
| 6. Overview | 6 |
| 7. Settings | 8 |
| 8. Period Filtering | 5 |
| 9. Data Integrity | 4 |
| **Total** | **77** |

---

## How to Run

**Tool**: Playwright MCP browser automation  
**Viewport**: 390×844 (Android mobile)  
**Base URL**: http://localhost:5173  
**Prerequisites**: Dev server running (`npm run dev`), app reachable at base URL  

To reset app state between test runs, clear IndexedDB in browser DevTools:  
Application → Storage → IndexedDB → delete `expensesapp` database, then reload.

For each test session, set viewport before navigating:
1. Resize browser to 390×844
2. Navigate to http://localhost:5173
3. Confirm dark theme is applied (no light background)

Date format used throughout this plan: **dd.MM.yyyy** (e.g. 05.04.2026)

---

## 1. Onboarding

### TC-001 — Full onboarding flow

**Area**: Onboarding  
**Priority**: P0  
**Preconditions**: Fresh app state (IndexedDB cleared). Navigate to http://localhost:5173.

**Steps**:
1. Confirm the Welcome screen is displayed with a "Get Started" button.
2. Tap "Get Started".
3. Confirm the Currency selection step is shown.
4. Select a currency from the list (e.g. USD).
5. Tap "Next" or "Continue" to advance.
6. Confirm the Create First Account step is shown.
7. Enter account name "My Wallet".
8. Select account type "Regular".
9. Enter starting balance "1000".
10. Tap "Next" or "Continue".
11. Confirm the Category Presets step is shown with suggested expense and income categories.
12. Accept the default presets (tap "Next" or "Continue" / "Accept").
13. Confirm the completion screen is shown.
14. Tap "Finish" or "Done".

**Expected Result**: App navigates to the main tab layout (e.g. `/accounts`). Bottom navigation is visible. The account "My Wallet" appears in the accounts list with balance 1 000.00 USD. Onboarding screens are no longer shown.

---

### TC-002 — Skip entire onboarding from welcome screen

**Area**: Onboarding  
**Priority**: P0  
**Preconditions**: Fresh app state (IndexedDB cleared). Navigate to http://localhost:5173.

**Steps**:
1. Confirm the Welcome screen is displayed.
2. Tap "Skip" on the Welcome screen.

**Expected Result**: App navigates directly to the main tab layout without creating any accounts or categories. Onboarding screens are not shown again.

---

### TC-003 — Skip mid-flow on the currency step

**Area**: Onboarding  
**Priority**: P1  
**Preconditions**: Fresh app state (IndexedDB cleared). Navigate to http://localhost:5173.

**Steps**:
1. Tap "Get Started" on the Welcome screen.
2. Confirm the Currency selection step is displayed.
3. Tap "Skip" on the currency step without selecting a currency.

**Expected Result**: App navigates directly to the main tab layout. The default currency (based on device locale, or USD as fallback) is used. Onboarding screens are not shown again. No crash occurs.

---

### TC-004 — Onboarding does not reappear after completion

**Area**: Onboarding  
**Priority**: P0  
**Preconditions**: TC-001 has been completed in the same browser session (onboarding finished).

**Steps**:
1. Reload the page (F5 / browser refresh).
2. Wait for the app to fully load.

**Expected Result**: The Welcome screen is not displayed. The app loads directly on the main tab layout (accounts, categories, transactions, budget, or overview tab, depending on startup screen setting). The `hasCompletedOnboarding` flag prevents re-showing the flow.

---

### TC-005 — Onboarding does not reappear after skip

**Area**: Onboarding  
**Priority**: P0  
**Preconditions**: TC-002 has been completed (onboarding was skipped from welcome screen).

**Steps**:
1. Reload the page.
2. Wait for the app to fully load.

**Expected Result**: The Welcome screen is not displayed. The app loads directly on the main tab layout. Skipping counts as completion for the purpose of the `hasCompletedOnboarding` flag.

---

### TC-006 — Create first account during onboarding with all field types

**Area**: Onboarding  
**Priority**: P1  
**Preconditions**: Fresh app state. Navigate to http://localhost:5173. Advance past Welcome and Currency steps.

**Steps**:
1. On the Create First Account step, enter name "Test Account" (up to 64 characters allowed).
2. Select a color using the color picker.
3. Select an icon using the icon picker.
4. Select account type "Savings".
5. Enter starting balance "500".
6. Enter description "My first savings account" (up to 255 characters allowed).
7. Toggle "Include in total" if the toggle is present.
8. Tap "Next" or "Continue".
9. Complete remaining onboarding steps (accept presets, finish).

**Expected Result**: App reaches the main tab layout. The account "Test Account" appears in the accounts list with the selected color, icon, and balance 500.00. Account type is shown as Savings.

---

## 2. Accounts

### TC-007 — Create a Regular account

**Area**: Accounts  
**Priority**: P0  
**Preconditions**: Onboarding completed. Navigate to `/accounts`.

**Steps**:
1. Tap the "+" (add account) button in the Accounts tab.
2. Enter name "Cash Wallet".
3. Select type "Regular".
4. Select any color.
5. Select any icon.
6. Select currency "USD".
7. Enter starting balance "200".
8. Leave description blank.
9. Leave "Include in total" enabled.
10. Tap "Save" or "Create".

**Expected Result**: "Cash Wallet" appears in the accounts list with balance 200.00 USD. The Total Balance at the top of the Accounts tab increases by 200.00 USD (assuming same main currency, or equivalent conversion).

---

### TC-008 — Create a Savings account with goal

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: Onboarding completed. Navigate to `/accounts`.

**Steps**:
1. Tap the "+" button to add an account.
2. Enter name "Holiday Fund".
3. Select type "Savings".
4. Select currency "USD".
5. Enter starting balance "300".
6. Enter savings goal "1000".
7. Tap "Save".

**Expected Result**: "Holiday Fund" appears in the accounts list. A progress bar is visible showing progress toward the 1000.00 USD goal (30% filled). The balance shows 300.00 USD.

---

### TC-009 — Create a Debt account and verify calculated fields in detail view

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: Onboarding completed. Navigate to `/accounts`.

**Steps**:
1. Tap the "+" button to add an account.
2. Enter name "Car Loan".
3. Select type "Debt".
4. Select currency "USD".
5. Enter starting balance "15000" (the debt amount owed).
6. In the Debt additional fields, enter yearly interest rate "5" (percent).
7. In the Mortgage fields, enter loan amount "15000", term "48" months (or equivalent years), and interest rate "5".
8. Tap "Save".
9. Tap "Car Loan" in the accounts list to open the detail view.

**Expected Result**: The account detail view shows read-only calculated fields: remaining balance (15 000.00), monthly payment (calculated from loan amount/rate/term), estimated time to payoff, and accrued interest (calculated as principal × annual_rate × days_since_creation ÷ 365). These values are informational only and cannot be edited directly. No crash occurs.

---

### TC-010 — Edit account (rename, color, icon)

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: At least one account exists. Navigate to `/accounts`.

**Steps**:
1. Tap an existing account card to open the detail view.
2. Tap the rename / edit button.
3. Change the account name to "Updated Name".
4. Change the color to a different color using the color picker.
5. Change the icon to a different icon using the icon picker.
6. Tap "Save".

**Expected Result**: The account card in the list shows "Updated Name" with the new color and new icon. No balance change occurs.

---

### TC-011 — Manual balance adjustment does not create a transaction

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: An account named "Cash Wallet" exists with balance 200.00. Navigate to `/accounts`.

**Steps**:
1. Tap "Cash Wallet" to open the account detail view.
2. Locate the manual balance adjustment control.
3. Enter new balance "350".
4. Confirm the adjustment.
5. Navigate to `/transactions`.
6. Check the transaction list for any entry related to this balance change.

**Expected Result**: The "Cash Wallet" balance now shows 350.00. No transaction record was created in the Transactions tab for this adjustment. The balance change is direct (not via a transaction).

---

### TC-012 — Exclude account from total balance and Total Wealth sub-view

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: Two accounts exist: "Main Account" (balance 1000, included in total) and "Hidden Account" (balance 500, included in total). Navigate to `/accounts`.

**Steps**:
1. Note the current Total Balance shown at the top of the Accounts tab.
2. Tap "Hidden Account" to open the detail view.
3. Toggle off "Include in total balance" (disable it).
4. Save changes.
5. Return to the Accounts tab.
6. Tap the Total Balance / Total Wealth area to open the Total Wealth sub-view.

**Expected Result**: The Total Balance at the top has decreased by 500.00 (the balance of "Hidden Account"). "Hidden Account" is still visible in the accounts list but no longer contributes to the total. The Total Wealth sub-view also excludes "Hidden Account" from assets and debts calculations.

---

### TC-013 — Soft delete account and verify it moves to trash

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: An account named "Old Account" exists. Navigate to `/accounts`.

**Steps**:
1. Tap "Old Account" to open the detail view.
2. Tap "Remove" or the delete button.
3. Confirm the deletion in any confirmation dialog.
4. Return to the main Accounts tab.
5. Tap the trash icon to open trashed accounts.

**Expected Result**: "Old Account" no longer appears in the active accounts list. It appears in the trashed accounts view. The account data is not permanently deleted (soft delete only). The trash cannot be emptied.

---

### TC-014 — Restore deleted account from trash

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: TC-013 completed. "Old Account" is in the trash. Trashed accounts view is open.

**Steps**:
1. Locate "Old Account" in the trashed accounts list.
2. Tap "Restore" next to "Old Account".
3. Close the trashed accounts view.
4. Return to the main Accounts tab.

**Expected Result**: "Old Account" reappears in the active accounts list with its original balance. It is removed from the trashed accounts view.

---

### TC-015 — View transactions shortcut from account detail

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: An account exists with at least one transaction. Navigate to `/accounts`.

**Steps**:
1. Tap an account to open its detail view.
2. Tap the "View transactions" shortcut button.
3. Observe the Transactions tab content.

**Expected Result**: App navigates to the Transactions tab (`/transactions`) with that account pre-applied as a filter. Only transactions belonging to the tapped account are shown. The account filter badge or indicator is visible as active.

---

### TC-016 — Total Wealth sub-view

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: At least one Regular account and one Debt account exist in different currencies (e.g. USD and EUR). Navigate to `/accounts`.

**Steps**:
1. Tap the "Total Wealth" or balance display area at the top of the Accounts tab to open the sub-view.
2. Observe the assets vs debts table.

**Expected Result**: The Total Wealth sub-view opens and shows a table with assets and debts broken down by currency. Regular and Savings account balances appear under assets. Debt account balances appear under debts. Accounts marked as "exclude from total balance" and trashed accounts are excluded from both columns.

---

### TC-017 — Create account with foreign currency

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: Main currency is set to USD. Navigate to `/accounts`.

**Steps**:
1. Tap "+" to add a new account.
2. Enter name "Euro Account".
3. Select type "Regular".
4. Select currency "EUR".
5. Enter starting balance "100".
6. Tap "Save".

**Expected Result**: "Euro Account" appears in the accounts list showing balance 100.00 EUR. The Total Balance at the top shows the EUR balance converted to USD using the current exchange rate.

---

### TC-018 — Character limits: name (64) and description (255)

**Area**: Accounts  
**Priority**: P2  
**Preconditions**: Navigate to `/accounts`. Tap "+" to open the add account form.

**Steps**:
1. In the name field, type a string of exactly 65 characters (one over the limit).
2. Observe the input behavior.
3. In the description field, type a string of exactly 256 characters (one over the limit).
4. Observe the input behavior.
5. Reduce name to 64 characters and description to 255 characters.
6. Fill remaining required fields and tap "Save".

**Expected Result**: The name field does not accept more than 64 characters (input is capped or validation error shown). The description field does not accept more than 255 characters. When within limits, the form saves successfully.

---

### TC-075 — Account currency change shows warning dialog

**Area**: Accounts  
**Priority**: P1  
**Preconditions**: An account "Cash Wallet" exists with currency USD and at least one transaction. Navigate to `/accounts`.

**Steps**:
1. Tap "Cash Wallet" to open the account detail view.
2. Locate the currency field and change the currency from "USD" to "EUR".
3. Observe any dialog that appears before saving.

**Expected Result**: A warning dialog appears explaining that existing transactions will retain their original amounts (in USD) and the stored balance will not be auto-converted — the user must manually correct the balance. The dialog has "Confirm" and "Cancel" options. Confirming changes the account currency to EUR. Cancelling leaves the currency unchanged.

---

## 3. Categories

### TC-019 — Create an expense category

**Area**: Categories  
**Priority**: P0  
**Preconditions**: Onboarding completed. Navigate to `/categories`.

**Steps**:
1. Tap the edit mode toggle (pencil icon or "Edit" button).
2. Tap the "+" button to add a new category.
3. Confirm the new category will be of type "Expense" (expense view is active).
4. Enter name "Groceries".
5. Select a color.
6. Select an icon.
7. Tap "Save".
8. Exit edit mode.

**Expected Result**: "Groceries" appears in the expense categories list with the selected color and icon. The donut chart updates (or remains empty if no transactions yet). "Groceries" does not appear in the income categories list.

---

### TC-020 — Create an income category via donut chart toggle

**Area**: Categories  
**Priority**: P1  
**Preconditions**: Navigate to `/categories`. The donut chart is visible.

**Steps**:
1. Tap the donut chart to toggle from the expense list to the income list.
2. Confirm the category list below the chart has switched to income categories.
3. Tap the edit mode toggle.
4. Tap "+" to add a new category.
5. Enter name "Freelance".
6. Select a color and icon.
7. Tap "Save".
8. Exit edit mode.

**Expected Result**: "Freelance" appears in the income categories list. Tapping the donut chart to switch back to expenses does not show "Freelance" there — category type is immutable and set at creation. No crash occurs.

---

### TC-021 — Edit category (rename, icon, color)

**Area**: Categories  
**Priority**: P1  
**Preconditions**: At least one category (e.g. "Groceries") exists. Navigate to `/categories`. Edit mode is active.

**Steps**:
1. Tap the "Groceries" category card in edit mode.
2. Change the name to "Food & Groceries".
3. Change the color.
4. Change the icon.
5. Tap "Save".
6. Exit edit mode.

**Expected Result**: The category card now shows "Food & Groceries" with the updated color and icon. The category type (Expense) has not changed.

---

### TC-022 — Donut chart renders empty ring when no categories

**Area**: Categories  
**Priority**: P1  
**Preconditions**: Fresh app state (all categories deleted or no categories exist). Navigate to `/categories`.

**Steps**:
1. Confirm no expense categories are listed.
2. Observe the donut chart area.

**Expected Result**: The donut chart renders as an empty ring (no filled segments). No JavaScript error occurs. The chart does not crash or disappear. The chart is still tappable.

---

### TC-023 — Donut chart tap toggles expense/income category list; chart itself does not change

**Area**: Categories  
**Priority**: P0  
**Preconditions**: At least one expense category and one income category exist. At least one expense and one income transaction exist for the current period. Navigate to `/categories`.

**Steps**:
1. Confirm the expense categories list is shown below the chart (default view).
2. Observe the donut chart — note which segments and center values are displayed.
3. Tap the donut chart.
4. Observe the category list below the chart.
5. Observe the donut chart itself (segments, center values).
6. Tap the donut chart again.
7. Observe the category list below the chart.

**Expected Result**: On first tap, the category list below the chart switches from expense categories to income categories. On second tap, it switches back to expense categories. The donut chart itself does not change appearance on either tap — its segments and the values shown in its center (total spending in red, total income in green) remain identical regardless of which list is active. The toggle affects only the list, not the chart.

---

### TC-024 — Category spending amounts update with transactions

**Area**: Categories  
**Priority**: P0  
**Preconditions**: Category "Groceries" exists with no transactions. Navigate to `/categories`. Note the current amount shown for "Groceries" (should be 0 or empty).

**Steps**:
1. Navigate to `/transactions/new`.
2. Select the "Expense" tab.
3. Select the "Groceries" category.
4. Enter amount "50".
5. Tap "SAVE".
6. Navigate back to `/categories`.

**Expected Result**: The "Groceries" category card now shows 50.00 in the amount field (in the current period). The donut chart segment for "Groceries" is visible.

---

### TC-025 — Drag-to-reorder categories persists

**Area**: Categories  
**Priority**: P2  
**Preconditions**: At least two expense categories exist (e.g. "Groceries" and "Transport"). Navigate to `/categories`. Edit mode is active.

**Steps**:
1. Note the current order of categories (e.g. "Groceries" is first, "Transport" is second).
2. Long-press or grab the drag handle of "Transport" and drag it above "Groceries".
3. Release.
4. Exit edit mode.
5. Reload the page.
6. Navigate to `/categories`.

**Expected Result**: After drag, "Transport" appears above "Groceries". After page reload, the new order persists (stored in IndexedDB).

---

### TC-026 — Soft delete category

**Area**: Categories  
**Priority**: P1  
**Preconditions**: Category "Transport" exists. Navigate to `/categories`. Edit mode is active.

**Steps**:
1. Tap the remove (×) button on the "Transport" category card in edit mode.
2. Confirm the deletion if a dialog appears.
3. Exit edit mode.
4. Tap the trash icon to view trashed categories.

**Expected Result**: "Transport" no longer appears in the active categories list. It appears in the trashed categories view (soft delete). No data is permanently destroyed. The trash cannot be emptied.

---

### TC-027 — Restore deleted category

**Area**: Categories  
**Priority**: P1  
**Preconditions**: TC-026 completed. "Transport" is in the trashed categories view.

**Steps**:
1. In the trashed categories view, locate "Transport".
2. Tap "Restore" next to "Transport".
3. Close the trashed view.
4. Observe the active categories list.

**Expected Result**: "Transport" reappears in the active expense categories list. It is removed from the trashed view.

---

### TC-028 — Tap category in normal mode opens pre-filled transaction input

**Area**: Categories  
**Priority**: P1  
**Preconditions**: Category "Groceries" (Expense type) exists. Navigate to `/categories`. Edit mode is OFF.

**Steps**:
1. Tap the "Groceries" category card.

**Expected Result**: App navigates to the transaction input screen. The "Expense" tab is already selected and the "Groceries" category is already selected — the initial tab selection step and category picker step are both bypassed. The user lands directly on the amount entry screen for an expense in "Groceries".

---

## 4. Transactions

### TC-029 — Add an expense transaction

**Area**: Transactions  
**Priority**: P0  
**Preconditions**: At least one account and one expense category exist. Navigate to `/transactions/new`.

**Steps**:
1. Select the "Expense" tab.
2. Tap the "Groceries" category (or any expense category).
3. Confirm the form is shown with account selector, amount display, notes field, and numpad.
4. Enter amount "75" using the numpad.
5. Enter note "Weekly shopping".
6. Confirm the date shows today's date (05.04.2026).
7. Tap "SAVE".

**Expected Result**: App navigates back to the Transactions list. A new expense row appears grouped under 05.04.2026 showing "Groceries", "Weekly shopping", and −75.00 in red. The source account balance has decreased by 75.00.

---

### TC-030 — Add an income transaction

**Area**: Transactions  
**Priority**: P0  
**Preconditions**: At least one account and one income category exist. Navigate to `/transactions/new`.

**Steps**:
1. Select the "Income" tab.
2. Select an income category (e.g. "Salary" or "Freelance").
3. Enter amount "2000" using the numpad.
4. Enter note "April salary".
5. Tap "SAVE".

**Expected Result**: A new income row appears in the Transactions list grouped under today's date showing the category name, "April salary", and +2000.00 in green. The account balance has increased by 2000.00.

---

### TC-031 — Add a transfer and verify two records are created

**Area**: Transactions  
**Priority**: P0  
**Preconditions**: At least two accounts exist (e.g. "Cash Wallet" balance 200, "Euro Account" balance 100). Navigate to `/transactions/new`.

**Steps**:
1. Select the "Transfer" tab.
2. Select "Cash Wallet" as the source account.
3. Select "Euro Account" as the destination account.
4. Enter amount "50".
5. Tap "SAVE".
6. Navigate to `/transactions`.

**Expected Result**: The Transactions list shows a single greyed row for the transfer in the format "Cash Wallet → Euro Account" with the source amount. "Cash Wallet" balance decreased by 50. "Euro Account" balance increased by 50 (or equivalent in EUR). Internally, two transaction records are created sharing the same `transferGroupId`. The transfer row is greyed out and visually distinct from income/expense rows.

---

### TC-032 — Edit a transaction (all fields including date)

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: At least one expense transaction exists. Navigate to `/transactions`.

**Steps**:
1. Tap the transaction row to select it (checkbox appears).
2. With one item selected, tap the "Edit" button in the bottom toolbar.
3. Confirm the form opens pre-filled with the existing values.
4. Change the amount to "99".
5. Change the note to "Updated note".
6. Tap the date field (calendar button in the numpad row) and change the date to 01.04.2026.
7. Tap "SAVE".

**Expected Result**: The transaction in the list now shows amount 99.00 and note "Updated note". It is grouped under 01.04.2026 in the Transactions list (date change repositioned it). The account balance reflects the updated amount. The transaction's `display_order` is reset to the bottom of the 01.04.2026 day group.

---

### TC-033 — Delete single transaction with confirmation dialog

**Area**: Transactions  
**Priority**: P0  
**Preconditions**: At least one expense transaction exists. Navigate to `/transactions`.

**Steps**:
1. Tap a transaction row to select it (checkbox appears).
2. Tap "Remove" in the bottom toolbar.
3. Observe the confirmation dialog.
4. Read the dialog text — it should say "Delete 1 transaction(s)? This cannot be undone."
5. Tap "Confirm" or "Delete" (destructive-style button) in the dialog.

**Expected Result**: The transaction is removed from the list. The account balance is updated to reflect the deletion. The confirmation dialog used a destructive-style confirm button. Tapping the confirm button is required — the deletion does not proceed without it.

---

### TC-034 — Delete multiple transactions (selection mode)

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: At least three transactions exist. Navigate to `/transactions`.

**Steps**:
1. Tap the first transaction row to enter selection mode.
2. Tap a second transaction row to add it to the selection.
3. Tap a third transaction row to add it to the selection.
4. Confirm three checkboxes are checked.
5. Tap "Remove" in the bottom toolbar.
6. Confirm the deletion in the dialog (dialog should mention "3 transaction(s)").

**Expected Result**: All three selected transactions are removed from the list. Account balances are updated accordingly. No other transactions are affected.

---

### TC-035 — Selection mode: single selection shows Edit and Remove; multi shows only Remove

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: At least two transactions exist. Navigate to `/transactions`.

**Steps**:
1. Tap one transaction row to enter selection mode.
2. Observe the bottom toolbar buttons.
3. Tap a second transaction row to add it to the selection.
4. Observe the bottom toolbar buttons again.

**Expected Result**: With one transaction selected, the bottom toolbar shows both "Edit" and "Remove" buttons. With two or more transactions selected, the toolbar shows only the "Remove" button (Edit is hidden or disabled for multi-selection).

---

### TC-036 — Note field pre-fills last note per category and "Use last note" chip

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: A transaction for category "Groceries" with note "Weekly shopping" exists. A transaction for category "Transport" with note "Bus ticket" exists. Navigate to `/transactions/new`.

**Steps**:
1. Select the "Expense" tab.
2. Select the "Groceries" category.
3. Observe the notes field.
4. Observe whether a "Use last note" chip is present showing "Weekly shopping".
5. Tap the "Use last note" chip.
6. Go back and select the "Transport" category instead.
7. Observe the notes field again.

**Expected Result**: After selecting "Groceries", the notes field shows a suggestion "Weekly shopping" (pre-filled in lighter/suggestion style) and a "Use last note" chip is visible. Tapping the chip fills the notes field with "Weekly shopping". After switching to "Transport", the notes field shows a different suggestion: "Bus ticket" (the last note for that specific category, not "Weekly shopping"). The last note is tracked per-category, not globally.

---

### TC-037 — Math expression on numpad evaluated with correct operator precedence (PEMDAS)

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: Navigate to `/transactions/new`. Select Expense tab and a category.

**Steps**:
1. Using the numpad, enter the expression "2+3×4" (tap 2, +, 3, ×, 4).
2. Observe the amount display showing the in-progress expression.
3. Tap "SAVE".
4. Observe the saved amount on the transaction row.

**Expected Result**: The numpad evaluates "2+3×4" to 14 (not 20) — multiplication is applied before addition per PEMDAS. The transaction is saved with amount 14.00. Also verify: entering a trailing operator (e.g. "50+") and tapping "SAVE" saves the amount as 50.00 (trailing operator is ignored).

---

### TC-038 — Drag grip handle reorders within a day; tapping row enters selection mode

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: At least two transactions exist on the same day. Navigate to `/transactions`.

**Steps**:
1. Locate a day group with two or more transactions (Transaction A above Transaction B).
2. Tap anywhere on the Transaction A row (not on the grip handle).
3. Observe the result.
4. Deselect (tap outside the list or tap the selected row again).
5. Now locate the grip handle icon on Transaction B's row.
6. Press and drag the grip handle to move Transaction B above Transaction A.
7. Release.
8. Attempt to drag Transaction B into a different day group using the grip handle.

**Expected Result**: Step 2: Tapping the row (outside the grip handle) enters selection mode — a checkbox appears and the selection toolbar appears at the bottom. Step 5–7: Dragging via the grip handle reorders Transaction B above Transaction A within the same day group. The custom order persists on page reload. Step 8: Dragging across day boundaries is blocked — the transaction cannot be moved to a different day via drag (use the date picker in the edit view to change the date).

---

### TC-039 — Filter transactions by category

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: Transactions exist for at least two different categories (e.g. "Groceries" and "Transport"). Navigate to `/transactions`.

**Steps**:
1. Tap the filter button.
2. Select "Category" filter.
3. Choose the "Groceries" category.
4. Apply the filter.

**Expected Result**: Only transactions belonging to the "Groceries" category are shown. Transactions for "Transport" and other categories are hidden. A filter indicator (active filter badge or "Clear filters" button) is visible.

---

### TC-040 — Filter transactions by account

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: Transactions exist across at least two different accounts. Navigate to `/transactions`.

**Steps**:
1. Tap the filter button.
2. Select "Account" filter.
3. Choose "Cash Wallet" account.
4. Apply the filter.

**Expected Result**: Only transactions associated with "Cash Wallet" are shown. Transactions from other accounts are hidden. The filter is active and visible. Trashed accounts appear in a collapsible "Archived" section within the account filter list.

---

### TC-041 — Filter transactions by note text

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: At least one transaction with note "Weekly shopping" and one with note "Dinner" exist. Navigate to `/transactions`.

**Steps**:
1. Tap the filter button.
2. Select "Note" or text search filter.
3. Type "Weekly" in the search field.
4. Apply/confirm.

**Expected Result**: Only transactions whose notes contain "Weekly" (case-insensitive contains match) are shown. The "Dinner" transaction is hidden. The filter is visible as active.

---

### TC-042 — Clear all active filters

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: At least one filter is active (e.g. category filter from TC-039). Navigate to `/transactions`.

**Steps**:
1. Confirm that a filter is active and the transactions list is filtered.
2. Tap the "Clear filters" button.

**Expected Result**: All filters are removed. The full unfiltered transactions list is shown. The "Clear filters" button disappears (only shown when at least one filter is active).

---

### TC-043 — Transfer shown as single greyed row and excluded from day income/expense totals

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: TC-031 completed. A transfer transaction exists. Navigate to `/transactions`.

**Steps**:
1. Locate the day with the transfer transaction.
2. Observe the transfer row appearance and its text content.
3. Observe the day header totals (total income and total expense shown on the right side of the day header).
4. Note any income or expense transactions on the same day and sum them manually.

**Expected Result**: The transfer is displayed as a single greyed row in the format "Cash Wallet → Euro Account" showing the source amount. The day header income total and expense total reflect only the income/expense transactions on that day — the transfer amount is not included in either total.

---

### TC-076 — Export generates correct xlsx columns and content

**Area**: Transactions  
**Priority**: P1  
**Preconditions**: The following transactions exist: one expense (50.00 USD, category "Groceries", note "Lunch", account "Cash Wallet", dated 01.04.2026), one income (200.00 USD, category "Salary", note "April pay", account "Cash Wallet", dated 02.04.2026), and one transfer (30.00 from "Cash Wallet" to "Savings", dated 03.04.2026). Navigate to `/settings`.

**Steps**:
1. Tap "Export data".
2. Set date range from 01.04.2026 to 03.04.2026.
3. Initiate the export.
4. Open the downloaded `.xlsx` file.
5. Inspect the columns and rows.

**Expected Result**: The file contains a spreadsheet with columns: Date | Note | Income | Expense | Category | Account. The expense row shows: "01.04.2026" | "Lunch" | (empty) | "50.00" | "Groceries" | "Cash Wallet". The income row shows: "02.04.2026" | "April pay" | "200.00" | (empty) | "Salary" | "Cash Wallet". The transfer is exported as two rows: one with "Transfer" as Category and the 30.00 amount in the Expense column (OUT half), and one with "Transfer" as Category and 30.00 in the Income column (IN half). All amounts are positive numbers.

---

## 5. Budget

### TC-044 — Set budget for an expense category

**Area**: Budget  
**Priority**: P0  
**Preconditions**: At least one expense category ("Groceries") exists. Navigate to `/budget`.

**Steps**:
1. Locate the Expenses section.
2. Tap on the "Groceries" category or its budget field.
3. Enter budget amount "300" using the budget numpad.
4. Confirm/save the budget.

**Expected Result**: "Groceries" displays a planned budget of 300.00. A progress bar appears showing 0% used (or current spend / 300). "Groceries" is pinned near the top of the Expenses section (items with a planned budget appear before items without).

---

### TC-045 — Budget progress bar appears and updates

**Area**: Budget  
**Priority**: P0  
**Preconditions**: "Groceries" has a budget of 300.00. A transaction of 75.00 for Groceries exists in the current month. Navigate to `/budget`.

**Steps**:
1. Locate the "Groceries" budget card in the Expenses section.
2. Observe the progress bar.

**Expected Result**: The progress bar is filled to 25% (75 out of 300). The card shows actual amount 75.00 and planned amount 300.00.

---

### TC-046 — Over-budget category shown in red

**Area**: Budget  
**Priority**: P1  
**Preconditions**: "Groceries" has a budget of 300.00. Total Groceries spending in the current month is 350.00 (over budget). Navigate to `/budget`.

**Steps**:
1. Locate the "Groceries" budget card.
2. Observe the visual styling.

**Expected Result**: The "Groceries" card has a red background or red highlight. The progress bar is filled past 100%. The over-budget state is visually distinct from within-budget cards.

---

### TC-047 — Month navigation with < > buttons

**Area**: Budget  
**Priority**: P1  
**Preconditions**: Navigate to `/budget`. Current month is displayed (e.g. April 2026).

**Steps**:
1. Note the current period shown (e.g. "April 2026").
2. Tap the "<" (previous) button.
3. Confirm the period changed to March 2026.
4. Tap the ">" (next) button.
5. Confirm the period returned to April 2026.
6. Tap ">" again.
7. Confirm the period changed to May 2026.

**Expected Result**: Each tap of "<" goes back one calendar month; each tap of ">" goes forward one calendar month. The budget data updates to reflect the selected month. Navigation anchors to the first day of each month (e.g. tapping "<" from March 31 would show February 1). No months are skipped.

---

### TC-048 — Budget stats button shows average, last month spend, and last set budget

**Area**: Budget  
**Priority**: P1  
**Preconditions**: "Groceries" has budget and transaction data for at least two past months. Navigate to `/budget`. Tap "Groceries" to open the budget numpad.

**Steps**:
1. Open the budget entry numpad for the "Groceries" category.
2. Tap the "stats" button (replaces the calendar button in the budget numpad — not present on the transaction numpad).
3. Observe the stats panel.

**Expected Result**: The stats panel displays three values: (1) average monthly spend across all historical months, (2) last month's actual spend for "Groceries", (3) the last budget amount set for "Groceries" (not necessarily last month — the most recently saved budget value). If no history exists for a given stat, it shows "N/A". No crash occurs.

---

### TC-049 — Savings account section shows transfers-in as spending toward budget

**Area**: Budget  
**Priority**: P1  
**Preconditions**: A Savings account ("Holiday Fund") exists. A budget of 200.00 has been set for "Holiday Fund" in the Budget tab. A transfer of 100 has been made into "Holiday Fund" in the current month. Navigate to `/budget`.

**Steps**:
1. Locate the Savings section in the Budget tab.
2. Find "Holiday Fund" in the section.
3. Observe the progress bar and amounts shown on the card.

**Expected Result**: "Holiday Fund" shows 100.00 as the spent/progress amount and 200.00 as the planned budget. The progress bar is at 50%. The "spending" value is the sum of transfers INTO "Holiday Fund" during the month — it does not use the savings goal from the account detail view.

---

### TC-050 — Debt account section shows transfers-in as spending

**Area**: Budget  
**Priority**: P1  
**Preconditions**: A Debt account ("Car Loan") exists. A transfer of 350 has been made into "Car Loan" (debt payment) in the current month. Navigate to `/budget`.

**Steps**:
1. Locate the Debt section in the Budget tab.
2. Find "Car Loan" in the section.
3. Observe the progress bar and displayed amount.

**Expected Result**: "Car Loan" shows 350.00 as the amount paid/progress. Transfers into debt accounts are treated as spending (debt repayment) in the budget view. If a budget was planned for "Car Loan", the progress bar reflects 350 out of that planned amount.

---

### TC-051 — Empty state when no budget and no transactions

**Area**: Budget  
**Priority**: P1  
**Preconditions**: Fresh app state with no transactions and no budget amounts set. Navigate to `/budget`.

**Steps**:
1. Observe each section (Expenses, Income, Savings, Debt) in the Budget tab.

**Expected Result**: The message "No budget data for this month" is displayed. No crash or unhandled error occurs.

---

## 6. Overview

### TC-052 — Net balance calculation (income minus expenses)

**Area**: Overview  
**Priority**: P0  
**Preconditions**: In the current month: income transactions total 2000.00, expense transactions total 500.00. Navigate to `/overview`. Set the period filter to the current month.

**Steps**:
1. Observe the net balance displayed in the Overview summary.
2. Observe the total income value.
3. Observe the total expenses value.

**Expected Result**: Net balance shows +1500.00 (2000 − 500) in green. Total income shows 2000.00 in green. Total expenses shows 500.00 in red. Transfer transactions are excluded from these totals.

---

### TC-053 — Bar chart renders for single month range (daily bars)

**Area**: Overview  
**Priority**: P1  
**Preconditions**: Multiple transactions on different days in the current month. Navigate to `/overview`. Set period to current month.

**Steps**:
1. Observe the bar chart in the Overview tab.

**Expected Result**: The bar chart renders with one bar per day of the month. The chart is auto-scaled appropriately. No crash or render error occurs.

---

### TC-054 — Bar chart renders for range greater than 90 days (monthly bars)

**Area**: Overview  
**Priority**: P1  
**Preconditions**: Transactions exist across multiple months. Navigate to `/overview`.

**Steps**:
1. Set the period filter to "All time" or a custom date range spanning more than 90 days.
2. Observe the bar chart.

**Expected Result**: The bar chart switches to one bar per month. The auto-scaling logic correctly detects a range greater than 90 days and uses monthly granularity. No crash occurs.

---

### TC-055 — Daily averages: avg/day, today, this week

**Area**: Overview  
**Priority**: P1  
**Preconditions**: Transactions exist in the current month including today (05.04.2026). Navigate to `/overview`. Set period to current month.

**Steps**:
1. Locate the Daily Averages section.
2. Observe the "avg/day" value.
3. Observe the "today" value.
4. Observe the "this week" value.

**Expected Result**: "avg/day" = total spending for the period ÷ number of calendar days in the period (including zero-spend days). "today" shows spending dated 05.04.2026 (visible because today is within the selected period). "this week" shows spending for the current Mon–Sun week (visible because the current week overlaps the selected period). If today or this week were outside the selected range, those figures would not appear.

---

### TC-056 — Category breakdown sorted descending, zero-spend categories greyed out

**Area**: Overview  
**Priority**: P1  
**Preconditions**: Multiple categories with different spending amounts. Navigate to `/overview`.

**Steps**:
1. Locate the Category Breakdown section.
2. Observe the order of categories.
3. Identify any categories with zero spending in the selected period.

**Expected Result**: Categories are sorted in descending order by spending amount (highest at top). Categories with zero spending are at the bottom in a greyed-out style, sorted alphabetically among themselves. Progress bars for each category reflect its share of total spending (100% = total spending for the period).

---

### TC-057 — Empty state when no transactions

**Area**: Overview  
**Priority**: P1  
**Preconditions**: Fresh app state with no transactions, or period filter set to a range with no transactions. Navigate to `/overview`.

**Steps**:
1. Set the period filter to a date range with no transactions (e.g. a future month like June 2027).
2. Observe the Overview tab content.

**Expected Result**: The message "No data for this period" is displayed. Net balance, income, and expenses all show 0.00. No crash or unhandled error occurs.

---

## 7. Settings

### TC-058 — Selecting Light theme shows humor dialog

**Area**: Settings  
**Priority**: P0  
**Preconditions**: Navigate to `/settings`.

**Steps**:
1. Locate the "Theme" setting.
2. Tap or select "Light" theme.
3. Observe the dialog or modal that appears.

**Expected Result**: A humor dialog appears explaining that the developer dislikes the light theme. The app does not switch to light mode and remains in dark theme. The dialog can be dismissed. This behavior is intentional per spec, not a bug.

---

### TC-059 — Main currency change shows confirmation dialog and recalculates historical transaction amounts

**Area**: Settings  
**Priority**: P1  
**Preconditions**: Main currency is currently set to USD. At least one historical transaction in a foreign currency (EUR) exists. Navigate to `/settings`.

**Steps**:
1. Locate the "Main currency" setting.
2. Tap to change it.
3. Select "EUR".
4. Observe any dialog that appears before the change is applied.
5. Confirm the change.

**Expected Result**: A confirmation dialog appears with the message "All historical amounts will be recalculated to EUR. This may take a moment." and "Confirm" / "Cancel" options. On confirming, each historical transaction's main-currency amount is recalculated using the transaction's original currency and current exchange rates. A progress indicator is shown during recalculation. If exchange rates are unavailable for any currency used in existing transactions, the change is blocked with an error listing the missing currencies.

---

### TC-060 — Daily notification toggle

**Area**: Settings  
**Priority**: P1  
**Preconditions**: Navigate to `/settings`.

**Steps**:
1. Locate the "Daily notification" setting.
2. Note the current state (on or off).
3. Tap the toggle to enable daily notifications.
4. Set the notification time to 20:00 using the time picker.
5. Tap the toggle again to disable notifications.

**Expected Result**: The toggle switches state without a crash. When enabled, the time picker is accessible and saves the selected time (20:00). When disabled, the notification is turned off. The setting persists on page reload.

---

### TC-061 — Export data: date range picker opens and export initiates

**Area**: Settings  
**Priority**: P1  
**Preconditions**: At least one transaction exists. Navigate to `/settings`.

**Steps**:
1. Locate the "Export data" setting.
2. Tap "Export".
3. Confirm a date range picker appears.
4. Set start date to 01.01.2026 and end date to 05.04.2026.
5. Confirm/initiate the export.
6. Wait for the export to complete (the export runs asynchronously).

**Expected Result**: The date range picker opens and accepts input in dd.MM.yyyy format. The export initiates asynchronously. A download of an `.xlsx` file begins (or a notification / success message is shown on completion). The export includes all transactions within the selected date range regardless of any active Transactions tab filters. No crash occurs.

---

### TC-062 — Backup: create an on-device backup

**Area**: Settings  
**Priority**: P1  
**Preconditions**: At least one account and one transaction exist. Navigate to `/settings`.

**Steps**:
1. Locate the "Backup" section.
2. Tap "Create on-device backup" (or equivalent button).
3. Wait for the operation to complete.

**Expected Result**: A success confirmation is shown. The backup is stored on-device (IndexedDB snapshot). A backup entry appears in the on-device backup list with a timestamp. No crash occurs.

---

### TC-063 — Restore: confirmation dialog warns before overwrite

**Area**: Settings  
**Priority**: P1  
**Preconditions**: At least one on-device backup exists (from TC-062). Navigate to `/settings`.

**Steps**:
1. Locate the "Backup" or "Restore" section.
2. Tap "Restore" next to an available backup.
3. Observe the confirmation dialog.
4. Tap "Cancel".

**Expected Result**: A confirmation dialog appears stating "This will delete all current data and replace it with the backup. This cannot be undone." with "Confirm" and "Cancel" options. Tapping "Cancel" aborts the restore and leaves all current data unchanged.

---

### TC-064 — Startup screen setting persists

**Area**: Settings  
**Priority**: P1  
**Preconditions**: Navigate to `/settings`.

**Steps**:
1. Locate the "Startup screen" setting.
2. Select "Transactions" as the startup screen.
3. Reload the page.

**Expected Result**: After reload, the app opens directly on the Transactions tab (`/transactions`) instead of the default tab. The setting is persisted in the database and applied on startup.

---

### TC-065 — Language selection renders without crash

**Area**: Settings  
**Priority**: P1  
**Preconditions**: Navigate to `/settings`.

**Steps**:
1. Locate the "Language" setting.
2. Observe the current language (e.g. English).
3. Tap to open the language selector.
4. Select a different language if available, or re-select the current language.

**Expected Result**: The language selector opens without a crash. Selecting a language applies it to the UI (text updates). If only one language is available, the selector still opens and closes gracefully. No JavaScript error occurs.

---

## 8. Period Filtering

### TC-066 — Month filter with < > navigation

**Area**: Period Filtering  
**Priority**: P0  
**Preconditions**: Transactions exist across multiple months. Navigate to `/transactions`. Set period to "Month".

**Steps**:
1. Confirm the period shows the current month (e.g. April 2026).
2. Tap "<" to go to March 2026.
3. Confirm only March transactions are shown.
4. Tap ">" to return to April 2026.
5. Confirm April transactions are shown.

**Expected Result**: Period navigation works correctly. Each tap moves exactly one month. The transaction list updates immediately to reflect the selected month's transactions. No stale data is shown.

---

### TC-067 — Week filter

**Area**: Period Filtering  
**Priority**: P1  
**Preconditions**: Transactions exist across multiple weeks. Navigate to `/transactions`.

**Steps**:
1. Open the period filter selector.
2. Select "Week".
3. Confirm the current week's transactions are shown.
4. Tap "<" to go to the previous week.
5. Confirm the previous week's transactions are shown.

**Expected Result**: The week filter shows only transactions in the selected week. Navigation by "<" and ">" moves one week at a time.

---

### TC-068 — Custom date range filter

**Area**: Period Filtering  
**Priority**: P1  
**Preconditions**: Transactions exist on various dates. Navigate to `/transactions`.

**Steps**:
1. Open the period filter selector.
2. Select "Custom range".
3. Set start date to 01.04.2026.
4. Set end date to 05.04.2026.
5. Apply the filter.

**Expected Result**: Only transactions between 01.04.2026 and 05.04.2026 (inclusive) are shown. The period indicator displays the custom range in dd.MM.yyyy format.

---

### TC-069 — "All time" shows all transactions

**Area**: Period Filtering  
**Priority**: P1  
**Preconditions**: Transactions exist across multiple months/years. Navigate to `/transactions`.

**Steps**:
1. Open the period filter selector.
2. Select "All time".
3. Observe the transactions list.

**Expected Result**: All non-trashed transactions across all dates are displayed. No transactions are filtered out by date. The count of visible transactions matches the total non-trashed transaction count.

---

### TC-070 — Filter state persists during session but resets on app close

**Area**: Period Filtering  
**Priority**: P2  
**Preconditions**: Navigate to `/transactions`. Set a period filter to "Week".

**Steps**:
1. Confirm "Week" filter is active and only this week's transactions are shown.
2. Navigate to the `/accounts` tab by tapping "Accounts" in the bottom nav.
3. Navigate back to `/transactions` by tapping "Transactions" in the bottom nav.
4. Observe the period filter state.
5. Close the browser tab entirely (or close the PWA) and reopen it.
6. Navigate to `/transactions`.
7. Observe the period filter state after reopening.

**Expected Result**: Step 3–4: The "Week" filter is still active after navigating away and back within the same session. Zustand ui-store holds ephemeral UI state that persists across tab navigation within a session. Step 6–7: After closing and reopening the app, the period filter has reset to the default (not "Week"). Filter state is ephemeral and does not persist across app close.

---

## 9. Data Integrity

### TC-071 — Account balance updates after adding an expense

**Area**: Data Integrity  
**Priority**: P0  
**Preconditions**: Account "Cash Wallet" has balance 200.00. Navigate to `/accounts` and note the balance.

**Steps**:
1. Navigate to `/transactions/new`.
2. Select "Expense" tab.
3. Select any expense category.
4. Select "Cash Wallet" as the source account.
5. Enter amount "50".
6. Tap "SAVE".
7. Navigate to `/accounts`.
8. Observe "Cash Wallet" balance.

**Expected Result**: "Cash Wallet" balance is now 150.00 (200.00 − 50.00). The balance update is immediate and accurate. The stored balance (not derived) reflects the deduction.

---

### TC-072 — Account balance updates after deleting a transaction

**Area**: Data Integrity  
**Priority**: P0  
**Preconditions**: Account "Cash Wallet" has balance 150.00 after the expense in TC-071. The 50.00 expense transaction exists. Navigate to `/transactions`.

**Steps**:
1. Select the 50.00 expense transaction row.
2. Tap "Remove" in the bottom toolbar.
3. Confirm the deletion.
4. Navigate to `/accounts`.
5. Observe "Cash Wallet" balance.

**Expected Result**: "Cash Wallet" balance is restored to 200.00 (150.00 + 50.00 reversed). The balance service correctly reverses the transaction's effect on the stored balance.

---

### TC-073 — Transfer correctly updates both account balances atomically

**Area**: Data Integrity  
**Priority**: P0  
**Preconditions**: "Cash Wallet" balance 200.00, "Savings Account" balance 100.00. Navigate to `/transactions/new`.

**Steps**:
1. Select "Transfer" tab.
2. Select "Cash Wallet" as source and "Savings Account" as destination.
3. Enter amount "75".
4. Tap "SAVE".
5. Navigate to `/accounts`.
6. Check "Cash Wallet" balance.
7. Check "Savings Account" balance.

**Expected Result**: "Cash Wallet" balance is 125.00 (200.00 − 75.00). "Savings Account" balance is 175.00 (100.00 + 75.00). Both balances are updated within a single DB transaction (atomically). The transfer creates two records in the database sharing a `transferGroupId`.

---

### TC-074 — Soft-deleted account transactions still visible in Transactions tab

**Area**: Data Integrity  
**Priority**: P1  
**Preconditions**: Account "Old Account" has transactions associated with it. The account has been soft-deleted (moved to trash). Navigate to `/transactions`.

**Steps**:
1. Set the period filter to "All time".
2. Observe the transactions list.
3. Look for transactions that were associated with "Old Account".

**Expected Result**: Transactions from the soft-deleted "Old Account" are still visible in the Transactions tab. They are not hidden when the account is trashed. Transaction records are fully preserved and accessible (soft delete only — no hard delete).

---

*End of test plan. Total test cases: 77 (TC-001 through TC-076, plus TC-075).*

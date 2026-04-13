# E2E Test Coverage Audit: Expenses App PWA

**Date**: 2026-04-13  
**Status**: Comprehensive coverage analysis complete  
**Total Test Cases in Plan**: 77 (TC-001 through TC-077)  
**E2E Test Files Analyzed**: 5 (accounts.spec.ts, mortgage-overpayment.spec.ts, onboarding-overview.spec.ts, smoke.spec.ts, helpers.ts)

---

## Executive Summary

The e2e test suite is **severely under-covered**, with only **7 test cases** from the 77-test manual plan actually implemented as automated e2e tests. Major critical flows are entirely untested:

- **0% coverage**: Transaction CRUD (create, edit, delete)
- **0% coverage**: Category management (create, edit, delete)
- **0% coverage**: Budget functionality
- **0% coverage**: Settings and export
- **0% coverage**: Period filtering
- **0% coverage**: Multi-currency scenarios
- **15% coverage**: Accounts (3 of 13 tests implemented)
- **17% coverage**: Onboarding (1 of 6 tests fully implemented)

The existing tests are primarily smoke tests (UI loads, empty states) and do not comprehensively validate user workflows.

---

## Coverage Matrix

| Test Case | Description | Covered | File | Notes |
|---|---|---|---|---|
| **ONBOARDING** |
| TC-001 | Full onboarding flow | ❌ Partial | onboarding-overview.spec.ts | Only the account-save regression is tested; full flow steps not validated |
| TC-002 | Skip entire onboarding from welcome | ❌ No | - | Not tested |
| TC-003 | Skip mid-flow on currency step | ❌ No | - | Not tested |
| TC-004 | Onboarding does not reappear after completion | ✅ Yes | smoke.spec.ts | Implicitly tested via setup() helper |
| TC-005 | Onboarding does not reappear after skip | ❌ No | - | Not tested |
| TC-006 | Create first account with all field types | ❌ No | - | Not tested (color, icon, type selection during onboarding) |
| **ACCOUNTS** |
| TC-007 | Create a Regular account | ✅ Yes | accounts.spec.ts | Test: "TC-007: create Regular account shows card in list" |
| TC-008 | Create a Savings account with goal | ❌ No | - | Not tested |
| TC-009 | Create a Debt account and verify calculated fields | ✅ Partial | accounts.spec.ts | Test: "TC-009: create Debt account with interest rate" — only creation, not calculated fields |
| TC-010 | Edit account (rename, color, icon) | ❌ No | - | Not tested |
| TC-011 | Manual balance adjustment does not create transaction | ❌ No | - | Not tested |
| TC-012 | Exclude account from total balance | ❌ No | - | Not tested |
| TC-013 | Soft delete account and verify it moves to trash | ✅ Yes | accounts.spec.ts | Test: "TC-013: archive account removes it from the active list" |
| TC-014 | Restore deleted account from trash | ❌ No | - | Not tested |
| TC-015 | View transactions shortcut from account detail | ❌ No | - | Not tested |
| TC-016 | Total Wealth sub-view | ❌ No | - | Not tested |
| TC-017 | Create account with foreign currency | ❌ No | - | Not tested |
| TC-018 | Character limits: name (64) and description (255) | ❌ No | - | Not tested |
| TC-075 | Account currency change shows warning dialog | ❌ No | - | Not tested |
| **CATEGORIES** |
| TC-019 | Create an expense category | ❌ No | - | Not tested |
| TC-020 | Create an income category via donut chart toggle | ❌ No | - | Not tested |
| TC-021 | Edit category (rename, icon, color) | ❌ No | - | Not tested |
| TC-022 | Donut chart renders empty ring when no categories | ❌ No | - | Not tested |
| TC-023 | Donut chart tap toggles list; chart itself does not change | ❌ No | - | Not tested |
| TC-024 | Category spending amounts update with transactions | ❌ No | - | Not tested |
| TC-025 | Drag-to-reorder categories persists | ❌ No | - | Not tested |
| TC-026 | Soft delete category | ❌ No | - | Not tested |
| TC-027 | Restore deleted category | ❌ No | - | Not tested |
| TC-028 | Tap category in normal mode opens pre-filled transaction input | ❌ No | - | Not tested |
| **TRANSACTIONS** |
| TC-029 | Add an expense transaction | ❌ No | - | Not tested (manually tested in onboarding-overview.spec.ts as part of overview test) |
| TC-030 | Add an income transaction | ❌ No | - | Not tested |
| TC-031 | Add a transfer and verify two records are created | ❌ No | - | Not tested |
| TC-032 | Edit a transaction (all fields including date) | ❌ No | - | Not tested |
| TC-033 | Delete single transaction with confirmation dialog | ❌ No | - | Not tested |
| TC-034 | Delete multiple transactions (selection mode) | ❌ No | - | Not tested |
| TC-035 | Selection mode: single vs multi buttons | ❌ No | - | Not tested |
| TC-036 | Note field pre-fills last note per category | ❌ No | - | Not tested |
| TC-037 | Math expression on numpad evaluated with correct operator precedence | ❌ No | - | Not tested |
| TC-038 | Drag grip handle reorders within a day | ❌ No | - | Not tested |
| TC-039 | Filter transactions by category | ❌ No | - | Not tested |
| TC-040 | Filter transactions by account | ❌ No | - | Not tested |
| TC-041 | Filter transactions by note text | ❌ No | - | Not tested |
| TC-042 | Clear all active filters | ❌ No | - | Not tested |
| TC-043 | Transfer shown as single greyed row and excluded from day totals | ❌ No | - | Not tested |
| TC-076 | Export generates correct xlsx columns and content | ❌ No | - | Not tested |
| **BUDGET** |
| TC-044 | Set budget for an expense category | ❌ No | - | Not tested |
| TC-045 | Budget progress bar appears and updates | ❌ No | - | Not tested |
| TC-046 | Over-budget category shown in red | ❌ No | - | Not tested |
| TC-047 | Month navigation with < > buttons | ❌ No | - | Not tested |
| TC-048 | Budget stats button shows average, last month spend, and last set budget | ❌ No | - | Not tested |
| TC-049 | Savings account section shows transfers-in as spending | ❌ No | - | Not tested |
| TC-050 | Debt account section shows transfers-in as spending | ❌ No | - | Not tested |
| TC-051 | Empty state when no budget and no transactions | ❌ No | - | Not tested |
| **OVERVIEW** |
| TC-052 | Net balance calculation (income minus expenses) | ✅ Partial | onboarding-overview.spec.ts | Test: "overview: loads all sections after first transaction is added" — only verifies UI renders |
| TC-053 | Bar chart renders for single month range (daily bars) | ❌ No | - | Not tested |
| TC-054 | Bar chart renders for range greater than 90 days (monthly bars) | ❌ No | - | Not tested |
| TC-055 | Daily averages: avg/day, today, this week | ❌ No | - | Not tested |
| TC-056 | Category breakdown sorted descending, zero-spend greyed | ❌ No | - | Not tested |
| TC-057 | Empty state when no transactions | ✅ Partial | smoke.spec.ts | Test: "overview tab — empty state" — only verifies empty state message |
| **SETTINGS** |
| TC-058 | Selecting Light theme shows humor dialog | ❌ No | - | Not tested |
| TC-059 | Main currency change shows confirmation dialog | ❌ No | - | Not tested |
| TC-060 | Daily notification toggle | ❌ No | - | Not tested |
| TC-061 | Export data: date range picker opens and export initiates | ❌ No | - | Not tested |
| TC-062 | Backup: create an on-device backup | ❌ No | - | Not tested |
| TC-063 | Restore: confirmation dialog warns before overwrite | ❌ No | - | Not tested |
| TC-064 | Startup screen setting persists | ❌ No | - | Not tested |
| TC-065 | Language selection renders without crash | ❌ No | - | Not tested |
| **PERIOD FILTERING** |
| TC-066 | Month filter with < > navigation | ❌ No | - | Not tested |
| TC-067 | Week filter | ❌ No | - | Not tested |
| TC-068 | Custom date range filter | ❌ No | - | Not tested |
| TC-069 | "All time" shows all transactions | ❌ No | - | Not tested |
| TC-070 | Filter state persists during session but resets on app close | ❌ No | - | Not tested |
| **DATA INTEGRITY** |
| TC-071 | Account balance updates after adding an expense | ❌ No | - | Not tested in isolation; covered conceptually by onboarding-overview test |
| TC-072 | Account balance updates after deleting a transaction | ❌ No | - | Not tested |
| TC-073 | Transfer correctly updates both account balances atomically | ❌ No | - | Not tested |
| TC-074 | Soft-deleted account transactions still visible in Transactions tab | ❌ No | - | Not tested |

---

## Existing Tests Summary

### accounts.spec.ts (3 tests)
- ✅ **TC-007**: Create Regular account — validates card appears in list
- ✅ **TC-009**: Create Debt account — validates card appears and shows Debt chip (partial, no calculated fields)
- ✅ **TC-013**: Archive account — validates account is removed from active list

**Quality Assessment**:
- Tests are focused on happy-path UI rendering
- Use `setup()` helper correctly for fast DB initialization
- Do not test edit, restoration, or account-to-transaction workflows
- No assertions on account balance accuracy
- Helper functions (`openNewAccountForm`, `setStartingBalance`) are well-designed for reuse

### smoke.spec.ts (5 tests)
- ✅ **Bottom nav**: All 5 tabs visible
- ✅ **Active tab reflection**: Current route matches active button
- ✅ **Empty states**: Accounts, Categories, Transactions, Budget, Overview empty state messages
- ✅ **New transaction form**: Elements present test
- ✅ **Settings page**: Opens from gear icon

**Quality Assessment**:
- Pure smoke tests — verify UI elements load without crash
- No functional workflow testing
- Limited value for identifying bugs; primarily regression protection
- Good use of `goToTab()` helper for navigation

### onboarding-overview.spec.ts (4 tests)
- ✅ **Onboarding account save**: Validates account is saved to IndexedDB (regression test)
- ✅ **Transaction form post-onboarding**: Account appears in step 1
- ✅ **Overview after first transaction**: All four sections render (Net, Spending, Daily breakdown, Categories)
- Tests use `clearDB()` for clean state instead of `setup()` (good isolation)

**Quality Assessment**:
- One legitimate functional test (account save to IDB)
- One workflow test (onboarding → transaction form)
- One integration test (create transaction → verify overview loads)
- Includes manual transaction creation via numpad (good coverage of UI interaction)
- **Issue**: Test uses manual numpad clicks instead of helpers — not reusable

### mortgage-overpayment.spec.ts (1 test)
- ✅ **Mortgage overpayment term savings**: Validates "Saves N months" hint appears

**Quality Assessment**:
- Specialized domain test (mortgage overpayment scenario)
- Uses `seedAccounts()` helper to create complex test data via IDB (excellent pattern)
- Test is flaky potential: No explicit waits for "Saves N months" text — only `expect(...).toBeVisible()`
- Does not validate the calculated savings value, only that text appears

---

## Missing Critical Flows

### 1. **Transaction Management (17 test cases, 0% covered)**
   - **Create Expense**: No test validates expense creation, category selection, amount entry, account selection
   - **Create Income**: No test validates income creation workflow
   - **Create Transfer**: No test validates two-sided transfer creation or balanced balance updates
   - **Edit Transaction**: No test validates editing amount, date, category, or note
   - **Delete Transaction**: No test validates deletion confirmation or balance reversal
   - **Selection Mode**: No test validates single/multi-selection toggle behavior
   - **Filtering**: No tests for category, account, or note text filters
   - **Drag Reordering**: No test validates drag handle reordering within a day or persistence
   - **Math Expressions**: No test validates numpad expression evaluation (2+3×4 → 14)
   - **Last Note Suggestion**: No test validates category-specific note suggestion
   - **Export**: No test validates xlsx export columns and row formatting

### 2. **Category Management (10 test cases, 0% covered)**
   - **Create Expense Category**: No test validates category creation, color/icon selection, or list update
   - **Create Income Category**: No test validates income vs expense category separation
   - **Edit Category**: No test validates rename, color, icon changes, or persistence
   - **Delete Category**: No test validates soft delete, restoration, or trash view
   - **Donut Chart**: No test validates chart rendering, toggles, or segment updates
   - **Category Spending**: No test validates spending amount updates when transactions change
   - **Drag Reordering**: No test validates category reorder persistence

### 3. **Budget Management (8 test cases, 0% covered)**
   - **Set Budget**: No test validates budget entry or pinning behavior
   - **Progress Bar**: No test validates progress bar filling or color coding
   - **Over-Budget**: No test validates red highlight for over-budget categories
   - **Month Navigation**: No test validates < > navigation between months
   - **Budget Stats**: No test validates average spend, last month, or last set budget
   - **Savings/Debt Sections**: No test validates transfer-in as spending counts

### 4. **Account Management (10 of 13 test cases, 23% covered)**
   - **Edit Account**: No test validates rename, color, icon changes
   - **Savings Goal**: No test validates savings account creation with goal and progress tracking
   - **Manual Balance Adjustment**: No test validates adjustment without creating transaction
   - **Exclude from Total**: No test validates account toggling and total recalculation
   - **Restore Deleted Account**: No test validates recovery from trash
   - **View Transactions Shortcut**: No test validates filtered transaction view from account detail
   - **Total Wealth View**: No test validates multi-currency asset/debt breakdown
   - **Foreign Currency**: No test validates foreign currency account creation and conversion
   - **Currency Change Warning**: No test validates warning dialog before currency change
   - **Character Limits**: No test validates 64-char name and 255-char description limits

### 5. **Settings & Configuration (8 test cases, 0% covered)**
   - **Theme Selection**: No test validates light theme humor dialog
   - **Main Currency Change**: No test validates confirmation dialog or historical recalculation
   - **Daily Notifications**: No test validates toggle and time picker
   - **Export Data**: No test validates date range picker and xlsx download
   - **On-Device Backup**: No test validates backup creation and listing
   - **Restore Backup**: No test validates confirmation dialog and data replacement
   - **Startup Screen**: No test validates setting persistence across reloads
   - **Language Selection**: No test validates language change and UI text updates

### 6. **Period Filtering (5 test cases, 0% covered)**
   - **Month Filter**: No test validates month navigation and transaction list updates
   - **Week Filter**: No test validates week-based grouping
   - **Custom Date Range**: No test validates start/end date picker and inclusive filtering
   - **All Time Filter**: No test validates full transaction history display
   - **Filter State**: No test validates session persistence and post-close reset

### 7. **Onboarding Flow (5 of 6 test cases, 17% covered)**
   - **Full Onboarding**: No test validates multi-step completion (welcome → currency → account → categories → finish)
   - **Skip at Welcome**: No test validates skip behavior and startup screen load
   - **Skip at Currency Step**: No test validates mid-flow skip with default currency
   - **Re-Onboarding Protection**: No test validates that onboarding doesn't reappear after completion
   - **Account Creation Fields**: No test validates color picker, icon picker, type selection, description

---

## Test Quality Issues

### 1. **Lack of Functional Testing**
   - Tests primarily validate UI presence (`toBeVisible()`) rather than correct behavior
   - No assertions on data accuracy (e.g., account balance values, transaction amounts)
   - No validation of state changes in IndexedDB after user actions

### 2. **Flaky Patterns Detected**
   - `mortgage-overpayment.spec.ts`: Expects "Saves N months" text without checking it matches pattern or has valid number
   - `onboarding-overview.spec.ts`: Waits for navigation with `waitForURL(/\/transactions/)` but no explicit wait for transaction form to render before entering amount
   - `smoke.spec.ts`: Tests bottom nav visibility but doesn't verify tabs actually load content when clicked (tested separately)
   - No explicit waits for numpad buttons to be clickable after page transitions

### 3. **Helper Function Underutilization**
   - `smoke.spec.ts` and others use `goToTab()` helper correctly for safe navigation
   - `setup()` helper is well-designed (sets onboarding flag, navigates to /accounts) and reused consistently
   - BUT: `onboarding-overview.spec.ts` uses inline numpad clicking (5, 0, 0 buttons) instead of creating a `setAmount()` helper
   - Mortgage test has `seedAccounts()` helper but it's not reused across other tests

### 4. **Incomplete Coverage of User Interactions**
   - No tests for form validation (e.g., required fields, character limits)
   - No tests for confirmation dialogs (e.g., delete confirmation, currency change warning)
   - No tests for pagination or scrolling (e.g., in long transaction lists)
   - No tests for date picker interactions

### 5. **Missing Edge Cases**
   - No tests for multi-currency transfers and exchange rate behavior
   - No tests for transactions spanning account currency boundaries
   - No tests for zero-amount transactions
   - No tests for debt account interest calculations
   - No tests for transfer same-currency vs. cross-currency handling

### 6. **State Isolation Issues**
   - `accounts.spec.ts` doesn't clear IndexedDB before tests (relies on empty state from previous test)
   - Tests could interfere with each other if run in different orders
   - `setup()` marks onboarding complete globally; subsequent tests inherit this state

---

## Recommended New E2E Tests

### P0 — Critical Path (Must Have)

#### Transaction Creation & Management
1. **Create Expense Transaction** (TC-029)
   - Create expense: Select account → Select category → Enter amount → Add note → Save
   - Verify: Transaction appears in list, account balance decreases, date groups correctly
   - Priority: **P0**

2. **Create Income Transaction** (TC-030)
   - Create income: Select account → Select category → Enter amount → Save
   - Verify: Transaction appears in list, account balance increases, green color
   - Priority: **P0**

3. **Create Transfer Transaction** (TC-031)
   - Create transfer: Select source account → Select destination account → Enter amount → Save
   - Verify: Two records created with same transferGroupId, both accounts updated, greyed row displayed
   - Priority: **P0**

4. **Delete Transaction with Confirmation** (TC-033)
   - Delete expense: Select transaction → Tap Remove → Confirm in dialog
   - Verify: Transaction removed, account balance restored, balance shows correctly on re-navigate
   - Priority: **P0**

5. **Edit Transaction** (TC-032)
   - Edit expense: Change amount → Change date → Change note → Save
   - Verify: Transaction updates, repositions to new date group, balance accurate
   - Priority: **P0**

#### Account Management
6. **Edit Account Details** (TC-010)
   - Edit account: Rename → Change color → Change icon → Save
   - Verify: Card shows new values, balance unchanged, persistence on reload
   - Priority: **P0**

7. **Restore Deleted Account** (TC-014)
   - Restore: Delete account → Open trash → Tap Restore
   - Verify: Account reappears in active list, balance preserved, trash is empty
   - Priority: **P0**

8. **Exclude Account from Total** (TC-012)
   - Toggle: Select account → Toggle "Include in total" off → Save
   - Verify: Total balance decreases by account balance, Total Wealth view excludes account
   - Priority: **P0**

#### Category Management
9. **Create Expense Category** (TC-019)
   - Create: Tap + → Enter name "Groceries" → Select color/icon → Save
   - Verify: Category appears in list, not in income list, donut chart updates
   - Priority: **P0**

10. **Delete Category** (TC-026)
    - Delete: Enter edit mode → Tap × → Confirm
    - Verify: Category moves to trash, not visible in active list
    - Priority: **P0**

#### Budget Management
11. **Set and View Budget** (TC-044)
    - Set budget: Select category → Enter amount 300 → Save
    - Verify: Budget displayed, progress bar shows 0% (or current spend), category pinned
    - Priority: **P0**

12. **Budget Progress Updates** (TC-045)
    - Add transaction → Check budget progress
    - Verify: Progress bar filled to correct percentage, amounts displayed accurately
    - Priority: **P0**

#### Data Integrity
13. **Account Balance Updates After Expense** (TC-071)
    - Add 50.00 expense → Navigate to accounts → Verify balance decreased
    - Verify: Balance calculation is accurate and persists
    - Priority: **P0**

14. **Transfer Atomic Update** (TC-073)
    - Create transfer 75.00 from Cash (200) to Savings (100)
    - Verify: Cash becomes 125, Savings becomes 175, both updates in same transaction
    - Priority: **P0**

### P1 — Important Features (Should Have)

#### Transaction Features
15. **Math Expression in Numpad** (TC-037)
    - Enter "2+3×4" using numpad buttons
    - Verify: Saved amount is 14 (not 20), PEMDAS respected
    - Priority: **P1**

16. **Filter Transactions by Category** (TC-039)
    - Apply filter: Select category "Groceries"
    - Verify: Only Groceries transactions shown, others hidden, clear button visible
    - Priority: **P1**

17. **Filter Transactions by Account** (TC-040)
    - Apply filter: Select account "Cash Wallet"
    - Verify: Only Cash Wallet transactions shown, archived section visible in list
    - Priority: **P1**

18. **Delete Multiple Transactions** (TC-034)
    - Select 3 transactions → Tap Remove → Confirm "Delete 3 transaction(s)"
    - Verify: All 3 deleted, balances updated, others unaffected
    - Priority: **P1**

19. **Last Note Suggestion** (TC-036)
    - Create expense with "Groceries" and note "Weekly shopping"
    - Create new expense with "Groceries" → Verify "Weekly shopping" chip appears
    - Switch to "Transport" → Verify different suggestion (per-category memory)
    - Priority: **P1**

#### Account Features
20. **Create Savings Account with Goal** (TC-008)
    - Create: Account "Holiday Fund" → Type "Savings" → Goal 1000 → Balance 300
    - Verify: Progress bar shows 30%, goal displayed
    - Priority: **P1**

21. **Create Account with Foreign Currency** (TC-017)
    - Create: EUR account with 100 EUR balance
    - Verify: Currency displayed, total balance shows USD conversion using exchange rate
    - Priority: **P1**

22. **View Transactions from Account Detail** (TC-015)
    - Open account detail → Tap "View transactions"
    - Verify: Navigates to Transactions tab with account pre-filtered, filter visible
    - Priority: **P1**

23. **Character Limits (Name 64, Description 255)** (TC-018)
    - Attempt to enter 65-char name and 256-char description
    - Verify: Input capped/rejected at limits, saves when within limits
    - Priority: **P1**

#### Category Features
24. **Create Income Category** (TC-020)
    - Toggle to income list → Create "Freelance" category
    - Verify: Appears in income list, not in expense list, immutable type
    - Priority: **P1**

25. **Edit Category** (TC-021)
    - Edit: Rename to "Food & Groceries" → Change color/icon
    - Verify: Card updated, type unchanged, persistence on reload
    - Priority: **P1**

26. **Restore Deleted Category** (TC-027)
    - Delete category → Open trash → Restore
    - Verify: Reappears in active list, trash empty
    - Priority: **P1**

27. **Category Spending Updates** (TC-024)
    - Create category "Groceries" with 0 amount
    - Create 50.00 Groceries transaction → Return to categories
    - Verify: Amount shows 50.00, donut chart segment visible
    - Priority: **P1**

#### Budget Features
28. **Over-Budget Category Highlighted** (TC-046)
    - Set budget 300 for "Groceries" → Create 350 spending
    - Verify: Card shows red highlight, progress bar past 100%
    - Priority: **P1**

29. **Budget Month Navigation** (TC-047)
    - Navigate: Tap < to March → Tap > to April → Tap > to May
    - Verify: Each month shows correct budget data, no skips
    - Priority: **P1**

30. **Budget Stats Panel** (TC-048)
    - Open budget numpad → Tap stats button
    - Verify: Shows average monthly spend, last month spend, last set budget
    - Priority: **P1**

#### Settings Features
31. **Export Data with Date Range** (TC-061)
    - Open export → Set 01.04.2026 to 05.04.2026 → Initiate
    - Verify: xlsx downloads with correct columns and date-filtered rows
    - Priority: **P1**

#### Filtering Features
32. **Month Period Navigation** (TC-066)
    - Navigate: Tap < to March → Tap > back to April
    - Verify: Transaction list updates immediately, stale data not shown
    - Priority: **P1**

33. **Custom Date Range Filter** (TC-068)
    - Set start 01.04.2026, end 05.04.2026 → Apply
    - Verify: Only transactions in that range shown, format preserved on refresh
    - Priority: **P1**

### P2 — Nice-to-Have (Can Be Deferred)

34. **Drag Reorder Categories** (TC-025) — Persistence test (P2)
35. **Drag Reorder Transactions** (TC-038) — Grip handle and same-day constraint (P2)
36. **Filter by Note Text** (TC-041) — Case-insensitive contains search (P2)
37. **Week Filter** (TC-067) — Week-based navigation (P2)
38. **Donut Chart Empty Ring** (TC-022) — Edge case: no categories (P2)
39. **All Time Filter** (TC-069) — Load all historical transactions (P2)
40. **Soft-Deleted Transactions Visible** (TC-074) — Trashed accounts' transactions still appear (P2)

---

## Testing Strategy Recommendations

### 1. **Create Reusable Test Helpers**
```typescript
// Helpers to add to helpers.ts:
export async function createExpenseTransaction(
  page: Page,
  accountName: string,
  categoryName: string,
  amount: string,
  note?: string
)

export async function createTransfer(
  page: Page,
  sourceAccount: string,
  destAccount: string,
  amount: string
)

export async function setAmount(page: Page, amount: string) // Reusable numpad

export async function deleteTransaction(page: Page, index: number)

export async function createCategory(
  page: Page,
  type: 'expense' | 'income',
  name: string
)

export async function setBudget(page: Page, categoryName: string, amount: string)
```

### 2. **Establish Base Test Data Patterns**
- Use `setup()` for onboarded app state with no accounts/transactions
- Use `seedAccounts()` pattern for pre-populated accounts (reuse across tests)
- Create `seedCategoriesAndTransactions()` for realistic starting state
- Keep helpers' IndexedDB operations focused and composable

### 3. **Structured Test Organization**
- Create separate test files per feature area:
  - `e2e/transactions.spec.ts` — All 17 transaction tests
  - `e2e/categories.spec.ts` — All 10 category tests
  - `e2e/budget.spec.ts` — All 8 budget tests
  - `e2e/settings.spec.ts` — All 8 settings tests
  - Keep `e2e/smoke.spec.ts` for UI presence checks only

### 4. **Validation Patterns**
- Always verify state in IndexedDB after user actions (not just UI)
- Use `expect(page.locator(...)).toHaveAttribute('value', ...)` for form values
- Assert on specific text content, not just visibility
- Verify numeric accuracy (balance calculations, progress percentages)

### 5. **Timing & Flakiness Prevention**
- Replace `waitForTimeout()` with explicit waits for specific elements
- Use `waitForURL()` for navigation, but also wait for key elements to load
- For numpad: Wait for button visibility before clicking
- For balances: Add explicit wait for amount to update after transaction save

### 6. **CI/CD Integration**
- Run full e2e suite in CI on every PR
- Ensure tests run in isolation (each test should clear/seed its own data)
- Set reasonable timeouts (8-10 seconds for navigation, 30 seconds for mortgage tests)
- Capture screenshots on failure for debugging

---

## Implementation Priority Timeline

### **Phase 1: Critical Path (Weeks 1-2)** — P0 Tests
Focus on core workflows: transaction CRUD, basic account management, category creation, budget setup, data integrity.
- Estimated: 13 tests
- Setup helpers, test structure, patterns established
- Validates happy path and balance accuracy

### **Phase 2: Feature Completeness (Weeks 3-4)** — P1 Tests
Cover filtering, editing, advanced features, multi-currency, multi-selection.
- Estimated: 20 tests
- Reusable helpers stabilized
- Edge cases and error paths included

### **Phase 3: Polish & Edge Cases (Week 5)** — P2 Tests
Drag reordering, complex filtering, ephemeral state persistence, rare scenarios.
- Estimated: 7 tests
- Full coverage achieved (77/77 test cases)
- Maintenance mode baseline established

---

## Files to Create/Modify

### New Test Files
- `e2e/transactions.spec.ts` — 17 transaction tests (P0-P1)
- `e2e/categories.spec.ts` — 10 category tests (P0-P1)
- `e2e/budget.spec.ts` — 8 budget tests (P0-P1)
- `e2e/settings.spec.ts` — 8 settings tests (P0-P1)
- `e2e/filtering.spec.ts` — 5 period filtering tests (P1-P2)

### Modified Files
- `e2e/helpers.ts` — Add helpers for transactions, categories, budget, amounts
- `e2e/accounts.spec.ts` — Add missing account tests (edit, restore, exclude, currency, limits)
- `e2e/smoke.spec.ts` — Keep as is (UI presence checks)
- `e2e/onboarding-overview.spec.ts` — Refactor to use new helpers
- `e2e/mortgage-overpayment.spec.ts` — Keep as is (specialized domain test)

---

## Conclusion

The e2e test suite is currently a **smoke-test stub** rather than a comprehensive coverage baseline. Only **9%** of test cases from the manual plan are automated (7 of 77), and existing tests focus on UI presence rather than functional correctness.

To achieve production-grade quality, prioritize **P0 tests** that validate critical user workflows and data accuracy. The recommended helper pattern (using IndexedDB seeding + reusable action helpers) will make test maintenance manageable as the app evolves.

**Estimated effort to full coverage: 60-80 hours** (assuming 3-5 tests per day with helper establishment in Phase 1).

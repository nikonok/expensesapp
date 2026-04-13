# Step 2 — Components Test Coverage Audit

## AmountDisplay.tsx
### Status: No tests
### Missing coverage
- Semantic color application (income → green + glow, expense → red + glow, transfer → blue)
- Negative neutral amount handling (applies expense styling)
- Currency formatting edge cases
- Prefix rendering (+, −, ⇄)
- Different size variants (lg/md/sm)
### Recommended tests
- Income type renders with green color + glow shadow
- Expense type renders with red color + glow shadow + minus prefix
- Transfer type renders with ⇄ prefix
- Neutral type with negative amount applies expense styling
- Size variants apply correct CSS variables

---

## CategoryCard.tsx
### Status: No tests
### Missing coverage
- Budget progress calculation (spent / budget)
- Over-budget styling detection
- Click handler in view mode
- Remove button in edit mode (stops propagation)
- Drag handle visibility (edit mode only)
- Emoji vs icon rendering
### Recommended tests
- Renders category name and icon
- Progress bar fills to (spent/budget) × 100%
- Over-budget card background is expense color
- Click triggers onClick in view mode
- Remove button triggers callback and stops propagation
- Drag handle visible only in edit mode

---

## DonutChart.tsx
### Status: No tests (existing tests are in DonutChart.test.ts for pure functions only)
### Missing coverage
- Arc calculation geometry
- Slice click handling (activeIndex toggle)
- Empty state rendering
- Center text calculation and rendering
- Clicking center toggles expense/income view
### Recommended tests
- Empty state renders with 0 and empty circle
- Slices render in correct colors
- Slice click sets activeIndex
- Slice click again deselects (sets null)
- Clicking center toggles view mode

---

## TotalWealth.tsx
### Status: No tests
### Missing coverage
- Exchange rate fetching and conversion
- Multi-currency aggregation
- cellFontSize responsive calculation
- Net wealth = assets - debts
- Cancellation token on unmount
### Recommended tests
- Single currency displays without conversion
- Multi-currency shows each currency row
- Net wealth = grand assets - grand debts
- cellFontSize returns lg for < 10 chars, sm for 10-13, caption for > 13
- Cancellation prevents state update on unmount

---

## BudgetCard.tsx
### Status: No tests
### Missing coverage
- Budget progress calculation
- Over-budget detection and styling
- Click to open numpad
- Null budget display
### Recommended tests
- Progress bar width = Math.min(100, (spent/planned)×100)%
- Over-budget background when spent > planned
- Normal background when spent ≤ planned
- Click opens BudgetNumpad sheet
- Null budget displays "—"

---

## BudgetStats.tsx
### Status: No tests
### Missing coverage
- Multi-month average calculation
- Last month actual lookup
- Budget history lookup (most recent)
- "N/A" display when no data
### Recommended tests
- avgMonthly = total / number of months
- lastMonth filters transactions by date range
- Displays "N/A" when no transactions
- Currency formatting applied to each value

---

## TransactionList.tsx
### Status: No tests
### Missing coverage
- Filter application (date range, account, category, note)
- Day grouping and daily totals
- Transaction selection/deselection
- Delete confirmation workflow
### Recommended tests
- Date range filter includes start/end dates
- Account filter shows only transactions from account
- Note filter does substring match
- Transactions grouped by date
- Transaction selection toggle works

---

## TransactionRow.tsx
### Status: No tests
### Missing coverage
- INCOME/EXPENSE/TRANSFER/DEBT_PAYMENT rendering
- Selection state (checkbox)
- Icon color calculation per type
- onSelect callback
### Recommended tests
- INCOME shows + prefix and income color
- EXPENSE shows − prefix and expense color
- TRANSFER shows transfer icon and transfer color
- DEBT_PAYMENT shows destination account icon
- Click triggers onSelect callback
- Icon color = category color for EXPENSE/INCOME

---

## TransactionDayHeader.tsx
### Status: No tests
### Missing coverage
- Date formatting
- Conditional income/expense visibility (hide when 0)
- Total amount calculation
### Recommended tests
- Date formatted correctly
- Income hidden when = 0
- Expense hidden when = 0
- Both shown when both > 0

---

## Numpad.tsx
### Status: Partial (14 tests)
### Missing coverage
- Operator buttons (+, −, ×, ÷) appending to value
- Calendar button callback
- Stats button callback
- "budget" variant (4 columns, no operators)
- isTransfer=true hides operators
### Recommended tests
- Pressing "+" appends "+" to value
- Pressing "÷" appends "÷" to value
- Calendar button calls onCalendarPress
- budget variant shows no operator buttons
- isTransfer=true hides operators row

---

## TransactionInput.tsx
### Status: Partial (exists, minimal component logic coverage)
### Missing coverage
- Transaction type toggle (INCOME/EXPENSE)
- Category/account selection
- Note field editing
- Form validation (amount = 0 blocked)
- Transfer mode (toAccount field)
### Recommended tests
- Transaction type button toggle
- Validation prevents submission if amount = 0
- Transfer mode shows toAccount field
- Note field can be edited

---

## AccountForm.tsx
### Status: Partial (debt/numpad coverage only)
### Missing coverage
- Basic account creation (name, currency, color, icon)
- Form submission for new vs edit
- Empty name validation
### Recommended tests
- Account name can be entered
- Currency/color/icon picker selections
- Form submission calls db.accounts.add for new account
- Validation prevents submit with empty name

---

## AccountDetail.tsx
### Status: No tests
### Missing coverage
- Balance adjustment workflow
- Archive/delete confirmation
- Debt/savings specific displays
### Recommended tests
- Adjust balance button opens numpad
- Numpad save updates balance
- Archive button shows confirmation dialog
- Delete button shows confirmation dialog

---

## AccountCard.tsx
### Status: Partial (mortgage-focused only)
### Missing coverage
- Basic rendering (name, type, balance)
- onPress callback
- Progress bar for SAVINGS/DEBT accounts
### Recommended tests
- Renders account name, type label, balance
- onPress callback triggered
- Progress bar shown for SAVINGS accounts

---

## BudgetNumpad.tsx
### Status: Partial (DB routing good, validation missing)
### Missing coverage
- Zero value allowed
- Negative value rejected
- Toast on success
### Recommended tests
- Zero value save is allowed
- Negative value rejected
- Toast shows on success

---

## CategoryBreakdown.tsx
### Status: Adequate (315 lines, comprehensive)
No additional tests needed.

---

## Summary Priority Table

| Component | Status | Priority |
|---|---|---|
| TransactionRow.tsx | No tests | P0 |
| AmountDisplay.tsx | No tests | P0 |
| TransactionInput.tsx | Partial | P0 |
| CategoryCard.tsx | No tests | P1 |
| BudgetCard.tsx | No tests | P1 |
| AccountDetail.tsx | No tests | P1 |
| DonutChart.tsx | No tests (pure fn only) | P1 |
| Numpad.tsx | Partial | P1 |
| AccountForm.tsx | Partial | P1 |
| TotalWealth.tsx | No tests | P2 |
| BudgetStats.tsx | No tests | P2 |
| TransactionList.tsx | No tests | P2 |
| TransactionDayHeader.tsx | No tests | P2 |
| AccountCard.tsx | Partial | P2 |
| BudgetNumpad.tsx | Partial | P2 |

# Test Coverage Audit: Hooks & Utils Layer

**Date**: April 13, 2026  
**Scope**: `src/hooks/`, `src/utils/`, `src/utils/__tests__/`, `src/db/`

---

## Hooks

### Status: No tests

All 8 hooks exist in `/src/hooks/` but NONE have dedicated unit tests.

### Hook Inventory

| Hook | Lines | Type | Notes |
|------|-------|------|-------|
| `use-accounts.ts` | 19 | Dexie wrapper | `useAccounts()`, `useAccount()` — filters trashed accounts |
| `use-budgets.ts` | 13 | Dexie wrapper | `useBudgets(month)` — simple month filter |
| `use-categories.ts` | 23 | Dexie wrapper | `useCategories(type?, trashed?)` — conditional sort + filter |
| `use-exchange-rate.ts` | 20 | **Stateful** | ⚠️ **LOGIC**: Async service call + state mgmt + cleanup |
| `use-install-prompt.ts` | 11 | Wrapper | Simple PWA install prompt wrapper |
| `use-total-balance.ts` | 60 | **Complex** | ⚠️ **LOGIC**: Multi-currency conversion, exchange rate fetching |
| `use-transactions.ts` | 50 | Dexie wrapper | Complex filter logic (date range, account, category, note search) |
| `use-translation.ts` | 1 | Re-export | Just forwards `react-i18next` |

### Missing coverage

**Hooks requiring testing (have testable logic beyond Dexie pass-through):**

- `use-exchange-rate.ts`: Handles async rate fetching, cancellation on unmount, error handling
- `use-total-balance.ts`: Calculates net worth with multi-currency conversion, handles missing exchange rates
- `use-transactions.ts`: Complex filtering logic (date range parsing, multiple filters, sorting)

**Hooks OK without unit tests (pure Dexie wrappers):**
- `use-accounts.ts`: Dexie wrapper + simple filter
- `use-budgets.ts`: Dexie wrapper + month filter
- `use-categories.ts`: Dexie wrapper + conditional sort
- `use-install-prompt.ts`: PWA wrapper (integration test better)
- `use-translation.ts`: Re-export only

### Recommended tests

**Priority 1: `use-exchange-rate.ts`**
- Test same-currency (from === to) returns rate=1 immediately, isLoading=false
- Test different currencies: fetches rate from service, sets isLoading=true then false
- Test error handling: null rate on fetch failure, but isLoading still false
- Test cleanup: cancelled flag prevents state updates after unmount
- Test dependency changes: re-fetches when from/to currencies change

**Priority 2: `use-total-balance.ts`**
- Test with empty accounts list: returns null netWorth
- Test single currency: no exchange rate call needed, uses 1:1
- Test multiple currencies: fetches rates only for non-main currencies
- Test missing rates: falls back to 1:1 when rate fetch fails
- Test DEBT accounts: negative balance affects netWorth correctly
- Test `includeInTotal` flag: excludes accounts from calculation
- Test cleanup: cancelled flag on unmount

**Priority 3: `use-transactions.ts` (integration test recommended)**
- Test date range filtering with `parsePeriodFilter` 
- Test compound filters (account + category + note search)
- Test sorting: by date DESC, then displayOrder ASC

---

## Utils

### currency-utils.ts

**Status: Adequate**

All 4 functions have explicit test coverage.

#### Functions tested:
- ✅ `formatAmount(amount, currency, locale?)` — 5 tests (USD, PLN, zero, negative)
- ✅ `formatAmountNoSymbol(amount, currency, locale?)` — 2 tests (USD, PLN)
- ✅ `convertAmount(amount, rate)` — 3 tests (multiply, rounding, zero rate)
- ✅ `getCurrencySymbol(currency, locale?)` — 2 tests (USD $, PLN zł)

#### Test quality:
- Uses locale-specific formatting (en-US, pl-PL)
- Tests edge cases: negative amounts, zero rate
- Tests rounding behavior for currency conversions

---

### date-utils.ts

**Status: Adequate**

6 key functions with comprehensive coverage (~20 tests across all functions).

#### Functions tested:
- ✅ `parsePeriodFilter(filter)` — 8 tests (all, today, day, week, month, year, custom)
- ✅ `formatDate(dateStr)` — 2 tests (standard, single-digit day)
- ✅ `autoScaleChartBuckets(start, end)` — 7 tests (boundaries at 0/31/90 days, full year)
- ✅ `shiftPeriod(filter, direction)` — 7 tests (month/week/day/year shifts, year boundary)
- ✅ `getWeekRange(date)` — used in tests but not explicit function tests
- ✅ `getPeriodLabel(filter)` — **NOT TESTED** (used internally)

#### Missing coverage:
- `getWeekRange()`: No direct tests (used indirectly via `parsePeriodFilter`)
- `getMonthRange()`: No tests
- `getLocalDateString()`: No tests
- `getUTCISOString()`: No tests
- `getPeriodLabel()`: No tests (returns human-readable labels for all filter types)

#### Test quality:
- Good boundary testing (31/32/90/91-day boundaries)
- Tests date ranges and week start on Monday (ISO 8601)
- Tests year boundary transitions

---

### math-parser.ts

**Status: Adequate**

`evaluateExpression()` has 11 tests covering core behavior and edge cases.

#### Functions tested:
- ✅ `evaluateExpression(expr)` — 11 tests

#### Coverage:
- Empty/whitespace strings → null
- Single numbers
- All operators: +, -, ×, ÷, −
- PEMDAS: multiply/divide before add/subtract
- Chained operations
- Trailing operators (stripped)
- Rounding to nearest cent
- Invalid expressions → null
- Division by zero → null

#### Test quality:
- Thorough operator testing (ASCII and Unicode variants)
- Good edge cases (empty, invalid, div by zero)
- Rounding behavior verified

---

### numpad-utils.ts

**Status: Adequate**

`formatNumpadDisplay()` has 8 tests covering spacing and operator handling.

#### Functions tested:
- ✅ `formatNumpadDisplay(raw)` — 8 tests

#### Coverage:
- Empty string → "0"
- Single/multi-digit numbers
- Thousands separators (space every 3 digits)
- Decimal point preservation
- Operator handling (+, −, ×, ÷)
- Edge cases (trailing decimal, large numbers)

#### Test quality:
- Tests both ASCII and Unicode operators
- Tests decimal separation (only integer part formatted)

---

### transaction-utils.ts

**Status: Adequate**

All 3 functions have comprehensive edge-case coverage.

#### Functions tested:
- ✅ `isDebtPayment(tx)` — 5 tests (TRANSFER OUT w/ toAccountId, various negatives)
- ✅ `isExpenseForReporting(tx)` — 5 tests (EXPENSE, debt payment, non-expenses)
- ✅ `getDayTotals(txs)` — 6 tests (empty, INCOME, EXPENSE, transfers, mixed day)

#### Test quality:
- Uses mock transaction factory for consistency
- Tests all transaction types: EXPENSE, INCOME, TRANSFER
- Tests transfer directions: OUT, IN
- Tests the `toAccountId` condition for debt payments
- Tests that `amountMainCurrency` is used (not `amount`)

#### Coverage:
Complete—all functions and branches covered. Well-designed tests with clear intent.

---

### validation.ts

**Status: No tests**

5 Zod schemas defined with NO unit test coverage.

#### Schemas without tests:
- ❌ `accountSchema` — 12 fields, complex validation (color format, optional numeric fields)
- ❌ `categorySchema` — 4 fields, color format validation
- ❌ `transactionSchema` — 11 fields, complex with transfer-specific logic
- ❌ `budgetSchema` — 4 fields + 1 refinement (XOR between categoryId/accountId)
- ❌ `settingSchemas` — key-value pairs with format rules

#### Missing coverage:
- Valid inputs for each schema
- Invalid inputs (wrong types, out-of-range values, invalid formats)
- Schema refinements (e.g., budgetSchema's categoryId XOR accountId)
- Color format validation: `oklch([\d.]+%\s+[\d.]+\s+[\d.]+)`
- Date format validation: `^\d{4}-\d{2}-\d{2}$` (transactionSchema)
- Time format validation: `^\d{2}:\d{2}$` (settingSchemas)
- String length constraints (min/max)
- Enum validation

### Recommended tests for validation.ts

**Test `accountSchema`:**
- Valid account with all fields
- Valid account with minimal required fields (name, type, color, icon, currency, startingBalance)
- Invalid: missing required fields
- Invalid: color not in oklch format
- Invalid: currency length !== 3
- Invalid: savingsGoal not positive when provided
- Invalid: interest rates outside [0, 1]

**Test `categorySchema`:**
- Valid category (EXPENSE and INCOME)
- Invalid: missing name, type, or icon
- Invalid: color format

**Test `transactionSchema`:**
- Valid EXPENSE transaction
- Valid INCOME transaction
- Valid TRANSFER (with transferGroupId, transferDirection)
- Valid debt payment (TRANSFER with toAccountId)
- Invalid: negative amount
- Invalid: invalid date format
- Invalid: accountId/categoryId not positive

**Test `budgetSchema`:**
- Valid budget with categoryId
- Valid budget with accountId
- Invalid: both categoryId and accountId null (violates refinement)
- Invalid: both categoryId and accountId set (violates refinement)

**Test `settingSchemas`:**
- Valid mainCurrency (3-letter)
- Valid language (2-10 chars)
- Valid startupScreen (enum)
- Valid notificationTime (HH:MM format)
- Invalid: time format variations

---

## Database Layer

### database.ts

**Status: Minimal tests**

`database.test.ts` has 5 tests covering basic operations and schema functionality.

#### What's tested:
- ✅ Account insert/retrieve
- ✅ Transaction insert/retrieve
- ✅ Compound index [date+displayOrder] functionality
- ✅ Settings table with key-based primary key
- ✅ put() upsert behavior

#### Missing coverage:
- Dexie version migrations (v1–v5)
- Schema indexes: type, name, isTrashed, currency filters
- Filter queries: where().equals(), where().between()
- toArray(), toCollection(), sortBy() operations
- Batch operations: bulkAdd(), bulkDelete()
- Cleanup queries (soft delete with isTrashed)

#### Test quality:
The tests that exist are solid, but coverage is shallow. Given that Dexie is a mature library, **focused tests on custom migrations and compound index queries** would be worthwhile.

### models.ts

**Status: N/A (TypeScript interfaces)**

`models.ts` defines 7 TypeScript interfaces with no behavior—static shape only. **No tests needed.**

---

## Summary Table

| Layer | Component | Status | Tests | Gap |
|-------|-----------|--------|-------|-----|
| **Hooks** | useAccounts | Pass-through | — | N/A |
| | useBudgets | Pass-through | — | N/A |
| | useCategories | Pass-through | — | N/A |
| | useExchangeRate | **Logic** | ❌ 0 | ⚠️ Priority 1 |
| | useInstallPrompt | Wrapper | — | N/A |
| | useTotalBalance | **Logic** | ❌ 0 | ⚠️ Priority 1 |
| | useTransactions | **Logic** | — | ⚠️ Priority 3 |
| | useTranslation | Re-export | — | N/A |
| **Utils** | currency-utils | ✅ Adequate | 12 | ✅ None |
| | date-utils | ✅ Adequate | ~20 | Minor: getMonthRange, getLocalDateString |
| | math-parser | ✅ Adequate | 11 | ✅ None |
| | numpad-utils | ✅ Adequate | 8 | ✅ None |
| | transaction-utils | ✅ Adequate | 6 | ✅ None |
| | validation | ❌ None | 0 | Critical: all 5 schemas |
| **Database** | database | Minimal | 5 | Minor: migrations, filters |
| | models | N/A | — | N/A |

---

## Recommendations

### Immediate Priority
1. **Add tests for `use-exchange-rate.ts`** — 4–5 tests (async, error, cleanup)
2. **Add tests for `use-total-balance.ts`** — 6–8 tests (multi-currency, edge cases)
3. **Add tests for `validation.ts` schemas** — 15–20 tests across 5 schemas

### Secondary
4. **Add tests for `use-transactions.ts`** — 4–6 integration tests (complex filtering)
5. **Expand `database.test.ts`** — test migrations v2–v5, filter queries, batch ops

### Low Priority (Nice-to-have)
6. Add tests for utility functions: `getLocalDateString()`, `getUTCISOString()`, `getPeriodLabel()`, `getMonthRange()`

---

**Total test files needed**: 3 (use-exchange-rate.test.ts, use-total-balance.test.ts, validation.test.ts)  
**Estimated test count**: ~35–50 new tests

# Code Quality Audit: Hooks, Utils, and DB Layer

## use-transactions.ts

### Missing Abstraction

**Location**: useTransactions hook, lines 15-50
**Issue**: Multiple independent filters (accountId, categoryId, noteContains) are applied manually in sequence with separate `filter()` calls. This pattern of conditional filtering is repeated across multiple hooks (useAccounts, useCategories) but with slight variations. The filtering logic should be abstracted into composable filter functions or a query builder utility.
**Suggested fix**: Create a `FilterBuilder` or `QueryBuilder` utility that chains filters declaratively, reducing duplication and improving testability.

### Type Gaps - Union Discrimination

**Location**: UseTransactionsOptions interface, line 8-13
**Issue**: Optional filters (accountId, categoryId, noteContains) lack discriminated union types. There's no compile-time guarantee that "no filters" is explicitly different from "unknown filter state." The pattern `field?: number` allows silent bugs where undefined vs 0 are treated the same way.
**Suggested fix**: Create a discriminated union: `type FilterSpec = { type: 'byAccount'; id: number } | { type: 'byCategory'; id: number } | { type: 'byNote'; query: string } | { type: 'none' }` and accept `filters: FilterSpec[]` instead.

## use-budgets.ts

### Over-engineering Concern

**Location**: useBudgets hook, lines 5-12
**Issue**: This is a trivial wrapper around `db.budgets.where().equals().toArray()`. It adds a single layer of indirection (Dexie's `useLiveQuery`) but doesn't abstract any complex logic. The hook name suggests "budgets" (plural) management but it only fetches for a single month. Similar to useAccounts/useCategories pattern—all are thin wrappers with minimal logic.
**Suggested fix**: Consider if these thin data-fetching hooks add value or should be moved into a higher-order composable utility. Alternatively, clearly document them as "data-layer adapters" to justify their existence.

## use-install-prompt.ts

### Naming Clarity

**Location**: useInstallPrompt hook, line 4 & return value, line 9
**Issue**: The hook returns `{ canInstall, install, dismiss }`, but the semantics aren't clear. "install" is a function, but the capitalization and position mixing noun/verb forms is inconsistent with React Hook naming conventions (should be `onInstall` or `handleInstall` if it's imperative).
**Suggested fix**: Rename return value to `{ isInstallPromptActive, promptInstall, dismissPrompt }` or similar, keeping consistent verb-form naming for all actions.

## use-accounts.ts

### Repeated Pattern - Filtering Logic

**Location**: useAccounts hook, lines 5-14
**Issue**: The `includeTrashed` parameter controls whether to filter out soft-deleted accounts. This same pattern (isTrashed field with optional filtering) is repeated in useCategories and elsewhere. The filtering logic is database-specific (leveraging Dexie's `.filter()`) but the semantic intent (get active vs. all records) is domain logic that should be abstracted.
**Suggested fix**: Create a domain-level `QueryFilter` utility that defines standard filters like `{ soft_delete: 'exclude' }` and applies them consistently across all query hooks.

### Type Gaps - Account Retrieval

**Location**: useAccount function, lines 16-18
**Issue**: Returns `Account | undefined` but doesn't document whether undefined means "loading" (still fetching), "not found" (404), or "error." The hook doesn't expose loading state or error state, unlike `useExchangeRate` which returns `{ rate, isLoading }`.
**Suggested fix**: Add `isLoading: boolean` and optionally `error: Error | null` to the return type, or create a separate `useAccountWithStatus` hook.

## use-total-balance.ts

### Missing Abstraction - Cancellation Pattern

**Location**: lines 35-56
**Issue**: The `useEffect` hook manually implements a "cancellation token" pattern (`let cancelled = false; ... return () => { cancelled = true; }`) which is repeated in useExchangeRate and elsewhere. This is low-level boilerplate that could be abstracted into a custom hook.
**Suggested fix**: Create a `useMountedState()` hook that returns a stable ref/state indicating whether the component is mounted, replacing the manual cancellation pattern across multiple hooks.

### Type Gaps - Exchange Rate Map

**Location**: line 44, `rateMap` variable
**Issue**: `rateMap` is constructed as `Object.fromEntries(currencies.map((c, i) => [c, rates[i]]))`. If `rates.length !== currencies.length`, the mapping could be silently corrupted. There's no type guard or validation.
**Suggested fix**: Add assertion or validation: `if (rates.length !== currencies.length) throw new Error('Rate array length mismatch');` and consider using a typed Map instead of Record.

### Design Issue - State Computed Inside Effect

**Location**: lines 17-32 (useMemo) and lines 35-56 (useEffect)
**Issue**: `groups` is computed in useMemo, then used in useEffect to compute `netWorth`. This creates tight coupling between two state management pieces. The grouping logic is stateful and hidden inside useMemo, making it hard to test or reuse.
**Suggested fix**: Extract grouping and rate conversion into pure utility functions and test them separately.

## use-exchange-rate.ts

### Cancellation Pattern Duplication

**Location**: lines 8-16
**Issue**: Same manual cancellation pattern as useTotalBalance. The pattern `let cancelled = false; ... return () => { cancelled = true; }` is repeated across the codebase.
**Suggested fix**: Create `useCancellableEffect()` or `useAsyncState()` custom hook to centralize this pattern.

### Missing Error Recovery

**Location**: lines 13-14
**Issue**: On fetch failure, the hook sets `rate: null` but doesn't expose the error. Callers can't distinguish between "rate is 1:1" (from === to) and "fetch failed" (rate === null). This is a silent failure mode.
**Suggested fix**: Return `{ rate, isLoading, error }` instead of just `{ rate, isLoading }`.

## use-categories.ts

### Mixed Concerns - Query Building vs Filtering

**Location**: lines 10-15
**Issue**: Conditional query building logic (`type ? db.categories.where().equals() : db.categories.toCollection()`) mixes database concerns with filter logic. If new filter dimensions are added (e.g., by color, icon, etc.), this will become a complex if-else tree.
**Suggested fix**: Create a `QueryBuilder<Category>` utility that takes filter specs and returns a ready-to-execute query, keeping the hook free of database syntax.

## validation.ts

### Constants as Type Literals

**Location**: Lines 4-26 (all schema definitions)
**Issue**: All enum-like values are defined as string literals in zod schemas (e.g., `z.enum(["REGULAR", "DEBT", "SAVINGS"])`). These literals aren't centralized or exported as constants. If an account type string is needed elsewhere, developers must either hardcode it or export from validation, creating coupling.
**Suggested fix**: Define account, transaction, category, and budget types as true TypeScript enums or constants at the top of the file, then use them in zod schemas: `z.enum(Object.values(ACCOUNT_TYPES))`.

### Over-validation

**Location**: Lines 28-62 (budget schema)
**Issue**: The budgetSchema includes complex cross-field validation using `.refine()` to ensure exactly one of (categoryId, accountId) is set. This business rule is duplicated logic that should live in the domain layer, not in a validation schema. Also, the error message "Budget must target exactly one of categoryId or accountId" is buried in the schema.
**Suggested fix**: Create a `BudgetValidator` class or pure function `isValidBudgetTarget()` that encapsulates this rule, making it reusable and testable outside the zod schema context.

### Type Gaps - Positive/Finite Numbers

**Location**: Lines 35-51 (transactionSchema)
**Issue**: The schema validates `amount: z.number().int().positive().finite()`, but comment on line 71 in models.ts says "always positive". If someone creates a transaction with amount=0, the validation passes (0 is not positive, but the schema says .positive() which should exclude 0). This inconsistency between comment and validation is a bug waiting to happen.
**Suggested fix**: Use `.gt(0)` instead of `.positive()` to be explicit, or clarify the rule in comments.

## date-utils.ts

### Over-engineered Utility Duplication

**Location**: Lines 92-104 (getWeekRange, getMonthRange)
**Issue**: These functions are thin wrappers around date-fns that add no domain logic. They're defined as separate exports but `parsePeriodFilter` already computes ranges for the same period types. Two ways to compute the same thing suggests inconsistent usage patterns across the codebase.
**Suggested fix**: Consolidate into a single `getPeriodBounds(period, date)` function that handles all cases, or remove these if `parsePeriodFilter` is sufficient.

### String Literal Consistency

**Location**: Lines 155-168 (autoScaleChartBuckets)
**Issue**: Returns string literal union `'hour' | 'day' | 'week' | 'month'` based on time span heuristics. These strings are also used in other parts of the codebase but aren't defined as a named constant or type, leading to duplication risk.
**Suggested fix**: Define `type ChartBucket = 'hour' | 'day' | 'week' | 'month'` in types/index.ts and export it.

### Mutable Default Logic

**Location**: Lines 39-45 (parsePeriodFilter 'today' case)
**Issue**: 'today' type doesn't store a startDate, but parsePeriodFilter creates one on the fly using `new Date()`. This means the same filter object returns different dates on successive calls if a day boundary is crossed. The 'today' filter is effectively stateless but semantically represents "today's date", creating confusion.
**Suggested fix**: Document that 'today' is re-evaluated on each call (not cached), or refactor to store today's date in the filter object at creation time.

## currency-utils.ts

### Type Gaps - Locale Parameter

**Location**: All functions (formatAmount, formatAmountNoSymbol, getCurrencySymbol)
**Issue**: `locale?: string` parameter is optional but has no default. If undefined is passed, Intl.NumberFormat will use the browser's locale, which is implicit and hard to test. The behavior is browser-dependent and non-deterministic across environments.
**Suggested fix**: Make locale a required parameter, or explicitly default to 'en-US' or use a store-managed locale. Add a comment explaining the behavior.

### Potential Bug - Division by 100

**Location**: Lines 1-6, 8-14
**Issue**: Both functions divide amount by 100, suggesting amounts are stored as cents. However, this assumption is nowhere documented in the function, and other utility functions (e.g., convertAmount) don't enforce this. If amount is already in decimal form, dividing by 100 produces wrong results.
**Suggested fix**: Create a strict type alias like `type CentAmount = number & { readonly __brand: 'CentAmount' }` or document the assumption prominently in file header and function JSDoc.

## transaction-utils.ts

### Type Gaps - Dead Export Risk

**Location**: isDebtPayment, lines 3-9
**Issue**: Function is exported and used in several places (TransactionRow, CategoryList, etc.), but the logic is tightly coupled to transaction type and transferDirection. If new transaction types are added, this function may silently produce wrong results. No discriminated union to enforce all transaction types are handled.
**Suggested fix**: Use a discriminated union on `type TransactionType` and ensure all branches are covered in conditional logic, e.g., TypeScript's `exhaustive switch` pattern.

### Missing Helper for Common Case

**Location**: isExpenseForReporting, lines 11-13
**Issue**: This function combines `type === 'EXPENSE' || isDebtPayment(tx)`. This suggests a "reportable expense" is a domain concept that appears in multiple places (OverviewPage, CategoryBreakdown, etc.). The name is domain-specific but lives in generic utils, and the logic is repeated rather than centralized.
**Suggested fix**: Move to a `transaction-domain-logic.ts` or `transaction-classification.ts` file to signal this is a business rule, not just a utility.

### Incomplete Logic - Day Totals

**Location**: getDayTotals, lines 15-23
**Issue**: Function sums income and expense but doesn't handle net transfers. If a user transfers between two of their own accounts, both accounts' transactions are counted, potentially double-counting the same money. The function assumes transfers are only relevant if they're debt payments (via isExpenseForReporting check).
**Suggested fix**: Document whether transfers between non-debt accounts should be included in daily totals, or create separate `getExpenseTotal()`, `getIncomeTotal()`, and `getTransferTotal()` functions.

## numpad-utils.ts

### Missing Export / Over-encapsulation

**Location**: formatNumericSegment, line 1
**Issue**: Helper function `formatNumericSegment()` is not exported, but its logic is tightly coupled to `formatNumpadDisplay()`. If this logic is ever needed elsewhere (e.g., for formatting currency input), it must be duplicated or refactored. The private/public boundary is unclear.
**Suggested fix**: Either export `formatNumericSegment` (with JSDoc) or document why it's intentionally private.

### Magic Regex

**Location**: Line 6
**Issue**: The regex `/\B(?=(\d{3})+(?!\d))/g` adds thousand separators but the pattern is cryptic and hard to maintain. The separator char (space) is hard-coded with no way to customize for different locales (some use comma, period, etc.).
**Suggested fix**: Extract regex and separator into named constants at file top: `const THOUSAND_SEPARATOR = ' '; const GROUPING_PATTERN = /\B(?=(\d{3})+(?!\d))/g;`

## constants.ts

### String Literals in Validation Schema

**Location**: Lines 40-81 (ICON_LIST)
**Issue**: ICON_LIST is a plain string array with no type safety. The validation schema (validation.ts) doesn't reference this list; icons are just validated as strings. If someone adds an icon to ICON_LIST but also updates validation to restrict icons to known values, the two lists could diverge.
**Suggested fix**: Define `ICON_LIST` with explicit icon types and export a union: `export const ICON_LIST = [...]  as const; export type IconType = typeof ICON_LIST[number];` then use in validation.

### Magic Numbers in Color Palette

**Location**: Lines 1-26 (COLOR_PALETTE)
**Issue**: Each color has an `id` (1-24), but the id field is never used elsewhere in the codebase (can't find usage of COLOR_PALETTE.find((c) => c.id === x)). The id appears to be legacy or over-engineered. Unclear why this is indexed by id when it could just be indexed by position.
**Suggested fix**: Remove the `id` field if unused, or document its purpose. If it's for database references, verify it's actually used in accounts/categories models.

## database.ts

### Version Migration Dead Code

**Location**: Lines 22-48 (db.version calls)
**Issue**: Multiple database migrations are defined (versions 1-5), but the codebase doesn't support downgrading. If new versions are needed, this file will grow with stale migration code that can never be executed (once a database is on v5, it won't re-run v3 or v4). This is technical debt.
**Suggested fix**: Consider removing old migrations once they're known to be out of production use (as part of Step 7: Remove DB migrations), or document a deprecation policy.

### Schema String Duplication

**Location**: Lines 22-31 and 33-36 (transactions schema defined twice)
**Issue**: The transactions table schema is defined in both version 1 (line 25-26) and version 2 (line 34-35). While version 2 updates it, the duplication makes it unclear what the "current" schema is without reading all versions. New developers may be confused.
**Suggested fix**: Comment above version 1 schema noting it's superseded by v2, or extract the final schema to a constant.

## models.ts

### Optional vs Required Fields

**Location**: Account interface, lines 5-36
**Issue**: Many fields are marked optional with `?` or nullable with `| null` (savingsGoal, interestRateMonthly, debtOriginalAmount, etc.), but the semantic difference between optional and nullable is unclear. If a field is "not set yet", should it be undefined or null? This ambiguity is compounded by lack of defaults.
**Suggested fix**: Decide on a convention: use `| null` for fields that can be explicitly "no value" (nullable in DB sense) and `?` for fields that might not exist in newer versions of the model. Document it in the file header.

### Comment Debt - Future Stubs

**Location**: Lines 19-32, 88-92
**Issue**: Multiple fields are marked with future feature comments (autoAccrueInterest, recurringRule). These stubs clutter the type definition and aren't validated by schemas. It's unclear if they're placeholders for upcoming work or permanent architectural decisions.
**Suggested fix**: Either implement these features or move their definitions to a separate `FutureFeatures.ts` file, or remove them entirely and re-add when implementation begins.

### Date Field Semantics

**Location**: Transaction, lines 61-63 (date vs timestamp)
**Issue**: Transaction has both `date` (wall-clock date "YYYY-MM-DD") and `timestamp` (ISO-8601 UTC). The relationship is implicit: `timestamp` is the moment of creation, `date` is the user-perceived date. If a transaction is created in UTC but the user is in a different timezone, `date` and `timestamp.slice(0,10)` may differ, creating subtle bugs.
**Suggested fix**: Document the invariant clearly: "`date` is always the local date at the time of creation; `timestamp` is UTC. They may differ due to timezone." Add a helper function `assertDateConsistency()` for tests.

## seed.ts

### Default Category Colors

**Location**: Lines 29-36 (DEFAULT_CATEGORY_PRESETS)
**Issue**: Category presets use `color: 'var(--swatch-5)'` (CSS variable) but the Account type and validation schema expect oklch colors (e.g., `oklch(65% 0.22 30)`). This inconsistency means seed data won't validate against the accountSchema/categorySchema unless the CSS vars are pre-resolved.
**Suggested fix**: Use actual oklch() color values in seed data, or create a separate CSS var resolution step in seed initialization.

## ui-store.ts

### Action Naming Inconsistency

**Location**: Lines 35-47 (setter function naming)
**Issue**: Some setters are `setX()` (setCategoriesFilter), others are `toggleX()` (toggleCategoriesViewType), others are `clearX()` (clearSelection). The naming pattern doesn't follow a consistent convention. Zustand stores use imperative naming (setState), but this mixes multiple patterns.
**Suggested fix**: Adopt a consistent naming scheme: either all `setX()`, or use a builder pattern like `{ state: {...}, actions: { setX, toggleX, clearX } }` to group them visually.

### Implicit Set Construction

**Location**: Line 63, selectedTransactionIds initialization
**Issue**: `selectedTransactionIds: new Set<number>()` is initialized as a Set, but Sets are mutable and don't trigger Zustand re-renders correctly if mutated in place. The toggleTransactionSelection function (lines 104-113) correctly creates a new Set, but this is fragile and easy to break.
**Suggested fix**: Add a comment warning against mutation, or use an immutable data structure like `Set` but with persistent copy semantics.

### Missing Type for Filter State

**Location**: Lines 19-21 (transactionNoteFilter, transactionCategoryFilter, transactionAccountFilter)
**Issue**: Three separate fields for transaction filters, but they're not grouped as a FilterState object. If more filters are added (by date range, amount range, etc.), the store shape will become unwieldy. The relationship between these filters is implicit.
**Suggested fix**: Create a `type TransactionFilters = { note?: string; categoryId?: number; accountId?: number }` and use it as a single store field.

## settings-store.ts

### Untyped Map Access

**Location**: Lines 38-42 (map construction from db.settings)
**Issue**: Settings are fetched as an array of { key, value } pairs and assembled into a `Record<string, unknown>`. All subsequent access uses unsafe type assertions like `(map['mainCurrency'] as string)`. If a setting key is renamed, there's no compile-time error.
**Suggested fix**: Create a `SettingKeys` enum or const object and use it: `const SETTING_KEYS = { mainCurrency: 'mainCurrency', ... } as const;` then use `map[SETTING_KEYS.mainCurrency]` to get typed access.

### Loose Type in Update

**Location**: Line 67, `update: async (key: string, value: unknown)`
**Issue**: The update method accepts any string key and unknown value. There's no validation that `key` is a valid setting or that `value` is appropriate for that setting. Callers can corrupt the store by passing invalid data.
**Suggested fix**: Use a discriminated union for updates: `type SettingUpdate = { key: 'mainCurrency'; value: string } | { key: 'language'; value: string } | ...;` and accept `update: (spec: SettingUpdate)` instead.

### Side Effect in Getter

**Location**: Line 37, `if (get().isLoaded) return;`
**Issue**: The load() method checks `isLoaded` flag to avoid re-loading. This is a defensive pattern but relies on external code calling load() exactly once. If multiple components call `useSettingsStore` and call load() before it completes, races are possible.
**Suggested fix**: Change to: `const isLoaded = get().isLoaded; if (isLoaded) return; set({ isLoaded: true }); /* ... fetch ... */` to ensure the flag is set before async work starts.

---

## Summary of Common Patterns

### Repeated Anti-Patterns:

1. **Manual Cancellation**: useExchangeRate and useTotalBalance both implement manual `cancelled` flag pattern (should be abstracted)
2. **Conditional Filtering**: useTransactions, useAccounts, useCategories all filter arrays manually in hooks (should use query builder)
3. **Loose Types**: Multiple places use `unknown`, untyped map access, and implicit type coercion
4. **String Literals**: Account types, transaction types, category types, budget types are spread across files (should centralize)
5. **Thin Wrappers**: Many hooks (useBudgets, useAccount) just delegate to Dexie without adding value (questionable justification)

### High-Priority Refactors:

1. Create `useCancellableEffect()` or `useMountedState()` hook to eliminate manual cancellation pattern
2. Create `QueryBuilder<T>` utility to centralize database query construction
3. Define central types/enums for AccountType, TransactionType, CategoryType in types/index.ts
4. Refactor SettingsStore to use discriminated union for type-safe updates
5. Extract domain logic from utils (isExpenseForReporting, getDayTotals) to separate domain layer

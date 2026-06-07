# Step 4: Components Layer Code Quality Audit

**Scope**: 11 business-logic components in src/components/  
**Focus**: Identifying structural issues, code smells, and refactoring opportunities  
**Status**: AUDIT COMPLETE - No fixes applied (read-only analysis)

---

## TransactionInput.tsx

**File Size**: 2565 lines | **Complexity**: CRITICAL

### 1. Components Doing Too Much

**Location**: Main component + Step1, Step2TO, PickerSheet (lines 77–560)  
**Issue**: Single file contains 5+ component definitions and handles: multi-step flow, category/account picking, calculations, currency conversion, debt payment logic, mortgage computations  
**Impact**: Extremely difficult to test, maintain, and reuse picker logic  
**Suggested fix**: Extract Step1, Step2TO, and picker helpers into separate files (TransactionInputSteps.tsx, AccountPicker.tsx, CategoryPicker.tsx). Create useTransactionForm hook for flow logic.

### 2. useEffect Abuse

**Location**: Lines 667, 820, 1844, 1858, 1881, 1937, 1963, 1972, 1984, 2003, 2189 (11+ effects)  
**Issue**: Multiple chained effects updating related state (account → category selection, exchange rate conversions, secondary amount calculations). Cascade of dependent state updates creates fragility.  
**Impact**: Hard to trace data flow, race conditions possible with async exchange rate calls  
**Suggested fix**: Create useTransactionForm hook consolidating these effects into a single state machine or derived-state pattern. Use useReducer for complex interdependent state.

### 3. Missing Memoization

**Location**: Lines 2028–2189 (callback handlers)  
**Issue**: handleFromAccountSelect, handleCategorySelect, handleTransferAccountSelect, etc. are recreated on every render, passed to child Step/Picker components  
**Impact**: Child pickers (Step1, Step2TO) re-render unnecessarily; picker's keyboard listeners re-attach  
**Suggested fix**: Wrap 15+ callbacks in useCallback with proper dependency arrays.

### 4. Logic Belongs in Service/Hook

**Location**: Lines 2028–2189 (transaction creation logic); line 1820+ (exchange rate & secondary amount calculations)  
**Issue**: Currency conversion, decimal handling, debt payment type detection, transaction validation spread across component render/effects  
**Impact**: Hard to unit test, mixed UI and business logic  
**Suggested fix**: Extract into useTransactionForm hook and/or transaction-input.service (currency conversion, secondary amount calc, validation).

### 5. Repeated Patterns

**Location**: CategoryRow (line 372), AccountRow (line 411), Step1/Step2TO headers (duplicated 50+ lines)  
**Issue**: Header structure (back button, title, close button) duplicated in Step1, Step2TO, PickerSheet  
**Impact**: Style drift, maintenance burden  
**Suggested fix**: Extract FormHeader component; reuse in Step1, Step2TO, PickerSheet.

### 6. EntityIcon Helper

**Location**: Line 41–64  
**Issue**: Helper function defined at top level; inlines icon color/size calculations  
**Impact**: Not exported; hard to reuse across other components (e.g., AccountDetail, CategoryList)  
**Suggested fix**: Move to src/components/shared/EntityIcon.tsx; export for reuse; add size/color token mapping.

### 7. Type Weaknesses

**Location**: Line 37 (TxTab type), lines 199–221 (Step2TOProps)  
**Issue**: TxTab = "income" | "expense" | "transfer" but logic often checks txType without exhaustiveness checks. Step2TOProps accepts separate handlers (onToExpenseCategorySelect, onToTransferAccountSelect, onToDebtAccountSelect) instead of unified handler.  
**Impact**: Easy to miss a transaction type in conditionals; props explosion  
**Suggested fix**: Use discriminated union for TxTab state; use single unified handler for "to" selection with variant discriminator.

### 8. Magic Values

**Location**: Line 1762 (isEdit ? 3 : 1), lines 46, 50 (size + 10 for icon), transitionDuration hardcodes  
**Issue**: Step numbers (1, 2, 3), sizing calculations, animation durations scattered  
**Impact**: Inconsistent behavior across pickers  
**Suggested fix**: Create constants: STEP_FROM = 1, STEP_TO = 2, STEP_CONFIRM = 3; ICON_PADDING = 10; move to separate config file.

### 9. Inline Styles

**Location**: Nearly every element (lines 92–2500+)  
**Issue**: All styling is inline style objects; 1000+ lines of style definitions  
**Impact**: Hard to audit design consistency, no way to share style tokens  
**Suggested fix**: Extract style objects to styled-components or CSS classes referencing design tokens (e.g., classes.stepContainer, classes.buttonRow).

### 10. Dead Props/State

**Location**: Line 1774 (focusedField state); likely used for keyboard/focus management but not evident in render  
**Issue**: focusedField state set but unclear how/if it's used in conditional rendering  
**Impact**: Cognitive overhead, possible stale state  
**Suggested fix**: Verify focusedField is actually used in focus/aria logic; if not, remove.

---

## TransactionList.tsx

**File Size**: 445 lines | **Complexity**: HIGH

### 1. Complex Business Logic in useMemo

**Location**: Lines 86–145 (groupedByDate/txById computation)  
**Issue**: Transfer pair merging logic (detecting TRANSFER type, comparing transferDirection, checking transferGroupId) embedded in useMemo. Logic is difficult to follow and test.  
**Impact**: Hard to debug transfer grouping behavior; error-prone  
**Suggested fix**: Extract into useGroupTransactionsByDate hook (or transaction-grouping.service). Make transfer-pair logic testable.

### 2. Prop Drilling

**Location**: Lines 359–375 (TransactionRow receives 6 props: transaction, account, toAccount, category, isSelected, onSelect)  
**Issue**: getTransferToAccount (line 148) computed in parent; passed through to child. Child also receives optional toAccount (could be undefined).  
**Impact**: Fragile prop dependency chain  
**Suggested fix**: Move getTransferToAccount into TransactionRow; pass accountMap/transactionMap instead.

### 3. Magic Values

**Location**: Line 343 (displayOrder: index \* 10), line 344 (map(t) => t.id!), line 356 (handleDragEnd recalculates displayOrder)  
**Issue**: Display order increment (10) hardcoded in two places; non-null assertions on transaction.id  
**Impact**: Maintenance burden if display order strategy changes  
**Suggested fix**: Define DISPLAY_ORDER_INCREMENT = 10 constant. Add null guards instead of assertions.

### 4. Missing Error Handling

**Location**: Lines 184–195 (revertTransaction), lines 241–246 (handleDragEnd)  
**Issue**: Catch blocks only console.error; no user feedback. Drag reorder can fail silently.  
**Impact**: Users unaware of failed operations  
**Suggested fix**: Ensure showToast called on error in both paths; consider retry UI.

### 5. Unused State

**Location**: Line 56 (filtersOpen, setFiltersOpen)  
**Issue**: filtersOpen state controls TransactionFilters sheet visibility but never closes automatically  
**Impact**: Sheet may remain open after filter applied  
**Suggested fix**: Pass onClose callback to TransactionFilters to auto-close on filter apply.

### 6. Inline Styles

**Location**: Lines 256–420 (FAB button, filter row, chips)  
**Issue**: Large inline style objects for sticky filter row, FAB, filter chips  
**Impact**: Hard to reuse, hard to coordinate spacing  
**Suggested fix**: Extract to CSS classes or styled components.

### 7. Repeated useTranslation Absence

**Location**: Line 226 (aria-label concatenates strings without translation)  
**Issue**: Reorder aria-label hardcoded instead of using translation hook  
**Impact**: Accessibility text not internationalized  
**Suggested fix**: Import useTranslation; use t('transactions.reorder') in aria-label.

---

## TransactionRow.tsx

**File Size**: 267 lines | **Complexity**: MEDIUM

### 1. Complex Icon/Color Selection Logic

**Location**: Lines 43–66 (icon selection for debt/transfer/expense)  
**Issue**: Nested ternaries determine iconColor, iconBg, and icon to render. 3-way conditional logic (debt payment vs transfer vs regular).  
**Impact**: Hard to follow; error-prone when adding new transaction types  
**Suggested fix**: Extract into helper function getTransactionDisplayProps(transaction, category, toAccount) returning {color, bg, icon, iconType}.

### 2. Conditional Rendering Fragility

**Location**: Lines 161–173 (icon rendering; nested ternaries)  
**Issue**: If toAccount is undefined but isDebtPmt is true, renders fallback emoji instead of error boundary  
**Impact**: Silent failure; visual inconsistency  
**Suggested fix**: Add explicit null guard at top; throw error or render error state if data incomplete.

### 3. Inline Styles

**Location**: Lines 85–241 (majority of JSX)  
**Issue**: All styling is inline; 100+ lines of style definitions  
**Impact**: Hard to coordinate, hard to reuse across row variants  
**Suggested fix**: Extract to CSS module (TransactionRow.module.css) or styled component; define row states (normal, selected, dragging) as class variants.

### 4. Magic Values

**Location**: Line 104 (opacity: 0.5 for transfers), line 105 (120ms transition), line 108 (scale: 1.03)  
**Issue**: Hardcoded animation/opacity values  
**Impact**: Inconsistent with design tokens  
**Suggested fix**: Use CSS custom properties: var(--opacity-faded), var(--duration-transition-standard), var(--scale-drag).

### 5. Dead Code/Unused Props

**Location**: Line 41 (useTranslation imported but t only used once in aria-label)  
**Issue**: Import appears but t('transactions.debtPayment.label') is one-off usage  
**Impact**: Minor; not critical but suggests incomplete extraction  
**Suggested fix**: Minor refactor; move translation elsewhere or justify single usage.

---

## AccountDetail.tsx

**File Size**: 573 lines | **Complexity**: MEDIUM-HIGH

### 1. Complex State Management

**Location**: Lines 28–31 (showAdjust, adjustValue, showArchiveConfirm, isArchiving)  
**Issue**: Form state (showAdjust) mixed with loading state (isArchiving) and dialog state (showArchiveConfirm). No state machine or formal state management.  
**Impact**: Easy to enter inconsistent states (e.g., both showAdjust and showArchiveConfirm true)  
**Suggested fix**: Create useAccountDetailState hook consolidating these with explicit state machine (VIEWING → ADJUSTING → SAVING → VIEWING).

### 2. Computations Embedded in Render

**Location**: Lines 37–102 (progress calculations, mortgage time-left logic)  
**Issue**: Complex nested conditionals for hasGoal, progress, debtProgress, debtPayment, mortgage remaining months. Logic mixed with JSX conditionals.  
**Impact**: Hard to test, duplicates mortgage calculation logic with TransactionInput  
**Suggested fix**: Extract computations into useAccountMetrics hook. Move mortgage calculation to shared service (debt-payment.service already exists; ensure used here).

### 3. Magic Values

**Location**: Line 38 (Math.min(1, ...)), line 44 (Math.max(0, ...)), line 91 (remainingMonths % 12)  
**Issue**: Hardcoded min/max bounds, date arithmetic calculations  
**Impact**: Non-obvious constraint semantics  
**Suggested fix**: Extract to utility functions: clampProgress(value), calculateDebtPayoffPercent(...), formatRemainingTime(...).

### 4. Code Duplication

**Location**: Lines 236–282 (savings progress) vs lines 283–339 (debt progress)  
**Issue**: Nearly identical progress bar + text rendering logic, just different labels and colors  
**Impact**: Maintenance burden; hard to coordinate design changes  
**Suggested fix**: Extract ProgressSection component accepting {label, amount, goal, color, percentage}.

### 5. Inline Styles - Extensive

**Location**: Nearly every element (lines 150–557)  
**Issue**: 400+ lines of inline style objects  
**Impact**: Very hard to maintain, no reuse  
**Suggested fix**: Extract to CSS module with BEM classes (accountDetail**section, accountDetail**progress, etc.).

### 6. Prop Drilling

**Location**: Lines 20 (props: {account, isOpen, onClose, onEdit})  
**Issue**: onEdit callback props passed; handlers then navigate. Not terrible but could use custom hook (useAccountDetailNavigation).  
**Impact**: Minor; navigation logic somewhat clear  
**Suggested fix**: Consider useAccountDetailNavigation hook wrapping navigation and toast logic.

### 7. Error Handling Missing

**Location**: Lines 104–116 (handleArchive), lines 124–132 (navigation handlers)  
**Issue**: No error boundary; archive failure only logged  
**Impact**: User unaware of failure  
**Suggested fix**: Wrap try/catch and show error toast on failure.

---

## AccountForm.tsx

**File Size**: 1078 lines | **Complexity**: CRITICAL

### 1. Massive Component with Too Many State Variables

**Location**: Lines 30–66 (state declarations)  
**Issue**: 37 state variables (name, type, color, icon, currency, description, startingBalance, savingsGoal, mortgageLoanAmount, mortgageStartDate, mortgageTermYears, mortgageInterestRate, etc.)  
**Impact**: Impossible to track all interdependencies; easy to miss updates  
**Suggested fix**: Create useAccountFormState hook using useReducer with action types (SET_NAME, SET_TYPE, UPDATE_DEBT_SUBTYPE, etc.). Consolidate related state (mortgage fields into mortgageState object).

### 2. Complex useEffect Dependencies

**Location**: Lines 69–140 (reset form on open)  
**Issue**: Single 70-line useEffect resetting all 37 state variables. Changes to editAccount re-run entire initialization.  
**Impact**: Performance concern; hard to debug  
**Suggested fix**: Split into separate hooks: useFormReset (initialize), useDebtSubtypeDefaults (clear fields when switching types), etc.

### 3. Mortgage Calculation Logic Embedded

**Location**: Lines 408–418 (previewPayment calculation)  
**Issue**: Mortgage calculation duplicated from TransactionInput; embedded in component render  
**Impact**: Can diverge from TransactionInput; hard to maintain  
**Suggested fix**: Move to shared mortgage utility; import and use here. Add memoization since pure calculation.

### 4. No Memoization on Expensive Calculations

**Location**: Lines 241–305 (validate function)  
**Issue**: validate() called in handleSave but creates new objects each time; no useMemo  
**Impact**: Minor; validation only on explicit save  
**Suggested fix**: Memoize validation result using useMemo if used elsewhere.

### 5. Type Weaknesses

**Location**: Lines 52–61 (activeNumpadField union type is 9 options)  
**Issue**: Union type for activeNumpadField explicit but config maps it (lines 195–208). Easy to miss a field.  
**Impact**: Fragile; adds new field requires 3 places update (state, config, handler)  
**Suggested fix**: Use enum or const assertion for field names; auto-generate config from enum.

### 6. Magic Values

**Location**: Line 23 (DEFAULT_COLOR = palette[14]), line 24 (DEFAULT_ICON = "wallet"), line 43 (Math.max(0, ...))  
**Issue**: Default values hardcoded; interest rate conversions (% / 100) scattered  
**Impact**: Hard to change defaults; inconsistent rate handling  
**Suggested fix**: Move to constants file; create rate formatter utility.

### 7. Inline Styles - Extremely Extensive

**Location**: 1000+ lines; majority inline style objects  
**Issue**: Every section, button, input has inline styles  
**Impact**: Nearly impossible to maintain  
**Suggested fix**: Extract to CSS module or styled-components; define tokens for input, label, section styles.

### 8. Code Duplication

**Location**: Lines 488–532 (shortcut buttons); lines 541–561 (savings goal input); lines 615–631 (debt-specific inputs)  
**Issue**: Repeated button/input patterns with similar styles  
**Impact**: Hard to coordinate changes  
**Suggested fix**: Extract FormInput, FormButton, ShortcutButton components.

### 9. Missing Internationalization

**Location**: Hardcoded strings throughout (lines 199, 201, 202, etc.)  
**Issue**: Form labels, placeholders, error messages not translated  
**Impact**: Non-English users see English text  
**Suggested fix**: Import useTranslation; wrap all user-facing strings with t() calls.

---

## TotalWealth.tsx

**File Size**: 242 lines | **Complexity**: MEDIUM

### 1. Helper Function at Module Level

**Location**: Lines 13–17 (cellFontSize function)  
**Issue**: Exported utility function but tightly coupled to component display logic  
**Impact**: Unclear if reusable elsewhere  
**Suggested fix**: Move to src/utils/formatting-utils.ts or keep private to component; clarify intent.

### 2. Exchange Rate Fetch in useEffect

**Location**: Lines 50–71 (async exchange rate calculation)  
**Issue**: Async exchange rate fetch in effect; sets grand totals to null until loaded. Cancelled cleanup is good but pattern is fragile.  
**Impact**: Loading state jank; no error handling if rate fetch fails  
**Suggested fix**: Create useExchangeRates hook; use suspense or loading boundary.

### 3. Type Safety Weakness

**Location**: Line 81 (Math.abs(amount) / 100)  
**Issue**: Assumes amount is in cents; no validation  
**Impact**: Silent errors if amount unit changes  
**Suggested fix**: Create typed formatAmount utility that validates unit.

### 4. Inline Styles

**Location**: Lines 88–240 (all styling inline)  
**Issue**: Grid layout, spacing, colors hardcoded  
**Impact**: Hard to maintain, hard to reuse  
**Suggested fix**: Extract to CSS module (grid template, spacing, colors as classes).

### 5. Magic Values

**Location**: Line 100 (gridTemplateColumns: '1fr 1fr 1fr'), line 183 (fontSize: cellFontSize(...))  
**Issue**: Grid assumed to be 3-column; font sizing computed dynamically  
**Impact**: Hard to adjust column count  
**Suggested fix**: Define GRID_COLUMNS constant; consider responsive columns.

---

## DonutChart.tsx

**File Size**: 250 lines | **Complexity**: HIGH

### 1. Complex Arc Calculation Logic

**Location**: Lines 121–149 (arc data building; gap/fraction/offset calculations)  
**Issue**: Math for arc positioning (circumference, gap fraction, stroke offset) is intricate and hard to follow  
**Impact**: Hard to debug positioning bugs  
**Suggested fix**: Extract into utility function: buildDonutArcs(slices, circumference, gapPx) returning arc data array. Add unit tests.

### 2. Repeated Font Size Logic

**Location**: Lines 32–39 (dynamicFontSize), lines 209–210 (repeated in render)  
**Issue**: dynamicFontSize utility defined but then duplicated inline: "primaryFontSize = dynamicFontSize(...); secondaryFontSize = dynamicFontSize(...)"  
**Impact**: Inconsistency if dynamicFontSize changes  
**Suggested fix**: Use utility consistently; memoize results.

### 3. Magic Values

**Location**: Lines 17–23 (CX=100, CY=100, R=80, STROKE_WIDTH=8, GAP_PX=2)  
**Issue**: SVG constants hardcoded  
**Impact**: Hard to adjust donut size/style  
**Suggested fix**: Make configurable via props or constants file.

### 4. Inline Styles on SVG

**Location**: Lines 182–191 (circle transform, opacity, filter, transition)  
**Issue**: SVG styling inline; complex filter and transition logic  
**Impact**: Hard to coordinate  
**Suggested fix**: Extract SVG styles to object literal or CSS.

### 5. Render Optimization

**Location**: Lines 165–195 (map arcs, each with complex conditional style)  
**Issue**: No React.memo on arc circle elements; complex style computed on each render  
**Impact**: Potential re-renders when parent updates  
**Suggested fix**: Memoize arc styles; consider useMemo for arc data building.

### 6. Type Weaknesses

**Location**: Lines 4–15 (DonutSlice and props type)  
**Issue**: DonutSlice.id is string (e.g., "cat-1", "acc-2") but no explicit format  
**Impact**: Easy to mix formats  
**Suggested fix**: Create discriminated union: {type: 'category', id: number} | {type: 'account', id: number}.

### 7. Mutation in Map

**Location**: Line 54 (void \_ = { bucketStart, bucketEnd };)  
**Issue**: Declaration of unused variables to satisfy linter  
**Impact**: Code smell; indicates incomplete refactoring  
**Suggested fix**: Remove dead variable declarations.

---

## CategoryList.tsx

**File Size**: 412 lines | **Complexity**: VERY HIGH

### 1. Multiple Concerns in Single Component

**Location**: Lines 42–412  
**Issue**: Component handles: category CRUD, drag-drop reordering, budget lookup, spent computation, debt account totals, donut chart rendering, edit/add forms  
**Impact**: Very hard to test, maintain, extend  
**Suggested fix**: Extract concerns: useCategoryDragDrop hook, useCategoryBudgets hook, useCategoryTotals hook. Create CategoryCardList sub-component.

### 2. Complex Computations in useMemo

**Location**: Lines 78–94 (expenseById/incomeById/debtAccountTotals), lines 106–120 (totalExpense/totalIncome), lines 123–140 (donutSlices)  
**Issue**: 3 separate useMemo blocks computing related aggregates; hard to trace dependencies  
**Impact**: Risk of stale computations; hard to debug  
**Suggested fix**: Consolidate into single useMemo returning {expenseById, incomeById, debtAccountTotals, totalExpense, totalIncome, donutSlices}.

### 3. Drag-Drop Sensors Duplicated

**Location**: Lines 186–190 (useSensors, PointerSensor, KeyboardSensor)  
**Issue**: Identical sensor setup in CategoryList and TransactionList  
**Impact**: Maintenance burden; inconsistent if updated  
**Suggested fix**: Create useDragSensors() hook; export from shared utility.

### 4. Missing Error Handling

**Location**: Lines 146–158 (handleConfirmTrash), lines 206–211 (handleDragEnd)  
**Issue**: Async operations (db.categories.update, db.categories.bulkPut) have catch blocks but incomplete error handling  
**Impact**: User unaware of failures  
**Suggested fix**: Ensure showToast called on all errors.

### 5. Magic Values

**Location**: Line 203 (displayOrder: index \* 10), line 68 (format(start, 'yyyy-MM'))  
**Issue**: Display order constant duplicated; date format hardcoded  
**Impact**: Maintenance burden  
**Suggested fix**: Define DISPLAY_ORDER_INCREMENT constant; extract to utility.

### 6. Inline Styles

**Location**: Lines 220–390 (controls row, buttons, cards)  
**Issue**: Extensive inline styling  
**Impact**: Hard to maintain  
**Suggested fix**: Extract to CSS module.

### 7. Type Weaknesses

**Location**: Lines 214–216 (confirmCategory lookup)  
**Issue**: confirmCategory = categories.find(...) ?? null; then used in error dialog. If not found, displays null.  
**Impact**: Defensive but unclear error message  
**Suggested fix**: Add explicit error state.

---

## BudgetCard.tsx

**File Size**: 209 lines | **Complexity**: MEDIUM

### 1. Inline Styles - Extensive

**Location**: Lines 47–64 (button style with CSS variable), lines 67–190 (card body and progress bar)  
**Issue**: Nearly all styling inline; CSS custom property (--card-color) used but not consistent  
**Impact**: Hard to coordinate across cards  
**Suggested fix**: Extract to CSS module; define card variant classes (budget-card, budget-card--over-budget).

### 2. Magic Values

**Location**: Line 28–29 (Math.min(100, ...) for progress), line 32 (isOverBudget ? '...' : '...')  
**Issue**: Progress capping and color logic hardcoded  
**Impact**: Hard to adjust thresholds  
**Suggested fix**: Define PROGRESS_CAP = 100; OVER_BUDGET_THRESHOLD = 100.

### 3. formatAmt Helper

**Location**: Lines 34–40 (inline formatter)  
**Issue**: Duplicated from other components; not shared  
**Impact**: Inconsistent formatting  
**Suggested fix**: Move to shared src/utils/formatting-utils.ts; import everywhere.

### 4. Type Safety

**Location**: Line 25 (item.planned != null && item.planned > 0)  
**Issue**: Repeated null checks and comparisons throughout  
**Impact**: Hard to follow logic  
**Suggested fix**: Create BudgetCardData validation schema; normalize data at type level.

---

## CategoryBreakdown.tsx

**File Size**: 229 lines | **Complexity**: MEDIUM

### 1. Complex useMemo with Side Effects

**Location**: Lines 26–93 (rows, totalsMap, totalSpend computation)  
**Issue**: 68-line useMemo computing category rows, account rows, filtering, sorting all at once  
**Impact**: Hard to understand data transformations  
**Suggested fix**: Break into smaller memos: useCategoryTotals, useAccountTotals, useSortedRows.

### 2. Repeated Computation Pattern

**Location**: Lines 45–53 (category totals) vs lines 50–75 (account rows)  
**Issue**: Similar aggregation patterns for categories vs accounts; code duplication  
**Impact**: Hard to maintain  
**Suggested fix**: Create generic aggregateByKey utility.

### 3. Inline Styles

**Location**: Lines 97–227 (all styling inline)  
**Issue**: Extensive inline styles  
**Impact**: Hard to maintain  
**Suggested fix**: Extract to CSS module.

### 4. Magic Values

**Location**: Line 116 (progress = totalSpend > 0 ? amount / totalSpend : 0), line 118 (getLucideIcon)  
**Issue**: Hardcoded condition logic  
**Impact**: Easy to miss edge cases  
**Suggested fix**: Extract progress calculation to utility.

---

## SpendingBarChart.tsx

**File Size**: 303 lines | **Complexity**: HIGH

### 1. Complex Bucketing Logic

**Location**: Lines 42–147 (buildBuckets function; 106 lines)  
**Issue**: Separate logic branches for hour/day/week/month; each branch manually builds buckets and maps transactions  
**Impact**: Very hard to test; easy to introduce bugs  
**Suggested fix**: Extract to src/services/chart-bucketing.service.ts with separate functions: buildHourBuckets, buildDayBuckets, etc.

### 2. Magic Values

**Location**: Line 203 (labelInterval = totalBuckets > 20 ? ...), line 220 (height={160}), line 224 (barCategoryGap="20%")  
**Issue**: Hardcoded thresholds, dimensions, chart parameters  
**Impact**: Hard to adjust chart appearance  
**Suggested fix**: Define CHART_HEIGHT, LABEL_INTERVAL_THRESHOLD constants.

### 3. Dead Code

**Location**: Line 54 (void \_ = { bucketStart, bucketEnd };)  
**Issue**: Unused variable declaration  
**Impact**: Code smell  
**Suggested fix**: Remove.

### 4. Type Weaknesses

**Location**: Line 159 (payload[0].value)  
**Issue**: Assumes payload exists and has value property; no runtime validation  
**Impact**: Potential runtime errors if recharts changes API  
**Suggested fix**: Add null checks and type guards.

### 5. Inline Styles

**Location**: Lines 160–191 (CustomTooltip styles)  
**Issue**: Extensive inline styling  
**Impact**: Hard to coordinate  
**Suggested fix**: Extract to CSS module.

---

## Cross-Component Issues

### 1. **Repeated Inline Styling Everywhere**

All components use extensive inline style objects. This is a systemic issue affecting maintainability.

- **Fix**: Create comprehensive CSS module strategy; use design tokens (--space-_, --color-_, --text-\*) consistently.

### 2. **No Shared Styling Components**

Each component defines its own button, input, label styling.

- **Fix**: Create shared styled components/CSS classes: Button, Input, Label, Card, Section.

### 3. **Missing Internationalization**

Many hardcoded strings not wrapped in useTranslation.

- **Fix**: Audit all components; wrap user-facing strings with t() calls.

### 4. **Duplicated Utilities**

cellFontSize, formatAmount, dynamicFontSize, calculateMortgagePayment computed/defined multiple times.

- **Fix**: Centralize in src/utils/ or src/services/; import everywhere.

### 5. **Drag-Drop Sensor Setup Duplicated**

TransactionList and CategoryList both define identical useSensors setup.

- **Fix**: Create useDragSensors() hook in src/hooks/.

### 6. **No Shared Entity Display**

AccountRow, CategoryRow, AccountDetail icon/color rendering duplicated.

- **Fix**: Create shared EntityIcon, EntityCard components.

### 7. **Error Handling Inconsistent**

Some components show toasts on error; others only console.error.

- **Fix**: Standardize: always show toast on user-facing errors; use error boundary for critical failures.

### 8. **Missing Memoization Everywhere**

Components frequently re-render child pickers/cards with new callback instances.

- **Fix**: Wrap all callbacks in useCallback; memoize expensive computations with useMemo.

### 9. **Date Handling Scattered**

getLocalDateString, format, parseISO, date math imported/used inconsistently.

- **Fix**: Create useDateFormatting hook consolidating date utilities.

### 10. **No Input Validation Layer**

AccountForm validates inline; other components skip validation.

- **Fix**: Create validation hooks: useAccountFormValidation, useBudgetValidation.

---

## Refactoring Priority (High Impact → Low Impact)

1. **CRITICAL**: Extract TransactionInput into smaller components + hooks (2565 → ~500 lines)
2. **CRITICAL**: Refactor AccountForm state management with useReducer (1078 → ~400 lines)
3. **HIGH**: Consolidate inline styles across all components into CSS modules
4. **HIGH**: Extract complex computations into hooks (useGroupTransactions, useCategoryTotals, etc.)
5. **HIGH**: Create shared entity display components (EntityIcon, EntityCard)
6. **MEDIUM**: Add missing useCallback/useMemo for performance
7. **MEDIUM**: Consolidate duplicated utilities (formatAmount, dynamicFontSize, etc.)
8. **MEDIUM**: Add comprehensive i18n coverage
9. **LOW**: Extract pure utility functions (bucketing, arc calculation)
10. **LOW**: Add React.memo for frequently re-rendered sub-components

---

## Summary by File

| File                  | Size  | Complexity  | Top Issues                                                | Refactor Effort |
| --------------------- | ----- | ----------- | --------------------------------------------------------- | --------------- |
| TransactionInput.tsx  | 2565L | CRITICAL    | Components too big, useEffect abuse, missing memoization  | 50+ hours       |
| AccountForm.tsx       | 1078L | CRITICAL    | Massive state, 37 variables, duplicated logic             | 30+ hours       |
| TransactionList.tsx   | 445L  | HIGH        | Business logic in useMemo, prop drilling, error handling  | 10 hours        |
| CategoryList.tsx      | 412L  | VERY HIGH   | Multiple concerns, complex memos, drag-drop duplication   | 15 hours        |
| SpendingBarChart.tsx  | 303L  | HIGH        | 106-line bucketing function, magic values                 | 8 hours         |
| DonutChart.tsx        | 250L  | HIGH        | Complex arc math, repeated font logic, memoization        | 6 hours         |
| AccountDetail.tsx     | 573L  | MEDIUM-HIGH | State management, embedded calculations, extensive styles | 8 hours         |
| BudgetCard.tsx        | 209L  | MEDIUM      | Inline styles, magic values, duplicated formatters        | 3 hours         |
| CategoryBreakdown.tsx | 229L  | MEDIUM      | Large useMemo, repeated patterns                          | 4 hours         |
| TransactionRow.tsx    | 267L  | MEDIUM      | Complex icon logic, inline styles, magic values           | 3 hours         |
| TotalWealth.tsx       | 242L  | MEDIUM      | Exchange rate fetch pattern, helper function placement    | 2 hours         |

**Total Estimated Refactor Time**: 140+ hours (phased over multiple sprints)

---

End of audit report.

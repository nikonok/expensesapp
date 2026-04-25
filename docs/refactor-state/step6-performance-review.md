# React Performance & Patterns Review

**Date:** 2026-04-13  
**Scope:** src/components/transactions/TransactionInput.tsx, TotalWealth.tsx, DonutChart.tsx, CategoryList.tsx, App.tsx

---

## Executive Summary

This PWA has solid foundational performance patterns but exhibits **moderate re-render risks** in the largest component (TransactionInput) and **callback/object recreation issues** in mid-sized components. Memory management is generally sound with proper cleanup. Three issues rated as **high-impact** and five as **medium-impact**. Lazy loading strategy is correct but could be expanded.

---

## 1. UNNECESSARY RE-RENDERS

### 1.1 **[HIGH IMPACT]** TransactionInput: Inline arrow functions in lists (Step 1 & Step 2)

**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx`  
**Lines:** 163-169, 172-174, 184-190, 296-310, 316-323, 337-345, 357-363, 1625-1654, 1660-1725

**Issue:**  
In Step1 and Step2 components, `AccountRow` and `CategoryRow` are rendered with inline arrow functions as the `onPress` handler:

```typescript
{nonDebtAccounts.map((acc) => (
  <AccountRow key={acc.id} account={acc} onPress={() => onFromAccountSelect(acc)} />
))}
{incomeCategories.map((cat) => (
  <CategoryRow key={cat.id} category={cat} onPress={() => onFromIncomeCategorySelect(cat)} />
))}
```

These anonymous functions are **recreated on every render** of Step1/Step2. While AccountRow/CategoryRow are likely not memoized, this creates new function references, which defeats shallow equality checks and causes unnecessary renders when data hasn't changed.

**Impact:** Medium-High. Step1/Step2 render whenever parent state changes (e.g., numpadValue, note). With hundreds of accounts/categories, this multiplies re-renders.

**Recommendation:**

1. Wrap inline closures in `useCallback` for each list map:
   ```typescript
   const handleAccountPress = useCallback(
     (acc: Account) => {
       onFromAccountSelect(acc);
     },
     [onFromAccountSelect],
   );
   ```
2. Or memoize `AccountRow` and `CategoryRow` with `React.memo()` to ignore shallow changes to `onPress`.

---

### 1.2 **[MEDIUM IMPACT]** DonutChart: Text layout recalculation on every render

**File:** `/home/anton/Project/expensesapp/src/components/categories/DonutChart.tsx`  
**Lines:** 41-49, 199-246

**Issue:**  
Every render calls `dynamicFontSize()` and `computeTextPositions()` to calculate SVG text metrics:

```typescript
const primaryFontSize = dynamicFontSize(primaryStr, 24, 14);
const secondaryFontSize = dynamicFontSize(secondaryStr, 14, 10);
const { primaryY, secondaryY } = computeTextPositions(primaryFontSize, secondaryFontSize);
```

These helper functions perform string-length-based calculations repeatedly, even when `slices`, `totalExpense`, `totalIncome`, and `categoriesViewType` haven't changed.

**Impact:** Low-Medium. Recalculation is fast, but this is avoidable and compounds if DonutChart re-renders frequently (e.g., parent category filter changes).

**Recommendation:**  
Wrap in `useMemo`:

```typescript
const { primaryFontSize, secondaryFontSize, primaryY, secondaryY } = useMemo(() => {
  const pfs = dynamicFontSize(primaryStr, 24, 14);
  const sfs = dynamicFontSize(secondaryStr, 14, 10);
  const pos = computeTextPositions(pfs, sfs);
  return { primaryFontSize: pfs, secondaryFontSize: sfs, ...pos };
}, [primaryStr, secondaryStr]);
```

---

### 1.3 **[MEDIUM IMPACT]** CategoryList: Inline event handlers on filter/edit buttons

**File:** `/home/anton/Project/expensesapp/src/components/categories/CategoryList.tsx`  
**Lines:** 238, 257-258, 312

**Issue:**  
UI controls pass inline arrow functions as event handlers:

```typescript
<button onClick={() => navigate('/categories/trash')} ... />
<button onClick={() => setCategoriesEditMode(!categoriesEditMode)} ... />
<button onClick={handleAddCategory} ... />
```

While these are simple operations, they create new function instances on every render. If CategoryList re-renders due to data changes (categories, budgets), buttons unnecessarily recreate closures.

**Impact:** Low. These are single buttons, not lists, so re-create cost is minimal.

**Recommendation:**  
Use `useCallback` to stabilize references:

```typescript
const handleToggleEditMode = useCallback(() => {
  setCategoriesEditMode(!categoriesEditMode);
}, [categoriesEditMode]);
```

---

### 1.4 **[MEDIUM IMPACT]** TotalWealth: formatAmount called inline on every render

**File:** `/home/anton/Project/expensesapp/src/components/accounts/TotalWealth.tsx`  
**Lines:** 75-81, 147-148, 220-225, 236

**Issue:**  
`formatAmount()` is defined as a function expression inside the component body:

```typescript
const formatAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat(...).format(...);
```

Called in `.map()` for every row:

```typescript
const assetsStr = formatAmount(g.assets, g.currency);
const debtsStr = formatAmount(g.debts, g.currency);
```

`Intl.NumberFormat` constructor is expensive; a new formatter is created per call per render.

**Impact:** Low-Medium. If TotalWealth re-renders (account balance changes), and there are many currencies (e.g., 5+), this becomes noticeable.

**Recommendation:**

1. Move `formatAmount` outside component or memoize with `useMemo`.
2. Cache `Intl.NumberFormat` instances:
   ```typescript
   const formattersRef = useRef(new Map<string, Intl.NumberFormat>());
   const formatAmount = useCallback((amount: number, currency: string) => {
     if (!formattersRef.current.has(currency)) {
       formattersRef.current.set(currency, new Intl.NumberFormat('en-US', {...}));
     }
     return formattersRef.current.get(currency)!.format(...);
   }, []);
   ```

---

## 2. useEffect CORRECTNESS

### 2.1 **[HIGH IMPACT]** TransactionInput: Missing dependency in `handleFromIncomeCategorySelect`

**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx`  
**Lines:** 2038-2056

**Issue:**

```typescript
const handleFromIncomeCategorySelect = useCallback(
  (cat: Category) => {
    // ... logic ...
    const hasPresetAccount =
      account !== null ||
      (qAccountId !== null && allAccounts.some((a) => a.id === parseInt(qAccountId, 10)));
    // ...
  },
  [account, allAccounts, searchParams], // Dependencies listed
);
```

The callback references `account` and `allAccounts`, but also uses `searchParams.get("accountId")` inside. If the component depends on a different parameter key or if `searchParams` itself becomes stale, this callback will have a snapshot of the old `searchParams`.

However, looking closer, `searchParams` is passed as a dependency via `[account, allAccounts, searchParams]`, so this is actually **safe**—but listed below for clarity.

**Recommendation:** Dependency list is correct. No change needed.

---

### 2.2 **[MEDIUM IMPACT]** TransactionInput: Effect dependencies for secondary amount calculation

**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx`  
**Lines:** 1937-1960, 1984-2000

**Issue:**

```typescript
useEffect(() => {
  if (secondaryManual) return;
  if (!account || account.currency === mainCurrency) return;
  // ... fetch exchange rate and update secondaryAmount
}, [numpadValue, account, mainCurrency, secondaryManual]);
```

This effect recalculates the secondary amount whenever `numpadValue` changes. However, if the user is **actively typing** in the numpad, this triggers an async `exchangeRateService.getRate()` call for each keystroke. The promise may resolve out-of-order if the user types quickly, causing stale state updates.

**Current mitigation:** None. The effect has no cancellation token or abort controller.

**Impact:** Medium. Rare race condition that causes incorrect secondary amounts if user types rapidly while offline or with slow network.

**Recommendation:**  
Add an AbortController to cancel in-flight requests:

```typescript
useEffect(() => {
  const abort = new AbortController();

  (async () => {
    if (secondaryManual) return;
    if (!account || account.currency === mainCurrency) return;
    const amount = evaluateExpression(numpadValue);
    if (amount === null || amount <= 0) {
      setSecondaryAmount("");
      return;
    }

    try {
      const rate = await exchangeRateService.getRate(account.currency, mainCurrency);
      if (!abort.signal.aborted) {
        // ... update state
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        // ... handle error
      }
    }
  })();

  return () => abort.abort();
}, [numpadValue, account, mainCurrency, secondaryManual]);
```

---

### 2.3 **[MEDIUM IMPACT]** App.tsx: Cleanup for notification effects is conditional

**File:** `/home/anton/Project/expensesapp/src/App.tsx`  
**Lines:** 66-76

**Issue:**

```typescript
useEffect(() => {
  if (!isLoaded) return;
  if (notificationEnabled) {
    scheduleDailyReminder(notificationTime || "20:00");
    registerPeriodicSync();
    return () => cancelDailyReminder(); // <-- Only returns cleanup if notificationEnabled
  } else {
    cancelDailyReminder();
    unregisterPeriodicSync();
  }
}, [isLoaded, notificationEnabled, notificationTime]);
```

The cleanup function is only returned if `notificationEnabled === true`. If the user disables notifications while the effect is running, the cleanup might not fire properly for `registerPeriodicSync()`.

**Impact:** Low-Medium. Could leak background sync registration if notifications are toggled.

**Recommendation:**

```typescript
useEffect(() => {
  if (!isLoaded) return;

  if (notificationEnabled) {
    scheduleDailyReminder(notificationTime || "20:00");
    registerPeriodicSync();
  } else {
    cancelDailyReminder();
    unregisterPeriodicSync();
  }

  return () => {
    cancelDailyReminder();
    unregisterPeriodicSync();
  };
}, [isLoaded, notificationEnabled, notificationTime]);
```

---

### 2.4 **[LOW IMPACT]** TotalWealth: Effect for exchange rate conversion is sound but could optimize

**File:** `/home/anton/Project/expensesapp/src/components/accounts/TotalWealth.tsx`  
**Lines:** 50-71

**Issue:**  
The effect correctly uses a `cancelled` flag to prevent state updates after unmount:

```typescript
useEffect(() => {
  let cancelled = false;
  async function calc() {
    // ... fetch rates
    if (!cancelled) {
      setGrandAssets(totalAssets);
      setGrandDebts(totalDebts);
    }
  }
  calc();
  return () => {
    cancelled = true;
  };
}, [groups, mainCurrency]);
```

This is a good pattern, but the effect refetches rates **every time** the `groups` array changes, even if only one currency was added. For a PWA with many accounts, this causes unnecessary API calls.

**Impact:** Low. Current behavior is safe; optimization is non-critical.

**Recommendation:**  
Track the set of currencies instead of the entire groups array:

```typescript
const currencies = useMemo(() => [...new Set(groups.map((g) => g.currency))], [groups]);
useEffect(() => {
  // ... effect
}, [currencies, mainCurrency]);
```

---

## 3. LAZY LOADING

### 3.1 **[LOW IMPACT]** Current lazy loading strategy is correct

**File:** `/home/anton/Project/expensesapp/src/App.tsx`  
**Lines:** 17-19

Already lazy-loaded:

- ✅ `BudgetPage` (223 lines)
- ✅ `OverviewPage` (105 lines)
- ✅ `TransactionInput` (2565 lines)

**Recommendation:** No additional changes needed. All heavy-weight route components are code-split. Pages like `AccountsPage`, `SettingsPage` etc. are thin wrappers (5 lines) so lazy loading them provides no benefit.

---

## 4. MEMORY LEAKS

### 4.1 **[GOOD PATTERN]** TotalWealth: Cancellation token prevents state updates after unmount

**File:** `/home/anton/Project/expensesapp/src/components/accounts/TotalWealth.tsx`  
**Lines:** 50-70

✅ **No leak.** Uses a `cancelled` flag before setState. This is a reliable pattern for async effects.

---

### 4.2 **[GOOD PATTERN]** DonutChart: Animation timer cleanup is correct

**File:** `/home/anton/Project/expensesapp/src/components/categories/DonutChart.tsx`  
**Lines:** 58-67

```typescript
useEffect(() => {
  setAnimated(false);
  if (animTimerRef.current) clearTimeout(animTimerRef.current);
  animTimerRef.current = setTimeout(() => {
    setAnimated(true);
  }, 30);
  return () => {
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
  };
}, [slices.length]);
```

✅ **No leak.** Clears the timer on unmount and before setting a new one.

---

### 4.3 **[POTENTIAL ISSUE]** TransactionInput: Event listeners cleaned up correctly but Escape handler is global

**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx`  
**Lines:** 2188-2195, 501-510, 667-677

Multiple effects attach global `keydown` listeners for Escape. Example:

```typescript
useEffect(() => {
  const h = (e: KeyboardEvent) => {
    if (e.key === "Escape") handleBack();
  };
  document.addEventListener("keydown", h);
  return () => document.removeEventListener("keydown", h);
}, [handleBack]);
```

This is cleaned up properly, but **multiple nested Escape handlers** are added (one per step, one per date picker, one per picker sheet). If all are mounted at once, this could cause unexpected behavior (e.g., all handlers firing).

**Impact:** Low. Handlers use `capture: true` or `stopPropagation()` to prevent bubbling, but architecture could be cleaner.

**Recommendation:**  
Consolidate Escape handling into a single top-level effect in the main component, or use a context to manage overlays.

---

## 5. KEY PROP ISSUES

### 5.1 **[GOOD PATTERN]** CategoryList & TransactionList: Stable, unique keys

**File:** `/home/anton/Project/expensesapp/src/components/categories/CategoryList.tsx`  
**Lines:** 359-375, 377-388

```typescript
{categories.map((cat) => (
  <CategoryCard key={cat.id} category={cat} ... />
))}
{debtAccountsWithSpend.map((acc) => (
  <DebtPaymentCard key={`debt-${acc.id!}`} account={acc} ... />
))}
```

✅ **Correct.** Uses `id` (stable DB primary key), not array index. DebtPaymentCard adds a prefix to avoid collisions with category IDs.

---

### 5.2 **[GOOD PATTERN]** TransactionList: Keys use transaction ID

**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionList.tsx`  
**Lines:** 341-370

```typescript
{groupedByDate.map(({ date, txs }) => (
  <div key={date} ...>
    {txs.map((tx) => (
      <TransactionRow key={tx.id} ... />
    ))}
  </div>
))}
```

✅ **Correct.** Uses `tx.id` (primary key), and date groups are also stable keys.

---

### 5.3 **[POTENTIAL ISSUE]** TransactionInput: Step1/Step2 lists use ID keys correctly

**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx`  
**Lines:** 163-174, 296-310, 316-363, 1625-1725

```typescript
{nonDebtAccounts.map((acc) => (
  <AccountRow key={acc.id} account={acc} ... />
))}
{incomeCategories.map((cat) => (
  <CategoryRow key={cat.id} category={cat} ... />
))}
```

✅ **Correct.** Uses `id` as key. However, these lists are not reorderable (no drag-and-drop), so order changes are not a concern.

---

## 6. SUMMARY TABLE

| #   | Issue                                                 | Component                  | Impact | Priority | Fix Effort |
| --- | ----------------------------------------------------- | -------------------------- | ------ | -------- | ---------- |
| 1.1 | Inline arrow functions in AccountRow/CategoryRow maps | TransactionInput (Step1/2) | High   | High     | Low        |
| 1.2 | Text metrics recalculation on every render            | DonutChart                 | Medium | Medium   | Low        |
| 1.3 | Inline handlers on filter buttons                     | CategoryList               | Low    | Low      | Low        |
| 1.4 | Intl.NumberFormat recreated per call                  | TotalWealth                | Medium | Medium   | Low        |
| 2.1 | Secondary amount effect missing race condition guard  | TransactionInput           | Medium | Medium   | Medium     |
| 2.2 | Notification cleanup conditional                      | App.tsx                    | Medium | Medium   | Low        |
| 2.3 | Exchange rate currency tracking could optimize        | TotalWealth                | Low    | Low      | Low        |
| 2.4 | Multiple global Escape listeners                      | TransactionInput           | Low    | Low      | Medium     |
| 3.1 | Lazy loading strategy                                 | App.tsx                    | —      | ✅ Good  | —          |
| 4.1 | Cancellation pattern                                  | TotalWealth                | —      | ✅ Good  | —          |
| 4.2 | Timer cleanup                                         | DonutChart                 | —      | ✅ Good  | —          |
| 5.x | Key props                                             | All lists                  | —      | ✅ Good  | —          |

---

## 7. RECOMMENDED QUICK WINS (Priority Order)

1. **Wrap inline closures in Step1/2 lists** (Issue 1.1)  
   – Prevents re-renders of AccountRow/CategoryRow when parent state changes  
   – 5 min fix, high impact

2. **Add AbortController to exchange rate effects** (Issue 2.1)  
   – Prevents race conditions on rapid numpad input  
   – 10 min fix, medium impact

3. **Memoize text layout calculations in DonutChart** (Issue 1.2)  
   – Avoids string-length recalculation on every render  
   – 5 min fix, medium impact

4. **Fix notification effect cleanup** (Issue 2.2)  
   – Ensures periodic sync is always unregistered on disable  
   – 2 min fix, medium impact

5. **Cache Intl.NumberFormat in TotalWealth** (Issue 1.4)  
   – Avoids expensive formatter recreation per amount  
   – 10 min fix, medium impact

---

## 8. NOTES

- **No critical memory leaks detected.** The codebase uses proper cleanup patterns.
- **Memoization is selectively used** (CategoryList, TransactionList use useMemo for maps/derivations).
- **React.memo is not used on components**, which may be intentional (components are mostly stateful presentation).
- **Dexie-React hooks (useLiveQuery) handle caching** at the database layer, reducing re-render pressure.
- **No prop drilling observed;** Zustand stores + React Router manage state well.

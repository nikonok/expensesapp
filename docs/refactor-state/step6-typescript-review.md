# Step 6: TypeScript Strictness and Error Handling Review

**Date:** 2026-04-13  
**Scope:** TypeScript strict mode compliance, error handling patterns, promise management, and type safety across services, stores, hooks, and database layer.

---

## Executive Summary

The codebase has **strict mode enabled** (`"strict": true` in tsconfig.json) and demonstrates generally good TypeScript discipline. However, several issues were identified:

1. **Unsafe type assertions** in services (primarily `as string` and `as any` in test files)
2. **Unhandled promise rejections** in React components (promise chains without error handling)
3. **Fire-and-forget async callbacks** in useEffect hooks (missing error boundaries)
4. **Missing error context** in catch blocks (errors swallowed silently in some cases)
5. **Test-only `as any` casts** that mask real type issues

All issues are **real, not style preferences** and pose maintenance or runtime risks.

---

## 1. Unsafe Type Assertions

### Issue 1.1: Unvalidated string cast in `getMainCurrency()`
**File:** `/home/anton/Project/expensesapp/src/services/exchange-rate.service.ts:10`  
**Severity:** Medium  
**Type:** Unvalidated type assertion

```typescript
// Line 10
return (setting?.value as string) ?? 'USD';
```

**Problem:**  
`setting?.value` is typed as `unknown` (from Setting interface where `value: unknown`). The cast to `string` is unsafe—no validation ensures the stored value is actually a string. If a non-string value was persisted (e.g., from a bug), this will silently pass and cause downstream errors in exchange-rate calculations.

**Risk:**  
- Subtle bugs in rate calculations if mainCurrency is not a string
- Type narrowing gap: should validate `typeof setting?.value === 'string'`

**Recommendation:**  
```typescript
const setting = await db.settings.get('mainCurrency');
if (setting && typeof setting.value === 'string') {
  return setting.value;
}
return 'USD';
```

---

### Issue 1.2: Unvalidated type assertions in `backup.service.ts:240–250`
**File:** `/home/anton/Project/expensesapp/src/services/backup.service.ts:240–250`  
**Severity:** Medium  
**Type:** Unsafe bulk operation casts

```typescript
// Lines 240–250
if (validAccounts.length)
  await db.accounts.bulkAdd(validAccounts as Parameters<typeof db.accounts.bulkAdd>[0]);
if (validCategories.length)
  await db.categories.bulkAdd(validCategories as Parameters<typeof db.categories.bulkAdd>[0]);
// ... etc
```

**Problem:**  
These casts rely on the filtering logic above (via `.safeParse().success`) to guarantee type safety, but the cast is opaque to TypeScript. Future changes to validation logic could break the invariant without compiler warnings.

**Risk:**  
- Restoration of corrupted data if validation is weakened
- Maintenance burden: developers may not understand why the cast is safe

**Recommendation:**  
Extract a type guard function that narrows the type:
```typescript
function assertValidAccount(row: unknown): row is Account {
  return accountSchema.safeParse(row).success;
}
const validAccounts = (data.tables.accounts as unknown[]).filter(assertValidAccount);
```

---

## 2. Non-Null Assertions in Tests

### Issue 2.1: Non-null assertions in service tests lack prior null checks
**File:** `/home/anton/Project/expensesapp/src/services/balance.service.test.ts` (multiple lines)  
**Severity:** Low (test code only)  
**Type:** Non-null assertions without null guards

**Examples:**
- Line 67: `expect(account!.balance).toBe(700);` — account fetched without null check
- Line 143: `const origOrder = saved!.displayOrder;` — saved transaction not checked
- Line 188: `expect(src!.balance).toBe(800);` — accounts retrieved but not validated

**Problem:**  
While test code is less critical, these assertions indicate a pattern: assumptions that database queries never fail. If they do fail silently, tests will crash with unclear error messages instead of failing gracefully.

**Recommendation:**  
Add assertions before using non-null assertions:
```typescript
const account = await db.accounts.get(id as number);
expect(account).toBeDefined();
expect(account!.balance).toBe(700);
```

---

## 3. Unhandled Promise Rejections in React Components

### Issue 3.1: Fire-and-forget database queries in `TransactionInput.tsx`
**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx:1898–1900`  
**Severity:** High  
**Type:** Unhandled promise rejection

```typescript
// Lines 1898–1900
db.accounts.get(existingTx.toAccountId).then((dest) => {
  if (dest) setToAccount(dest);
});
```

**Problem:**  
Promise chain has no `.catch()` handler. If the database query fails, the rejection is unhandled. No error is logged, and the component state is inconsistent (user sees blank destination account).

**Risk:**  
- Silent failures in editing debt payments
- Unhandled rejection warnings in dev console
- User confusion: form shows incomplete data

---

### Issue 3.2: Promise chain without error handling at lines 1915–1921
**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx:1911–1921`  
**Severity:** High  
**Type:** Unhandled promise rejection

```typescript
// Lines 1911–1921
db.transactions
  .where("transferGroupId")
  .equals(existingTx.transferGroupId)
  .toArray()
  .then((records) => {
    const other = records.find((r) => r.id !== existingTx.id);
    if (other) {
      const dest = allAccounts.find((a) => a.id === other.accountId);
      if (dest) setToAccount(dest);
    }
  });
```

**Problem:**  
Loading the transfer partner account has no error handler. If the database query fails, the UI inconsistency is silent.

**Risk:**  
- Form renders incomplete when editing transfers
- No error feedback to user

---

### Issue 3.3: Empty catch block swallows errors at line 1999
**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx:1998–1999`  
**Severity:** Medium  
**Type:** Silent error swallowing

```typescript
// Lines 1998–1999
.catch(() => {});
```

**Problem:**  
Exchange rate fetch failure is silently ignored. The `toSecondaryAmount` field is not updated, leaving it stale or blank. No error is logged or communicated.

**Risk:**  
- Silent data inconsistency
- User doesn't know conversion rate is unavailable
- Difficult to debug rate-related issues

**Recommendation:**  
```typescript
.catch((err) => {
  console.warn('Failed to fetch exchange rate:', err);
  setToSecondaryAmount('');
  // Optionally show warning toast
});
```

---

### Issue 3.4: Unsafe async callback in `setAutoBackupSchedule`
**File:** `/home/anton/Project/expensesapp/src/services/backup.service.ts:134–141`  
**Severity:** Medium  
**Type:** Unhandled async operation errors

```typescript
// Lines 134–141
this._autoBackupIntervalId = setInterval(
  () =>
    void (async () => {
      await this.createBackup(true);
      await db.settings.put({ key: 'lastAutoBackupAt', value: new Date().toISOString() });
    })(),
  intervalHours * 3_600_000,
);
```

**Problem:**  
The async IIFE has no `.catch()` handler. If `createBackup()` or the settings update fails, the error is unhandled and periodic backup silently fails. No logging or retry mechanism.

**Risk:**  
- Silent backup failures (user unaware)
- No audit trail of when backups succeeded/failed

**Recommendation:**  
```typescript
() =>
  void (async () => {
    try {
      await this.createBackup(true);
      await db.settings.put({ key: 'lastAutoBackupAt', value: new Date().toISOString() });
    } catch (err) {
      console.error('Auto backup failed:', err);
      // Optionally emit event or log to analytics
    }
  })()
```

---

### Issue 3.5: Promise chains in `TransactionInput.tsx` useEffect (lines 1945–1959, 1992–1999)
**File:** `/home/anton/Project/expensesapp/src/components/transactions/TransactionInput.tsx:1945–1959, 1992–1999`  
**Severity:** Medium  
**Type:** Race conditions and unhandled rejections in effects

```typescript
// Lines 1945–1959: exchangeRateService call without proper cleanup
exchangeRateService
  .getRate(account.currency, mainCurrency)
  .then((rate) => { ... })
  .catch(() => {
    setNoRateWarning(true);
    setSecondaryAmount(String(amount / 100));
  });
```

**Problem:**  
The promise is not cancelled if the component unmounts or dependencies change before the promise resolves. This causes state updates on unmounted components (memory leak + warning in dev).

**Risk:**  
- React warnings: "Can't perform a React state update on an unmounted component"
- Memory leaks if many promise chains are created but never cleaned up

**Recommendation:**  
Use an abort controller or mutable ref to cancel pending requests:
```typescript
useEffect(() => {
  let isMounted = true;
  
  exchangeRateService
    .getRate(account.currency, mainCurrency)
    .then((rate) => {
      if (!isMounted) return;
      // update state
    })
    .catch(() => {
      if (!isMounted) return;
      // handle error
    });
    
  return () => {
    isMounted = false;
  };
}, [numpadValue, account, mainCurrency, secondaryManual]);
```

---

## 4. Missing Error Context in Services

### Issue 4.1: Generic catch-all in `integrity.service.ts`
**File:** `/home/anton/Project/expensesapp/src/services/integrity.service.ts:15–17`  
**Severity:** Low  
**Type:** Loss of error context

```typescript
// Lines 15–17
catch (err) {
  return { ok: false, error: err instanceof Error ? err.message : 'Unknown database error' };
}
```

**Problem:**  
The catch block loses the error stack trace. Debugging database corruption becomes harder because we only get the message, not the full context.

**Recommendation:**  
Preserve more context for dev debugging:
```typescript
catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown database error';
  if (import.meta.env.DEV) console.error('Database integrity check failed:', err);
  return { ok: false, error: message };
}
```

---

### Issue 4.2: Generic error message in export service
**File:** `/home/anton/Project/expensesapp/src/services/export.service.ts:121–124`  
**Severity:** Low  
**Type:** Silent error swallowing

```typescript
// Lines 121–124
catch (err) {
  if (import.meta.env.DEV) console.error('Export failed:', err);
  throw err;
}
```

**Problem:**  
Error is logged in dev but original error message is re-thrown. If this happens in production, users see the generic browser error page with no helpful message.

**Recommendation:**  
Wrap the error with context:
```typescript
catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (import.meta.env.DEV) console.error('Export failed:', err);
  throw new Error(`Export failed: ${message}`);
}
```

---

## 5. Test-Only Type Assertions

### Issue 5.1: `as any` casts in test files
**File:** `/home/anton/Project/expensesapp/src/services/export.service.test.ts:76, 266`  
**Severity:** Low (test only)  
**Type:** Type unsafety in mocks

```typescript
// Line 76
vi.mocked(db.transactions.where).mockReturnValue(mockTxQuery as any);

// Line 266
expect(vi.mocked(document.createElement as any).mock.results[0].value.click)
```

**Problem:**  
`as any` in tests often hides type incompatibilities that should be caught by proper mocking. Makes tests less reliable as type safety checks.

**Recommendation:**  
Use proper mock types or `satisfies` constraint:
```typescript
vi.mocked(db.transactions.where).mockReturnValue(mockTxQuery as ReturnType<typeof db.transactions.where>);
```

---

## 6. Type Narrowing Gaps

### Issue 6.1: String comparison for transaction types without narrowing
**File:** Multiple component and service files  
**Severity:** Low  
**Type:** Type narrowing opportunity

**Pattern observed:**
```typescript
if (tx.type === 'TRANSFER' && tx.transferGroupId) {
  // use tx.transferGroupId
}
```

**Problem:**  
While this works, it doesn't establish a type guard. TypeScript doesn't narrow `tx` to a type where `transferGroupId` is guaranteed non-null. This is more a maintainability issue than a bug.

**Recommendation:**  
Create a discriminated union type guard:
```typescript
function isTransfer(tx: Transaction): tx is Transaction & { transferGroupId: string } {
  return tx.type === 'TRANSFER' && tx.transferGroupId != null;
}

if (isTransfer(tx)) {
  // Now TypeScript knows transferGroupId is non-null
  const groupId = tx.transferGroupId;
}
```

---

## 7. Error Handling Consistency Summary

| Service | Throws Typed Errors | Returns Result Objects | Logs Errors | Re-throws w/ Context |
|---------|-------------------|------------------------|------------|----------------------|
| balance.service.ts | ✅ (Error with message) | ❌ | ❌ | ❌ (wrapped via wrapQuotaError) |
| backup.service.ts | ✅ (Error with context) | ❌ | ❌ | ❌ |
| export.service.ts | ✅ (Error) | ❌ | ⚠️ (DEV only) | ⚠️ (re-throws original) |
| integrity.service.ts | ❌ | ✅ (ok/error object) | ⚠️ (DEV only) | N/A |
| notification.service.ts | ❌ (silent fail on permission) | ❌ | ❌ | N/A |
| exchange-rate.service.ts | ✅ (Error) | ❌ | ❌ | ✅ (graceful fallback) |

**Pattern:** Services throw errors, but React components sometimes don't handle them properly.

---

## Recommendations (Prioritized)

### P0 (High Priority - Fix Soon)
1. **Add `.catch()` handlers** to fire-and-forget database queries in TransactionInput.tsx (lines 1898, 1915)
2. **Cancel pending promises** on unmount in useEffect hooks to prevent state-update-on-unmounted-component warnings
3. **Add error logging** to `setAutoBackupSchedule` async callback in backup.service.ts

### P1 (Medium Priority - Fix in Next Sprint)
4. Add type guard for `mainCurrency` setting in exchange-rate.service.ts
5. Implement proper type-guarded validation for backup restoration casts
6. Replace empty `.catch(() => {})` with proper error handling or logging
7. Add dev-only logging to integrity checks

### P2 (Low Priority - Refactoring)
8. Create type guards for discriminated unions (Transaction type narrowing)
9. Extract validation functions with type guards for safer casts
10. Audit remaining `.then()/.catch()` chains for proper error boundaries

---

## Conclusion

The codebase is **generally well-typed** with strict mode enabled. The main issues are:
- **Unhandled promise rejections** in React components (higher risk)
- **Unsafe type assertions** in settings and backup restoration (medium risk)
- **Missing error context** in some catch blocks (lower risk)

All issues are fixable with straightforward refactoring. No deep architectural changes needed.

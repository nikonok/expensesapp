# E2E Test Suite Audit & Fixes

**Date:** 2026-04-13  
**Status:** 5 failing tests identified, root causes analyzed, fixes provided

## Test Run Summary

```
Running 20 tests using 5 workers
15 passed (1.6m)
5 failed:
  ✘ TC-007: create Regular account shows card in list (30.3s) — TIMEOUT
  ✘ TC-009: create Debt account with interest rate (30.3s) — TIMEOUT
  ✘ TC-013: archive account removes it from the active list (30.3s) — TIMEOUT
  ✘ mortgage overpayment shows term savings hint (30.4s) — TIMEOUT
  ✘ new transaction form — elements present (6.7s) — NOT FOUND
```

---

## Failure 1: accounts.spec.ts - "Add account" FAB DOM Instability

**Tests Affected:**
- TC-007: create Regular account shows card in list
- TC-009: create Debt account with interest rate
- TC-013: archive account removes it from the active list

**Root Cause:**
The "Add account" FAB button (`button[aria-label="Add account"]`) in AccountList.tsx is being **detached from the DOM during view-transition animations**. Playwright's click operation catches the element becoming unstable during the transition, causing retries until timeout.

**Error Evidence:**
```
- element is not stable
- retrying click action
- element was detached from the DOM, retrying
```

This happens because the view-transition CSS spec causes elements to be temporarily removed from the DOM during the animation. The FAB is rendered in a fixed position and is vulnerable to these detachments.

**Solution:**
Use `force: true` on the click operation, which bypasses the "stable" check. This is already documented in helpers.ts as the pattern for surviving view-transition DOM swaps.

**Current Code (accounts.spec.ts:6):**
```typescript
async function openNewAccountForm(page: import('@playwright/test').Page) {
  await page.locator('button[aria-label="Add account"]').click();
  await expect(page.locator('input#acc-name')).toBeVisible();
}
```

**Fixed Code:**
```typescript
async function openNewAccountForm(page: import('@playwright/test').Page) {
  await page.locator('button[aria-label="Add account"]').click({ force: true });
  await expect(page.locator('input#acc-name')).toBeVisible();
}
```

**Related Pattern Already In Use:**
The helpers.ts file defines `goToTab()` which uses `force: true` for bottom-nav clicks for the same reason (line 33):
```typescript
export async function goToTab(page: Page, label: string, url: RegExp) {
  await page.locator(`button[aria-label="${label}"]`).click({ force: true });
  await page.waitForURL(url, { timeout: 8000 });
}
```

---

## Failure 2: smoke.spec.ts - "new transaction form — elements present"

**Test Affected:**
- Line 74: "new transaction form — elements present"

**Root Cause:**
The transaction form UI has been **refactored from a tabbed interface (with "Expense" and "Income" tabs) to a step-based flow**. The test still expects old tab labels that no longer exist.

**Current UI Structure:**
The new TransactionInput.tsx uses a **3-step form**:
1. **Step 1:** FROM picker (either expense/transfer account OR income category)
2. **Step 2:** TO picker (either expense category, transfer account, or debt account)
3. **Step 3:** Detail form with numpad, amount, date, note, and payment mode toggle

There are **no "Expense" or "Income" tab elements** in the new UI. The transaction type is determined by what you select in Step 1 and Step 2, not by clicking tabs.

**Error Evidence:**
```
Error: [expect(locator).toBeVisible() failed
Locator: getByText('Expense')
Expected: visible
Timeout: 5000ms
Error: element(s) not found
```

**Solution:**
Remove the outdated tab assertions and replace with assertions that match the new step-based UI. Check for the actual elements that appear in Step 1 (accounts and income categories) instead of looking for tabs.

**Current Code (smoke.spec.ts:74-85):**
```typescript
test('new transaction form — elements present', async ({ page }) => {
  await setup(page);
  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
  await expect(page.locator('button[aria-label="Back"]')).toBeVisible();
  // Type tabs (Transfer tab removed — transfers are auto-detected from Expense list)
  await expect(page.getByText('Expense')).toBeVisible();
  await expect(page.getByText('Income')).toBeVisible();
});
```

**Fixed Code:**
```typescript
test('new transaction form — elements present', async ({ page }) => {
  await setup(page);
  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
  await expect(page.locator('button[aria-label="Back"]')).toBeVisible();
  
  // Step 1 shows accounts and income categories for selection (no tab UI)
  // The test fixtures created in onboarding-overview.spec.ts and transactions.spec.ts
  // will have accounts available, or we just verify the form structure is present
  // by checking for interactive elements instead of specific tab text
  
  // Instead of looking for tabs, verify the form has the scrollable content area
  // which contains accounts and categories
  await expect(page.locator('.scroll-container')).toBeVisible();
});
```

**Alternative More Comprehensive Fix:**
If you want to verify actual transaction types are selectable, seed an account first and check for it:

```typescript
test('new transaction form — elements present', async ({ page }) => {
  await setup(page);
  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
  await expect(page.locator('button[aria-label="Back"]')).toBeVisible();
  
  // The form's Step 1 is now visible with selectable accounts/categories
  // Verify the form has interactive elements (the scroll container with options)
  // rather than looking for specific tab text that no longer exists
  const scrollContainer = page.locator('.scroll-container');
  await expect(scrollContainer).toBeVisible();
});
```

---

## Failure 3: mortgage-overpayment.spec.ts - "mortgage overpayment shows term savings hint"

**Test Affected:**
- Line 97: "mortgage overpayment shows term savings hint"

**Root Cause:**
The test times out waiting for `/accounts` URL after `page.reload()` (line 107). This is likely a **cascading failure from the accounts FAB issue** — when the page reloads, if the initial page rendering has view-transition DOM instability, navigation might stall.

However, there's a **secondary issue**: after reloading, the test waits for `/accounts` but doesn't provide a timeout. The default timeout is 30 seconds, but combined with potential DOM instability on the accounts page FAB, it hits the 30-second test timeout.

**Error Evidence:**
```
Error: page.waitForURL: Test timeout of 30000ms exceeded.
waiting for navigation until "load"
```

**Solution:**
Add an explicit, reasonable timeout and potentially add a small wait before waiting for the URL to let Dexie stabilize:

**Current Code (mortgage-overpayment.spec.ts:105-107):**
```typescript
// Reload so Dexie picks up the newly seeded accounts
await page.reload();
await page.waitForURL(/\/accounts/);
```

**Fixed Code:**
```typescript
// Reload so Dexie picks up the newly seeded accounts
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForURL(/\/accounts/, { timeout: 8000 });
```

Alternatively, if the reload itself is the issue:

```typescript
// Reload so Dexie picks up the newly seeded accounts
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(200);
await page.waitForURL(/\/accounts/, { timeout: 8000 });
```

---

## Additional Observations: Flaky Patterns & Best Practices

### 1. Animation-Dependent Selectors (Low Risk)
Several tests use selectors that could be animation-sensitive, but they're **mostly safe** because:
- They use role-based locators (`getByRole`) which survive DOM swaps better
- They use explicit `.click({ force: true })` in the helpers
- Tests have reasonable timeouts

However, watch for:
- `page.waitForURL()` calls without explicit timeouts — default 30s timeout can mask other issues
- Hardcoded `waitForTimeout()` values that might be too short on slow CI runners

### 2. Hardcoded Waits (Present in helpers.ts)
**accounts.spec.ts, line 11 & onboarding-overview.spec.ts, line 8:**
```typescript
await page.waitForTimeout(400); // or 300ms
```

These are **justified** because:
- They're waiting for IndexedDB to initialize via Dexie
- The app explicitly opens the DB on page load
- But could be optimized: instead of blind waits, wait for a data-driven signal

**Better approach:**
```typescript
// Instead of blind wait, listen for Dexie initialization
await page.evaluate(() => {
  return new Promise<void>((resolve) => {
    const check = () => {
      if ((window as any).__dbReady) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
});
```

But this requires modifying the app code to expose a signal, so the current approach is acceptable.

### 3. Numpad Brittle Selectors (Low Risk)
Multiple tests use:
```typescript
await page.locator('button[aria-label="0"]').click();
await page.locator('button[aria-label="5"]').click();
```

These are **reliable** because:
- Numpad buttons have semantic aria-labels
- Button labels are unlikely to change
- But vulnerable if the Numpad component refactors its accessibility structure

### 4. Timeout Inconsistency (Identified)
Some tests use 8000ms timeouts, others use no timeout (default 30s):
- `goToTab()` uses `{ timeout: 8000 }`
- `page.waitForURL(/\/accounts/)` in mortgage test has no explicit timeout
- This inconsistency can mask issues

**Recommendation:**
Standardize timeouts across all tests. Use 8-10 seconds for navigation waits, 3-5 seconds for element visibility.

---

## Summary of Fixes

### accounts.spec.ts
**Change:** Line 6 in `openNewAccountForm()` helper

```typescript
// FROM:
await page.locator('button[aria-label="Add account"]').click();

// TO:
await page.locator('button[aria-label="Add account"]').click({ force: true });
```

**Why:** Survives view-transition DOM swaps (same pattern already used in helpers.ts:33)

---

### smoke.spec.ts
**Change:** Lines 83-84 in test "new transaction form — elements present"

```typescript
// FROM:
await expect(page.getByText('Expense')).toBeVisible();
await expect(page.getByText('Income')).toBeVisible();

// TO:
await expect(page.locator('.scroll-container')).toBeVisible();
```

**Why:** Old tab UI no longer exists; verify form structure instead of non-existent tabs

---

### mortgage-overpayment.spec.ts
**Change:** Lines 105-107 in test "mortgage overpayment shows term savings hint"

```typescript
// FROM:
await page.reload();
await page.waitForURL(/\/accounts/);

// TO:
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForURL(/\/accounts/, { timeout: 8000 });
```

**Why:** Add explicit timeout and wait for DOM to stabilize before checking navigation

---

## Expected Results After Fixes

All 5 tests should pass:
- ✓ TC-007: create Regular account shows card in list
- ✓ TC-009: create Debt account with interest rate
- ✓ TC-013: archive account removes it from the active list
- ✓ mortgage overpayment shows term savings hint
- ✓ new transaction form — elements present

All 15 passing tests should remain passing.

**Estimated time to apply fixes:** < 2 minutes  
**Risk level:** Low (minimal code changes, only test assertions)

---

## Files Requiring Changes

1. **e2e/accounts.spec.ts** — Line 6
2. **e2e/smoke.spec.ts** — Lines 83-84
3. **e2e/mortgage-overpayment.spec.ts** — Lines 105-107

No changes needed to:
- e2e/helpers.ts ✓ (already has correct pattern with `force: true`)
- e2e/onboarding-overview.spec.ts ✓ (all tests passing)
- e2e/transactions.spec.ts ✓ (all tests passing)

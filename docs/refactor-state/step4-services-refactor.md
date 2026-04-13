# Step 4 — Services Layer Refactoring Audit

## balance.service.ts

### Duplication
**Location**: Lines 47-48, 72-73, 97-98 (repeated 8+ times)
**Issue**: Every function repeats `await db.accounts.get()` + identical null check + error throw
**Suggested fix**: Extract `async getAccountOrThrow(id)` helper to avoid 8+ repetitions

### Long function
**Location**: Lines 88-141 — `replaceTransaction`
**Issue**: Heavy branching for account changes makes flow hard to follow
**Suggested fix**: Extract `updateSingleAccountDelta()` and `updateTwoAccountDeltas()` helpers

### Magic value
**Location**: Lines 54, 128, 187, 196, 300, 309 — displayOrder `-1` subtraction
**Issue**: `-1` appears 6 times without explanation
**Suggested fix**: Named constant `DISPLAY_ORDER_DECREMENT` with comment explaining descending ordering

### Duplication
**Location**: Lines 163-181 and 277-294 — transfer account update logic
**Issue**: Nearly identical code in `applyTransfer` and `replaceTransfer`
**Suggested fix**: Extract `updateTransferAccounts(outTx, inTx, delta)` helper

---

## backup.service.ts

### Long function
**Location**: Lines 174-255 — `_restoreData` (81 lines)
**Issue**: Handles validation for 6 tables plus DB restoration
**Suggested fix**: Extract `validateAndFilterTable(schema, data)` helper, loop through table definitions

### Duplication
**Location**: Lines 175-220 — validation pattern repeated 6 times
**Issue**: Filter + validate + error check copy-pasted for accounts/categories/transactions/budgets
**Suggested fix**: Schema map + loop replaces 6 repeated blocks

### Magic value
**Location**: Line 108 — `10 * 1024 * 1024`
**Issue**: File size limit hardcoded inline
**Suggested fix**: `private static readonly MAX_IMPORT_FILE_SIZE_BYTES`

### Duplication
**Location**: Lines 138, 170 — auto-backup timestamp update
**Issue**: `db.settings.put({ key: 'lastAutoBackupAt', ... })` duplicated
**Suggested fix**: `private async updateLastBackupTime()` method

---

## debt-payment.service.ts

### Naming
**Location**: Lines 49, 53 in `calculateTermSaved` — variables `x`, `newX`
**Issue**: Cryptic mathematical variable names
**Suggested fix**: Rename to `paymentRatio` / `newPaymentRatio` with amortization formula comment

### Magic value
**Location**: Lines 11-12 — `/ 12` for monthly rate
**Issue**: Yearly-to-monthly conversion lacks explanation
**Suggested fix**: Add comment explaining annual-to-monthly conversion

### Dead code
**Location**: Lines 8-14 — `type !== "DEBT"` check in `getMonthlyRate`
**Issue**: Only ever called on debt accounts; the guard is unreachable in practice
**Suggested fix**: Remove type check or add comment explaining invariant

---

## exchange-rate.service.ts

### Duplication
**Location**: `getRate` (lines 108-141) vs `getHistoricalRate` (lines 160-169) — cache lookup
**Issue**: Cache lookup + stale check + refresh is nearly identical in both functions
**Suggested fix**: Extract `getOrRefreshCachedRates(baseCurrency, date?, fallback)` helper

### Long function
**Location**: Lines 101-148 — `getRate` with 4 nested try-catch levels
**Issue**: 4 nested try-catch blocks make the flow hard to trace
**Suggested fix**: Refactor into 3 steps: (1) try cache, (2) try refresh, (3) try fallback

### Type safety
**Location**: Lines 145-147 — rate validation after `deriveRate`
**Issue**: Could be clearer about null handling
**Suggested fix**: `isValidRate(rate): rate is number` type guard helper

---

## export.service.ts

### Long function
**Location**: Lines 10-125 — `exportTransactions` (110 lines)
**Issue**: Single function handles filtering, transfer pairing, formatting, and file download
**Suggested fix**: Split into `prepareTransactionData()`, `generateWorksheet()`, `downloadFile()`

### Duplication
**Location**: Lines 62, 78, 89-90 — repeated `accounts.find()` / `categories.find()` per row
**Issue**: O(n²) lookups in export loop
**Suggested fix**: Pre-build `Map<id, Account>` and `Map<id, Category>` before the loop

### Type safety
**Location**: Lines 74, 86, 102 — implicit any in `dataRows`
**Issue**: `(string | number)[][]` loses type information
**Suggested fix**: Define `type ExportRow = [string, string, ...]` and use it

### Error handling
**Location**: Lines 121-124 — catch block loses context
**Issue**: Re-thrown error has no context about what failed
**Suggested fix**: `throw new Error(\`Export failed: ${err instanceof Error ? err.message : 'unknown'}\`)`

---

## integrity.service.ts

### Naming
**Location**: Lines 3-18 — `checkDatabaseIntegrity`
**Issue**: Returns generic error, doesn't indicate which table failed
**Suggested fix**: Return `{ ok: boolean; failedTables?: string[]; error?: string }`

### Dead code/misleading
**Location**: Lines 5-12 — `.limit(1).toArray()` check
**Issue**: Only checks if tables are readable, not actual data integrity — function name is misleading
**Suggested fix**: Add comment: "table connectivity check, not deep validation"

---

## math-parser.ts

### Magic value
**Location**: Line 96 — `MAX_AMOUNT = 99_999_999_999`
**Issue**: Origin of value is unclear
**Suggested fix**: Add comment: `// ~999,999,999.99 in major units (99 billion cents max)`

### Complexity
**Location**: Lines 43-53 — redundant token validation
**Issue**: start/end number checks are already guaranteed by tokenization logic
**Suggested fix**: Remove redundant checks; keep only alternation check

### Type safety
**Location**: Line 80 — unsafe cast `as { type: 'num'; value: number }`
**Issue**: TypeScript can't narrow after the guard on line 79
**Suggested fix**: Use explicit narrowing function or typed assertion

---

## notification.service.ts

### Error handling
**Location**: Line 5 — `time.split(':').map(Number)`
**Issue**: Silently fails with NaN if time is not "HH:MM" format
**Suggested fix**: `if (isNaN(h) || isNaN(m)) throw new Error('Invalid time format: expected HH:MM')`

### Dead code
**Location**: Lines 12, 20 — `clearTimeout(this.timeoutId ?? undefined)`
**Issue**: `?? undefined` is redundant; `clearTimeout` accepts `undefined` natively
**Suggested fix**: `clearTimeout(this.timeoutId)`

### Type safety / reliability
**Location**: Line 24 — `sendNotification` doesn't check for Notification API existence
**Issue**: Crashes on browsers without Notification API support
**Suggested fix**: `if (typeof Notification === 'undefined') return`

### Magic value
**Location**: Line 26 — `/icons/icon-192.png` hardcoded
**Issue**: Icon path change would break silently
**Suggested fix**: `private static readonly NOTIFICATION_ICON = '/icons/icon-192.png'`

---

## Priority Summary

**High Impact:**
1. `balance.service.ts`: Extract `getAccountOrThrow()` (8+ repetitions eliminated)
2. `backup.service.ts`: `_restoreData` table loop (81 lines → ~30)
3. `export.service.ts`: Split + Map lookups (O(n²) → O(n), cleaner structure)

**Medium Impact:**
1. `exchange-rate.service.ts`: Cache lookup extraction (reduces nesting depth)
2. `notification.service.ts`: Input validation + Notification API guard
3. `debt-payment.service.ts`: Rename cryptic math variables

**Low Impact (housekeeping):**
1. Magic value constants
2. `clearTimeout` redundant `?? undefined`
3. `integrity.service.ts` comment clarity

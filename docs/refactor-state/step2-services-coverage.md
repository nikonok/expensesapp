# Step 2 — Services Test Coverage Audit

## balance.service.ts

### Missing coverage
- `wrapQuotaError`: Never tested; no tests for QuotaError catching or propagation
- `getMinDisplayOrder`: Edge cases like multiple transactions with identical displayOrder not validated
- `replaceTransaction` with account change: Concurrent updates edge case missing
- `applyTransfer` with same account: Edge case for self-transfers mentioned in code but not explicitly tested
- Missing account error path: Tests don't verify error message content or type thrown
- Database transaction rollback: No tests for Dexie transaction rollback if validation fails mid-transaction

### Shallow/fragile tests
- Tests use mock in-memory data only; no transaction isolation validation
- Balance calculations verified only with small numbers; overflow/underflow boundary cases missing
- displayOrder tests only verify relative ordering, not exact formula (min-1)

### Recommended new tests
- QuotaError is thrown and wrapped correctly when IndexedDB quota exceeded
- replaceTransaction correctly updates balances when account changes
- Self-transfer (same account) is handled without double-counting

---

## backup.service.ts

### Missing coverage
- `validateBackupStructure`: Has no direct test; relies on integration tests
- `_restoreData` partial validation: Backup with mixed valid/invalid rows not tested
- `setAutoBackupSchedule` with value 0 or negative
- `checkAndRunAutoBackup` with malformed settings (null, non-number intervalHours)
- Actual database transaction atomicity during restore not validated
- Race condition: Two backups created in quick succession (pruning behavior)

### Shallow/fragile tests
- Mock file.text() and file.size don't simulate real File behavior edge cases
- Date comparisons use exact timestamps; DST/timezone edge cases not covered

### Recommended new tests
- Partial/corrupt backup file is rejected with clear error message
- checkAndRunAutoBackup skips gracefully when settings are malformed

---

## debt-payment.service.ts

### Missing coverage
- `calculateMortgagePayment`: **NO TESTS AT ALL** — entire function untested
- `calculateTermSaved`: **NO TESTS AT ALL** — entire function untested
- `getMonthlyRate` with null mortgage rate and both yearly/monthly null simultaneously
- Negative interest rates not validated
- `calculatePaymentSplit` with very large numbers (MAX_AMOUNT)

### Recommended new tests
- calculateMortgagePayment returns correct monthly payment for standard mortgage
- calculateMortgagePayment handles edge case: 0% rate
- calculateMortgagePayment handles edge case: 0 term
- calculateTermSaved returns correct months saved for extra payment
- calculateTermSaved returns 0 when extra payment = 0

---

## exchange-rate.service.ts

### Missing coverage
- Invalid currency codes (3-letter validation): malformed codes (AA, USDA) not tested
- API response with `rates: null`
- `getRate` with currency not in rates dict: Returns null but no test
- `deriveRate` with division by zero (rFrom === 0)
- `recalculateAllMainCurrencyAmounts` failure partway through batch
- Rate pruning at exactly 90-day cutoff not validated

### Shallow/fragile tests
- Mocks db completely; no integration with real Dexie
- Progress callback tested but doesn't validate exact percentages

### Recommended new tests
- getRate returns null for unknown currency code
- deriveRate guards against division by zero
- recalculateAllMainCurrencyAmounts calls progress at expected intervals

---

## export.service.ts

### Missing coverage
- Transfer with missing partner leg (transferGroupId set but partner tx deleted)
- Empty date range (startDate > endDate): Behavior undefined, no test
- Transactions with `isTrashed: undefined` vs `isTrashed: null`
- Multiple transfers with same groupId (malformed data)
- XLSX write failure: No test for error in dynamic import

### Shallow/fragile tests
- Mocks XLSX completely; doesn't validate actual XLSX structure
- Formula injection only tests `=`, `+`, `-`; `@` not tested (CSV injection vector)
- Date formatting tested only with valid dates; invalid dates pass through

### Recommended new tests
- Export skips orphaned transfer leg without crashing
- @ prefix is sanitized in formula injection check
- Empty date range produces empty XLSX without error

---

## integrity.service.ts

### Missing coverage
- Partial failures: Only first table read failure tested; mixed success/failure not tested
- Database locked/timeout scenarios
- Specific error types: Catches all errors but doesn't validate specific error codes

### Shallow/fragile tests
- Only mocks one table failure; doesn't test cascading failures
- Error message content not validated (just checks it exists)

### Recommended new tests
- Returns error when only one of multiple tables fails to read
- Returns error object with meaningful message property

---

## math-parser.ts

### Missing coverage
- Very large numbers (10000×10000): No overflow/precision tests
- Decimal handling: `100.50+50.25` or `0.01+0.02`
- Negative input: `-5` or `-10+5`
- Whitespace between operators: `100 + 50`
- Multiple consecutive operators: `100++50`
- Unicode normalization: Mixed ASCII/unicode operators
- Leading zeros: `0100+50` behavior not defined

### Recommended new tests
- `100.50+50.25` evaluates to correct minor-unit result
- Multiple consecutive operators return null/invalid
- Whitespace-padded expressions evaluate correctly

---

## notification.service.ts

### Missing coverage
- **NO TESTS EXIST** — entire service untested
- `scheduleDailyReminder`: time calculation, target scheduling
- `cancelDailyReminder`: timeout cleanup verification
- `sendNotification`: permission check, Notification API call
- `requestPermission`: Notification.requestPermission() integration
- Reminder scheduled in past (current time > scheduled time)
- Cancel called multiple times (already-cleared timeout)
- Notification when permission === 'denied' (should be no-op)
- Browser doesn't support Notification API

### Recommended new tests
- scheduleDailyReminder calculates correct ms delay to next occurrence
- cancelDailyReminder clears the scheduled timeout
- sendNotification is a no-op when permission is 'denied'
- requestPermission resolves to 'granted' / 'denied' / 'default' correctly

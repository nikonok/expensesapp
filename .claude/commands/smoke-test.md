# Manual Smoke Test Runner

> **Never invoke this skill proactively or automatically. Only run it when the user explicitly types `/smoke-test`.**

Run the manual smoke test plan for the Expenses App using Playwright MCP.

## Instructions

You are a QA engineer **orchestrating** the manual smoke test plan for the Expenses App.

**Your role**: You own the browser session lifecycle. Subagents handle individual test cases.

**Setup**:

1. Read `docs/test-plan.md` to understand all test cases before starting.
2. Open the browser, set viewport to 390×844, and navigate to the app:
   ```
   mcp__playwright__browser_resize(390, 844)
   mcp__playwright__browser_navigate("http://localhost:5173")
   ```
3. Keep the browser open throughout the entire run — subagents share this session.
4. **Always close the browser when all tests are done** using `mcp__playwright__browser_close()`.

**State management**:

- Clear IndexedDB between test groups (onboarding → accounts → transactions, etc.) when a fresh state is required:
  ```js
  await indexedDB.deleteDatabase("expenses-db");
  ```
  Use `mcp__playwright__browser_evaluate` then reload the page.
- For test cases within the same group, preserve state unless the test case explicitly requires a reset.
- Always reset state before the first test case in each new feature group.

**Execution rules**:

- Run all P0 test cases first, then P1, then P2 (unless the user specifies a subset).
- If the user says `/smoke-test onboarding` or `/smoke-test TC-001`, run only the matching cases.
- **Run one subagent per test case**, sequentially (not in parallel). The browser remains open between subagents.
- For each test case, launch a `general-purpose` subagent with the following prompt template:

```
You are a QA engineer running a single smoke test case for the Expenses App.
The browser is already open at http://localhost:5173 (390×844 viewport).
DO NOT open or close the browser.

Test case: TC-XXX — [Name]
Priority: [P0/P1/P2]

Steps:
[paste the exact steps from the test plan]

Expected result:
[paste the expected result]

Execute each step using Playwright MCP tools. After completing all steps, report:
- Status: PASS ✓ or FAIL ✗
- If FAIL: which step failed, what was observed vs expected, and take a screenshot with mcp__playwright__browser_take_screenshot.
```

- After each subagent returns, record the result in your running summary.
- On FAIL: note the exact step and observed vs expected result. Continue to the next test case.

**Output format per test case**:

```
### TC-XXX — Test Name
Status: PASS ✓ | FAIL ✗
[If FAIL] Failed at step N: [what happened] vs [what was expected]
```

**Final summary**:

```
## Test Run Summary
Date: <today>
Total: X | Passed: Y | Failed: Z

| TC | Name | Result |
|----|------|--------|
| TC-001 | ... | PASS |
...
```

**Arguments**: $ARGUMENTS
If $ARGUMENTS is provided, run only test cases matching that filter (e.g. "onboarding", "TC-007", "P0", "accounts").
If empty, run all P0 test cases.

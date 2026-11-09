# Step 13.4 — Outbox Automated Testing Guide

## 1. Overview & Test Runner Commands

The durable outbox test suite verifies persistence, concurrency fencing, state machine transitions, exponential backoff, rate limiting, error categorization, multi-tenant security, and financial prohibition rules.

### Running Outbox Tests

```bash
# Run all outbox-specific tests
npx vitest run tests/offline/

# Run individual test suites
npx vitest run tests/offline/outboxDatabase.test.ts
npx vitest run tests/offline/outboxLifecycle.test.ts
npx vitest run tests/offline/outboxConcurrency.test.ts
npx vitest run tests/offline/outboxRetry.test.ts
npx vitest run tests/offline/outboxSecurity.test.ts

# Run backward-compatibility outbox test
npx vitest run tests/offlineOutbox.test.ts

# Run the complete system test suite
npm test
```

---

## 2. Test Matrix & Coverage Details

The outbox test suite comprises **32 dedicated tests across 5 files** in `tests/offline/`, plus **3 backwards compatibility tests** in `tests/offlineOutbox.test.ts`:

### 2.1 Database & Persistence (`tests/offline/outboxDatabase.test.ts` - 7 Tests)

| Test Case | Scenario | Verification |
|---|---|---|
| `1.1` | Schema v3 upgrade | Verifies `outboxCommands` table and all compound indexes exist |
| `1.2` | Full metadata enqueue | Verifies 21 metadata fields populated on enqueue |
| `1.3` | Required fields validation | Enqueue throws `OutboxValidationError` when `userId` or `businessId` missing |
| `1.4` | Duplicate ID rejection | Direct collision on primary key `id` throws error |
| `1.5` | Idempotency deduplication | Re-enqueueing identical key + payload returns existing record |
| `1.6` | Idempotency payload conflict | Re-enqueueing identical key + different payload throws `OutboxConflictError` |
| `1.7` | Tenant & branch isolation | Querying commands filters strictly by `userId`, `businessId`, and `branchId` |

### 2.2 Lifecycle & State Machine (`tests/offline/outboxLifecycle.test.ts` - 5 Tests)

| Test Case | Scenario | Verification |
|---|---|---|
| `2.1` | Full lifecycle transition | Validates sequence: `pending` $\to$ `leased` $\to$ `sending` $\to$ `acknowledged` |
| `2.2` | Unknown schema version | Rejects command enqueue with unsupported version (`commandVersion: 99`) |
| `2.3` | Payload tampering detection | Detects raw record mutation in IndexedDB without hash match; rejects with `PAYLOAD_TAMPERED` |
| `2.4` | Command cancellation | Pending command transitions to `cancelled`; acknowledged command cannot be cancelled |
| `2.5` | Terminal state protection | Cancelled/rejected/acknowledged commands are never leased or dispatched |

### 2.3 Concurrency & Leases (`tests/offline/outboxConcurrency.test.ts` - 6 Tests)

| Test Case | Scenario | Verification |
|---|---|---|
| `3.1` | Batch lease acquisition | Claiming sets `leased`, populates `leaseToken`, and sets future `leaseExpiresAt` |
| `3.2` | Worker conflict prevention | Concurrent workers cannot claim same batch; second worker receives 0 claims |
| `3.3` | Abandoned lease recovery | When worker crashes, expired lease is reclaimed by next worker with new token |
| `3.4` | Active lease protection | Active unexpired lease prevents other workers from claiming across polling cycles |
| `3.5` | Mismatched lease token | Worker with stale or mismatched token cannot update command (`OutboxLeaseExpiredError`) |
| `3.6` | Expired lease token update | Worker cannot commit update if lease expired during processing |

### 2.4 Error Handling & Retries (`tests/offline/outboxRetry.test.ts` - 8 Tests)

| Test Case | Scenario | Verification |
|---|---|---|
| `4.1` | Network failure transition | Network error (`TypeError: Failed to fetch`) transitions to `retryable` |
| `4.2` | Exponential backoff growth | Verifies backoff cap doubles with each attempt ($1\text{s}, 2\text{s}, 4\text{s}, 8\text{s}$) |
| `4.3` | Backoff full jitter | Jitter distributes uniformly within $[500\text{ms}, \text{backoffCap}]$ |
| `4.4` | HTTP 429 Retry-After | Server-specified delay from `Retry-After` header overrides backoff algorithm |
| `4.5` | HTTP 5xx Server Error | Transient 503 error transitions command to `retryable` |
| `4.6` | Max attempts exceeded | After 5 failed attempts, transitions to `rejected` with `MAX_ATTEMPTS_EXCEEDED` without deletion |
| `4.7` | HTTP 409 Conflict | Version conflict transitions to `conflict` and pauses automatic retries |
| `4.8` | Conflict manual retry | Calling `retryConflict(id, newPayload)` resets status to `pending` and succeeds |

### 2.5 Security & Authorization (`tests/offline/outboxSecurity.test.ts` - 6 Tests)

| Test Case | Scenario | Verification |
|---|---|---|
| `5.1` | HTTP 401 Session Expiry | Unauthorized response transitions command to `blocked_auth` and halts execution |
| `5.2` | User switch isolation | Pending commands for User Alice are never dispatched under User Bob's session |
| `5.3` | Financial command prohibition | All 10 financial commands are forbidden in registry; cannot be registered as authorized |
| `5.4` | Dispatcher rejection | If a financial command is enqueued, dispatcher rejects it with `UNAUTHORIZED_COMMAND` |
| `5.5` | Unwhitelisted command types | Enqueueing unregistered arbitrary command types throws `OutboxValidationError` |
| `5.6` | Offline state skipping | When `navigator.onLine === false`, dispatcher immediately halts without claiming |

---

## 3. Test Environment & Simulation Mechanics

- **In-Memory IndexedDB**: Tests use `fake-indexeddb/auto` to provide deterministic, isolated IndexedDB storage across test runs.
- **Clock & Global Mocks**: `vi.stubGlobal('navigator', ...)` simulates network connectivity transitions.
- **Crypto & Hashing**: Web Crypto `crypto.subtle.digest('SHA-256', ...)` is exercised in Node.js environment to guarantee exact cross-platform cryptographic parity.


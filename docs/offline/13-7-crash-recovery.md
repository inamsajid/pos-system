# Step 13.7 — Crash Recovery & Lease Expiry Protocol

## 1. Crash Scenarios & Defenses

A robust offline POS must withstand client crashes, tab closes, browser process kills, and power outages during any phase of execution:

| Failure Point | Potential Risk | Architectural Defense |
|---|---|---|
| **During Cart Checkout** | Half-written sale record | Dexie atomic transaction (`db.transaction('rw', ...)`). Either complete provisional record is written or nothing. |
| **During Outbox Dispatch** | Command locked indefinitely in `sending` state | Lease Token with 30-second TTL (`leaseExpiresAt`). Expired leases are automatically reclaimed on next dispatch. |
| **During Server Execution** | Partial DB writes (sale created but no invoice) | Atomic D1 batch. All 11 statements commit together or roll back completely on exception. |
| **After Server Commit, Before Response** | Lost response, potential duplicate sale | Server-side `idempotency_keys` table. Client retries with identical key and recovers cached response. |

---

## 2. The Lease Fencing Mechanism

To prevent race conditions where a slow network response overlaps with a retry:

1. When claiming commands, `outboxRepository.claimEligibleBatch` updates matching records:
   ```sql
   SET leaseToken = uuid(),
       leaseExpiresAt = now + 30 seconds,
       status = 'sending'
   ```
2. When the command finishes or fails, the update statement includes a lease check:
   ```typescript
   if (record.leaseToken !== currentLeaseToken) {
     // Another process has taken over the command; discard local result
     return;
   }
   ```
3. If the browser tab crashes or the process is killed while `status = 'sending'`, the lease expires after 30 seconds. On the subsequent dispatch cycle, `claimEligibleBatch` treats the command as eligible for re-claiming because `leaseExpiresAt < now`.


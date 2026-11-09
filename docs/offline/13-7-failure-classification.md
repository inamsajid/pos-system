# Step 13.7 — Failure Classification & Error Handling

## 1. Classification Matrix

Errors encountered during outbox dispatch are categorized into five deterministic failure types:

| HTTP Status / Error | Category | Outbox Transition | Backoff / Resolution |
|---|---|---|---|
| **408 Request Timeout** | `retryable` | `retryable` | Exponential backoff with full jitter. |
| **429 Too Many Requests** | `retryable` | `retryable` | Honors server `Retry-After` header if present. |
| **500 / 502 / 503 / 504** | `retryable` | `retryable` | Exponential backoff (base 1s, max 60s). |
| **Network / TypeError** | `retryable` | `retryable` | Exponential backoff until connection restored. |
| **401 Unauthorized** | `blocked_auth` | `blocked_auth` | Pauses dispatch; prompts cashier to re-authenticate. |
| **409 Conflict** | `conflict` | `conflict` | Stops automatic retry; requires version review. |
| **403 Forbidden** | `rejected` / `blocked_auth` | `rejected` | Tampered signature or revoked terminal -> permanent drop. |
| **422 Business Violation** | `reconciliation_required` | `reconciliation_required` | Overconsumed allocation quota -> operator review. |
| **Max Attempts Exceeded** | `terminal` | `rejected` | Exceeded 5 retry attempts -> operator review. |

---

## 2. Exponential Backoff with Full Jitter Formula

To avoid thundering-herd spikes on Cloudflare Workers when 50+ registers reconnect simultaneously:

$$\text{delay} = \min(\text{maxDelayMs}, \text{baseDelayMs} \times 2^{\text{attemptCount}})$$
$$\text{actualDelay} = \text{delay} \times (0.5 + 0.5 \times \text{random}())$$

- Base Delay: $1,000 \text{ ms}$ (1 second)
- Maximum Delay: $60,000 \text{ ms}$ (60 seconds)
- Maximum Retry Attempts: 5 attempts before marking `rejected` or `reconciliation_required`.

---

## 3. The `reconciliation_required` State

Unlike generic fatal errors, transactions marked `reconciliation_required` represent **valid physical cash sales completed in the real store** that cannot be automatically mapped to central records without human review.

Such records are NEVER deleted or purged automatically. They remain preserved in Dexie with their original timestamps, line items, and cash amounts, accessible through the Store Manager Reconciliation Console.


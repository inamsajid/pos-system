# Retry & Idempotency Policy for Offline Synchronization Outbox

## 1. Mathematical Backoff Algorithm

The outbox dispatcher calculates retry delays using bounded exponential backoff with full jitter to prevent thundering herd problems when an offline terminal reconnects:

$$t_{\text{backoff}} = \min\left(t_{\text{max}}, t_{\text{base}} \times 2^{\text{attemptCount}}\right)$$
$$t_{\text{delay}} = \text{random}(0, t_{\text{backoff}})$$

### Parameter Defaults:
- **Base delay ($t_{\text{base}}$)**: $1\,000\text{ ms}$ (1 second)
- **Maximum delay ($t_{\text{max}}$)**: $60\,000\text{ ms}$ (60 seconds)
- **Maximum attempts ($N_{\text{max}}$)**: $5\text{ attempts}$

### `Retry-After` Header Handling:
If the server responds with HTTP 429 Too Many Requests containing a `Retry-After` header (in seconds or RFC 2822 date), the dispatcher honors the server-specified delay:
```ts
nextAttemptAt = now + Math.max(retryAfterSeconds * 1000, 1000)
```

---

## 2. Categorized Error Handling

| HTTP / Error Category | Examples | Outbox State Transition | Retry Behavior |
|---|---|---|---|
| **Network Interruption** | `TypeError: Failed to fetch`, `ERR_CONNECTION_RESET` | `retryable` | Backoff with jitter, increment `attemptCount`. |
| **HTTP 408 / Timeout** | Gateway Timeout, Client Timeout | `retryable` | Backoff with jitter, increment `attemptCount`. |
| **HTTP 429 Rate Limit** | Too Many Requests | `retryable` | Honor `Retry-After` header if present. |
| **HTTP 5xx Server Error** | 500, 502, 503 Service Unavailable | `retryable` | Backoff with jitter, increment `attemptCount`. |
| **HTTP 401 Unauthorized** | Token expired, user logged out | `blocked_auth` | Pause processing until authenticated session restored. |
| **HTTP 409 Conflict** | Concurrency conflict, stale version | `conflict` | Hold for user manual resolution; do not auto-retry. |
| **HTTP 400 Bad Request** | Schema validation failure | `rejected` | Permanent terminal failure; record error code. |
| **HTTP 403 Forbidden** | RBAC permission denied | `rejected` | Permanent terminal failure; record error code. |
| **Max Retries Exceeded** | `attemptCount >= 5` | `rejected` | Mark rejected with `MAX_ATTEMPTS_EXCEEDED`. |

---

## 3. Idempotency Key Architecture

Every outbox command generates a stable idempotency key upon creation:
```ts
idempotencyKey = `idem_${commandType}_${crypto.randomUUID()}`
```

### Invariants:
1. **Key Stability**: The idempotency key is set when the command is created. It is **never** re-generated or modified across retries.
2. **Payload Binding**: If the user modifies any field in a draft, a completely new command with a new idempotency key must be created. The old key must never be used with different data.
3. **Payload Fingerprinting**: A deterministic SHA-256 hash of the canonical JSON payload is computed and stored as `payloadHash`. Before dispatch, the dispatcher validates that:
   $$\text{SHA256}(\text{canonical}(\text{payload})) == \text{record.payloadHash}$$
   If a discrepancy is detected (e.g. storage tampering or memory corruption), the command is aborted and marked `rejected`.


# Step 12.8 Operations and Monitoring Runbook

This runbook outlines operational procedures, logging conventions, and triage guidelines for system administrators and support engineers maintaining the Northstar POS platform.

---

## 1. Observability Architecture & Metrics

Northstar leverages native Cloudflare Workers Observability (Request Traces and Structured Logs) combined with SQLite-backed audit trails.

### 1.1 Request ID Tracing
Every request processed by the Worker API generates or propagates a unique UUID:
- Response Header: `X-Request-Id: <uuid>`
- Structured Log Prefix: `[RequestId: <uuid>]`
- Support Reference: Cashiers and store managers report this ID from error toast notifications to enable instant lookup in logs.

### 1.2 Redaction and PII Protection Rules
Logs MUST NEVER contain:
- Plaintext passwords or password hashes.
- Session tokens (`__session` cookie contents).
- Auth secrets or environment keys.
- Customer tax numbers or raw payment card details.

---

## 2. Real-Time Cloudflare Log Tail Inspection

Operators inspect live production Worker logs using Wrangler tail:
```bash
# Stream live production execution logs
wrangler tail --env production

# Filter specifically for 5xx errors
wrangler tail --env production --status error

# Filter for a specific request ID
wrangler tail --env production --search "<REQUEST_ID>"
```

---

## 3. Incident Triage Procedures

### 3.1 Investigating a Failed POS Checkout
- **Symptom**: Cashier encounters "Checkout transaction failed" error modal.
- **Immediate Action**:
  1. Verify the cashier's cart remains intact on screen (UI invariant POS-04).
  2. Ask cashier for the `X-Request-Id` displayed on the error notification.
  3. Filter logs: `wrangler tail --env production --search "<REQUEST_ID>"`.
  4. Inspect root cause:
     - **HTTP 409 (Stock Conflict)**: Another register completed a sale for the same item. Inspect shelf or allow supervisor override.
     - **HTTP 401/403 (Session/Branch Error)**: Cashier session expired or cashier switched to unauthorized branch. Re-authenticate cashier.
     - **HTTP 500 (D1 SQLite Lock)**: Transient lock conflict. Instruct cashier to tap "Retry" with unchanged cart (idempotency key ensures zero double-charge).

### 3.2 Investigating an Idempotency Conflict (HTTP 409)
- **Symptom**: User encounters `Idempotency key collision with different request payload`.
- **Root Cause**: The client generated an idempotency key and submitted a request, but then altered the items, total, or quantities before re-submitting with the same key.
- **Resolution**: Clear the cart or initiate a new checkout ticket to generate a fresh `Idempotency-Key` UUID.

### 3.3 Investigating a CPU Limit Alert (Error 1101)
- **Symptom**: Cloudflare reports `Worker exceeded CPU limit`.
- **Root Cause**: Authentication PBKDF2 hash computation exceeded the 10 ms CPU limit of Workers Free.
- **Resolution**: Verify that the account is subscribed to **Workers Paid** with the standard 30-second CPU execution model.

---

## 4. Database Maintenance & Audit Inspections

### 4.1 Inspecting Idempotency Keys
```sql
SELECT operation, idempotency_key, response_status, created_at 
FROM idempotency_keys 
WHERE business_id = ? 
ORDER BY created_at DESC 
LIMIT 50;
```

### 4.2 Inspecting Discrepant Stock Adjustments
```sql
SELECT sm.movement_number, sm.product_id, p.name, sm.type, sm.quantity_change, sm.created_at, sm.created_by
FROM stock_movements sm
JOIN products p ON sm.product_id = p.id
WHERE sm.business_id = ? AND sm.type IN ('adjustment_in', 'adjustment_out', 'stock_count_variance')
ORDER BY sm.created_at DESC 
LIMIT 50;
```

---

## 5. Escalation Contacts & Severity Levels
- **Severity 1 (Critical)**: POS register unable to process transactions across the store. (Response target: < 15 minutes).
- **Severity 2 (High)**: Individual branch unable to perform receiving or inventory adjustment. (Response target: < 1 hour).
- **Severity 3 (Low)**: Reporting or analytics delay. (Response target: Next business day).


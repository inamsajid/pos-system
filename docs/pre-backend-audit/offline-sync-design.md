# Offline and Multi-Device Synchronization Design

**Status: not implemented.** The manifest exists, but there is no service worker, installable PWA lifecycle, IndexedDB, outbox, sync protocol or conflict UI. localStorage is not an offline transaction system.

## Safe future boundary

- Cache catalog and business display settings read-only in IndexedDB with business/branch/version metadata.
- Queue only explicit user-approved commands with stable IDs and idempotency keys; retain exact payload, actor/device, local created time, business date, schema version and sync status.
- Server assigns canonical transaction timestamp/sequence. Client timestamps are metadata, not authority.
- On reconnect, post outbox entries in order; acknowledge only after server returns canonical resource and related movement/payment IDs.
- Make queue state durable before showing a transaction as saved offline. UI must distinguish local pending from server-committed receipts.
- Do not claim a transaction is accepted if the server has not validated it.

## Operations and online policy

| Operation | Offline policy | Conflict risk |
|---|---|---|
| Browse cached catalog/customer list | Read-only offline if cache is recent and scoped | Stale price/status/stock |
| Product/category/customer/supplier edits | Queue only if business policy allows; conflict by version; otherwise online only | Duplicate names, deleted/archived master |
| POS sale | Offline only with explicit risk policy and per-device stock reservation/limits; otherwise require online | Two terminals sell last unit; stale customer credit; pricing/discount changes |
| Customer/supplier payment | Prefer online-only until server validation; offline payment requires strong receipt sequence/reconciliation rules | Duplicate tender capture, stale receivable/payable, bank proof |
| Goods receiving/stock adjustment/count | Online-only recommended initially | Concurrent receipt, wrong purchase quantity, stale stock count |
| Reports/ledger | Cached read-only with as-of/synced-at label | Stale totals and balance display |

## Conflict rules

- Never last-write-wins financial or stock transactions.
- Server idempotency table is authoritative; device UUID + monotonic local counter can help create keys, but key must include a stable command UUID.
- Use optimistic version on mutable records and balance projections; on conflict return current state and require cashier/manager action.
- Stock cannot be reserved securely across devices while fully offline. If offline selling is allowed, cap each device’s sellable offline stock allocation and reconcile reservations on reconnect; unresolved conflict becomes a manager exception, not silent negative stock.
- Two devices collecting a payment must revalidate outstanding amount server-side. Same for purchase receiving and stock count.
- Preserve both local attempt and server outcome for audit; do not discard an uncertain command.

## Implementation dependencies

1. Finish server transaction/idempotency semantics.
2. Define device registration and user/business/branch identity.
3. Add IndexedDB schema and version migrations.
4. Add outbox/inbox and observable sync state.
5. Add conflict/retry/dead-letter UI and monitoring.
6. Test offline, duplicate submission, out-of-order response, browser restart, schema upgrade and simultaneous-device scenarios.

A PWA manifest alone does not provide offline storage or synchronization. Do not install a service worker until cache invalidation and rollback strategy are defined.


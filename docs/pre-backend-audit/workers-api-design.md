# Proposed Cloudflare Workers API Design

**Proposal only.** No Worker, endpoint, auth mechanism or binding was created. The current frontend API wrapper is unused and only /health is declared.

## Conventions

- Version under /api/v1. JSON request/response envelopes; RFC 3339 UTC timestamps and ISO business dates.
- Authenticate first. Derive businessId, branchId, userId and role from verified session/token and membership, never from caller-trusted fields.
- Use opaque stable IDs. List responses support cursor pagination, bounded page size, filters, and explicit sort keys.
- Mutations validate with shared schemas server-side and return structured field errors. Keep API DTOs separate from database rows.
- Require Idempotency-Key for sale completion, customer/supplier payment, goods receipt and stock adjustment. Store request hash and resulting resource in same D1 transaction.
- Return canonical resource plus version/updatedAt; use If-Match/version for edits to avoid lost updates.

## Proposed endpoints

### Auth and business context
- POST /api/v1/auth/login; POST /logout; GET /me
- GET /api/v1/businesses; GET /businesses/:businessId/branches
- Membership and role mutation endpoints are owner/admin only and audited.

### Catalog
- GET/POST /products; GET/PUT/POST archive /products/:id
- GET/POST /categories; GET/PUT/archive /categories/:id
- GET/POST /customers; GET/PUT/archive /customers/:id
- GET/POST /suppliers; GET/PUT/archive /suppliers/:id
- GET/PUT /suppliers/:id/products and /products/:id/suppliers for many-to-many supplier association management.

### POS, sales and invoices
- POST /sales: idempotent sale completion command. Server calculates totals and validates stock; client-provided totals are display hints only.
- GET /sales; GET /sales/:id
- GET /invoices; GET /invoices/:id
- POST /sales/:id/returns and POST /sales/:id/void only after return/refund accounting policy is designed; not in initial scope.

### Payments and ledgers
- GET /payments; POST /payments; GET /payments/:id
- POST /payments/:id/allocations for applying eligible existing advances, with explicit source and idempotency.
- GET /customers/:id/ledger; GET /suppliers/:id/ledger
- GET /supplier-payments; POST /supplier-payments; GET /supplier-payments/:id

### Inventory and purchases
- GET /inventory; GET /stock-movements
- POST /stock-adjustments; POST /stock-counts; POST /stock-counts/:id/confirm
- GET/POST /purchases; GET /purchases/:id; POST /purchases/:id/confirm; POST /purchases/:id/cancel
- POST /purchases/:id/receipts (idempotent, receipt item quantities); GET /purchases/:id/receipts

### Expenses and reports
- GET/POST /expenses; GET/PUT/void /expenses/:id
- GET /reports/sales; /products; /customers; /customer-balances; /suppliers; /supplier-balances; /payments; /inventory; /purchases; /profit; /expenses
- Reports accept dateFrom/dateTo business dates, branch, and permitted dimension filters. Server owns timezone boundaries and aggregation source.

## Example command contracts

POST /api/v1/sales request: customerId, lines[{productId, quantity}], discount{type,value}, tenders[{method,amount,reference?}], optional notes. Server response: sale, invoice, payment receipts, inventory movement IDs, totals in amountMinor and display currency code. Do not accept arbitrary customer/product snapshots or client-computed stock.

POST /api/v1/payments request: customerId, receivedAt, tenders, allocations[{saleId,amountMinor}], keepAsAdvance, notes. Server response includes payment, allocations, unallocated amount, resulting invoice balances and ledger entry ID.

POST /api/v1/purchases/:id/receipts request: receivedAt, lines[{purchaseItemId,quantity}], notes. Server validates against remaining quantity and branch; returns receipt, updated purchase status and movement IDs.

## Transaction boundaries

Complete sale, goods receipt, customer payment, supplier payment, stock count confirmation, and adjustment are one logical request and one D1 batch transaction. Master-data CRUD is a single transaction with audit row. An external file upload to R2 is not atomic with D1: stage upload, validate, commit metadata, then clean abandoned objects asynchronously.

The D1 batch API is documented as transactional with rollback on statement failure: [D1 database batch](https://developers.cloudflare.com/d1/worker-api/d1-database/). This is a proposal informed by the current docs; confirm limits and API behavior when implementation starts.

## Error and retry behavior

Use stable error codes such as VALIDATION_ERROR, INSUFFICIENT_STOCK, ALLOCATION_EXCEEDS_BALANCE, VERSION_CONFLICT, IDEMPOTENCY_KEY_REUSED, NOT_FOUND and FORBIDDEN. Same key + same canonical request returns the original result; same key + different request hash returns conflict. Never retry a write with a new key automatically after an unknown network outcome.


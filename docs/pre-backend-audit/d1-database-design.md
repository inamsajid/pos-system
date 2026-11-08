# Proposed Cloudflare D1 Relational Design

**Proposal only.** No migrations or D1 connection were created. Use SQLite-compatible DDL, integer paise for money, UTC ISO-8601 timestamps, and explicit ISO business dates. Every business-owned record needs tenant scope. This model is based on actual current TypeScript shapes and documents missing fields as proposed.

## Model mapping

| Existing model/source | Proposed table(s) | Relationships and rules |
|---|---|---|
| No business model | businesses | PK id; legal/display identity, currency, timezone, status and timestamps. |
| No branch model | branches | FK business; unique business + branch code; branch-specific settings and stock. |
| Auth placeholder | users, business_members | Users are global identity; membership joins business/user with role/status. Never trust role or business scope from client body. |
| Category | categories | FK business; normalized name/slug unique per business; archive rather than delete referenced category. |
| Product | products, optional product_variants | FK business/category; unique SKU/barcode per chosen scope. Add variants only if options have distinct sellable SKU/barcode/stock. |
| SupplierProductAssociation fixture | supplier_products | Many-to-many supplier/product (optional variant); unique pair, supplier SKU, preferred flag and current quoted cost. Not transaction-cost source. |
| Customer | customers | FK business; unique customer code; soft archive; walk-in is an explicit system customer per business/branch. |
| Supplier | suppliers | FK business; unique supplier code; soft archive. |
| CheckoutSale | sales, sale_items | Sale FK business/branch/customer/user; item FKs and immutable product/SKU/unit/price/cost/tax/discount snapshots. Unique business+branch+sale number and idempotency key. |
| Invoice projection | invoices | One-to-one FK sale; unique sale ID and invoice number scoped to branch. Preserve legal fields and bill-to snapshot. |
| CustomerPayment + method rows | payments, payment_methods, payment_allocations | Payment/customer; tender child rows; allocations to sale/invoice. Payment may hold an advance. Enforce amount = methods total and allocated + unallocated = amount in the use case. |
| Computed customer ledger | customer_ledger | Append-only entries with business/branch/customer, debit/credit paise, source type/id, effective date, actor, idempotency key. Opening balance is explicit imported journal row. |
| Purchase | purchases, purchase_items | FK business/branch/supplier; immutable supplier/item/cost snapshots; unique purchase number. Status transitions enforced by application. |
| GoodsReceipt | goods_receipts, goods_receipt_items | FK purchase/supplier/branch; unique receipt number and request key; line references purchase item and received quantity. |
| SupplierPayment | supplier_payments, supplier_payment_methods, supplier_payment_allocations | FK supplier, tender child rows and allocations to purchase or explicit opening balance; unique receipt/idempotency per business. |
| Computed supplier ledger | supplier_ledger | Append-only debit/credit entries, source links, effective date, request key. Define opening-payable/advance allocation rules. |
| StockMovement | stock_movements, inventory_balances | Movement is immutable delta with branch/product, quantity precision, source transaction/item, snapshots and cost source. Balance is a rebuildable projection with version. |
| No cost-layers model | optional inventory_cost_layers | Only if FIFO/lot costing is selected; otherwise define a weighted-average model. Do not infer valuation from current product purchase price. |
| Expenses placeholder | expenses | Business/branch, category, amount_minor, business date, payment account, creator, status and reversal reference. Distinct from purchases. |
| No audit model | audit_logs | Actor, business/branch, action, entity/id, redacted before/after metadata, correlation ID and UTC time; append-only and access controlled. |
| Settings placeholder | settings | Scoped business/branch key/value with schema version. Do not put secrets in client-visible settings. |
| No retry model | idempotency_keys | Business, actor, operation, key, request hash, state, resource/result ID and expiry; unique business+operation+key. Needed for sale, payment, receipt, adjustment and sync retries. |

## Constraints and indexes

- Every business-owned table: business_id NOT NULL. Branch transactions also carry branch_id NOT NULL. Composite foreign keys or server-side tenant scoping must prevent cross-business references.
- Use UUID/ULID TEXT primary keys or integer keys consistently; don't mix within one relation. Unique document numbers include business/branch scope.
- Foreign keys RESTRICT posted financial/inventory history; catalog records are archived rather than deleted. Avoid cascade delete for sales, invoices, payments, movements and ledgers.
- Recommended indexes: business/branch/created_at; sales by business/branch/business_date/status; invoices by customer/date/status; payments by customer/date; allocations by sale and payment; purchases by supplier/date/status; supplier allocations by purchase; stock movements by product/date and source; inventory projection by branch/product; audit logs by entity/date and actor/date.
- Unique constraints: normalized SKU and barcode per chosen scope; category slug per business; customer/supplier codes per business; sale/invoice/purchase/receipt/payment number per branch; one invoice per sale; one receipt per idempotency key; one movement per source line/type; one member row per business/user.
- Use integer paise for PKR. Use integer-scaled quantity with a defined scale per unit, or validated decimal text if variable scales are necessary; never use REAL for authoritative money.
- Add valid status-transition checks in application use cases plus constraints where possible.

## Atomic operation boundaries

Use one Worker request and a D1 batch transaction for all writes that form one business event:

1. **Complete sale:** verify idempotency; validate business/branch/customer/products and stock; create sale/items/invoice; create tender/payment rows and allocations; append customer ledger; append stock movements; update balance projection; commit together.
2. **Receive goods:** verify purchase state and idempotency; validate remaining quantities/version; create receipt/items; append stock movements; update projection; update received quantities/state; append supplier-account event per policy; commit together.
3. **Customer/supplier payment:** verify idempotency; validate payment methods and outstanding amounts; create receipt, method rows, allocations, advance amount and ledger rows; commit together.
4. **Adjustment/count:** compare expected inventory version; append movement and update projection; commit together.

Cloudflare's D1 documentation describes batch statements as sequential SQL transactions that roll back if a statement fails, and documents SQLite-compatible foreign-key enforcement. Do not assume arbitrary multi-request BEGIN/connection transactions. Verify affected-row/version checks and uniqueness behavior against the selected D1 API. References: [D1 batch transaction behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

## Current model gaps

No entity carries business/branch IDs. Actor names are hard-coded strings. Customer/supplier opening balances are fixture fields. No variant, audit log, idempotency table, expense row, cost layer or central settings entity exists. These are proposed entities, not implemented code.


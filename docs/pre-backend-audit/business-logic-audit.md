# Business Logic and Data Consistency Audit

## Sales and invoices

Implemented: completeCheckout validates customer/product availability, discount, tender and tracked stock; generates one sale ID with sale/receipt/invoice numbers; snapshots customer and sold item name/SKU/unit/price/quantity/line total; records a completed sale; invoice service projects the same sale. Discounts are bounded by subtotal and percentage is bounded to 100%. Tax is not implemented. Status type is only completed; cancelled, voided, return and refund workflows do not exist.

### HIGH — sale completion is not atomic
checkoutService deducts inventory before adding/persisting the sale; payment records are projected later by getPayments. Browser termination or storage failure between effects can produce stock without sale or sale without durable payment. A module-level lock blocks concurrent checkouts only in one JS realm, not another tab/device.

### HIGH — sale tender has no server idempotency or uniqueness enforcement
Random IDs reduce collision risk, but there is no scoped idempotency record or D1 unique constraint. Repeated actions from another tab/device can create another sale.

### MEDIUM — snapshots omit sale-time cost and tax
Product name, SKU and selling price are snapshotted, but no historical cost or tax line exists. Current catalog purchase price must never be used as historical COGS. Return/refund is unsupported.

### MEDIUM — invoice number year uses device-local time
checkoutService uses device-local getFullYear while reports use Asia/Karachi. Around New Year a device timezone can produce a different invoice year. Generate invoice numbering on the backend with a business/branch sequence and unique constraint.

## Payments and ledgers

- POS payment projection excludes credit, adjusts cash tender down for change, and stores one payment with allocation to the same sale. ID pos-{saleId} prevents duplicate import in the current stored array.
- Manual customer collection validates method total, open invoice/customer references, allocation total and advance opt-in. Its draft has no idempotency key; UI saving state is not a server guarantee.
- Supplier payment validates supplier, method totals, allocations against open purchase balances, and advance acceptance. Its request ID is optional at service level; current form holds one per mount.
- Customer convention in the current ledger: sale debit; customer receipt credit. Supplier convention: purchase credit; payment debit. Labels follow those signs.
- Ledgers are derived on read rather than persisted; opening balances come from mock financial fixtures. Customer invoice outstanding excludes opening receivables; supplier payable includes opening payable. Neither payment flow allocates to opening balance. Specify invoice balance, opening balance, advance and current net account semantics before cutover.
- Existing customer/supplier mock history types and service methods are separate from canonical transactions; current account pages use computed ledgers, but fixture APIs remain.

### HIGH — archived supplier cannot settle existing payable
Supplier archive is allowed with outstanding payable, but createSupplierPayment requires active status. Recommended policy: archive blocks new purchases, while authorized users can settle existing liabilities. Do not change without product/accounting approval.

### HIGH — purchase cancellation ignores supplier payment allocations
cancelPurchase checks status/received quantity, not supplier payment allocations. A paid, not-yet-received purchase can be cancelled while its supplier payment still references it; open payable queries then exclude the cancelled bill. Fix in a shared purchase/payment use case after removing the service dependency cycle risk.

### MEDIUM — advances cannot be applied later
Customer/supplier payment creation allocates only at receipt time. No workflow reallocates an existing advance to a later invoice/bill.

### MEDIUM — input validation is incomplete
Payment services validate amount/method/allocation arithmetic but do not consistently validate effective dates, future bounds, duplicate supplier invoice numbers, or accounting-period policy.

## Inventory and purchases

- Product stock is exposed from inventoryService balance projection. Opening, purchase receipt, sale, adjustment and count movement types exist. Draft purchase does not change stock; receipt adds entered quantities; count compares current stock with count snapshot before applying variance.
- Purchase item rows preserve supplier/product names/SKU/unit/category and unit cost. Goods receipt references purchase and item IDs. One product can have multiple suppliers in static SupplierProductAssociation data, but association CRUD is missing.
- Product stock display is a projection; it is not authoritative master data.
- No FIFO, weighted-average, or other valuation method exists. Receipt movements store unit cost, but no cost layers or sale-time COGS. Inventory estimate multiplies current stock by current catalog purchase price. Profit and inventory valuation are not authoritative.

### CRITICAL — inventory and business events are not atomic
Inventory persistence writes balance/movement/count keys separately and swallows storage errors. Purchase receipt updates stock before receipt/purchase writes. Checkout updates stock before sale write. The stock projection cannot be treated as a durable ledger.

### HIGH — partial movement replay can double stock
inventoryService idempotency only handles “all movements already exist.” A multi-product batch with some existing reference/type movements and some missing entries falls through and replays the entire batch, duplicating existing product changes. A retry with the same reference but a different quantity is silently treated as complete when every key exists.

Proposed small safe correction: detect full replay separately from partial/mismatched replay; return only if every existing movement exactly matches quantity; otherwise throw a conflict and write nothing. Backend equivalent: unique source movement key plus request idempotency enforced in one database transaction. This correction does not rewrite existing data.

### MEDIUM — generic quantity precision
Movement quantities round to 0.001 for all product units; unit-specific fractional rules are not enforced (for example, piece/box can accept fractions). Define precision per unit/product before backend.

## Financial precision and dates

- POS money() rounds JavaScript floating point to two decimals using Number.EPSILON. Some paths use it, while sales utilities duplicate the rounding formula. Quantities round to three decimals. Other comparisons allow tolerances of 0.01/0.001.
- Currency formatting is PKR via Intl.NumberFormat('en-PK') and currently hides fractional digits (maximum 0). Do not change presentation as part of this audit.
- This is not a fully consistent accounting precision strategy. D1 should store integer paise (amount_minor INTEGER) and quantities as scaled integer or validated fixed precision, with explicit conversion at API boundaries.
- createdAt transaction timestamps are ISO UTC in core services and display converts to Asia/Karachi. Some list filters compare device-local dates or UTC string prefixes; purchase date is a business date string. Sales, invoice, supplier-payment and ledger filters can disagree near Karachi midnight. End-date timestamp comparisons can exclude part of selected end date.
- Safe date correction: add a shared business-date key/range helper that treats YYYY-MM-DD as a business date and timestamps as UTC instants converted to Asia/Karachi; update consumers to compare inclusive date keys. Keep event timestamps UTC and retain business document dates separately.

## Reports

- Sales/invoices are counted once from completed sales; invoices are projections, not additional revenue.
- Customer payments use synchronized POS payment records and manual receipts once per payment ID. Outstanding credit is not treated as collected cash.
- Purchase totals remain purchasing activity, not operating expenses.
- Product/revenue reports use sale snapshots; COGS/profit and expense reports are explicitly unavailable.
- Supplier/customer balances derive from ledgers and transaction sources, with opening-balance caveats above.
- Dashboard uses independent fixture data. Reconcile each report total with transaction rows after API migration.


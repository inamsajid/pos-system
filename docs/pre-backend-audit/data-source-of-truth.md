# Data Source of Truth Audit

## Entity ownership and propagation

| Entity | Current source / owner | Main consumers | Copies or propagation gaps | API readiness |
|---|---|---|---|---|
| Products | productService, seeded from productMockData, module-memory array | Products, POS, purchases, category statistics, inventory, reports | Master CRUD resets on reload; inventory balance persists separately. Category ID is resolved against current category list; sale/purchase snapshots preserve selected fields. | Low |
| Categories | categoryService, seeded from categoryMockData, module-memory array | Products, category UI, supplier product display, reports | CRUD resets on reload. Existing products see a rename in the same runtime because category name is resolved by ID. | Low |
| Customers | customerService, seeded from customerMockData, memory array | POS, payment collection, profiles and reports | CRUD resets on reload. Transaction snapshots survive with stored sales/payments, but referenced customer may disappear. Legacy history APIs read static fixtures. | Low |
| Suppliers | supplierService, seeded from supplierMockData, memory array | Purchases, supplier payments, supplier profile, reports | CRUD resets on reload. Transaction snapshots survive, but supplier records may disappear. Supplier-product associations are static fixture rows. | Low |
| Sales | checkoutService, northstar.completed-sales.v1 | POS, sales service/page, invoice service/pages, payments, customer ledger, reports | One canonical sale array; payment and inventory effects are separate records. | Medium-low |
| Invoices | No separate store; projection of completed sales via invoiceService | Invoice pages, payments, ledgers, reports | Same sale ID/number; invoice page must never add another revenue transaction. Snapshot fields are on sale. | Medium |
| Customer payments | paymentService, northstar.customer-payments.v1; POS sale receipts imported with ID pos-{saleId} | Payments, customer ledger/profile, sales status, reports | POS imports once per payment ID. Manual payment drafts have no request/idempotency key. | Low |
| Customer ledger | Computed in customerLedgerService from sales + customer payments + financialMockData.openingBalance | Customer account/profile, payment form, report | No independent journal. Legacy accountMockData/history methods remain but are not the current account ledger. Opening balance is fixture-backed; no allocation to opening receivables. | Low |
| Purchases | purchaseService, northstar.purchases.v1 | Purchases, supplier ledger, supplier profile, payments, reports | Purchase rows include supplier/product snapshots and receipt progress; master product/supplier may reset independently. | Medium-low |
| Goods receipts | purchaseService, northstar.goods-receipts.v1 | Purchase details/receiving, inventory | Receipt records and purchase state persist separately from inventory keys; not one durable transaction. Request key is caller-provided and not checked against purchase on replay. | Low |
| Supplier payments | supplierPaymentService, northstar.supplier-payments.v1 | Supplier payments, supplier ledger/profile, purchases, reports | Allocations reference purchases; request ID is optional in service. The current form generates one per mount. | Low |
| Supplier ledger | Computed in supplierLedgerService from purchases + supplier payments + supplierFinancialMockData.openingPayable | Supplier account/profile, purchase/payment forms, reports | No independent journal. Opening payable is fixture-backed; payment allocations cannot settle opening payable. | Low |
| Inventory balances | inventoryService, northstar.inventory-balances.v1 | Product stock fields, POS, purchases, stock count, reports | Balance is a cached projection separate from movements and master products. Separate localStorage keys have no atomic commit/rebuild reconciliation. | Low |
| Stock movements | Same service, northstar.inventory-movements.v1 | Product adjustment history, inventory pages, reports | Append-only behavior is intended; references include sale/receipt/count IDs. No durable FK or source transaction guarantee. | Low |
| Stock counts | Same service, northstar.inventory-counts.v1 | Stock count page | Draft/confirm state is another key; current quantity drift is checked before confirmation. | Low |
| Expenses | Missing | Placeholder only | No source exists. Purchases must not be treated as operating expenses. | Missing |
| Dashboard analytics | dashboardDemo.ts fixtures | Dashboard | Independent sample values, not derivations from sales/payments/inventory. | Missing for live metrics |
| Product-supplier relation | supplierProductMockData | Supplier profile, purchase form suggested prices | Static many-to-many fixture; no CRUD repository. Association fields include preferred supplier and supplier-specific price. | Low |

## Propagation assessment

- Within one page/runtime, product and category changes are visible when services are reread; this is not cross-tab or cross-device synchronization.
- A new customer/supplier can be selected by POS/purchase UI in the same runtime, but it is not durable across reload. Stored transaction snapshots do not recreate the master entity.
- Sale, invoice and POS-derived customer payment point to one sale ID; invoice is a projection. This avoids a second invoice sale in current reads.
- Stock is shared through inventoryService, not by trusting Product.stockQuantity; productService overlays the balance projection. Persistence of that projection and its ledger is still non-atomic.
- Reports mostly read transaction services; dashboard does not.
- Browser local storage is origin- and device-local, not a shared source of truth. A second workstation has an independent set of records.

## Recommendations

1. Separate seed fixtures from runtime repositories; add validation/migration versioning for browser-only demo data.
2. Establish one repository interface per entity and one application use-case layer for cross-entity transactions.
3. Use stable scoped identifiers: business, branch and globally unique ID. Put business/branch context in authenticated server context, not only client filters.
4. Keep immutable historical sale, purchase, customer, supplier, price and unit snapshots on transaction items/documents.
5. Replace computed ledgers with append-only journal rows or a well-defined ledger projection with reconciliation; retain opening balances as explicit imported opening journal events.
6. Persist supplier-product associations; use a unique association key and preserve per-supplier SKU/cost snapshots.
7. Provide explicit migration and reconciliation reports before importing any browser-local demo data. Never merge isolated browser datasets automatically.


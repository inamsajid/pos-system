# Pre-Backend Implementation Roadmap

## Priority order

### P0 — before any live business data
1. Replace the unconditional auth guard with a real server-verified session boundary before exposing data.
2. Decide business/branch isolation, employee roles, walk-in customer identity and actor audit semantics.
3. Establish canonical repository contracts and remove parallel dashboard/customer/supplier fixture histories from live screens.
4. Move sale, payment, goods receiving, stock adjustment and stock-count writes into atomic server use cases with scoped idempotency keys and database uniqueness.
5. Define cancellation/void/return/refund rules, including financial and stock reversals; prohibit destructive edits to posted events.
6. Define accounting treatment for opening receivables/payables and applying advances; settle supplier payments after archival and block cancellation of bills with payment allocations.
7. Choose historical inventory costing and sale-time cost capture before presenting profit/COGS or valuation.
8. Define money in integer paise and per-unit quantity scales; reconcile existing rounding tolerances.

### P1 — required for reliable backend cutover
1. Add business/branch/actor/timestamps/version fields with scoped IDs and historical snapshots.
2. Persist supplier-product associations and define unique SKU/barcode/name policies.
3. Introduce API DTO schemas, repository adapters, TanStack Query keys/invalidation, structured errors and request correlation.
4. Move date filtering to one Asia/Karachi helper and include full business end-date semantics.
5. Import demo/browser data only through an explicit preview, validation and reconciliation tool; don't treat browser localStorage as a database migration source.
6. Add audit log, reversals, reconciliation jobs and operational error reporting.

### P2 — staged product capabilities
1. Add expenses and reporting only after account/category and posted/voided workflows are specified.
2. Add staff/settings/permissions screens after role and business policies are server-defined.
3. Add offline cache/outbox only after online transaction semantics and conflict policy are proven.
4. Add file upload through R2 only with secure content validation and ownership rules.

## Safe pre-backend corrections

This audit identifies two bounded corrections suitable before backend work:
- Centralize business-date key/range logic and update sales, invoice, customer/supplier ledger, supplier-payment and inventory movement filters that currently compare device-local time or UTC string prefixes.
- Tighten stock-movement replay handling so exact full replays are idempotent while partial/mismatched replays fail without writing.

These changes do not migrate, reset or delete existing browser data. They require targeted helper/service checks plus production build. Other accounting and transaction-boundary findings are documented and should not be patched as isolated UI changes.

## Existing code-quality warnings

npm run lint exits 0 but warns in:
- src/features/sales/pages/SalesPage.tsx and SaleDetailsPage.tsx: state set synchronously in effects.
- src/features/customers/pages/CustomersPage.tsx: state set in effect.
- src/features/customers/components/CustomerForm.tsx and src/features/suppliers/components/SupplierForm.tsx: React Hook Form incompatible-library/compiler warning.
- src/features/pos/pages/PosPage.tsx: manual memoization/compiler warnings.

No lint warning originated in the reports feature during this audit. The project has no unit-test runner configured. Add a dependency-free test plan only after choosing the supported Node range; current README allows Node 20.19, where native TypeScript execution support differs from Node 22+. At minimum test money rounding/discount bounds, payment allocations and advances, ledger signs/openings, stock batch idempotency, receipt quantities/retries, snapshots and business-date boundaries.

## Backend readiness verdict

**Not ready; significant architectural work required.** Current demo transactions are browser-local, master data is not durable, authentication is bypassed, cross-entity transaction effects are non-atomic, and tenant/branch identity is absent. Build success does not establish production data integrity.


# POS Frontend Architecture Audit

Scope: C:\projects\pos-system, inspected 2026-11-08. This is a pre-backend assessment. No API, D1 migration, deployment, or authentication implementation was added.

## Overall assessment

The UI has a useful feature-oriented layout and several working browser-only transaction flows. It is still a single-browser demo, not a multi-device data architecture. Master records are mostly in memory; selected transaction records are stored in localStorage; some legacy customer/supplier views and the dashboard read independent fixtures. Relationships work within one running JavaScript realm, but persistence and transaction boundaries do not cover whole business operations.

Verdict: **Not ready for production backend integration without significant architectural work.** Proceed only with an isolated backend prototype after canonical models, transaction invariants, business scoping, financial precision, and reconciliation rules are agreed. Do not point this frontend at live business data yet.

## Entry points and shared infrastructure

- src/main.tsx mounts one React root and wraps StrictMode, Providers, and App; it imports the sole global stylesheet.
- src/app/App.tsx hosts RouterProvider; src/app/router.tsx declares auth and application routes.
- src/app/providers.tsx mounts TanStack Query and src/app/queryClient.ts configures it. No feature uses useQuery or useMutation.
- src/store/appStore.ts contains transient sidebar state only. Business data does not use Zustand.
- src/assets/styles/index.css is the Tailwind v4 global entry. Vite uses @tailwindcss/vite; no separate Tailwind config exists in the root.
- src/lib/api-client.ts is a generic fetch wrapper; src/services/api/endpoints.ts only defines /health. Neither is consumed by feature services.
- dist/ is generated output and ignored; .env.local is ignored by *.local. The project has no test script or test framework.

## Module inventory

| Module | Status | What actually exists |
|---|---|---|
| Authentication | Placeholder / guard ineffective | Login/register/reset forms only prevent submit; ProtectedRoute hard-codes authenticated=true. |
| Dashboard | UI implemented, data inconsistent | Cards, charts, activity and low-stock sample read dashboardDemo.ts, independent of transaction services. |
| Products | Partially implemented | CRUD and snapshots work in memory; stock delegates to inventory. Product master does not survive reload. |
| Categories | Partially implemented | CRUD/statistics work in memory and products resolve category IDs at runtime; categories do not survive reload. |
| Customers | Inconsistent | CRUD is in memory. Current account/profile views use sales and payment services, but legacy fixture-backed DTOs/methods remain. |
| Suppliers | Inconsistent | CRUD is in memory; live ledger/purchase/payment views use transaction services. Product associations and legacy history APIs are fixtures. |
| POS | Browser-only flow | Validates checkout, writes one sale, synchronizes tender into customer payments and records stock movements. Effects are not atomic. |
| Sales | Projection | salesService delegates to checkout service; no second sale repository. Date-filter logic is duplicated and timezone-sensitive. |
| Invoices | Projection | invoiceService exposes completed sales; there is no independent invoice transaction store. |
| Payments | Partially implemented | Manual customer payments and POS-derived receipts use one customer payment array; supplier payments use another. Browser-only idempotency is incomplete. |
| Customer ledger | Computed, partly fixture-backed | Entries derive from sales/payments plus fixture opening balances; no persisted journal/opening-balance allocation exists. |
| Supplier ledger | Computed, partly fixture-backed | Entries derive from confirmed purchases and supplier payments plus fixture opening payables. |
| Inventory | Partially implemented | Balance projection, movements and counts share one module and browser storage, but separate keys are not transactionally persisted. |
| Purchases | Partially implemented | Draft/order/partial receiving and snapshots exist; receipts affect stock and purchase state in separate local operations. |
| Expenses | Placeholder | No model, service, repository or transactions. |
| Reports | Partially implemented | Reads transaction and master-data services. Profit/expenses disclose unavailable authoritative source data. |
| Staff / settings / general ledger | Placeholder | Routes render the shared Coming soon placeholder. |

## Dependency map

- main.tsx -> Providers(QueryClient) -> App -> Router
- Router -> ProtectedRoute (hard-coded allow) -> DashboardLayout -> UI layout + Zustand sidebar
- DashboardPage -> dashboardDemo fixtures (not transaction services)
- POS -> productService -> inventoryService -> localStorage balances/movements/counts
- POS -> customerService (in-memory)
- POS -> checkoutService -> localStorage completed sales; checkout calls productService for stock deduction
- invoiceService and salesService -> checkoutService (same canonical sales)
- paymentService -> customerService + checkoutService -> localStorage customer payments and POS-derived receipt projection
- customerLedgerService -> checkoutService + paymentService + customer opening fixtures
- purchaseService -> supplierService + productService + inventoryService -> localStorage purchases and goods receipts
- supplierPaymentService -> supplierService + purchaseService -> localStorage supplier payments
- supplierLedgerService -> purchaseService + supplierPaymentService + supplier opening fixtures
- categoryService -> productService for derived product counts
- supplierService -> productService + categoryService + supplier association fixtures
- reportService -> checkout, customer payment, supplier payment, purchase, inventory, product, customer, supplier, category and supplier-ledger services

A static scan of relative TypeScript imports found no import cycles. Shared money rounding is owned by pos/utils/checkoutCalculations.ts and imported by inventory, purchases, payments, ledgers and reports. That is an inappropriate dependency direction; move domain primitives into a shared domain library before backend adapters are introduced.

## Findings

### HIGH — no repository contract for most entities
Problem: Feature services directly own module arrays, fixture imports and browser-storage calls. Product/category/customer/supplier master data is in memory; transactions are split across browser-storage keys. api-client.ts and TanStack Query are not wired into services.
Why it matters: Replacing fetch alone will not replace the app’s assumptions about immediate shared module state. Tabs/devices diverge, and refresh can remove entities referenced by persisted transactions.
Recommendation: Define repository interfaces and DTO mapping; keep use cases independent of React and persistence; add API repositories behind those interfaces later. Must fix before integration.

### HIGH — parallel fixture sources
Problem: Dashboard metrics/activity are hard-coded. Customer/supplier services retain fixture financial summaries, history and transactions while some pages use computed ledgers.
Why it matters: Screens can disagree about the same business period or account.
Recommendation: Isolate fixtures as explicitly demo-only and migrate live screens to one repository/query source. Must fix before integration.

### MEDIUM — domain dependency direction
Problem: POS owns shared money helpers; report service imports almost every feature service; supplier/category services cross-call feature APIs.
Why it matters: POS becomes a coupling hub and domain calculation tests load unrelated modules.
Recommendation: Extract only shared domain primitives and explicit application use cases. Avoid broad page reorganization. Fix before integration.

### MEDIUM — query/API scaffolding only
Problem: Query provider and generic client exist, but features use direct service calls/effects; there is no cache invalidation, auth transport, response validation, or endpoint contract.
Recommendation: Decide repository and query-key/invalidation policies with the first API-backed feature. Fix before integration.

## Quality baseline

- npm run build executes tsc -b && vite build; both passed during this audit.
- npm run lint runs Oxlint and exits successfully, with existing warnings cataloged in implementation-roadmap.md.
- No test command/framework is configured.
- Strict TypeScript is enabled. A source scan found no explicit any, @ts-ignore or @ts-nocheck; the relative-import graph scan found no cycles.


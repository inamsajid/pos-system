# Step 12.7 — Complete Frontend Integration with Cloudflare Worker APIs

## 1. Overview & Architectural Principles

Step 12.7 establishes the Cloudflare Worker API (backed by local Cloudflare D1 SQL database and Cloudflare R2 object storage) as the **single source of truth** for all business data across the POS application.

### Key Architectural Tenets
1. **Single Source of Truth**: All transactional, financial, catalog, inventory, and file data flow to and from `/api/v1/*`. Browser storage and memory serve strictly as view/cache layers.
2. **Gated Demo Fallback Safety**:
   - Demo mode is strictly gated by `VITE_DATA_SOURCE=mock`.
   - In live mode (default), all API calls require session cookies (`credentials: "include"`) and tenant headers (`X-Business-Id`, `X-Branch-Id`).
   - Network or server errors in live mode **never silently degrade** into local fake storage or mock state. Errors bubble directly to the UI with clear feedback.
3. **Paise Precision Boundary**:
   - Database / Worker: 64-bit integer minor units (paise; 1 PKR = 100 paise).
   - Frontend: Decimal Pakistani Rupees (PKR).
   - Conversion contract:
     - Outgoing requests: `Math.round(amountPkr * 100)`
     - Incoming responses: `amountMinor / 100`
4. **Tenant Context Injection & Cache Safety**:
   - `apiClient` registers a context provider callback to automatically attach `X-Business-Id` and `X-Branch-Id` headers to requests.
   - When switching business, switching branch, or signing out in `AuthContext`, `queryClient.clear()` is triggered immediately so data from one tenant is never leaked or visible to another.

---

## 2. Integrated Feature Modules

### 2.1 POS Checkout (`src/features/pos/`)
- **Worker Endpoint**: `POST /api/v1/sales`
- **Idempotency**: Generates a standard UUID per checkout attempt sent in the `Idempotency-Key` request header.
- **Double Submission Guard**: Button disabled and `busy` state locks checkout during submission.
- **Cart Resilience**: On error or stock conflict (HTTP 409), the cart remains intact so the cashier can adjust or retry without data loss; products reload to refresh live stock counts.
- **Finality**: Cart is cleared and completed receipt modal displayed only upon HTTP 201 server confirmation.

### 2.2 Sales & Invoices (`src/features/sales/`, `src/features/invoices/`)
- **Worker Endpoints**:
  - `GET /api/v1/sales?limit=100`
  - `GET /api/v1/sales/:id`
  - `POST /api/v1/sales/:id/void`
  - `GET /api/v1/invoices`
  - `GET /api/v1/invoices/:id`
  - `GET /api/v1/invoices/:id/sale`
- **Projection Guarantee**: Invoices are pure projections of canonical completed sales.
- **Data Hydration**: Asynchronously mapped to `CheckoutSale` with minor unit conversions.

### 2.3 Customer Payments & Customer Ledger (`src/features/payments/`, `src/features/customers/`)
- **Worker Endpoints**:
  - `GET /api/v1/customer-payments`
  - `POST /api/v1/customer-payments`
  - `GET /api/v1/customers/:id/ledger`
  - `GET /api/v1/customers/:id/ledger/summary`
- **Allocations**: Supports allocating payments against specific invoices or retaining excess as customer advance.
- **Ledger Verification**: Live statement entries calculate accurate running balance (`balance = previous + debit - credit`).
- **Customer CRUD Note**: Customer ledger and account summary are wired to live APIs. General Customer CRUD (`POST /api/v1/customers`) is documented as `PARTIAL / BLOCKED` until the customer directory API is implemented in D1.

### 2.4 Inventory, Movements & Stock Adjustments (`src/features/inventory/`)
- **Worker Endpoints**:
  - `GET /api/v1/inventory/balances`
  - `GET /api/v1/inventory/movements`
  - `POST /api/v1/inventory/adjustments`
  - `GET /api/v1/inventory/counts`
  - `POST /api/v1/inventory/counts`
  - `POST /api/v1/inventory/counts/:id/complete`
- **Audit Trail**: Stock movements provide immutable tracking of quantity changes, unit costs, and reference types (`sale`, `purchase`, `adjustment`, `opening_stock`, `stock_count`).

### 2.5 Purchases, Goods Receipts & Supplier Ledger (`src/features/purchases/`, `src/features/supplier-payments/`, `src/features/suppliers/`)
- **Worker Endpoints**:
  - `GET /api/v1/purchases`
  - `POST /api/v1/purchases`
  - `POST /api/v1/purchases/:id/confirm`
  - `POST /api/v1/purchases/:id/cancel`
  - `POST /api/v1/purchases/:id/receipts`
  - `GET /api/v1/supplier-payments`
  - `POST /api/v1/supplier-payments`
  - `GET /api/v1/suppliers/:id/ledger`
  - `GET /api/v1/suppliers/:id/ledger/summary`
  - `GET /api/v1/suppliers`
- **Workflow**: PO creation -> confirmation -> atomic goods receipt (incrementing stock and establishing supplier liability) -> supplier payment recording.

### 2.6 Reports, Dashboard & Analytics (`src/features/reports/`, `src/features/dashboard/`)
- **Worker Endpoints**:
  - `GET /api/v1/reports/dashboard`
  - `GET /api/v1/reports/sales/summary`
  - `GET /api/v1/reports/sales/trends`
  - `GET /api/v1/reports/export/csv`
- **Accounting Disclosure**: Explicit accounting notices displayed in UI ("Operating expenses and net profit calculations are unavailable in the current API version because expenses tables are pending backend implementation").
- **CSV Export**: Secure sanitized CSV streaming via `apiClient.getBlob()` with spreadsheet formula injection defense.

### 2.7 Private File Storage (R2) (`src/features/files/`, `src/features/products/`)
- **Worker Endpoints**:
  - `POST /api/v1/files` (multipart/form-data)
  - `GET /api/v1/files/:id/content`
  - `DELETE /api/v1/files/:id`
- **Product Integration**: Uploads files directly to private Cloudflare R2 bucket with MIME/magic-byte validation and displays via authenticated streaming URL.

---

## 3. Verification & Test Baseline

| Check | Tool / Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Worker TypeScript** | `npm run build:worker` | **PASS (0 errors)** | `tsc -p tsconfig.worker.json --noEmit` clean |
| **Frontend Production Build** | `npm run build` | **PASS (0 errors)** | `tsc -b && vite build` built in 1.92s |
| **Linter** | `npm run lint` | **PASS (0 errors)** | `oxlint` 0 errors across 290 files |
| **Local D1 Database** | `npm run db:status:local` | **PASS (0 pending)** | 11 migrations applied |
| **Vitest Test Suite** | `npm test` | **PASS (298 / 298)** | 39 test files passing (100% green) |
| **Frontend Integration Tests** | `tests/frontendIntegration12_7.test.tsx` | **PASS (14 / 14)** | Verifies headers, idempotency, conversions, fallbacks |


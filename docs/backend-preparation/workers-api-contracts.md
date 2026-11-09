# Cloudflare Workers API Specifications & Contracts

## Document Overview
- **Document ID**: `API-SPEC-11.8-05`
- **Status**: Production API Contract Specification / Step 11.8
- **Base Route**: `/api/v1`
- **Format**: JSON over HTTPS / RESTful with Idempotency Guarantees
- **Audience**: Backend Engineers, Frontend Engineers, Mobile Integrators

---

## 1. Global API Standards & Conventions

### 1.1 HTTP Headers & Context Propagation
Every authenticated API request requires these standard headers:

| Header Name | Type | Requirement | Purpose |
| :--- | :--- | :--- | :--- |
| `Authorization` | String | Optional (if Cookie used) | `Bearer <session_token>` for mobile/tablet clients. |
| `Cookie` | String | Web Clients | Secure HttpOnly session cookie (`__session`). |
| `X-Business-Id` | UUID / String | Required | Explicit business scope. Server verifies authenticated membership. |
| `X-Branch-Id` | UUID / String | Required for store operations | Explicit branch scope. Server verifies member branch access. |
| `Idempotency-Key`| UUIDv4 | Required for mutating actions | Prevents duplicate checkouts, payments, and stock movements. |
| `X-Request-Id` | UUIDv4 | Auto-injected by Worker | Traceability correlation ID across logs and responses. |

### 1.2 Standard Success Response Envelope
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 50,
    "totalCount": 124,
    "totalPages": 3,
    "hasNextPage": true
  },
  "requestId": "req_01hgb234xyz89"
}
```

### 1.3 Standard Error Response Envelope
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock quantity for Premium Basmati Rice 5kg.",
    "details": {
      "productId": "prod_01h8a",
      "requestedQuantity": 10,
      "availableQuantity": 4
    }
  },
  "requestId": "req_01hgb234xyz89"
}
```

### 1.4 Standard Reusable Error Codes
- `VALIDATION_ERROR` (400)
- `AUTHENTICATION_REQUIRED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `INSUFFICIENT_STOCK` (422)
- `ALLOCATION_EXCEEDS_BALANCE` (422)
- `VERSION_CONFLICT` (409)
- `IDEMPOTENCY_KEY_REUSED` (409)
- `INTERNAL_SERVER_ERROR` (500)

---

## 2. Comprehensive Endpoint Index

### 2.1 Authentication & Profile (`/api/v1/auth`)
- `POST /api/v1/auth/sign-up`: Create root owner account and business.
- `POST /api/v1/auth/sign-in`: Authenticate user and issue session token / HttpOnly cookie.
- `POST /api/v1/auth/sign-out`: Revoke current active session.
- `GET /api/v1/auth/me`: Retrieve current user profile, active business memberships, and branch assignments.
- `POST /api/v1/auth/forgot-password`: Dispatch password reset link.
- `POST /api/v1/auth/reset-password`: Set new password with secure token.

### 2.2 Businesses & Branches (`/api/v1/businesses`, `/api/v1/branches`)
- `GET /api/v1/businesses`: List businesses accessible to authenticated user.
- `POST /api/v1/businesses`: Create new business entity.
- `GET /api/v1/businesses/:businessId`: Get business details and configurations.
- `GET /api/v1/branches`: List branches for the active business.
- `POST /api/v1/branches`: Create new branch within the active business.

### 2.3 Product Catalog & Categories (`/api/v1/products`, `/api/v1/categories`)
- `GET /api/v1/products`: List products with pagination, search, category filter, low stock filter.
- `GET /api/v1/products/:id`: Get product details and branch-specific stock levels.
- `POST /api/v1/products`: Create product. Requires `catalog:write`.
- `PUT /api/v1/products/:id`: Update product master details.
- `POST /api/v1/products/:id/archive`: Soft-archive product.
- `GET /api/v1/categories`: List category hierarchy.
- `POST /api/v1/categories`: Create category.
- `PUT /api/v1/categories/:id`: Update category.

### 2.4 Customers & Customer Ledger (`/api/v1/customers`)
- `GET /api/v1/customers`: Search and list customers.
- `GET /api/v1/customers/:id`: Customer profile and financial summary.
- `POST /api/v1/customers`: Register new customer with opening balance.
- `PUT /api/v1/customers/:id`: Update customer contact info.
- `GET /api/v1/customers/:id/ledger`: Paginated subledger statement (`debit`, `credit`, running balance).

### 2.5 Suppliers & Supplier Ledger (`/api/v1/suppliers`)
- `GET /api/v1/suppliers`: Search and list active/inactive suppliers.
- `POST /api/v1/suppliers`: Create supplier profile with opening payable.
- `PUT /api/v1/suppliers/:id`: Update supplier profile.
- `GET /api/v1/suppliers/:id/ledger`: Paginated supplier subledger statement.

### 2.6 POS, Sales & Invoicing (`/api/v1/sales`, `/api/v1/invoices`)
- `POST /api/v1/sales`: Complete POS checkout transaction. Requires `Idempotency-Key`.
- `GET /api/v1/sales`: Paginated sales list with business date filters.
- `GET /api/v1/sales/:id`: Detailed sale receipt, line items with snapshot costs, and invoice.
- `GET /api/v1/invoices`: Paginated invoice list.
- `GET /api/v1/invoices/:id`: Invoice document representation.
- `POST /api/v1/sales/:id/void`: Same-day sale void (requires supervisor role).
- `POST /api/v1/sales/:id/returns`: Process customer item return with stock disposition.

### 2.7 Payments & Advance Allocations (`/api/v1/payments`)
- `POST /api/v1/payments`: Record incoming customer payment and allocate against invoices.
- `GET /api/v1/payments`: Paginated payment receipt list.
- `GET /api/v1/payments/:id`: Payment details and allocation breakdown.
- `POST /api/v1/payments/:id/allocations`: Allocate unallocated customer advance to open invoices.
- `POST /api/v1/supplier-payments`: Disburse supplier payment and allocate against purchases.
- `GET /api/v1/supplier-payments`: List supplier payment vouchers.

### 2.8 Inventory & Stock Movements (`/api/v1/inventory`)
- `GET /api/v1/inventory`: Branch inventory balances and valuation.
- `GET /api/v1/stock-movements`: Paginated stock movement audit trail.
- `POST /api/v1/stock-adjustments`: Record manual stock correction (requires manager role).
- `POST /api/v1/stock-counts`: Create physical stocktake draft.
- `POST /api/v1/stock-counts/:id/confirm`: Finalize stocktake and auto-generate variance adjustments.

### 2.9 Purchases & Receiving (`/api/v1/purchases`)
- `GET /api/v1/purchases`: List purchase orders.
- `GET /api/v1/purchases/:id`: Purchase order details.
- `POST /api/v1/purchases`: Create draft purchase order.
- `POST /api/v1/purchases/:id/confirm`: Transition PO to `ordered` status.
- `POST /api/v1/purchases/:id/receipts`: Record Goods Receipt (increments stock, updates moving unit cost).
- `POST /api/v1/purchases/:id/cancel`: Cancel purchase order (validates 0 receipts and 0 payments).

### 2.10 Reports & Analytics (`/api/v1/reports`)
- `GET /api/v1/reports/sales`: Sales aggregate by date range, channel, cashier.
- `GET /api/v1/reports/products`: Top-selling products and categories.
- `GET /api/v1/reports/customer-balances`: Aged receivables and advance liability summary.
- `GET /api/v1/reports/suppliers`: Aged payables summary.
- `GET /api/v1/reports/payments`: Cash drawer and electronic settlement collection reports.
- `GET /api/v1/reports/inventory`: Stock valuation by Moving Weighted Average cost.
- `GET /api/v1/reports/purchases`: Procurement volume and supplier spending.
- `GET /api/v1/reports/profit`: Gross margin analysis (Sales Revenue - Snapshot COGS).

### 2.11 Operating Expenses (`/api/v1/expenses`)
- `GET /api/v1/expenses`: List operating expenses by category and date.
- `POST /api/v1/expenses`: Record operating expense (rent, utility, salary).
- `GET /api/v1/expenses/categories`: List expense categories.

---

## 3. Idempotency Execution Protocol

1. Client generates UUIDv4 `Idempotency-Key` and attaches it as a header on `POST` requests.
2. Worker computes SHA-256 hash of the canonical request body:
   $$\text{requestHash} = \text{SHA256}(\text{canonicalJsonStringify}(\text{requestBody}))$$
3. Worker queries `idempotency_keys` table inside D1:
   ```sql
   SELECT response_status, response_body_json, request_hash
   FROM idempotency_keys
   WHERE business_id = ? AND operation = ? AND idempotency_key = ?;
   ```
4. If row exists:
   - If `request_hash == stored_hash`: Return cached response immediately (`HTTP 200 OK`) with header `X-Cache-Lookup: HIT-IDEMPOTENT`.
   - If `request_hash != stored_hash`: Return `HTTP 409 CONFLICT` (`code: IDEMPOTENCY_KEY_REUSED`).
5. If row does not exist:
   - Worker executes domain use case.
   - Worker writes business entities AND idempotency record inside the **same atomic D1 batch**:
     ```sql
     INSERT INTO idempotency_keys (id, business_id, operation, idempotency_key, request_hash, response_status, response_body_json)
     VALUES (?, ?, ?, ?, ?, ?, ?);
     ```
   - Commit guarantees that either both business mutation and key are saved, or neither is.


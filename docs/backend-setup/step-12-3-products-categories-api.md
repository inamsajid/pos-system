# Step 12.3: Products & Categories API Endpoints Documentation

## Executive Overview
- **Step**: 12.3 (Product Catalog & Category CRUD APIs)
- **Status**: Complete & Verified
- **Runtime Target**: Cloudflare Workers + Cloudflare D1 (SQLite) + React/Vite PWA
- **Security Boundary**: Zero-Trust Multi-Tenancy with Server-Derived Business Context and RBAC (`catalog_read`, `catalog_write`)
- **Inventory Protection**: Zero-Stock-Mutation Invariance Guarantee across all product lifecycle operations

---

## 1. Implemented Endpoints & Permissions Matrix

All catalog endpoints enforce authenticated session context via cookie (`__session`) or Bearer token (`Authorization: Bearer <token>`), and resolve the active business container via trusted server membership (`X-Business-Id`).

| Method | Endpoint | RBAC Permission | Purpose | Parameters / Payload |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/categories` | `catalog_read` | List categories for tenant with computed statistics | `status` (`active` \| `archived` \| `all`), `parentId` |
| `GET` | `/api/v1/categories/:id` | `catalog_read` | Fetch a single category by ID with statistics | Route param `:id` |
| `POST` | `/api/v1/categories` | `catalog_write` | Create a new category | Body: `CreateCategoryRequest` |
| `PUT` | `/api/v1/categories/:id` | `catalog_write` | Full-replacement update (mandatory fields required, omitted reset to null) | Route param `:id`, Body: `ReplaceCategoryRequest` |
| `PATCH` | `/api/v1/categories/:id` | `catalog_write` | Partial update (updates provided fields, preserves omitted fields) | Route param `:id`, Body: `UpdateCategoryRequest` |
| `DELETE` | `/api/v1/categories/:id` | `catalog_write` | Safely soft-archive category (preserves foreign keys) | Route param `:id` |
| `GET` | `/api/v1/products` | `catalog_read` | Search, filter, and paginate product catalog | `search`, `sku`, `barcode`, `categoryId`, `status`, `lowStock`, `page`, `limit`, `sortBy`, `sortOrder` |
| `GET` | `/api/v1/products/:id` | `catalog_read` | Fetch product detail with computed stock and category | Route param `:id` |
| `POST` | `/api/v1/products` | `catalog_write` | Create product with integer minor amounts (paise) | Body: `CreateProductRequest` |
| `PUT` | `/api/v1/products/:id` | `catalog_write` | Full-replacement update (mandatory fields required, omitted reset to null/defaults) | Route param `:id`, Body: `ReplaceProductRequest` |
| `PATCH` | `/api/v1/products/:id` | `catalog_write` | Partial update (updates provided fields, preserves omitted fields) | Route param `:id`, Body: `UpdateProductRequest` |
| `DELETE` | `/api/v1/products/:id` | `catalog_write` | Safely soft-archive product (preserves stock balances) | Route param `:id` |

---

## 2. Business Rules & Domain Validation

### 2.1 Category Domain Invariants
1. **Uniqueness**: Category `name` (case-insensitive) and `slug` (case-insensitive) must be unique within the tenant (`business_id`). Duplicate creation or rename throws `409 Conflict`.
2. **Hierarchy & Cycle Prevention**:
   - A category cannot be its own parent (`parentId !== id`).
   - If `parentId` is specified, the parent category must exist and belong to the same `business_id`.
   - Cycle detection traces the entire ancestor chain up to root (depth 25). If `id` appears in the ancestor hierarchy of `candidateParentId`, the request is rejected with `400 Bad Request` (`Circular category hierarchy detected`).
3. **Soft Archive vs Referential Integrity**:
   - `DELETE /api/v1/categories/:id` soft-archives the record (`status = 'archived'`).
   - Hard deletion is prohibited to preserve historical references from `products`, `sales`, and `inventory`.

### 2.2 Product Domain Invariants
1. **Monetary Precision**: All monetary values are strictly validated and stored as non-negative integer minor currency units (paise, 1 PKR = 100 paise) in D1:
   - `purchase_price_minor INTEGER NOT NULL DEFAULT 0`
   - `selling_price_minor INTEGER NOT NULL DEFAULT 0`
   - Floating-point currency storage is strictly prohibited.
2. **Code Uniqueness**:
   - `sku` (case-insensitive) is unique per `business_id` (enforced by DB index `UNIQUE(business_id, sku)`).
   - `barcode` (case-insensitive) is unique per `business_id` among non-null values.
3. **Category Ownership**: A product cannot be assigned to a category belonging to another tenant. Cross-tenant category references are rejected with `400 Bad Request`.
4. **Unit of Measure (UoM)**: Must be one of the approved domain units:
   `'piece'`, `'kg'`, `'gram'`, `'liter'`, `'meter'`, `'box'`, `'pack'`, `'dozen'`.
5. **CRITICAL Stock Mutation Invariance**:
   - `POST /api/v1/products`, `PATCH /api/v1/products/:id`, and `DELETE /api/v1/products/:id` write exclusively to the `products` table.
   - Zero rows are inserted into `stock_movements`.
   - Zero balances are modified in `inventory_balances`.
   - Stock intake belongs exclusively to Purchases, Goods Receipts, Stock Adjustments, and Stocktake workflows.

---

## 3. Database Tables & Query Architecture

### 3.1 Tables Used
- `categories`: Master product taxonomy container (`id`, `business_id`, `name`, `slug`, `description`, `parent_id`, `display_order`, `status`, `created_at`, `updated_at`).
- `products`: Product master (`id`, `business_id`, `category_id`, `sku`, `barcode`, `name`, `description`, `image_url`, `unit`, `purchase_price_minor`, `selling_price_minor`, `low_stock_threshold`, `track_inventory`, `status`, `created_at`, `updated_at`).
- `inventory_balances`: Read-only aggregated stock queries (`SUM(quantity_on_hand)`) to compute live stock balances without mutating stock.

### 3.2 Parameterized SQL & Safe Pagination
- **Zero Raw String Concat**: All queries use parameterized SQLite statements (`db.prepare(sql).bind(...params)`).
- **Pagination**: Default `limit=50`, max limit `100`, page $\ge 1$.
- **Sorting Allowlist**:
  - `name` $\rightarrow$ `p.name`
  - `sku` $\rightarrow$ `p.sku`
  - `selling_price` $\rightarrow$ `p.selling_price_minor`
  - `purchase_price` $\rightarrow$ `p.purchase_price_minor`
  - `stock` $\rightarrow$ `stock_quantity`
  - `created_at` $\rightarrow$ `p.created_at`
  - `updated_at` $\rightarrow$ `p.updated_at`
  - Any unrecognized sort parameter safely defaults to `p.name ASC`.

---

## 4. Multi-Tenant Isolation & Branch Stock Visibility Architecture

```mermaid
flowchart TD
    Client["Client Request (Cookie or Bearer)"] --> Auth["requireAuth: Validate Session in D1"]
    Auth --> Tenant["requireBusinessContext: Resolve Business Membership"]
    Tenant --> RBAC{"requirePermission('catalog_read' | 'catalog_write')"}
    RBAC -->|Forbidden (e.g. Cashier on POST)| Err403["403 Forbidden"]
    RBAC -->|Authorized| BranchCtx["resolveAuthorizedBranchIds: Resolve User's Accessible Branches"]
    BranchCtx --> Repo["Repository Layer (Scoped by business_id AND branch_id IN authorized_branches)"]
    Repo --> D1[("Cloudflare D1: WHERE business_id = ? AND branch_id IN (?)")]
```

1. **No Client Trust**: Client-supplied `business_id`, `userId`, or `role` in the request body is completely ignored.
2. **Symmetrical Boundary**: User A in Business A receives `404 Not Found` when requesting an ID belonging to Business B.
3. **Header Spoofing Protection**: Supplying `X-Business-Id: biz_other` results in `403 Forbidden` (`Access to specified business is denied.`).
4. **Branch-Level Stock Visibility & Isolation**:
   - Stock quantities in product listing (`GET /api/v1/products`), product detail (`GET /api/v1/products/:id`), category listing (`GET /api/v1/categories`), and category detail (`GET /api/v1/categories/:id`) read exclusively from `inventory_balances` filtered by authorized branch context via `resolveAuthorizedBranchIds()`.
   - Branch-restricted staff (e.g. cashiers) only see inventory quantities for branches explicitly assigned to them in `member_branches`.
   - Business owners and administrators see aggregate stock across all branches within their business by default, or may target a specific branch by supplying the `X-Branch-Id` header.
   - Cross-business stock is never accessible by any role or user.
   - Low-stock filtering (`?lowStock=true`) calculates thresholds strictly against authorized branch stock balances.

### 4.1 HTTP Method Correctness: PUT vs PATCH
- **PUT (`/api/v1/categories/:id`, `/api/v1/products/:id`)**: Implements strict full-replacement semantics. All mandatory fields (`name`, `sku`, `unit`, `purchasePriceMinor`, `sellingPriceMinor`) are strictly required. Omitted optional fields (`barcode`, `categoryId`, `description`, `imageUrl`, `parentId`) are explicitly reset to `null` or domain defaults.
- **PATCH (`/api/v1/categories/:id`, `/api/v1/products/:id`)**: Implements RFC-compliant partial updates. Only specified fields are updated; omitted fields retain their existing database values.

### 4.2 Frontend Demo Fallback Safety
- **Strict Gating**: Frontend fallback to in-memory mock data is strictly gated by the environment configuration `VITE_DATA_SOURCE === 'mock'`.
- **Zero Silent Mutation**: In live mode (`VITE_DATA_SOURCE !== 'mock'`), any backend error (401 unauthenticated, 403 forbidden, 400 validation, 409 conflict, 500 internal, or network failure) immediately rethrows `ApiError` or `TypeError` to trigger the application's authentication flow or error toasts. Failed mutations never report fake success or alter local mock data.

---

## 5. Request & Response Payload Examples

### 5.1 Create Category
**Request:**
```http
POST /api/v1/categories HTTP/1.1
Host: localhost:8787
Origin: http://localhost:5173
Authorization: Bearer <owner_token>
Content-Type: application/json

{
  "name": "Dairy & Beverages",
  "slug": "dairy-beverages",
  "description": "Cold milk, yogurts, juices, and drinks",
  "displayOrder": 1
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "cat_3010f3c5-9bca-4b08-8e65-9831ce8677c3",
    "businessId": "biz_default",
    "name": "Dairy & Beverages",
    "slug": "dairy-beverages",
    "description": "Cold milk, yogurts, juices, and drinks",
    "parentId": null,
    "displayOrder": 1,
    "status": "active",
    "productCount": 0,
    "activeProductCount": 0,
    "totalStockQuantity": 0,
    "createdAt": "2026-11-09 06:40:00",
    "updatedAt": "2026-11-09 06:40:00"
  },
  "requestId": "req_01hgb234xyz89"
}
```

### 5.2 Create Product
**Request:**
```http
POST /api/v1/products HTTP/1.1
Host: localhost:8787
Origin: http://localhost:5173
Authorization: Bearer <owner_token>
Content-Type: application/json

{
  "name": "Pure Desi Butter 500g",
  "sku": "SKU-BUTTER-500G",
  "barcode": "8964000998877",
  "categoryId": "cat_3010f3c5-9bca-4b08-8e65-9831ce8677c3",
  "unit": "pack",
  "purchasePriceMinor": 65000,
  "sellingPriceMinor": 85000,
  "lowStockThreshold": 8,
  "trackInventory": true
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "prod_44c219aa-7f91-4cf8-b391-44759b8a8b12",
    "businessId": "biz_default",
    "sku": "SKU-BUTTER-500G",
    "barcode": "8964000998877",
    "name": "Pure Desi Butter 500g",
    "description": null,
    "categoryId": "cat_3010f3c5-9bca-4b08-8e65-9831ce8677c3",
    "categoryName": "Dairy & Beverages",
    "unit": "pack",
    "purchasePriceMinor": 65000,
    "sellingPriceMinor": 85000,
    "stockQuantity": 0,
    "lowStockThreshold": 8,
    "trackInventory": true,
    "status": "active",
    "imageUrl": null,
    "createdAt": "2026-11-09 06:41:00",
    "updatedAt": "2026-11-09 06:41:00"
  },
  "requestId": "req_01hgb234xyz90"
}
```

### 5.3 List Products with Filters & Pagination
**Request:**
```http
GET /api/v1/products?search=butter&page=1&limit=20&sortBy=selling_price&sortOrder=asc HTTP/1.1
Host: localhost:8787
Origin: http://localhost:5173
Authorization: Bearer <cashier_token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "prod_44c219aa-7f91-4cf8-b391-44759b8a8b12",
      "businessId": "biz_default",
      "sku": "SKU-BUTTER-500G",
      "barcode": "8964000998877",
      "name": "Pure Desi Butter 500g",
      "description": null,
      "categoryId": "cat_3010f3c5-9bca-4b08-8e65-9831ce8677c3",
      "categoryName": "Dairy & Beverages",
      "unit": "pack",
      "purchasePriceMinor": 65000,
      "sellingPriceMinor": 85000,
      "stockQuantity": 24,
      "lowStockThreshold": 8,
      "trackInventory": true,
      "status": "active",
      "imageUrl": null,
      "createdAt": "2026-11-09 06:41:00",
      "updatedAt": "2026-11-09 06:41:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "totalCount": 1,
    "totalPages": 1,
    "hasNextPage": false
  },
  "requestId": "req_01hgb234xyz91"
}
```

---

## 6. Local Testing Commands & Runbook

### Run Full Test Suite
```bash
npm test
```
*Current result: 19 test files passed, 193 tests passed (100% green).*

### Run Catalog & Branch Isolation Regression Tests
```bash
npx vitest run tests/branchStockVisibility.test.ts tests/catalogPutAndFallbackSafety.test.ts tests/categoriesApi.test.ts tests/productsApi.test.ts tests/catalogTenantIsolation.test.ts tests/frontendCatalogIntegration.test.tsx
```

### Type Checking & Production Builds
```bash
npm run build:worker
npm run build
npm run lint
```

### Local Dev Server
```bash
npx wrangler dev --local
```

---

## 7. Known Boundaries & Deferred Capabilities

1. **Branch-Level Price Overrides**: Products currently share business-wide prices (`selling_price_minor`). Branch-specific price books can be added in future multi-store phases.
2. **Variants**: Product variants remain normalized in separate product master rows with shared category references.
3. **Stock Adjustments & Receipts**: Direct inventory mutation via product endpoints is deliberately blocked to preserve double-entry auditability. Inventory intake will be connected in Step 12.7 (Inventory & Stock Movements) and Step 12.8 (Purchases & Receiving).


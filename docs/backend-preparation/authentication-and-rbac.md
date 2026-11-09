# Authentication, Session Security & Role-Based Access Control (RBAC)

## Document Overview
- **Document ID**: `AUTH-SPEC-11.8-07`
- **Status**: Production Security Architecture Specification / Step 11.8
- **Core Technology**: Better-Auth with Cloudflare D1 SQLite Adapter
- **Audience**: Security Engineers, Backend Architects, Store Compliance Officers

---

## 1. Authentication Engine Evaluation & Decision

### 1.1 Candidate Comparison

| Dimension | Option A: Better-Auth on Cloudflare D1 (Recommended) | Option B: Clerk / Auth0 (Managed SaaS) | Option C: Custom JWT in Worker |
| :--- | :--- | :--- | :--- |
| **D1 Compatibility** | Native SQLite D1 adapter with zero latency. | Requires external webhooks and sync to D1. | High maintenance; prone to roll-your-own crypto bugs. |
| **Edge Performance** | Runs directly inside Cloudflare Workers runtime. | External round-trip on every token exchange. | Native edge. |
| **Vendor Lock-in** | **Zero**. Open-source, self-hosted inside D1. | Heavy vendor lock-in. | None. |
| **Cost at Scale** | **\$0 added cost** (included in Cloudflare D1 plan). | Per-Monthly-Active-User (MAU) licensing fees. | \$0. |
| **Multi-Tenancy** | First-class organization/team plugins supported. | Requires expensive Enterprise B2B tier. | Must be written from scratch. |
| **Security Auditing** | Standard PBKDF2/Argon2 hashing & session tokens. | SOC2 Type II managed infrastructure. | High vulnerability risk. |

### 1.2 Selected Architecture: Better-Auth on D1
We recommend **Better-Auth** using its official Cloudflare D1 adapter:
1. All user credentials, sessions, and multi-tenant organization memberships reside inside the application's own D1 database (`users`, `business_members`).
2. Authentication checks execute locally at edge data centers without external network hops.
3. No external dependency risk or user-tier billing cliffs.

---

## 2. Session Security & Transport Hardening

### 2.1 Cookie Architecture
Web sessions are stored in an encrypted, tamper-proof cookie:
- **Cookie Name**: `__session`
- **Flags**: `HttpOnly; Secure; SameSite=Lax; Path=/`
- **Domain**: `.northstarmarket.pk` (shared across Pages and Worker API)
- **Lifecycle**:
  - Web Admin / Backoffice: 24-hour rolling session.
  - POS Register Terminal: 7-day persistent session bound to device registration fingerprint (`device_code`).

### 2.2 Cross-Site Request Forgery (CSRF) Mitigation
Because the API requires custom application headers (`X-Business-Id`, `Idempotency-Key`, `Content-Type: application/json`), standard browser cross-origin requests (`<form>`, `<img>`) cannot trigger state mutations without preflight rejection by Cloudflare Edge.

### 2.3 Rate Limiting & Abuse Prevention
Cloudflare WAF rate limiting is applied to authentication endpoints:
- Max 5 failed login attempts per IP per 15 minutes $\rightarrow$ 15-minute challenge or block.

---

## 3. Role-Based Access Control (RBAC) Matrix

### 3.1 System Roles
1. **`owner`**: Store proprietor. Unrestricted financial and configuration authority.
2. **`admin`**: System administrator. Manages staff, devices, and catalogs.
3. **`manager`**: Shift supervisor. Can authorize voids, stock counts, and adjustments.
4. **`cashier`**: POS operator. Completes sales, takes customer payments.
5. **`inventory_manager`**: Warehouse controller. Issues POs, receives goods, counts stock.
6. **`accountant`**: Financial officer. Views ledgers, reports, and tax filings.

### 3.2 Granular Permission Matrix

| Capability / API Operation | Owner | Admin | Manager | Cashier | Inv. Mgr | Accountant | Approval Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Business Settings & Taxes** |  Yes | Limited | No | No | No | No | `Approved` |
| **Manage Staff & Roles** |  Yes | Yes | No | No | No | No | `Approved` |
| **Product Catalog (Read)** |  Yes | Yes | Yes | Yes | Yes | Yes | `Approved` |
| **Product Catalog (Create/Edit)**|  Yes | Yes | Yes | No | Yes | No | `Approved` |
| **Complete POS Sale** |  Yes | Yes | Yes | Yes | No | No | `Approved` |
| **Apply Line Discount > 10%** |  Yes | Yes | Yes | PIN Req | No | No | `Pending Owner Approval` |
| **Same-Day Sale Void** |  Yes | Yes | Yes | PIN Req | No | No | `Pending Owner Approval` |
| **Customer Return with Restock**|  Yes | Yes | Yes | PIN Req | No | No | `Pending Owner Approval` |
| **Collect Customer Payments** |  Yes | Yes | Yes | Yes | No | Yes | `Approved` |
| **Manual Stock Adjustment** |  Yes | Yes | Yes | No | Yes | No | `Approved` |
| **Confirm Physical Stocktake** |  Yes | Yes | Yes | No | Yes | No | `Approved` |
| **Issue Purchase Order (PO)** |  Yes | Yes | Yes | No | Yes | No | `Approved` |
| **Receive Goods Shipments** |  Yes | Yes | Yes | No | Yes | No | `Approved` |
| **Disburse Supplier Payments** |  Yes | Yes | Limited | No | No | Yes | `Approved` |
| **Financial & Profit Reports** |  Yes | Yes | Limited | No | No | Yes | `Approved` |
| **Export Full Database Backup** |  Yes | No | No | No | No | No | `Approved` |

---

## 4. Multi-Tenant Server-Side Verification Protocol

Every protected Worker endpoint executes an authorization guard middleware:
```typescript
export async function enforceAuthAndTenant(c: Context) {
  // 1. Resolve session from cookie or Bearer token
  const session = await getSession(c)
  if (!session) throw new ApiError('AUTHENTICATION_REQUIRED', 401)

  // 2. Resolve requested Business ID from header
  const targetBusinessId = c.req.header('X-Business-Id')
  if (!targetBusinessId) throw new ApiError('VALIDATION_ERROR', 400, 'Missing X-Business-Id')

  // 3. Query membership in D1
  const member = await c.env.DB.prepare(
    `SELECT role, is_active FROM business_members WHERE business_id = ? AND user_id = ?`
  ).bind(targetBusinessId, session.user.id).first()

  if (!member || !member.is_active) {
    throw new ApiError('FORBIDDEN', 403, 'Not an authorized member of this business.')
  }

  // 4. Bind validated context to request lifecycle
  c.set('user', session.user)
  c.set('businessId', targetBusinessId)
  c.set('role', member.role)
}
```
**Zero Trust Invariant**: The client can never pass an arbitrary `user_id` or `role` to elevate privileges. Context is derived solely from the server-validated membership record.


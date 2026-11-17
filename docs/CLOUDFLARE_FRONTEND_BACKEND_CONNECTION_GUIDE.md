# NORTHSTAR POS — CLOUDFLARE FRONTEND & BACKEND CONNECTION GUIDE
## Production-Grade Staging Deployment & Multi-Tier Cloudflare Integration

**Workspace Root:** `C:\projects\pos-system`  
**Frontend Deployment:** `https://pos-system-5vu.pages.dev` (Cloudflare Pages)  
**Target Staging Worker:** `northstar-pos-api-staging`  
**Target Staging D1 Database:** `northstar-pos-staging`  
**Target Staging R2 Bucket:** `northstar-pos-staging-files`  

---

## 1. Executive Summary & Verification Findings

An exhaustive forensic inspection of the codebase has been completed before altering any settings or resources. Below are the verified facts:

| Item | Finding in Repository | Source Code Location |
| :--- | :--- | :--- |
| **API Base URL Var** | Strictly **`VITE_API_BASE_URL`**. Legacy docs referenced `VITE_API_URL`, but source code **only** reads `VITE_API_BASE_URL`. | [`src/lib/api-client.ts:20`](file:///c:/projects/pos-system/src/lib/api-client.ts#L20) |
| **Data Source Modes** | `VITE_DATA_SOURCE="api"` (live network mode) or `VITE_DATA_SOURCE="mock"` (in-memory demo). | [`.env.example:4`](file:///c:/projects/pos-system/.env.example#L4), all service modules |
| **Silent Mock Fallback** | **Zero silent mock fallbacks exist**. In `api` mode, API failures immediately raise `ApiError` to the UI. Only catalog queries fall back to Dexie cache with `isStale: true` when offline. | [`src/features/products/services/productService.ts:112-120`](file:///c:/projects/pos-system/src/features/products/services/productService.ts#L112-L120) |
| **Pages API URLs** | Currently deployed with relative `/api/v1`. On standalone Pages without a proxy, relative `/api/v1` returns **404 Not Found**. An absolute Worker URL or Pages Function proxy is required. | [`src/lib/api-client.ts:24-35`](file:///c:/projects/pos-system/src/lib/api-client.ts#L24-L35) |
| **Worker Entrypoint** | `worker/src/index.ts` registering 141 total route endpoints with robust CORS & security middleware. | [`wrangler.jsonc:4`](file:///c:/projects/pos-system/wrangler.jsonc#L4), [`worker/src/index.ts`](file:///c:/projects/pos-system/worker/src/index.ts) |
| **D1 & R2 Bindings** | D1 binding: `DB`, R2 binding: `FILES`. | [`wrangler.jsonc:17,26`](file:///c:/projects/pos-system/wrangler.jsonc#L17) |
| **CORS Policy** | Whitelist-based origin checks. Controlled by `ALLOWED_ORIGINS` env var. Must include `https://pos-system-5vu.pages.dev`. | [`worker/src/config/environment.ts:21-31`](file:///c:/projects/pos-system/worker/src/config/environment.ts#L21-L31) |
| **Authentication & Cookies** | `HttpOnly; SameSite=Lax` cookies. Cross-site subresource calls between `pages.dev` and `workers.dev` require careful architectural routing (detailed in Section 6). | [`worker/src/auth/sessionService.ts:58-70`](file:///c:/projects/pos-system/worker/src/auth/sessionService.ts#L58-L70) |

---

## 2. Architecture & Staging Configuration

### 2.1 Staging Environment in `wrangler.jsonc`

The existing [`wrangler.jsonc`](file:///c:/projects/pos-system/wrangler.jsonc) contains a staging placeholder. To deploy the staging backend safely without affecting local or production environments, the staging section maps to the dedicated staging resources:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pos-system-worker",
  "main": "worker/src/index.ts",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],

  "vars": {
    "ENVIRONMENT": "local",
    "TIMEZONE": "Asia/Karachi",
    "SERVICE_NAME": "pos-system-api",
    "API_VERSION": "v1"
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "pos-system-local",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "worker/migrations"
    }
  ],

  "r2_buckets": [
    {
      "binding": "FILES",
      "bucket_name": "pos-system-local-files"
    }
  ],

  "env": {
    "staging": {
      "name": "northstar-pos-api-staging",
      "vars": {
        "ENVIRONMENT": "staging",
        "TIMEZONE": "Asia/Karachi",
        "SERVICE_NAME": "northstar-pos-api-staging",
        "API_VERSION": "v1",
        "ALLOWED_ORIGINS": "https://pos-system-5vu.pages.dev"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "northstar-pos-staging",
          "database_id": "<STAGING_D1_DATABASE_ID>",
          "migrations_dir": "worker/migrations"
        }
      ],
      "r2_buckets": [
        {
          "binding": "FILES",
          "bucket_name": "northstar-pos-staging-files"
        }
      ]
    },
    "production": {
      "name": "pos-system-worker-production",
      "vars": {
        "ENVIRONMENT": "production",
        "TIMEZONE": "Asia/Karachi",
        "SERVICE_NAME": "pos-system-api-production",
        "API_VERSION": "v1"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "pos-system-prod-d1",
          "database_id": "<PROD_D1_DATABASE_ID_PLACEHOLDER>",
          "migrations_dir": "worker/migrations"
        }
      ],
      "r2_buckets": [
        {
          "binding": "FILES",
          "bucket_name": "pos-system-prod-files"
        }
      ]
    }
  }
}
```

---

## 3. Remote Staging Resource Provisioning Steps

Run these commands in PowerShell or Bash from the repository root `C:\projects\pos-system`.

### Step 3.1: Authenticate with Cloudflare Wrangler
```powershell
npx wrangler whoami
```
*(If unauthenticated, run `npx wrangler login` to authorize the CLI via browser).*

### Step 3.2: Create Remote Staging D1 Database
```powershell
npx wrangler d1 create northstar-pos-staging
```
**Sample Output:**
```text
[[d1_databases]]
binding = "DB"
database_name = "northstar-pos-staging"
database_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```
> [!IMPORTANT]
> Copy the returned `database_id` and update `"database_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"` under `"env": { "staging": { ... } }` in `wrangler.jsonc`.

### Step 3.3: Create Remote Staging R2 Bucket
```powershell
npx wrangler r2 bucket create northstar-pos-staging-files
```

### Step 3.4: Configure Remote Staging Secrets
The Cloudflare Worker requires a cryptographically strong `AUTH_SECRET` for HMAC token verification and session integrity.

Generate a 64-character hex secret and provision it directly to Cloudflare Secret Storage:
```powershell
# Generate a secret (or use OpenSSL / crypto):
# e.g., openssl rand -hex 32

npx wrangler secret put AUTH_SECRET --env staging
```
*(When prompted: paste your 32+ character random secret string).*

---

## 4. Database Migrations Execution (0001–0021)

### 4.1 Migration Verification
All 21 SQL migrations located in [`worker/migrations/`](file:///c:/projects/pos-system/worker/migrations) must be applied in strict numerical order:

1. `0001_businesses_and_branches.sql`
2. `0002_catalog.sql`
3. `0003_customers_and_suppliers.sql`
4. `0004_sales_and_invoices.sql`
5. `0005_payments_and_ledgers.sql`
6. `0006_purchases_and_goods_receipts.sql`
7. `0007_inventory_and_costing.sql`
8. `0008_expenses_and_audit_logs.sql`
9. `0009_indexes_and_constraints.sql`
10. `0010_sessions_and_auth.sql`
11. `0011_file_storage.sql`
12. `0012_sync_and_devices.sql`
13. `0013_offline_pos_and_allocations.sql`
14. `0014_expenses_and_staff.sql`
15. `0015_rate_limiting.sql`
16. `0016_pricing_overrides_and_offline_snapshots.sql`
17. `0017_offline_auth_usage_tracking.sql`
18. `0018_hash_session_tokens.sql`
19. `0019_supplier_payment_methods.sql`
20. `0020_payment_void_and_inventory_branch_cost.sql`
21. `0021_files_expense_related_type.sql`

### 4.2 Safe Execution Command
> [!WARNING]
> Always verify the target flag `--env staging` or database name `northstar-pos-staging` to ensure production is never targeted.

```powershell
npx wrangler d1 migrations apply northstar-pos-staging --remote
```
Wrangler will list all 21 pending migrations and prompt for confirmation: `Yes`.

### 4.3 Verify Remote Migration State
Confirm that all 21 migrations were committed to the remote D1 instance:
```powershell
npx wrangler d1 execute northstar-pos-staging --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id ASC;"
```
*(Verify 21 rows are returned).*

---

## 5. Worker API Deployment

### 5.1 Manual CLI Deployment (Fastest & Verified)
To deploy the worker immediately to Cloudflare:
```powershell
npx wrangler deploy --env staging
```
**Result:** Wrangler bundles `worker/src/index.ts` with esbuild, binds the staging D1 database and R2 bucket, and outputs your live Worker endpoint:
```text
Uploaded northstar-pos-api-staging (x.xx sec)
Deployed northstar-pos-api-staging triggers:
  https://northstar-pos-api-staging.<your-subdomain>.workers.dev
```

### 5.2 Git-Connected Worker Deployment (Cloudflare Dashboard)
To configure continuous deployment from GitHub:
1. Navigate to **Cloudflare Dashboard** → **Workers & Pages** → **Create application** → **Workers**.
2. Select **Connect to Git** and choose repository `pos-system`.
3. Configure settings:
   - **Production branch:** `main` (or `develop` for staging)
   - **Root directory:** `/`
   - **Build command:** `npm run build:worker` (optional, Wrangler bundles automatically)
   - **Deploy command:** `npx wrangler deploy --env staging`
4. Under **Settings** → **Variables and Secrets**:
   - Add Secret: `AUTH_SECRET`
   - Add Variable: `ENVIRONMENT` = `staging`
   - Add Variable: `ALLOWED_ORIGINS` = `https://pos-system-5vu.pages.dev`
   - Bind D1: Variable name `DB` → `northstar-pos-staging`
   - Bind R2: Variable name `FILES` → `northstar-pos-staging-files`

---

## 6. Frontend Connection & Cross-Origin / Cookie Compatibility

### 6.1 The Cross-Site Cookie Challenge (Crucial Insight)
In Cloudflare:
- Frontend Origin: `https://pos-system-5vu.pages.dev`
- Worker Origin: `https://northstar-pos-api-staging.<subdomain>.workers.dev`

`pages.dev` and `workers.dev` are separate entries on the **Public Suffix List (PSL)**. Modern browsers (Chrome, Edge, Safari, Firefox) classify subresource calls between them as **cross-site (third-party)**.

Because [`worker/src/auth/sessionService.ts`](file:///c:/projects/pos-system/worker/src/auth/sessionService.ts#L62) configures `SameSite=Lax`:
- Browsers **refuse** to attach `SameSite=Lax` cookies to cross-site `fetch` requests (even with `credentials: 'include'`).
- Calls to protected endpoints (`/api/v1/auth/me`, `/api/v1/products`) will fail with `401 Unauthorized` because the session cookie is dropped by the browser.

### 6.2 Solution Architectures

#### Architecture Option A: Cloudflare Pages Proxy Function (Recommended for pages.dev)
Add a zero-overhead Cloudflare Pages Function at `functions/api/[[path]].ts` that reverse-proxies `/api/*` directly to the Worker over Cloudflare's edge network:

**File:** `functions/api/[[path]].ts`
```typescript
export const onRequest: PagesFunction<{ WORKER_API_HOST: string }> = async (context) => {
  const url = new URL(context.request.url)
  // Target worker hostname (e.g. northstar-pos-api-staging.<subdomain>.workers.dev)
  const targetHost = context.env.WORKER_API_HOST || 'northstar-pos-api-staging.<subdomain>.workers.dev'
  
  url.hostname = targetHost
  url.port = '443'
  url.protocol = 'https:'

  const modifiedRequest = new Request(url.toString(), {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
    redirect: 'manual',
  })

  return fetch(modifiedRequest)
}
```
**Benefits:**
- **Same-Origin:** The browser communicates strictly with `https://pos-system-5vu.pages.dev/api/v1/...`.
- **Zero CORS:** No OPTIONS preflight latency.
- **Cookies Work Naturally:** `SameSite=Lax; HttpOnly` works seamlessly without third-party cookie restrictions.
- **Frontend Config:** `VITE_API_BASE_URL` remains `/api/v1`.

---

#### Architecture Option B: Direct Cross-Origin with Custom Domain (Production Best Practice)
Attach a custom domain in Cloudflare (e.g. `northstarpos.com`):
- Frontend: `app.northstarpos.com` (Cloudflare Pages custom domain)
- Worker: `api.northstarpos.com` (Cloudflare Worker custom domain)

Since both share the same registered domain (`northstarpos.com`), they are **same-site**!
- Set `ALLOWED_ORIGINS` = `https://app.northstarpos.com`
- Set `VITE_API_BASE_URL` = `https://api.northstarpos.com`
- Cookies function reliably without third-party restrictions.

---

#### Architecture Option C: Direct Cross-Origin without Custom Domain
If using the direct Worker URL (`https://northstar-pos-api-staging.<subdomain>.workers.dev`) without Pages proxy:
1. Ensure Worker environment variable `ALLOWED_ORIGINS` includes `https://pos-system-5vu.pages.dev`.
2. Configure session cookie with `SameSite=None; Secure; Partitioned` (or support `Authorization: Bearer <token>` in frontend state).

---

## 7. Cloudflare Pages Configuration Update & Redeployment

Update the Cloudflare Pages deployment settings in the Cloudflare Dashboard:

1. Navigate to **Cloudflare Dashboard** → **Workers & Pages** → **pos-system-5vu** → **Settings** → **Environment variables**.
2. Configure the following variables for **Production** (and Preview):

| Variable Name | Value | Purpose |
| :--- | :--- | :--- |
| `VITE_DATA_SOURCE` | `api` | Switches frontend from demo mock mode to live Worker API calls. |
| `VITE_API_BASE_URL` | `https://northstar-pos-api-staging.<subdomain>.workers.dev` *(or `/api/v1` if using Option A)* | Base URL for all API requests. |

3. Trigger a redeployment:
   - Go to **Deployments** tab → Click the latest deployment → Click **Retry deployment** (or push a commit to trigger a build).

---

## 8. End-to-End Verification Runbook

Execute these tests to confirm full end-to-end functionality between Cloudflare Pages, Worker, D1, and R2.

### 8.1 Probe Health and Readiness
```powershell
# 1. Health Probe
curl -i https://northstar-pos-api-staging.<subdomain>.workers.dev/api/v1/health

# Expected 200 OK:
# {"status":"healthy","service":"northstar-pos-api-staging","version":"v1"}

# 2. Database Readiness Probe
curl -i https://northstar-pos-api-staging.<subdomain>.workers.dev/api/v1/ready

# Expected 200 OK:
# {"status":"ready","database":"connected"}
```

### 8.2 One-Time Master Bootstrap (Initialize Business & Admin)
Initialize your master business and root owner account:
```powershell
curl -i -X POST https://northstar-pos-api-staging.<subdomain>.workers.dev/api/v1/auth/bootstrap `
  -H "Content-Type: application/json" `
  -d '{
    "businessName": "Northstar Flagship Staging",
    "businessCode": "NS-STG",
    "name": "System Administrator",
    "email": "admin@northstarpos.com",
    "password": "SecurePassword2026!"
  }'
```
**Expected Response:** `201 Created` with session record and `Set-Cookie` header.

### 8.3 Verify D1 Database Persistence
Query the remote staging D1 database directly to confirm records were persisted:
```powershell
npx wrangler d1 execute northstar-pos-staging --remote --command "SELECT id, name, email, status FROM users;"
npx wrangler d1 execute northstar-pos-staging --remote --command "SELECT id, code, name FROM businesses;"
npx wrangler d1 execute northstar-pos-staging --remote --command "SELECT id, code, name FROM branches;"
```

### 8.4 Test Product and Customer Creation in UI
1. Open `https://pos-system-5vu.pages.dev`.
2. Login with `admin@northstarpos.com` / `SecurePassword2026!`.
3. Navigate to **Catalog** → Click **New Product** → Create a product (e.g., *Espresso Blend*, SKU `ESP-001`, Price `500.00`).
4. Navigate to **Customers** → Click **New Customer** → Create a customer (e.g., *Ali Khan*, Phone `03001234567`).
5. Query D1 via Wrangler CLI to verify records:
```powershell
npx wrangler d1 execute northstar-pos-staging --remote --command "SELECT id, name, sku, selling_price_minor FROM products;"
npx wrangler d1 execute northstar-pos-staging --remote --command "SELECT id, customer_code, name, phone FROM customers;"
```

### 8.5 Test R2 File Storage Upload
Upload a receipt or product image via the UI or API:
```powershell
# Verify files in R2 staging bucket
npx wrangler r2 object list northstar-pos-staging-files
```

---

## 9. Summary of Remaining Manual Actions

To complete the connection without automated changes:

1. [ ] Run `npx wrangler d1 create northstar-pos-staging` and paste the generated `database_id` into `wrangler.jsonc` under `env.staging`.
2. [ ] Run `npx wrangler r2 bucket create northstar-pos-staging-files`.
3. [ ] Run `npx wrangler secret put AUTH_SECRET --env staging`.
4. [ ] Run `npx wrangler d1 migrations apply northstar-pos-staging --remote`.
5. [ ] Run `npx wrangler deploy --env staging`.
6. [ ] Update Cloudflare Pages environment variables (`VITE_DATA_SOURCE="api"` and `VITE_API_BASE_URL`) and trigger redeployment.
7. [ ] Visit `https://pos-system-5vu.pages.dev/register` (or call `/api/v1/auth/bootstrap`) to initialize your administrator account.


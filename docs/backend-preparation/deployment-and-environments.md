# Deployment Architecture, Environments & Wrangler Blueprint

## Document Overview
- **Document ID**: `DEP-SPEC-11.8-12`
- **Status**: Production Deployment Specification / Step 11.8
- **Tooling**: Cloudflare Wrangler CLI v3+, Cloudflare Pages, GitHub Actions CI/CD
- **Audience**: DevOps Engineers, Release Managers, Cloudflare Operators

---

## 1. Environment Topology & Infrastructure Separation

To guarantee absolute data isolation between development, testing, and live business operations:

| Resource Dimension | Local Development (`local`) | Staging Environment (`staging`) | Production Environment (`production`) |
| :--- | :--- | :--- | :--- |
| **Worker Name** | `northstar-pos-worker-local` | `northstar-pos-worker-staging` | `northstar-pos-worker-prod` |
| **D1 Database Binding** | Local Miniflare SQLite | `pos-db-staging` (`<staging_d1_id>`) | `pos-db-prod` (`<prod_d1_id>`) |
| **R2 Storage Binding** | Local filesystem emulator | `r2-pos-files-staging` | `r2-pos-files-prod` |
| **Pages Project** | Vite Dev Server (`localhost:5173`) | `northstar-pos-staging.pages.dev` | `pos.northstarmarket.pk` |
| **API Base URL** | `http://localhost:8787/api/v1` | `https://staging-api.northstarmarket.pk/api/v1` | `https://pos.northstarmarket.pk/api/v1` |
| **Environment Flag** | `ENVIRONMENT="local"` | `ENVIRONMENT="staging"` | `ENVIRONMENT="production"` |
| **Timezone Anchor** | `Asia/Karachi` | `Asia/Karachi` | `Asia/Karachi` |

---

## 2. Production Wrangler Configuration Blueprint

Below is the design template for `wrangler.toml` (to be created with actual Cloudflare resource IDs in Step 12):

```toml
name = "northstar-pos-worker"
main = "src/index.ts"
compatibility_date = "2026-11-01"
compatibility_flags = ["nodejs_compat"]

# ---------------------------------------------------------------------------
# DEFAULT (LOCAL DEVELOPMENT)
# ---------------------------------------------------------------------------
[vars]
ENVIRONMENT = "local"
APP_NAME = "Northstar POS"
BASE_CURRENCY = "PKR"
TIMEZONE = "Asia/Karachi"
ALLOW_NEGATIVE_STOCK = "true"

[[d1_databases]]
binding = "DB"
database_name = "pos-db-dev"
database_id = "00000000-0000-0000-0000-000000000000"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "r2-pos-files-dev"

# ---------------------------------------------------------------------------
# STAGING ENVIRONMENT
# ---------------------------------------------------------------------------
[env.staging]
name = "northstar-pos-worker-staging"
routes = [
  { pattern = "staging-api.northstarmarket.pk/api/v1/*", zone_name = "northstarmarket.pk" }
]

[env.staging.vars]
ENVIRONMENT = "staging"
BASE_CURRENCY = "PKR"
TIMEZONE = "Asia/Karachi"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "pos-db-staging"
database_id = "PLACEHOLDER_STAGING_D1_DATABASE_ID"

[[env.staging.r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "r2-pos-files-staging"

# ---------------------------------------------------------------------------
# PRODUCTION ENVIRONMENT
# ---------------------------------------------------------------------------
[env.production]
name = "northstar-pos-worker-prod"
routes = [
  { pattern = "pos.northstarmarket.pk/api/v1/*", zone_name = "northstarmarket.pk" }
]

[env.production.vars]
ENVIRONMENT = "production"
BASE_CURRENCY = "PKR"
TIMEZONE = "Asia/Karachi"

[[env.production.d1_databases]]
binding = "DB"
database_name = "pos-db-prod"
database_id = "PLACEHOLDER_PRODUCTION_D1_DATABASE_ID"

[[env.production.r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "r2-pos-files-prod"

[env.production.triggers]
crons = ["0 21 * * *"] # Daily backup export at 02:00 AM PKT
```

---

## 3. Secret Management & Zero-Leakage Policy

API keys, hashing peppers, and session encryption keys must **never** be committed to Git or specified in `wrangler.toml`:

```bash
# Production secrets injected directly via Wrangler encrypted secret store
npx wrangler secret put AUTH_SECRET --env production
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put SENTRY_DSN --env production
```

---

## 4. HTTP Cache-Control Matrix

| Route Category | Target Response | Cache-Control Header |
| :--- | :--- | :--- |
| **Vite Static Chunks** | JS, CSS, Web Fonts (`/assets/*`) | `public, max-age=31536000, immutable` |
| **PWA Manifest & Icons** | `/manifest.json`, `/icons/*` | `public, max-age=86400, stale-while-revalidate=3600` |
| **SPA HTML Entrypoint** | `/index.html` | `no-cache, no-store, must-revalidate` |
| **Authenticated APIs** | All `/api/v1/*` endpoints | `no-store, no-cache, private, max-age=0` |


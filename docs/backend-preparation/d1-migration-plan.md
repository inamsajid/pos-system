# Cloudflare D1 Database Migration Plan & Operational Protocol

## Document Overview
- **Document ID**: `MIG-SPEC-11.8-04`
- **Status**: Production Migration Specification / Step 11.8
- **Engine**: Cloudflare D1 Migrations Engine (`wrangler d1 migrations`)
- **Audience**: Database Administrators, Backend Engineers, Release Managers

---

## 1. Migration Protocol & Principles

Cloudflare D1 manages schema changes via sequential SQL files tracked in a dedicated `d1_migrations` table stored inside each D1 database instance.

### 1.1 Non-Negotiable Operational Rules
1. **Immutability of Applied Migrations**: Once a migration SQL file has been applied to staging or production, it must **never** be edited, renamed, or reordered.
2. **Forward-Only Changes**: All corrections, schema alterations, and index additions must be introduced via new forward migrations.
3. **Pre-Migration Snapshot**: Prior to applying migrations in production, a full logical export or Time Travel bookmark must be established.
4. **Three-Tier Progression**: Migrations must follow the strict promotion sequence:
   $$\text{Local D1 (Wrangler)} \quad \longrightarrow \quad \text{Remote Staging} \quad \longrightarrow \quad \text{Remote Production}$$
5. **No Production Experiments**: Experimental schema alterations are strictly prohibited against staging or production.

---

## 2. Sequential Migration Breakdown

To guarantee clean foreign key dependency resolution, the initial Step 12 deployment will execute across 9 modular migration scripts:

| Sequence | Migration File Name | Target Entities | Dependency Rationale |
| :--- | :--- | :--- | :--- |
| **0001** | `0001_business_and_auth.sql` | `businesses`, `branches`, `users`, `business_members`, `member_branches`, `business_settings` | Establishes root multi-tenant hierarchy and authentication identities. |
| **0002** | `0002_catalog.sql` | `categories`, `products` | Product catalog depends on `businesses`. |
| **0003** | `0003_customers_and_suppliers.sql` | `customers`, `suppliers`, `supplier_products` | Master customer and vendor records. |
| **0004** | `0004_sales_and_invoices.sql` | `sales`, `sale_items`, `invoices`, `sale_returns`, `sale_return_items` | Sales transaction tables referencing products and customers. |
| **0005** | `0005_payments_and_ledgers.sql` | `payments`, `payment_methods`, `payment_allocations`, `customer_ledger_transactions` | Receivables and customer financial ledger. |
| **0006** | `0006_purchases_and_goods_receipts.sql`| `purchases`, `purchase_items`, `goods_receipts`, `goods_receipt_items`, `supplier_payments`, `supplier_payment_allocations`, `supplier_ledger_transactions` | Purchasing pipeline, vendor bills, payables ledger. |
| **0007** | `0007_inventory_and_costing.sql` | `inventory_balances`, `stock_movements`, `stock_adjustments`, `stock_counts`, `stock_count_items` | Stock ledgers referencing branches and products. |
| **0008** | `0008_expenses_and_audit.sql` | `expense_categories`, `expenses`, `audit_logs`, `idempotency_keys`, `device_registrations` | Operational overhead and system governance. |
| **0009** | `0009_indexes_and_constraints.sql` | Composite performance indexes across all tables | Applied after table creation for optimal ingestion. |

---

## 3. Migration Application Procedures (Wrangler CLI)

### 3.1 Local Development Workflow
```bash
# 1. Create a new migration file in /migrations
npx wrangler d1 migrations create pos-db-dev add_feature_name

# 2. Inspect pending local migrations
npx wrangler d1 migrations list pos-db-dev --local

# 3. Apply migrations to local SQLite emulator (.wrangler/state)
npx wrangler d1 migrations apply pos-db-dev --local
```

### 3.2 Staging Verification Workflow
```bash
# 1. Verify pending migrations against remote staging D1
npx wrangler d1 migrations list pos-db-staging --remote

# 2. Apply migrations to remote staging D1
npx wrangler d1 migrations apply pos-db-staging --remote

# 3. Run automated integration test suite against staging API
npm run test:e2e:staging
```

### 3.3 Production Cutover Procedure
```bash
# 1. Capture current D1 Time Travel bookmark
npx wrangler d1 time-travel info pos-db-prod

# 2. Capture logical SQL backup
npx wrangler d1 export pos-db-prod --remote --output="./backups/pre-mig-$(date +%Y%m%d%H%M).sql"

# 3. Apply migrations to production D1
npx wrangler d1 migrations apply pos-db-prod --remote

# 4. Verify post-migration table health
npx wrangler d1 execute pos-db-prod --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

---

## 4. Rollback and Disaster Recovery Procedures

Cloudflare D1 does not execute down-migrations natively. If a migration introduces an error:

### 4.1 Automated Point-in-Time Recovery (D1 Time Travel)
Cloudflare D1 maintains continuous transaction logs allowing point-in-time restoration within its retention window:
```bash
# Restore production database to timestamp before failed migration
npx wrangler d1 time-travel restore pos-db-prod --timestamp="2026-11-08T14:30:00Z"
```
> [!CAUTION]
> D1 Time Travel restoration overwrites the entire target database. It must be treated as a major recovery action requiring written approval from the Lead Architect.

### 4.2 Forward-Fix Protocol
For minor schema oversights (e.g., missing index, column typo):
1. Create a corrective forward migration (e.g. `0010_fix_product_index.sql`).
2. Test on local D1 and staging.
3. Apply immediately to production without rolling back existing state.


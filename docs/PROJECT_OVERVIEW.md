# Northstar POS — Comprehensive Project Overview & Technical Architecture

**Generated On:** 2026-11-16  
**Document Type:** Full System Architecture, Scope & Technology Specification  
**Repository:** `c:\projects\pos-system`  
**Application Name:** Northstar POS  

---

## 1. Executive Summary & Project Purpose

**Northstar POS** is a modern, high-reliability, edge-native **Point of Sale (POS), Inventory Control, Multi-Branch Supply Chain, and Financial Subledger System**. 

The system is designed specifically for single-store and multi-branch retail/wholesale businesses (configured with Pakistan Rupee `PKR` minor units and `Asia/Karachi` timezone defaults) that demand:
- **Instant offline checkout resilience**: Cashiers can continue barcode scanning, ringing up sales, calculating line discounts/taxes, and issuing receipts during complete internet disconnections.
- **Serverless edge performance**: Zero cold-start latency, running on Cloudflare’s global edge network.
- **Strict double-entry accounting integrity**: Server-authoritative pricing, tamper-proof sales, multi-tender payments, moving weighted average (MWA) inventory valuation, and auditable financial subledgers.
- **Zero data loss & concurrency protection**: Conflict-free offline sync via IndexedDB Outbox and atomic SQLite row-level constraint guards against inventory overselling.

---

## 2. Complete Technology Stack

### 2.1 Frontend Client (Single Page Application & PWA)
- **Runtime & Language**: React 19 (`^19.3.1`) + TypeScript (`~7.0.2`).
- **Build Tool & Bundler**: Vite 8 (`^8.3.6`) with dynamic `guardedLazy` route-level code splitting (individual production chunks under 50kB).
- **Styling & UI Design System**: Tailwind CSS v4 (`^4.3.5`) via `@tailwindcss/vite` with a custom bespoke design system (neutral slate palettes, high-contrast badges, mobile-responsive layouts, and keyboard shortcut listeners).
- **Icons**: Lucide React (`^1.70.0`).
- **Routing**: React Router DOM v7 (`^7.18.5`) with role-based `PermissionGuard` route protection.
- **Server State & Data Fetching**: TanStack Query (React Query) v5 (`^5.107.1`) with tenant-scoped query keys `[businessId, branchId, ...]`.
- **Client State Management**: Zustand v5 (`^5.1.0`) for active sessions and contextual state.
- **Form Management & Validation**: React Hook Form v7 (`^7.91.0`) + Zod v4 (`^4.6.7`).
- **Charts & Data Visualization**: Recharts v3 (`^3.10.1`).
- **Offline Client Database**: Dexie.js v4/v5 (IndexedDB wrapper) managing local caches for products, customers, transactions, offline authorization grants, and an ACID outbox queue.
- **Service Worker & PWA Shell**: Custom Service Worker (`public/sw.js`) dynamically fed by `dist/asset-manifest.json` from a custom Vite build plugin, enabling instant cold offline app boot.

### 2.2 Backend Edge Architecture (Cloudflare Workers)
- **Edge Compute Engine**: Cloudflare Workers (`@cloudflare/workers-types` `^5.20261108.1`) with native Web Standard APIs (`fetch`, `crypto.subtle`, `Request`, `Response`).
- **Primary Database**: Cloudflare D1 (Serverless Distributed SQLite) with 21 forward-only SQL migrations applied locally and managed via Wrangler CLI.
- **Blob & Media Storage**: Cloudflare R2 Object Storage (S3-compatible) for category banners, product imagery, and expense receipt attachments.
- **Cryptography & Security**: Native Web Crypto API for SHA-256 session token hashing and HMAC-SHA256 offline authorization signatures.
- **API Architecture**: Fully typed REST API with route dispatching, JSON schema validation (Zod), and centralized HTTP status error handling.

### 2.3 Quality Assurance, Verification & Tooling
- **Testing Framework**: Vitest v5 (`^5.1.0`) running 83 test suites and 562 automated tests (100% pass rate).
- **DOM Simulation**: JSDOM v31 + `@testing-library/react` v16 + `fake-indexeddb` v6.
- **Linter**: Oxlint (`^1.90.0`) delivering sub-second static analysis.
- **Deployment & Cloud Tooling**: Cloudflare Wrangler CLI v4 (`^4.158.0`).

---

## 3. High-Level Architecture & Data Flow

```
                      +---------------------------------------+
                      |       Web Browser / PWA Client        |
                      |  React 19 + Tailwind v4 + Dexie (IDB) |
                      +-------------------+-------------------+
                                          |
                        [Online / REST API via HTTPS]
                                          |
                                          v
                      +---------------------------------------+
                      |       Cloudflare Workers API          |
                      |  139 Protected Routes (Least RBAC)    |
                      +-------+-----------------------+-------+
                              |                       |
                     [SQL Queries / D1]      [Object Uploads / R2]
                              |                       |
                              v                       v
               +---------------------------+   +-------------------+
               | Cloudflare D1 (SQLite)    |   | Cloudflare R2     |
               | - Multi-tenant isolation  |   | - Product Photos  |
               | - Subledgers & Journals   |   | - Expense Files   |
               | - Stock balances & logs   |   +-------------------+
               +---------------------------+
```

### Offline-First Checkout Flow
1. **Catalog Granting**: When online, the terminal downloads an offline authorization grant signed with HMAC-SHA256, specifying allowable products, expiry timestamp, transaction limits, and maximum minor amount.
2. **Provisional Offline Sale**: When offline, the POS rings up items against the cached catalog, commits provisional stock deductions into local Dexie, creates a signed local outbox entry, and prints/generates an offline receipt.
3. **Reconnection & Outbox Dispatcher**: As network connectivity resumes, the `OutboxDispatcher` reads queued records in deterministic FIFO order, verifies SHA-256 payload canonical hashes, and transmits them to `POST /api/v1/offline/sales/commit`.
4. **Authoritative Server Commit**: The Worker validates the subset HMAC, checks atomic usage limits (`offline_auth_usage`), deducts stock with SQLite constraints, logs change-log entries for peer syncing, and returns authoritative sales confirmations.

---

## 4. Key Functional Modules & Project Scope

### 4.1 Point of Sale (POS) Checkout
- Barcode lookup, item search, quantity toggles, and responsive category browsing.
- Line-item discounts and overall cart discounts validated in integer minor units (PKR cents).
- Server-authoritative tax calculation with business-level tax settings.
- Server-authoritative price overrides requiring `price_override` permission, accompanied by reason capture and audit logging.
- Split payment tenders (Cash, Card, Bank Transfer, Cheque, Customer Credit).
- Offline indicator banner, drawer for outbox queue status (Draft, Pending, Syncing, Synced, Conflict, Failed).

### 4.2 Inventory Control & Moving Weighted Average (MWA) Costing
- Multi-branch stock visibility and balance management.
- Atomic SQL checks (`quantity_on_hand >= ?`) preventing concurrent sales from overselling.
- Prevention of phantom stock creation on new item initialization (`INSERT OR IGNORE ... 0`).
- Branch-isolated moving weighted average unit costing (`inventory_balances.average_cost_minor`) updated during Goods Receipt Notes (GRN).
- Stock Count audit workflows supporting drafts, variance calculation, and managerial reconciliation.

### 4.3 Purchasing & Supplier Management
- Supplier directory with contact profiles, tax numbers, and account balances.
- Purchase Order (PO) creation with line items, tax, and discount calculation.
- Physical Goods Receipt Notes (GRN): Payables are recognized strictly when items are physically received; draft POs cannot inflate payables.
- Multi-tender supplier disbursements (`supplier_payment_methods`) tracking split payments without truncating methods.
- Supplier subledger with running balances, invoices, payment history, and unallocated advances.

### 4.4 Customer Management & Accounts Receivable
- Customer profiles (Walk-in, Individual, Corporate) with credit limits and notes.
- Customer Ledger showing total sales, payments, debit/credit running balances, and unallocated advances.
- Receive Payment modal with invoice-level allocation (keyed to canonical `inv_*` IDs), preventing over-allocation or duplicate invoice IDs.

### 4.5 Financial Reports & Business Intelligence
- Real-time Dashboard KPIs (Gross Revenue, Net Sales, Gross Profit, Total Expenses, and Net Profit).
- Posted Expenses integration (`worker/src/features/expenses/`), categorizing business expenditures and receipt uploads via Cloudflare R2.
- Detailed reporting screens: Sales by Category, Payment Method Breakdown, Tax Liabilities, and Profit & Loss.
- Secure CSV exports with formula injection neutralization (prefixing triggers like `=`, `+`, `-`, `@` with `'`).

### 4.6 Multi-Tenant, Multi-Branch & Staff RBAC
- Multi-tenant architecture keyed on `business_id` with fail-closed security guards.
- Dynamic Header switcher to toggle between authorized Stores and Branches with automatic cache invalidation.
- Granular Role-Based Access Control (RBAC): Owner, Admin, Manager, Cashier, Inventory Clerk.
- Staff Management: User invitations with acceptance route (`/accept-invitation`), branch assignments, and immediate session termination upon suspension (`sessionService.revokeAllUserSessions`).
- SHA-256 hashed session token storage in D1 database.

---

## 5. File System & Codebase Directory Structure

```text
c:\projects\pos-system\
├── .env.example                     # Environment template (defaults to live API)
├── package.json                     # Project manifest and package dependencies
├── tsconfig.json                    # Client TypeScript configuration
├── tsconfig.worker.json             # Cloudflare Worker TypeScript configuration
├── vite.config.ts                   # Vite bundler, Tailwind, and PWA manifest plugins
├── wrangler.jsonc                   # Cloudflare Workers, D1 database & R2 bucket bindings
├── public/
│   ├── favicon.ico
│   ├── manifest.webmanifest         # PWA installation manifest
│   └── sw.js                        # Offline precaching Service Worker
├── src/                             # Frontend React 19 Client
│   ├── api/                         # Global query keys and API contracts
│   ├── app/                         # App entry, router.tsx, and PermissionGuard
│   ├── components/                  # Shared UI components (Buttons, Inputs, Modals, Cards)
│   ├── domain/                      # Core domain utilities (Money calculations in minor units)
│   ├── features/                    # Modular feature directories:
│   │   ├── auth/                    # Login, Register, AcceptInvitationPage, AuthContext
│   │   ├── categories/              # Category CRUD and catalog management
│   │   ├── customers/               # Customer list, creation, editing, customer ledger
│   │   ├── dashboard/               # Live analytics, KPIs, and revenue charts
│   │   ├── expenses/                # Expense logging, receipt uploads, and categories
│   │   ├── files/                   # Cloudflare R2 authenticated blob helpers
│   │   ├── inventory/               # Stock levels, movements, and StockCountPage
│   │   ├── invoices/                # Sales invoices and payment status
│   │   ├── ledger/                  # Shared financial subledgers (Customer & Supplier)
│   │   ├── payments/                # Customer payments and invoice allocations
│   │   ├── pos/                     # Main POS checkout interface, Cart, and Offline Drawer
│   │   ├── products/                # Product catalog, pricing, SKU barcodes
│   │   ├── purchases/               # Purchase Orders (PO) and Goods Receipt (GRN)
│   │   ├── reports/                 # Financial, sales, tax, and profit & loss reports
│   │   ├── sales/                   # Sales order history, details, and void workflows
│   │   ├── settings/                # Business settings, tax rules, and receipt preferences
│   │   ├── staff/                   # Staff accounts, roles, branch assignments, and invitations
│   │   ├── supplier-payments/       # Supplier disbursements and split-payment modal
│   │   └── suppliers/               # Supplier management and supplier ledger
│   ├── layouts/                     # Dashboard layouts, Header with Branch Switcher, Sidebar
│   └── lib/                         # Core libraries:
│       ├── api-client.ts            # Normalized API client with automatic business headers
│       ├── permissions.ts           # Client-side permission definitions
│       └── offline/                 # Offline engine:
│           ├── database.ts          # Dexie.js schema v5 and typed stores
│           ├── deviceIdentity.ts    # Unique terminal hardware installation ID
│           ├── sessionCleanup.ts    # Shared-terminal logout privacy cleaner
│           ├── outbox/              # Deterministic FIFO outbox queue and dispatcher
│           ├── sales/               # Offline provisional sales repository
│           └── sync/                # Background sync client with peer stock protection
├── worker/                          # Cloudflare Workers Backend
│   ├── migrations/                  # 21 Forward-Only SQL Migrations:
│   │   ├── 0001_initial_schema.sql
│   │   ├── ...                      # Historical migrations 0002 - 0015
│   │   ├── 0016_pricing_overrides_and_offline_snapshots.sql
│   │   ├── 0017_offline_auth_usage_tracking.sql
│   │   ├── 0018_hash_session_tokens.sql
│   │   ├── 0019_supplier_payment_methods.sql
│   │   ├── 0020_payment_void_and_inventory_branch_cost.sql
│   │   └── 0021_files_expense_related_type.sql
│   └── src/                         # Backend source code:
│       ├── index.ts                 # Main router registering 139 protected endpoints
│       ├── router.ts                # Custom edge router with CORS, headers, and error handling
│       ├── auth/                    # Session service (SHA-256 tokens) and tenant context
│       ├── middleware/              # Auth guard, RBAC permission checker, rate limiter
│       ├── lib/                     # Business date (Asia/Karachi), money, and errors
│       └── features/                # Domain Worker services, repositories, and routes:
│           ├── categories/          # Category endpoints
│           ├── customer-ledger/     # Customer subledger and advance balances
│           ├── customer-payments/   # Payment allocation and receipting
│           ├── customers/           # Customer management
│           ├── expenses/            # Business expenses and categories
│           ├── files/               # R2 bucket upload and authenticated streaming
│           ├── goods-receipts/      # Physical goods receipt and MWA branch costing
│           ├── inventory/           # Stock levels, adjustments, and count batches
│           ├── invoices/            # Sales invoice records
│           ├── offline/             # Offline grants, subset HMAC validation, commit engine
│           ├── products/            # Product catalog and pricing
│           ├── purchases/           # Purchase order lifecycle
│           ├── reports/             # Aggregations, Net Profit, and CSV exports
│           ├── sales/               # Sales order processing, overrides, and void reversal
│           ├── settings/            # Business settings and receipt config
│           ├── staff/               # Staff invitations, permissions, and branch scoping
│           ├── supplier-ledger/     # Supplier subledger and payables
│           ├── supplier-payments/   # Multi-tender supplier disbursements
│           ├── suppliers/           # Supplier records
│           └── sync/                # Multi-terminal change log and device management
├── tests/                           # 83 Vitest automated test suites (562 tests)
└── docs/                            # In-depth architectural reports and specifications
```

---

## 6. Summary of Hardened Invariants

1. **Integer Minor Currency Units**: All financial calculations (prices, line totals, taxes, discounts, balances) are stored and manipulated as integer integers (`minor` units / PKR cents), eliminating floating-point rounding inaccuracies.
2. **Server-Authoritative Security**: The client cannot dictate prices or bypass tax policies. All exceptions trigger audited overrides or fail closed.
3. **Branch Isolation**: Inventory balances and costs are tracked independently per branch. Multi-branch staff can only access their explicitly assigned branches.
4. **Session Integrity**: Session tokens are hashed via SHA-256 before storage in D1, and suspending staff invalidates all active sessions immediately.
5. **Zero-Tamper Offline Architecture**: Offline checkouts require pre-signed cryptographically verified HMAC tokens with server-enforced transaction and monetary caps.


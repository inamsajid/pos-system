# Step 14 Module Audit: Missing POS Business Management Modules

**Audit Date**: November 9, 2026  
**System**: Point of Sale & Retail Management System  
**Auditor**: Google Antigravity (Gemini 3.8 Flash High)  
**Target Scope**: 
1. Customer Ledger and Supplier Ledger UI (`/customers/:customerId/ledger`, `/suppliers/:supplierId/ledger`, and `/ledger`)
2. Expenses Management Backend & Frontend (`/expenses`)
3. Staff Management Backend & Frontend (`/staff`)

---

## 1. Executive Summary

A comprehensive pre-implementation audit was conducted across the frontend application (`src/`), Cloudflare Worker backend (`worker/src/`), D1 SQL migrations (`worker/migrations/`), and client Dexie offline stores (`src/lib/offline/`).

While the underlying financial tables and core ledger calculations were established in Steps 12.4 and 12.5, significant gaps existed in user interface completeness, dedicated routing, and full lifecycle APIs for Expenses and Staff Management:

| Module | D1 Database State | Backend Worker State | Frontend UI State | Status / Gap |
|---|---|---|---|---|
| **Customer Ledger** | Table `customer_ledger_transactions` exists; indexed; triggers balance updates. | Endpoints `/api/v1/customers/:customerId/ledger` and `.../summary` implemented. | Basic view at `/customers/:id/account`. Missing alias route `/customers/:customerId/ledger`, link shortcuts from customer details, and a unified Ledger hub page. | Complete routing, enhance transaction navigation, and integrate into unified `/ledger`. |
| **Supplier Ledger** | Table `supplier_ledger_transactions` exists; indexed. | Endpoints `/api/v1/suppliers/:supplierId/ledger` and `.../summary` implemented. | Basic view at `/suppliers/:supplierId/account`. Missing alias route `/suppliers/:supplierId/ledger`, link shortcuts, and unified Ledger hub page. | Complete routing, enhance transaction navigation, and integrate into unified `/ledger`. |
| **Expenses Management** | Tables `expenses` and `expense_categories` exist in migration 0008. Lacks void/reversal audit columns. | **No endpoints exist** in Worker router for expenses or categories. | `src/features/expenses/pages/ExpensesPage.tsx` is an empty `PlaceholderPage`. | Add D1 void columns, implement Worker endpoints, services, repository, and complete interactive React UI. |
| **Staff Management** | Tables `users`, `business_members`, `member_branches` exist in migrations 0001/0010. Lacks `staff_invitations` table. | **No endpoints exist** for staff member listing, role assignment, branch updates, or invitations. | `src/features/staff/pages/StaffPage.tsx` is an empty `PlaceholderPage`. | Add `staff_invitations` table, implement Worker endpoints, services, repository with RBAC guardrails, and complete React UI. |

---

## 2. Customer & Supplier Ledger Audit

### 2.1 Customer Ledger
- **D1 Schema**:
  - `customer_ledger_transactions` stores `id`, `business_id`, `branch_id`, `customer_id`, `entry_type` (`opening_balance`, `invoice_accrual`, `payment_credit`, `advance_adjustment`, `void_reversal`), `reference_id`, `amount_minor`, `running_balance_minor`, `business_date_key`, `created_at`.
- **Backend API**:
  - `GET /api/v1/customers/:customerId/ledger` supporting pagination (`page`, `limit`), date range filters (`startDate`, `endDate`), and branch scoping.
  - `GET /api/v1/customers/:customerId/ledger/summary` returning opening balance, total debits, total credits, outstanding receivables, unallocated advances, current account balance.
- **Frontend Current State**:
  - Exists under `/customers/:id/account`.
  - Missing route `/customers/:customerId/ledger` as required by POS accounting standards.
  - Links to invoice details and payment details need verification for seamless one-click audit drilldown.
  - Needs export statement functionality and clear running balance verification.

### 2.2 Supplier Ledger
- **D1 Schema**:
  - `supplier_ledger_transactions` stores `id`, `business_id`, `branch_id`, `supplier_id`, `entry_type` (`opening_balance`, `purchase_invoice`, `supplier_payment`, `advance_allocation`, `void_reversal`), `reference_id`, `amount_minor`, `running_balance_minor`, `business_date_key`, `created_at`.
- **Backend API**:
  - `GET /api/v1/suppliers/:supplierId/ledger` supporting pagination and filters.
  - `GET /api/v1/suppliers/:supplierId/ledger/summary` returning opening payable, total purchases, total paid, outstanding payables, advance balance, current balance.
- **Frontend Current State**:
  - Exists under `/suppliers/:supplierId/account`.
  - Missing route `/suppliers/:supplierId/ledger`.
  - Drilldown navigation to `/purchases/:purchaseId` and `/supplier-payments/:paymentId` must be confirmed.

### 2.3 Unified Ledger Hub (`/ledger`)
- Currently `src/features/ledger/pages/LedgerPage.tsx` displays only a `PlaceholderPage`.
- Needs a two-tabbed financial command center:
  1. **Customer Receivables Ledger**: Summary of all customers with positive receivables or advance credits, quick search, and one-click "View Ledger" button.
  2. **Supplier Payables Ledger**: Summary of all suppliers with payables or advance balances, quick search, and one-click "View Ledger" button.
  3. High-level financial KPIs: Total Receivables (Assets), Total Payables (Liabilities), Net Ledger Position, Total Active Customer/Supplier Accounts.

---

## 3. Expenses Management Audit

### 3.1 D1 Schema Analysis (`worker/migrations/0008_expenses_and_audit_logs.sql`)
- Existing tables:
  ```sql
  CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK(status IN ('active', 'archived')) DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, name)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    expense_number TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES expense_categories(id),
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank_transfer', 'card', 'other')),
    title TEXT NOT NULL,
    notes TEXT,
    receipt_attachment_url TEXT,
    business_date_key TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, expense_number)
  );
  ```
- **Identified Gap**:
  - Requirement: "Never hard-delete a posted financial expense. Use approved reversal or correction process."
  - Table `expenses` requires columns for void status, timestamp, executor user, and void reason.
  - Solution: In Migration `0014_expenses_and_staff.sql`, add:
    ```sql
    ALTER TABLE expenses ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';
    ALTER TABLE expenses ADD COLUMN voided_at TEXT;
    ALTER TABLE expenses ADD COLUMN voided_by TEXT REFERENCES users(id);
    ALTER TABLE expenses ADD COLUMN void_reason TEXT;
    ```

### 3.2 Backend Worker API Plan
- Files to create in `worker/src/features/expenses/`:
  - `expenses.types.ts`: TypeScript interfaces for filters, payloads, and DTOs.
  - `expenses.validation.ts`: Request validation schemas (amount_minor > 0 integer paise, valid category, branch verification, payment method enum).
  - `expenses.repository.ts`: D1 queries for listing with joins to categories and branches, creating, voiding, and auditing.
  - `expenses.service.ts`: Business logic including sequential expense number formatting (`EXP-YYYYMMDD-XXXX`), tenant isolation, and audit logging.
  - `expenses.routes.ts`: HTTP request handlers.
- Endpoints:
  - `GET /api/v1/expenses`: Filtered list (branch, category, payment method, date range, status, search).
  - `GET /api/v1/expenses/:id`: Single expense details.
  - `POST /api/v1/expenses`: Record an expense with idempotency protection.
  - `POST /api/v1/expenses/:id/void`: Void a posted expense with mandatory reason.
  - `GET /api/v1/expense-categories`: List categories for current business.
  - `POST /api/v1/expense-categories`: Add category.

### 3.3 Frontend Expenses UI Plan
- Location: `src/features/expenses/`
- Key UI features:
  - KPI Cards: Total Expenses (Monthly & Daily), Top Spending Category, Active Count.
  - Filter Bar: Search, Category dropdown, Payment Method selector, Branch selector, Date Range.
  - Create Expense Modal: Category selector (with instant category creation), Title, Minor unit paise input/formatting, Payment method, Branch selector, Receipt URL / file upload trigger, Notes.
  - Void Expense Modal: Confirmation modal requiring void reason input.
  - Export CSV of filtered expenses.

---

## 4. Staff Management Audit

### 4.1 D1 Schema Analysis
- Existing tables in `0001_businesses_and_branches.sql`:
  - `users`: `(id, email, phone, name, password_hash, email_verified, status, created_at, updated_at)`
  - `business_members`: `(id, business_id, user_id, role, is_active, created_at, updated_at)`
  - `member_branches`: `(id, member_id, branch_id, created_at)`
- **Identified Gap**:
  - The system supports invitation-based onboarding where an Admin or Owner generates an invitation token with predefined role and branch assignments.
  - Solution: In Migration `0014_expenses_and_staff.sql`, add `staff_invitations`:
    ```sql
    CREATE TABLE IF NOT EXISTS staff_invitations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_manager')),
      token_hash TEXT NOT NULL UNIQUE,
      branch_ids_json TEXT,
      invited_by TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staff_inv_biz ON staff_invitations(business_id);
    CREATE INDEX IF NOT EXISTS idx_staff_inv_token ON staff_invitations(token_hash);
    ```

### 4.2 RBAC & Permission Matrix
Based on `worker/src/auth/tenantContext.ts`:

| Role | Manage Staff | View Staff | Manage Expenses | View Expenses | Void Expenses | View Customer Ledger | View Supplier Ledger |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Owner** | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Admin** | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Manager** | No | Yes | Yes | Yes | Yes | Yes | Yes |
| **Accountant** | No | No | Yes | Yes | No | Yes | Yes |
| **Cashier** | No | No | No | No | No | Yes | No |
| **Inventory Manager** | No | No | No | No | No | No | No |

**Security Guardrails**:
- An `admin` cannot grant the `owner` role.
- An `admin` cannot demote or suspend an `owner`.
- A user cannot suspend or delete their own active membership.
- The business must retain at least one active `owner` at all times.

### 4.3 Backend Worker API Plan
- Files to create in `worker/src/features/staff/`:
  - `staff.types.ts`, `staff.validation.ts`, `staff.repository.ts`, `staff.service.ts`, `staff.routes.ts`.
- Endpoints:
  - `GET /api/v1/staff`: List members with user details and branch assignments.
  - `GET /api/v1/staff/:id`: Get member details.
  - `POST /api/v1/staff/invitations`: Generate an invitation token.
  - `GET /api/v1/staff/invitations`: List pending invitations.
  - `POST /api/v1/staff/invitations/:id/revoke`: Revoke invitation.
  - `PATCH /api/v1/staff/:id/role`: Update member role (with guardrails).
  - `PUT /api/v1/staff/:id/branches`: Update branch assignments.
  - `POST /api/v1/staff/:id/suspend`: Suspend member.
  - `POST /api/v1/staff/:id/reactivate`: Reactivate member.

### 4.4 Frontend Staff UI Plan
- Location: `src/features/staff/`
- Key UI features:
  - Staff KPI Cards: Total Staff, Active Staff, Suspended Members, Pending Invitations.
  - Staff Table: Name, Email/Phone, Role Badge (Owner, Admin, Manager, Cashier, Accountant, Inventory Manager), Assigned Branches, Status (Active / Suspended), Action buttons.
  - Invite Modal: Input Email, Role selector with explanatory badge, Branch multiselect checkboxes, Submit & Copy Invite Link.
  - Edit Modal: Update Role & Branch assignments.
  - Pending Invitations Table: View pending tokens with expiration and Revoke button.

---

## 5. Offline & Synchronization Boundary Policy
- **Customer & Supplier Ledger Mutations**: Strictly online-only; ledgers are authoritative server records driven by D1 triggers or atomic transactions.
- **Expenses**: Online-only in this phase (no offline outbox mutation needed for general OPEX).
- **Staff Management**: Strictly online-only for credential security and RBAC token issuance.
- **Dexie/IndexedDB**: Products and categories remain cached; offline POS transactions queue to durable outbox and synchronize upon reconnection as validated in Step 13.8.

---

## 6. Implementation Action Plan
1. **Migration 0014**: Apply `worker/migrations/0014_expenses_and_staff.sql` to local D1.
2. **Step 14.1**: Implement Unified `/ledger` Hub, add `/customers/:customerId/ledger` and `/suppliers/:supplierId/ledger` routes, verify links and statements.
3. **Step 14.2**: Implement backend Worker endpoints and frontend React UI for Expenses (`worker/src/features/expenses/` and `src/features/expenses/`).
4. **Step 14.3**: Implement backend Worker endpoints and frontend React UI for Staff (`worker/src/features/staff/` and `src/features/staff/`).
5. **Testing**: Write comprehensive Vitest integration tests covering ledgers, expenses, staff RBAC, and verify 100% green test suite.
6. **Documentation**: Deliver reports `step-14-1-ledger-ui.md`, `step-14-2-expenses-management.md`, `step-14-3-staff-management.md`, and `step-14-acceptance-report.md`.


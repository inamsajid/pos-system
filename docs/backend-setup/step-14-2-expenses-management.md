# Step 14.2 Implementation Report: Expenses Management (Backend + Frontend)

**Date**: November 9, 2026  
**System**: Point of Sale & Retail Management System  
**Stage**: Step 14.2 — Operating Expenses Management (Full Stack)  
**Auditor/Implementer**: Google Antigravity (Gemini 3.8 Flash High)

---

## 1. Overview & Architecture

Step 14.2 delivers a production-grade operating expense management module across the Cloudflare Worker API, D1 database, and React frontend application.

The design satisfies all core financial accounting principles:
1. **Never Hard-Delete Posted Financial Expenses**: Implemented formal financial voiding/reversals with audit logging, retaining immutable transaction trails.
2. **Integer Monetary Precision**: All monetary values are processed and stored as positive integer minor units (paise) in D1 (`amount_minor INTEGER NOT NULL CHECK(amount_minor > 0)`).
3. **Sequential Expense Numbering**: Formatted sequentially as `EXP-YYYYMMDD-XXXX` with database collision checks.
4. **Idempotency & Safe Network Retries**: Full support for `Idempotency-Key` header with canonical SHA-256 hash checks. Identical retries return cached responses; divergent payloads return HTTP 409 Conflict.
5. **Receipt Document Support**: Integrates with Cloudflare R2 storage or external secure URLs.
6. **Role-Based Access Control (RBAC)**:
   - Creation & Viewing: `owner`, `admin`, `manager`, `cashier`, `accountant`
   - Voiding / Reversals: `owner`, `admin`, `manager`

---

## 2. Database Schema (Migration `0014_expenses_and_staff.sql`)

The `expenses` table supports non-destructive voiding and category tracking:
```sql
ALTER TABLE expenses ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';
ALTER TABLE expenses ADD COLUMN voided_at TEXT;
ALTER TABLE expenses ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN void_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_biz_status ON expenses(business_id, status);
```

---

## 3. Cloudflare Worker API Endpoints

Implements full REST semantics in `worker/src/features/expenses/`:

| Method | Endpoint | Description | Required Permission |
|---|---|---|---|
| `GET` | `/api/v1/expenses` | Filtered list with pagination, date range, branch, category, and payment method filters. | `expenses_read` |
| `GET` | `/api/v1/expenses/summary` | Consolidated KPIs: this month total, today total, posted amount, voided amount, category & payment breakdowns. | `expenses_read` |
| `GET` | `/api/v1/expenses/:id` | Detailed single expense record with category, creator, and void audit metadata. | `expenses_read` |
| `POST` | `/api/v1/expenses` | Creates new posted expense with sequential number, optional `Idempotency-Key` handling, and records entry in `audit_logs`. | `expenses_write` |
| `PATCH` | `/api/v1/expenses/:id` | Updates non-financial editable metadata (`title`, `notes`, `receiptAttachmentUrl`) on active, non-voided expenses. | `expenses_write` |
| `POST` | `/api/v1/expenses/:id/void` | Sets `status = 'voided'` with mandatory reason, user reference, timestamp, and audit log. | `expenses_write` (`owner`/`admin`/`manager`) |
| `GET` | `/api/v1/expense-categories` | Lists all active expense categories with usage counts and totals. | `expenses_read` |
| `POST` | `/api/v1/expense-categories` | Adds a new expense category with duplicate prevention. | `expenses_write` |
| `PATCH` | `/api/v1/expense-categories/:id` | Updates category name, description, and status. | `expenses_write` |
| `DELETE` | `/api/v1/expense-categories/:id` | Soft-archives category (`status = 'archived'`) if referenced by expenses; deletes if unreferenced. | `expenses_write` |

---

## 4. Frontend Architecture & Modular Components (`src/features/expenses/`)

### 1. TanStack Query Hooks (`src/features/expenses/hooks/`)
- **`useExpenses(filters)`**: Scoped by `[businessId, branchId, filters]`, returns paginated items, totals, and refetch handler.
- **`useExpenseSummary()`**: Scoped by `[businessId, branchId]`, returns executive metrics.
- **`useCreateExpense()`**: Mutation invalidating `['expenses']`, `['expenseSummary']`, and `['expenseCategories']`.
- **`useVoidExpense()`**: Mutation invalidating `['expenses']` and `['expenseSummary']`.
- **`useUpdateExpense()`**: Mutation invalidating `['expenses']`.
- **`useExpenseCategories()`**: Scoped by `[businessId]`, returns all and active categories.
- **`useCreateExpenseCategory()`**, **`useUpdateExpenseCategory()`**, **`useDeleteExpenseCategory()`**: Category mutations.

### 2. Modular UI Components (`src/features/expenses/components/`)
- **`ExpenseCategorySelect.tsx`**: Reusable category dropdown supporting "All Categories" filter option or mandatory selection.
- **`ExpenseFilters.tsx`**: Search input, category dropdown, payment method dropdown, status dropdown, date picker, and reset button.
- **`ExpenseSummary.tsx`**: KPI cards (Net Posted, Today's Expenses, This Month, Voided Count) with icon accents and color coding.
- **`ExpenseTable.tsx`**: Responsive table + mobile card list with formatted currency, receipt links, status indicators, and view/void action triggers.
- **`ExpenseForm.tsx`**: Standalone expense entry form with validation (amount > 0, required title & category).
- **`CreateExpenseModal.tsx`**: Modal for creating new expenses with branch and category pickers.
- **`VoidExpenseModal.tsx`**: Non-destructive voiding modal with mandatory reason prompt.
- **`ManageCategoriesModal.tsx`**: Category creation, editing, and archiving interface.
- **`ExpenseDetailsModal.tsx`**: Detailed view modal showing audit trails and receipt attachments.

### 3. Expenses Page (`src/features/expenses/pages/ExpensesPage.tsx`)
- Orchestrates TanStack Query hooks, KPI cards, filters, data table, pagination (`LedgerPagination`), CSV export, and modals.

---

## 5. Verification Status

- **Worker TypeScript build** (`npm run build:worker`): Passed (0 errors).
- **Frontend production build** (`npm run build`): Passed (0 errors).
- **Linter check** (`npm run lint`): Passed (0 errors).
- **Local D1 migrations** (`npm run db:status:local`): Passed (`0014_expenses_and_staff.sql` applied, `✅ No migrations to apply!`).
- **Backend API Tests** (`tests/expensesApi.test.ts`): **10 passed (10)** covering creation, listing, voiding, idempotency key caching, 409 conflict, patch updating, category updating, and category soft-archival.
- **Frontend Component Tests** (`tests/frontendExpenses.test.tsx`): **6 passed (6)** covering `ExpenseCategorySelect`, `ExpenseFilters`, `ExpenseSummary`, `ExpenseTable`, `ExpenseForm`, and `ExpensesPage`.

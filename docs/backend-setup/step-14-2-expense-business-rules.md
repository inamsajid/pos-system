# Step 14.2 — Expense Management Business Rules & Financial Accounting Policy

## 1. Scope & Purpose

This document establishes the official accounting rules, data integrity constraints, lifecycle states, and operational boundaries for the **Expenses Management** module in the Point of Sale system.

Expenses in this system represent **operational business expenditures** (OPEX) incurred during daily branch operations (e.g., utility bills, store maintenance, staff meals, packaging supplies, freight/courier fees, local travel).

### Non-Interference with Stock and Inventory
- **Strict Separation from Inventory Cost of Goods Sold (COGS)**:
  - Goods receipts and supplier inventory purchase bills are processed strictly through the **Purchases and Goods Receipts** module.
  - Expense entries **NEVER** modify stock levels, inventory quantities, FIFO valuation layers, or inventory asset ledgers.
  - An expense record does **NOT** post movements to `stock_movements`, `product_batches`, or inventory valuation tables.
- **Strict Separation from Trade Payables (AP)**:
  - Supplier invoices are tracked through `supplier_ledger_transactions`.
  - Operational expenses recorded here are immediate operational disbursements (paid via cash drawer, bank transfer, card, or company funds).

---

## 2. Monetary Precision & Currency Integrity

1. **Integer Minor Units (Paise / Cents)**:
   - In keeping with the system-wide financial integrity policy, all monetary figures are stored in the database as integer minor units (`amount_minor` as SQLite `INTEGER`).
   - SQLite `REAL` or floating-point decimals are **prohibited** for monetary amounts in schema and calculations.
   - For PKR (Pakistani Rupee), 1 Rupee = 100 paise. (e.g., Rs 1,250.50 is stored as `125050`).
2. **Positive Amounts**:
   - `amount_minor > 0` is strictly enforced. Zero or negative expense amounts are rejected with HTTP 400.
3. **Frontend Formatting**:
   - Displayed to users using standard formatted currency utilities (`formatCurrency(amountMinor / 100)`).

---

## 3. Date & Timezone Semantics

1. **Business Date Key (`business_date_key`)**:
   - Stored in standard `YYYY-MM-DD` ISO format.
   - Defaults to the active branch's local calendar day in `Asia/Karachi` (+05:00).
   - Allows backdating or recording expenses incurred earlier in the current accounting cycle if authorized by role.
2. **System Timestamps (`created_at`, `voided_at`)**:
   - Stored as full ISO-8601 UTC strings (`datetime('now')` / `toISOString()`).
3. **Reporting Ranges**:
   - Date range filters (`startDate`, `endDate`) operate inclusively on `business_date_key`.

---

## 4. Expense Categories

1. **Category Structure**:
   - Every expense must be assigned to an active category (`category_id`).
   - Default core categories include:
     - Utilities & Electricity
     - Rent & Facilities
     - Repairs & Maintenance
     - Printing & Stationery
     - Cleaning & Janitorial
     - Transportation & Logistics
     - Refreshments & Meals
     - Marketing & Advertising
     - Miscellaneous
2. **Name Uniqueness & Status**:
   - Category names are unique per business (`LOWER(name)` check).
   - Categories have lifecycle status: `'active' | 'archived'`.
3. **No Cascading Deletion**:
   - Categories that have associated expense records **cannot be hard-deleted**.
   - Attempting to delete a category that contains expenses automatically executes a soft-archival (`status = 'archived'`).
   - Archived categories are hidden from future expense entry dropdowns but preserved in historical expense reports and ledger lookups.

---

## 5. Payment Methods & Cash Drawers

1. **Allowed Payment Methods**:
   - `cash`: Paid directly out of the physical POS cash drawer or petty cash register.
   - `bank_transfer`: Paid directly via corporate bank account or direct online transfer.
   - `card`: Paid via corporate debit/credit card.
   - `other`: Authorized cheques, digital wallets (EasyPaisa/JazzCash), or vouchers.
2. **Petty Cash / Register Reconciliation**:
   - Cash expenses tagged to a branch on a given date directly inform POS shift closing reconciliations (`expected_cash = opening_cash + cash_sales - cash_expenses + cash_in - cash_out`).

---

## 6. Immutable Postings & Non-Destructive Voiding

1. **Posting State**:
   - Newly created expenses are immediately in `'posted'` status.
   - Once posted, financial amounts (`amount_minor`), payment methods, branch associations, and categories cannot be arbitrarily modified to prevent financial fraud.
2. **Safe Edits**:
   - Non-financial metadata (`title`, `notes`, `receipt_attachment_url`) may be updated via `PATCH /api/v1/expenses/:id` if the expense is active and unvoided.
3. **Void Policy (Reversals)**:
   - Hard deletion (`DELETE /api/v1/expenses/:id`) is strictly forbidden.
   - Expenses can only be cancelled by issuing a **Void** operation (`POST /api/v1/expenses/:id/void`).
   - Voiding requires:
     - Sufficient role permission (`owner`, `admin`, or `manager`).
     - A non-empty explanation `reason` (minimum 3 characters).
   - The record status transitions to `'voided'`.
   - `voided_at`, `voided_by`, and `void_reason` are captured indelibly.
   - An immutable audit trail entry is posted to `audit_logs`.
   - Voided expenses are clearly struck-through in UI and excluded from net expense totals, dashboards, and P&L summaries.

---

## 7. Receipts & Cloudflare R2 Attachments

1. **Proof of Expense**:
   - Users may attach photos of paper receipts, invoices, or payment slips (`receiptAttachmentUrl`).
2. **Storage Architecture**:
   - Files are stored in Cloudflare R2 object storage with pre-signed URLs or dedicated R2 public worker routes.
   - Max file size: 10MB.
   - Allowed mime-types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.

---

## 8. Multi-Tenant Isolation & Role-Based Access Control (RBAC)

1. **Multi-Tenancy**:
   - Every expense and category is scoped to `business_id`.
   - Expenses are additionally scoped to a specific `branch_id`.
   - Users cannot see or mutate expenses outside their authorized business and assigned branch memberships.
2. **RBAC Permissions**:
   - `expenses_read`: View expenses list, expense details, categories, and summary metrics. (Roles: `owner`, `admin`, `manager`, `cashier`).
   - `expenses_write`: Create new expenses, update editable metadata, create/edit categories. (Roles: `owner`, `admin`, `manager`, `cashier` with permission).
   - `expenses_void`: Void posted expenses. Strictly restricted to `owner`, `admin`, and `manager`.

---

## 9. Idempotency & Network Safety

1. **`Idempotency-Key` Support**:
   - POST `/api/v1/expenses` supports the standard `Idempotency-Key` header.
   - Requests sent with an identical key and identical payload return the previously created expense response with HTTP 201/200, preventing duplicate disbursements during network retries or double clicks.
   - Requests sent with the same key but differing payloads return HTTP 409 Conflict.


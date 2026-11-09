# POS System — Financial Accounting Policy & Ledger Architecture

## Document Overview
- **Document ID**: `FAP-SPEC-11.7-02`
- **Status**: Draft / Step 11.7 Architecture Finalization
- **Standard**: Modified Cash-Accrual Basis for Retail POS & Inventory
- **Audience**: Financial Systems Engineers, Software Architects, Accounting Auditors

---

## 1. Accounting Conventions & Double-Entry Principles

### 1.1 Debit and Credit Conventions
All financial movements are governed by standard accounting principles adapted for a retail POS ledger:

| Account Type | Normal Balance | Increased By | Decreased By | Example in POS |
| :--- | :--- | :--- | :--- | :--- |
| **Asset** | Debit | Debit | Credit | Cash Register, Bank Account, Accounts Receivable |
| **Liability** | Credit | Credit | Debit | Accounts Payable, Customer Advances (Unearned) |
| **Equity** | Credit | Credit | Debit | Retained Earnings, Owner Capital |
| **Revenue** | Credit | Credit | Debit | Sales Revenue, Service Fees |
| **Expense** | Debit | Debit | Credit | Cost of Goods Sold (COGS), Wastage, Operating Expenses |

### 1.2 Customer Sub-Ledger Conventions
For customer account balances:
- **Debit ($D$)**: Increases Customer Debt / Receivable (e.g. Sales Invoices on credit, bounced cheque charges).
- **Credit ($C$)**: Decreases Customer Debt / Adds Advance (e.g. Cash payments received, bank receipts, sales returns, credit notes).
- **Net Customer Position**:
  $$\text{Net Position} = \sum \text{Debits} - \sum \text{Credits}$$
  - When $\text{Net Position} > 0$: Customer has an **Outstanding Receivable** (owes the store).
  - When $\text{Net Position} < 0$: Customer has an **Advance Balance** (store owes customer goods/refund).
  - When $\text{Net Position} = 0$: Account is settled / Clear.

### 1.3 Supplier Sub-Ledger Conventions
For supplier account balances:
- **Credit ($C$)**: Increases Supplier Debt / Payable (e.g. Purchase Bills, received shipments on credit).
- **Debit ($D$)**: Decreases Supplier Debt / Adds Advance (e.g. Payments to supplier, purchase returns, debit notes).
- **Net Supplier Position**:
  $$\text{Net Position} = \sum \text{Credits} - \sum \text{Debits}$$
  - When $\text{Net Position} > 0$: Store has an **Outstanding Payable** (owes supplier).
  - When $\text{Net Position} < 0$: Store has a **Supplier Advance** (supplier owes store goods/refund).
  - When $\text{Net Position} = 0$: Account is settled / Clear.

---

## 2. Customer Opening Balance Treatment

### 2.1 The Opening Balance Dilemma in POS
In naive POS applications, an opening balance is either stored as a mutable number on the customer table or incorrectly treated as a "Sale" or "Payment". Both cause major reporting corruption:
- Treating opening receivable as a Sale corrupts Sales Revenue and Tax Returns.
- Treating opening advance as a Payment corrupts Daily Cash Inflow reports.

### 2.2 Canonical Opening Balance Policy
1. **Explicit Ledger Record**:
   - Customer opening balances are initialized via an explicit `CustomerLedgerTransaction` record with `type: 'opening_balance'`.
   - The customer table's `openingBalance` field is an immutable baseline reference set at creation time.
2. **Impact on Revenue & Cash Reports**:
   - **Sales Total Excludes Opening Balance**: Total Sales for any period counts strictly `type = 'sale'` / `invoice`. Opening balances are excluded.
   - **Cash Collection Total Excludes Opening Balance**: Payments collected count actual incoming cash/bank receipts. The opening balance itself represents pre-existing claims, not current-period cash.
3. **Canonical Customer Financial Formula**:
   $$\text{Outstanding Receivable} = \max\left(0, \text{Opening Receivable} + \sum \text{Invoiced Amounts} - \sum \text{Collected Payments}\right)$$
   $$\text{Customer Advance} = \max\left(0, \sum \text{Collected Payments} - (\text{Opening Receivable} + \sum \text{Invoiced Amounts})\right)$$

---

## 3. Supplier Opening Balance Treatment

### 3.1 Canonical Supplier Opening Policy
1. **Explicit Payable Record**:
   - Supplier opening balances are recorded as a `SupplierLedgerTransaction` with `type: 'opening_balance'`.
2. **No Physical Stock Movement**:
   - An opening payable reflects money owed for historical inventory already sitting on shelves.
   - **STRICT RULE**: Initializing a supplier opening payable **DOES NOT** trigger any stock movement, purchase order, or goods receipt. Existing physical stock is initialized independently via product `opening_stock`.
3. **Canonical Supplier Financial Formula**:
   $$\text{Outstanding Payable} = \max\left(0, \text{Opening Payable} + \sum \text{Billed Purchases} - \sum \text{Disbursed Payments}\right)$$
   $$\text{Supplier Advance} = \max\left(0, \sum \text{Disbursed Payments} - (\text{Opening Payable} + \sum \text{Billed Purchases})\right)$$

---

## 4. Advance Payments & Multi-Invoice Allocation System

### 4.1 Advance Payment Lifecycle
When a customer deposits money in advance or overpays an invoice:
1. The incoming money is credited to the customer's ledger as an unearned liability.
2. The portion exceeding currently outstanding invoices is tracked as `unallocatedAmount`.
3. When new sales invoices are issued to this customer, the advance can be allocated against them.

### 4.2 Allocation Record Architecture
Allocations are explicit, first-class entities:

```typescript
export interface PaymentInvoiceAllocation {
  id: string
  paymentId: string
  saleId: string
  invoiceNumber: string
  amount: number // In integer paise (minor units)
  allocatedAt: string
  allocatedBy: string
}
```

### 4.3 Allocation Accounting Rules
1. **Zero Cash Flow Impact**:
   - Allocating an advance against an invoice creates **ZERO** new cash movement.
   - The cash entry occurred when the payment was received.
   - Allocation merely shifts the liability (Customer Advance) to settle the asset (Accounts Receivable):
     $$\text{Dr: Customer Advance (Liability)} \quad \longrightarrow \quad \text{Cr: Accounts Receivable (Asset)}$$
2. **Allocation Reversibility**:
   - Allocations can be unallocated or reallocated if a dispute arises, restoring the advance balance without affecting the original cash receipt timestamp.
3. **Multi-Invoice Settlement Priority**:
   - Cashiers can either choose **FIFO Automatic Allocation** (oldest outstanding invoice settled first) or **Explicit Line Selection** (cashier specifies which invoice is being settled).
   - In both cases, $\sum \text{Allocated Amounts} \le \text{Payment Amount}$.


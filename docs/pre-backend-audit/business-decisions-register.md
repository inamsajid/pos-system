# POS System — Business Decisions Register & Owner Approvals

## Document Overview
- **Document ID**: `BDR-SPEC-11.7-08`
- **Status**: Active Working Document / Step 11.7
- **Target Audience**: Business Owners, Product Managers, Lead Architects

---

## 1. Decision Matrix & Approval Status

| ID | Domain Area | Decision Title | Proposed Default Policy | Architectural Rationale & Trade-off | Approval Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BDR-01** | Inventory | **Negative Inventory at Checkout** | **Allow with Warning** (`allowNegativeStockWithWarning = true`). System allows checkout but displays prominent low/negative stock badge. | *Trade-off*: Prevents sales counters from freezing when shelf restocking hasn't been keyed into the computer yet. *Risk*: Inventory balance becomes negative temporarily until purchase receiving is entered. | `Pending Owner Approval` |
| **BDR-02** | Inventory Costing | **Valuation Engine Methodology** | **Perpetual Moving Weighted Average Cost (MWA)**. Recalculated dynamically upon every confirmed `GoodsReceipt`. | *Trade-off*: Low computational overhead; smooth margins; avoids heavy FIFO batch-queue storage in Cloudflare D1. *Risk*: Does not support batch-level expiry tracking out of the box. | `Accepted (Architectural Default)` |
| **BDR-03** | Currency & Precision | **Storage of Monetary Quantities** | **Integer Minor Units (Paise)**. Stored as integer (1 PKR = 100 paise) across database, domain models, and APIs. | *Trade-off*: Eliminates IEEE 754 floating-point rounding errors and reconciliation drift. Requires UI formatting boundary. | `Accepted (Architectural Default)` |
| **BDR-04** | Inventory Precision | **Quantity Precision by Unit Type** | **Strict Integers** for discrete units (`piece`, `box`, `pack`, `dozen`); **Max 3 decimals (scale 1000)** for continuous units (`kg`, `liter`, `meter`, `gram`). | *Trade-off*: Rejects fractional sales for discrete goods (e.g. 1.5 shirts), while enabling weight scales down to 1 gram (0.001 kg). | `Accepted (Architectural Default)` |
| **BDR-05** | Financial Accounting | **Customer Opening Balance Treatment** | **Explicit Opening Transaction** (`type: 'opening'`). Does NOT create sales revenue or affect daily cash collection figures. | *Trade-off*: Protects tax reporting and P&L from artificial revenue spikes. Customer receivables still correctly aggregate. | `Accepted (Architectural Default)` |
| **BDR-06** | Financial Accounting | **Supplier Opening Balance Treatment** | **Explicit Opening Payable** (`type: 'opening'`). Does NOT create purchase orders or stock movements. | *Trade-off*: Avoids duplicate inventory intake because physical opening stock is initialized separately. | `Accepted (Architectural Default)` |
| **BDR-07** | Payments & Ledger | **Advance Payment Allocation Lifecycle** | **Explicit First-Class Allocation Records**. Settle invoices without generating new cash receipts. Allocations are reversible. | *Trade-off*: Full auditability of deposits and advances. Clear separation between cash flow (day of deposit) and revenue recognition (day of invoice). | `Accepted (Architectural Default)` |
| **BDR-08** | Sales & Cash Control | **Sales Voids vs Returns Boundaries** | **Voids limited to same business day** and require Supervisor / Manager PIN. All other refunds require formal **Return Note** referencing original invoice. | *Trade-off*: Prevents cashiers from voiding days-old transactions to pocket cash, while offering flexibility for immediate ringing errors. | `Pending Owner Approval` |
| **BDR-09** | Reverse Logistics | **Stock Disposition Classification** | Cashier must select disposition per returned item: **`restock`**, **`damaged`**, or **`discard`**. | *Trade-off*: Damaged goods do not return to sellable inventory, preventing reselling broken items to other customers. | `Pending Owner Approval` |
| **BDR-10** | Purchasing | **Purchase Order Cancellation Protocol** | **Hard Blocking** if any items are received ($Q_{\text{received}} > 0$) or payments allocated. Requires Return Note or Debit adjustment instead. | *Trade-off*: Protects inventory counts and supplier ledger balances from orphaned or unlinked records. | `Accepted (Architectural Default)` |
| **BDR-11** | Customer & Supplier | **Archiving Constraints** | **Strict Zero-Balance Rule**. Cannot archive if $\text{Outstanding Balance} \ne 0$ or $\text{Advance Balance} \ne 0$. | *Trade-off*: Prevents hiding bad debt or unclaimed advance deposits under archived status. Must settle or write off first. | `Pending Owner Approval` |
| **BDR-12** | Localization & Time | **Timezone Authority** | **Centralized `Asia/Karachi` (`UTC+05:00`)** for all business date keys (`YYYY-MM-DD`), day-close reports, and shifts. | *Trade-off*: Enforces unified store trading day regardless of client device OS clock skew. | `Accepted (Step 11.6 Complete)` |
| **BDR-13** | Migration | **Historical COGS Representation** | Pre-existing mock/demo sales without recorded cost snapshots are tagged with **`cogsEstimated: true`**. | *Trade-off*: Preserves historical sales records without fabricating artificial inventory movements. | `Accepted (Architectural Default)` |

---

## 2. Decision Sign-Off Summary

- **Architectural Defaults (7 Decisions)**: Approved by Engineering Architect for performance, data integrity, and D1 scalability.
- **Pending Business Owner Sign-Off (6 Decisions)**:
  1. Negative stock warning vs hard blocking.
  2. Maximum allowable void window (e.g. 60 mins vs entire business day).
  3. Default return policy window (e.g. 7 days vs 14 days vs 30 days).
  4. Return stock disposition workflow (supervisor inspection required vs cashier discretion).
  5. Customer credit limit strictness (override allowed by manager PIN vs hard block).
  6. Archiving debt threshold (zero tolerance vs nominal write-off allowance up to PKR 10).


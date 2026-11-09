# Backend & Business Decisions Master Register

## Document Overview
- **Document ID**: `DEC-SPEC-11.8-14`
- **Status**: Active Decision Matrix / Step 11.8
- **Audience**: Store Proprietor, Chief Executive, Technical Architect

---

## 1. Master Decision Status Register

| ID | Domain Area | Decision Title | Status | Current Policy / Default | Risk & Alternative Impact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEC-01** | Operations | **Negative Stock at Checkout** | `Pending Owner Approval` (Proposed) | **Allow with Warning**: POS permits sale but shows warning badge. | *Alternative*: Hard block checkout. *Risk*: Cashier cannot complete sale if physical shelf was restocked before data entry. |
| **DEC-02** | Inventory | **Valuation Engine Methodology** | `Approved` (Implemented) | **Perpetual Moving Weighted Average (MWA)**. Recalculated dynamically upon goods receipt. | *Alternative*: FIFO lot tracking. *Rationale*: Low D1 overhead, smooth profit margins. |
| **DEC-03** | Currency | **Monetary Storage & Precision** | `Approved` (Implemented) | **Integer Minor Units (Paise)** across D1, domain logic, and APIs. | *Alternative*: Floating point. *Rationale*: Zero IEEE 754 precision loss or penny drift. |
| **DEC-04** | Inventory | **Quantity Precision by Unit** | `Approved` (Implemented) | **Strict Integers** for discrete (`piece`, `box`); **Max 3 decimals** for continuous (`kg`, `liter`). | *Alternative*: Free-form floats. *Rationale*: Rejects fractional sales for discrete goods (e.g. 1.2 shirts). |
| **DEC-05** | Accounting | **Customer Opening Balance** | `Approved` (Implemented) | **Explicit Opening Ledger Entry**. Excluded from sales revenue and daily cash collection. | *Alternative*: Treat as invoice. *Risk*: Corrupts tax reports and P&L statements. |
| **DEC-06** | Accounting | **Supplier Opening Balance** | `Approved` (Implemented) | **Explicit Opening Ledger Entry**. Zero stock intake effect. | *Alternative*: Treat as purchase. *Risk*: Double counts physical opening stock. |
| **DEC-07** | Payments | **Advance Payment Allocation** | `Approved` (Implemented) | **First-Class Allocation Records**. Reversible; zero cash flow impact upon allocation. | *Alternative*: Overwriting payment amount. *Rationale*: Complete audit trail of deposits. |
| **DEC-08** | Cash Control| **Sales Voids vs Returns** | `Pending Owner Approval` (Proposed) | **Voids restricted to same-day + Manager PIN**. Multi-day refunds require Return Note. | *Alternative*: Cashiers can void any sale anytime. *Risk*: Rogue cashiers pocketing drawer cash. |
| **DEC-09** | Logistics | **Stock Disposition Options** | `Pending Owner Approval` (Proposed) | Cashier must select **`restock`**, **`damaged`**, or **`discard`** per returned line item. | *Alternative*: All returns auto-restocked. *Risk*: Selling broken goods to customers. |
| **DEC-10** | Purchasing | **Purchase Order Cancellation** | `Approved` (Implemented) | **Hard Blocking** if any items are received ($Q > 0$) or payments allocated. | *Alternative*: Allow cancellation anytime. *Risk*: Orphaned inventory and ledger discrepancies. |
| **DEC-11** | Master Data | **Customer / Supplier Archiving** | `Pending Owner Approval` (Proposed) | **Strict Zero-Balance Invariant**. Cannot archive if outstanding debt or advance exists. | *Alternative*: Allow soft-delete with debt. *Risk*: Hiding bad debt under archived status. |
| **DEC-12** | Timezone | **Centralized Business Date** | `Approved` (Implemented) | Centralized **`Asia/Karachi` (`UTC+05:00`)** for business date keys (`YYYY-MM-DD`). | *Alternative*: Client device local time. *Risk*: Distorted trading day from client clock drift. |
| **DEC-13** | Migration | **Historical Sales COGS** | `Approved` (Implemented) | Pre-existing mock/demo sales tagged with **`cogsEstimated: true`**. | *Alternative*: Fabricate retroactive POs. *Rationale*: Preserves historical honesty in reports. |
| **DEC-14** | Architecture| **Multi-Tenant Scoping** | `Approved` (Design Complete) | Shared catalog per business, branch-specific stock/sales, single-branch initial launch. | *Alternative*: Multi-tenant schema from day one. *Rationale*: Smooth multi-branch expansion. |
| **DEC-15** | Security | **Authentication Solution** | `Pending Owner Approval` (Proposed) | **Better-Auth on Cloudflare D1**. Zero third-party dependency; native edge execution. | *Alternative*: Auth0 / Clerk. *Risk*: Per-user monthly SaaS fees and external network hops. |
| **DEC-16** | Security | **Session Delivery Model** | `Approved` (Design Complete) | **Same-Origin Unified Routing** (`pos.../api/v1/*`) with HttpOnly secure cookie. | *Alternative*: Cross-origin API. *Rationale*: Eliminates CORS and third-party cookie blocks. |
| **DEC-17** | Storage | **R2 Object Access Model** | `Approved` (Design Complete) | **Private-by-default** R2 bucket with 300s temporary S3 presigned upload URLs. | *Alternative*: Public bucket. *Risk*: Data leakage of confidential invoices and receipts. |
| **DEC-18** | Reliability | **Database Disaster Recovery** | `Approved` (Design Complete) | Continuous **D1 Time Travel (30-day)** + Nightly encrypted SQL exports to R2. | *Alternative*: Rely on manual backups. *Risk*: Data loss during hardware or human error. |
| **DEC-19** | Integration | **Frontend Repository Transition**| `Approved` (Design Complete) | **Dual Interchangeable Adapters** (`Mock` vs `Api`) toggled via environment flag. | *Alternative*: Big-bang replacement. *Rationale*: Zero downtime; uninterrupted dev testing. |
| **DEC-20** | Infrastructure | **Cloudflare Workers Plan for Auth** | `Pending Owner Approval` (Critical) | **Cloudflare Workers Paid** ($5/mo, 30s CPU limit) required for PBKDF2 (100k iterations, ~44ms CPU). | *Alternative*: Workers Free with downgraded iterations (<25k) or external Auth0. *Risk*: 10ms CPU limit on Free tier causes Error 1101 on login. |

---

## 2. Outstanding Decisions Awaiting Business Owner Sign-Off

The following 6 decisions require explicit confirmation from the store proprietor prior to production cutover in Step 12:

1. **Negative Stock Policy (DEC-01)**: Should POS registers permit checkout with a visual warning when physical stock outpaces system entry, or should checkout be strictly locked?
2. **Same-Day Void Authority (DEC-08)**: Is a 24-hour window acceptable for transaction voids with manager PIN, or should voids be restricted strictly to the active cashier shift (e.g. 8 hours)?
3. **Stock Disposition Workflow (DEC-09)**: Should cashiers have authority to designate returned items as `damaged` / `discard`, or must a manager inspect and sign off on damaged goods?
4. **Archiving Debt Threshold (DEC-11)**: Is the zero-balance archiving rule absolute, or should nominal balances under PKR 50 be allowed to auto-write-off to Bad Debt Expense upon archiving?
5. **Authentication Engine (DEC-15)**: Confirm adoption of native D1 WebCrypto sessions versus a hosted identity service like Auth0.
6. **Cloudflare Subscription Tier (DEC-20)**: Approve Workers Paid tier ($5/month) to provide 30-second CPU limit for OWASP-compliant PBKDF2 password authentication.


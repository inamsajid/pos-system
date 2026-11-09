# Business Decisions Register & Owner Approvals: Offline POS & Sales (Step 13.6)

## Document Overview
- **Document ID**: `BDR-OFFLINE-13.6-01`
- **Scope**: Step 13.6 (Offline POS & Checkout) and Step 13.7 (Reconnection, Retry & Reconciliation)
- **Status**: Formulated with Safe Engineering Defaults; Pending Formal Business Owner Sign-Off
- **Target Audience**: Business Owners, Financial Auditors, POS System Architects

---

## 1. Decision Matrix & Owner Safety Gates

| Ref # | Policy Dimension | Proposed Engineering Default | Business Risk & Trade-off | Owner Status |
|---|---|---|---|---|
| **OD-01** | **Payment Methods Allowed** | **Cash Only**. Customer credit, debit/credit cards, mobile wallets, and split tenders are strictly forbidden offline. | *Trade-off*: Eliminates complex unverified credit risk and offline PCI compliance issues. Cash is physically collected at the drawer. | `Approved Safe Default` |
| **OD-02** | **Maximum Authorization Duration** | **8 Hours Maximum** (`expiresAt = issuedAt + 8h`). Hard ceiling after which new sales are blocked. | *Trade-off*: Covers a single retail shift. Prevents multi-day stale pricing or indefinite disconnected operation. | `Approved Safe Default` |
| **OD-03** | **Per-Device Stock Allocation Limits** | **Pre-allocated Quotas Required**. Maximum 50 units per discrete SKU or 50.000 kg per continuous SKU per device. | *Trade-off*: Prevents multi-device overselling. Device can only sell up to its pre-reserved allocation. | `Approved Safe Default` |
| **OD-04** | **Transaction Count & Value Caps** | Max **100 transactions** OR **PKR 50,000 (5,000,000 paise)** gross total per offline authorization package. | *Trade-off*: Caps cumulative financial exposure per terminal if a device is physically compromised. | `Approved Safe Default` |
| **OD-05** | **Discount Permissions** | **Strictly Prohibited** (`allow_discounts: 0`). Cashier cannot enter line-item or order discounts offline. | *Trade-off*: Eliminates cashier fraud or discount manipulation while offline. | `Approved Safe Default` |
| **OD-06** | **Tax Calculation Rules** | **Fixed Snapshot Rules Only**. Exact tax rate encoded in signed server package; no tax exemptions or overrides. | *Trade-off*: Prevents tax calculation discrepancies between offline receipt and server-generated invoice. | `Approved Safe Default` |
| **OD-07** | **Pricing Snapshot Validity** | **Server-Signed Pricing Snapshot**. Price must match integer minor units (`sellingPriceMinor`) in the authorization package. | *Trade-off*: Server re-computes authoritative totals upon sync. Client edits to local database are rejected. | `Approved Safe Default` |
| **OD-08** | **Cash Collected for Rejected Sales** | **Quarantined in Drawer; Manual Cash Audit**. Cash remains in drawer, flagged as `unreconciled_provisional_cash`. | *Trade-off*: Physical cash cannot be deleted. Discrepancy must be balanced during end-of-day register closeout. | `Approved Safe Default` |
| **OD-09** | **Local Retention Period** | **7 Days Maximum**. After 7 days without sync, terminal requires manager intervention. Records are never silently deleted. | *Trade-off*: Ensures audit trail is retained while alerting management to neglected or lost devices. | `Approved Safe Default` |
| **OD-10** | **Device Loss & Revocation** | **Manual Allocation Reconciliation**. Revoking a device locks new sales, but does not release stock until manager reviews pending sales. | *Trade-off*: Prevents double-selling stock if the lost device had made un-synced sales before disappearing. | `Approved Safe Default` |
| **OD-11** | **Customer Association** | **Walk-in / Anonymous Only**. Existing customers cannot be selected, and new customers cannot be created offline. | *Trade-off*: Prevents storing customer PII unencrypted in browser IndexedDB. | `Approved Safe Default` |

---

## 2. Updated Local Data Classification

The data classification defined in `docs/offline/13-1-local-data-classification.md` is updated for Step 13.6:

```
[PREVIOUS STATUS]
Financial Transactions (Sales tickets, cash receipts) -> STRICTLY FORBIDDEN (Central D1 only)

[STEP 13.6 UPDATED STATUS]
Provisional Offline Cash Sales -> CONDITIONALLY PERMITTED IN LOCAL DEXIE
- Scope: Only Walk-in Cash Sales
- Protection: Bound to Server-Signed Authorization Package
- Lifetime: Retained until synchronized with central D1
- Prohibitions: No customer PII, no card numbers, no bank credentials, no credit balances
```

---

## 3. Operational Safety Flags

The following runtime flags protect the application until active authorization packages are granted:

```typescript
export const OFFLINE_POS_SAFETY_CONFIG = {
  ALLOW_OFFLINE_CHECKOUT: true,            // Requires server authorization package
  REQUIRE_SERVER_AUTHORIZATION: true,      // Must be cryptographically signed by backend
  ENFORCE_DEVICE_STOCK_ALLOCATION: true,   // Cannot sell without allocated quota
  CASH_ONLY: true,                         // Non-cash payment attempts fail validation
  WALK_IN_ONLY: true,                      // Customer selection disabled offline
  DISALLOW_DISCOUNTS: true,                // Manual discounts disabled offline
  MAX_AUTHORIZATION_HOURS: 8,              // Max valid duration
}
```


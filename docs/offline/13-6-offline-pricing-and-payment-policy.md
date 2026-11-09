# Step 13.6 — Offline Pricing & Payment Policy

## 1. Executive Summary

Offline operation introduces risk of financial discrepancies, fraudulent pricing, and bad debt. To eliminate financial loss while enabling continuous business operations during network outages, strict pricing and tender policies are enforced at both frontend UI and server validation layers.

---

## 2. Payment Method Policy: Cash Only

| Payment Method | Permitted Offline? | Architectural Reason |
|---|---|---|
| **Cash** | **YES** | Physical tender is physically accepted into the register cash drawer immediately by the cashier. |
| **Credit / Account** | **NO** | Debtor balances cannot be verified offline; risk of uncollectible credit limits or concurrent overdraft. |
| **Card (Debit/Credit)** | **NO** | Central payment gateway authorization cannot be completed without real-time bank connectivity. |
| **Digital Wallet / QR** | **NO** | Provider notification and settlement cannot be validated offline. |
| **Split Tender** | **NO** | Multiple payment sources complicate atomicity and partial settlement recovery. |

### Rule P-01: Cash Tender Validation
- `cashTenderedMinor` must be equal to or greater than `totalAmountMinor`.
- Exact change returned is computed locally and verified by the server:
  `changeReturnedMinor = cashTenderedMinor - totalAmountMinor`
- Server verifies exact minor calculations and rejects any sale where `cashTenderedMinor < totalAmountMinor`.

---

## 3. Pricing Policy: Authoritative Catalog Prices Only

### Rule P-02: Strict Prohibitions
1. **No Manual Price Overrides**:
   The unit price of every line item must match the authoritative selling price recorded in the active offline authorization package.
2. **No Line or Total Discounts**:
   The server authorization issues `allow_discounts = 0`. Any offline sale payload containing non-zero discount values is rejected with `422 UNPROCESSABLE_ENTITY`.
3. **No Dynamic Tax Modifications**:
   Tax rules and calculation methods are locked to the catalog pricing snapshot at the time of authorization issuance.

---

## 4. Customer Scope Policy: Walk-in Only

### Rule P-03: Walk-in Customer Exclusivity
- Offline sales cannot select existing debtors or register new customer profiles.
- All offline transactions are mapped to the business walk-in customer account:
  `cust_walkin_{businessId}`
- If the walk-in customer profile does not exist in the central database, the server commit transaction automatically provisions it atomically.
- This ensures zero foreign key violations in the central `sales`, `invoices`, and `payments` tables without exposing sensitive customer ledger data offline.


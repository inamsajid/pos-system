# Step 13.1 Local Data Classification Specification

## 1. Data Classification Matrix

Browser storage (IndexedDB / Dexie) is stored in the local user profile on disk and is **unencrypted** at the application level. To minimize security exposure, compliance risk, and data leakage, Northstar POS strictly classifies what data is permitted in local device storage.

| Classification | Category | Specific Entities / Fields | Storage Destination | Permitted in Step 13.1–13.3 |
| :--- | :--- | :--- | :--- | :--- |
| **PUBLIC / OPERATIONAL** | Device Identity | Installation UUID, creation timestamp, schema version | Dexie `deviceMetadata` | **YES** |
| **PUBLIC / OPERATIONAL** | Catalog Master | Product ID, name, SKU, barcode, unit, selling price minor, category ID, status, thumbnail URL | Dexie `cachedProducts` | **YES** |
| **PUBLIC / OPERATIONAL** | Category Taxonomy | Category ID, name, slug, description, display order, status | Dexie `cachedCategories` | **YES** |
| **OPERATIONAL / STALE** | Branch Stock Snapshot | Product ID, quantity on hand snapshot, unit, threshold, sync timestamp | Dexie `cachedBranchStock` | **YES (Informational Only)** |
| **OPERATIONAL** | Sync Metadata | Active snapshot ID, sync timestamp, sync status, error summary | Dexie `cacheSyncState` | **YES** |
| **STRICTLY FORBIDDEN** | Authentication Credentials | Passwords, password hashes, PBKDF2 salts, API keys | Nowhere on client | **NO** |
| **STRICTLY FORBIDDEN** | Session Tokens | Session secrets, bearer tokens, raw cookie contents | Memory / HttpOnly Cookie only | **NO** |
| **STRICTLY FORBIDDEN** | Confidential Costing | Purchase cost minor (`purchase_price_minor`), vendor margins, supplier cost lists | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Customer PII | Customer names, phone numbers, tax numbers, addresses, credit limits | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Supplier PII | Supplier contact names, phone numbers, banking details | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Financial Transactions | Sales tickets, cash receipts, invoices, payments, allocations | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Financial Subledgers | Customer ledger entries, supplier ledger entries, running balances | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Procurement Records | Purchase orders, goods receipts, purchase bills | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Management Reports | Sales summary, gross profit, cash drawer totals, tax analytics | Central D1 only | **NO** |
| **STRICTLY FORBIDDEN** | Private Storage Media | Original invoices, receipts, tax certificates from R2 | Central R2 / Memory stream | **NO** |

---

## 2. Rationale & Security Implications

### 2.1 Confidential Purchase Price Exclusion
- **Rationale**: In retail POS environments, cashiers and floor staff operate registers. Exposing raw wholesale supplier purchase prices in the local browser database allows unauthorized inspection of store profit margins.
- **Enforcement**: When products are transformed from server `ProductDTO` into `CachedProductRecord`, the `purchasePriceMinor` field is omitted. Only `sellingPriceMinor` is retained for POS checkout browsing.

### 2.2 Customer & Supplier PII Exclusion
- **Rationale**: Device theft or shared workstation inspection could expose customer phone numbers and credit balances.
- **Enforcement**: Customer and supplier records remain online-only in Steps 13.1–13.3.

### 2.3 Local Device Disk Security Warning
- IndexedDB files are stored in the browser profile directory (`%LOCALAPPDATA%\Google\Chrome\User Data\...` or `%APPDATA%\Mozilla\Firefox\...`).
- Anyone with administrative access to the operating system can read IndexedDB contents.
- **Policy**: Store owners must enable full-disk encryption (BitLocker on Windows) on POS hardware to protect cached catalog data at rest.


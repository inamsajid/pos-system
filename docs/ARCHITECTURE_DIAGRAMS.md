# Northstar POS Architecture Diagrams & Technical Blueprints

**Document**: System Architecture Blueprints & Visual Workflows  
**System**: Point of Sale & Retail Management Platform  
**Target Architecture**: Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare R2, React 19 + TypeScript + Vite, Dexie.js (IndexedDB v4)  
**Date**: November 9, 2026  
**Auditor**: Google Antigravity (Gemini 3.8 Flash High)

---

## 1. High-Level Application Architecture

```mermaid
graph TD
    subgraph ClientLayer ["Client Browser / PWA Layer"]
        UI["React 19 SPA (Vite + Tailwind CSS v4)"]
        SW["Service Worker (public/sw.js)"]
        DexieDB[("IndexedDB: Dexie.js (v4)<br/>northstar_pos_offline_v1")]
        OutboxQueue["Durable Outbox & Reconnection Service"]
    end

    subgraph EdgeLayer ["Cloudflare Edge Platform"]
        CDN["Cloudflare Global Edge / CDN"]
        Worker["Cloudflare Worker API (worker/src/index.ts)"]
    end

    subgraph PersistenceLayer ["Cloudflare Cloud Storage"]
        D1[("Cloudflare D1 (SQLite Engine)<br/>pos-system-local / remote")]
        R2[("Cloudflare R2 Bucket<br/>pos-system-*-files")]
    end

    UI -->|"Static Shell Boot"| SW
    SW -->|"Cache Fallback (HTML/JS/CSS)"| UI
    UI <-->|"Offline Cache / Outbox"| DexieDB
    DexieDB <--> OutboxQueue
    UI -->|"HTTPS / REST (JSON) with Cookies"| CDN
    OutboxQueue -->|"Sync & Commit /api/v1/offline/*"| CDN
    CDN --> Worker
    Worker <-->|"D1 Prepared SQL & Atomic Batches"| D1
    Worker <-->|"S3 API / File Streaming"| R2
```

---

## 2. Frontend Component & Feature Architecture

```mermaid
graph TD
    App["App Root (main.tsx)"] --> Providers["Providers (providers.tsx)"]
    Providers --> QueryClient["TanStack Query Provider"]
    Providers --> AuthProv["AuthProvider (AuthContext.tsx)"]
    Providers --> Router["React Router 7 (router.tsx)"]

    Router --> AuthLayout["AuthLayout"]
    AuthLayout --> LoginPage["LoginPage"]
    AuthLayout --> RegisterPage["RegisterPage"]
    AuthLayout --> ForgotPwPage["ForgotPasswordPage"]

    Router --> ProtectedRoute["ProtectedRoute"]
    ProtectedRoute --> DashboardLayout["DashboardLayout"]
    DashboardLayout --> Header["Header (Search, OfflinePill, UserMenu)"]
    DashboardLayout --> Sidebar["Sidebar (RBAC Filtered Navigation)"]
    DashboardLayout --> MobileNav["MobileNavigation"]
    DashboardLayout --> Outlet["Route Outlet"]

    Outlet --> DashPage["DashboardPage (/dashboard)"]
    Outlet --> PosPage["PosPage (/pos)"]
    Outlet --> ProdPage["ProductsPage (/products)"]
    Outlet --> CatPage["CategoriesPage (/categories)"]
    Outlet --> CustPage["CustomersPage (/customers)"]
    Outlet --> CustAccPage["CustomerAccountPage (/customers/:id/account)"]
    Outlet --> SupPage["SuppliersPage (/suppliers)"]
    Outlet --> SupAccPage["SupplierAccountPage (/suppliers/:id/account)"]
    Outlet --> SalesPage["SalesPage (/sales)"]
    Outlet --> InvPage["InvoicesPage (/invoices)"]
    Outlet --> StockPage["InventoryPage (/inventory)"]
    Outlet --> PurchPage["PurchasesPage (/purchases)"]
    Outlet --> PayPage["PaymentsPage (/payments)"]
    Outlet --> SupPayPage["SupplierPaymentsPage (/supplier-payments)"]
    Outlet --> PermGuard["PermissionGuard"]

    PermGuard --> LedgerPage["LedgerPage (/ledger)"]
    PermGuard --> ExpPage["ExpensesPage (/expenses)"]
    PermGuard --> StaffPage["StaffPage (/staff)"]
    PermGuard --> StaffDetPage["StaffDetailsPage (/staff/:id)"]
    PermGuard --> SettingsPage["SettingsPage (/settings)"]
```

---

## 3. Frontend-to-Backend Communication & Offline Outbox Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Cashier / POS User
    participant Cart as POS Cart Component
    participant Svc as checkoutService.ts
    participant Outbox as OutboxDispatcher (IndexedDB)
    participant Client as apiClient (api-client.ts)
    participant Worker as Cloudflare Worker API
    participant D1 as D1 Database (SQLite)

    Cashier->>Cart: Click "Complete Checkout"
    Cart->>Svc: completeCheckout(quantities, customer, payments)
    
    alt Device is Online
        Svc->>Client: POST /api/v1/sales (Idempotency-Key: UUID)
        Client->>Worker: HTTPS Request + Session Cookie + Tenant Headers
        Worker->>Worker: Validate Tenant & Stock Availability
        Worker->>D1: Atomic Batch (Sales + Items + Invoice + Stock + Ledger)
        D1-->>Worker: Commit Success
        Worker-->>Client: 201 Created (SaleDTO)
        Client-->>Svc: SaleDTO
        Svc-->>Cart: Return Completed Sale & Print Receipt
    else Device is Offline / Network Drop
        Svc->>Outbox: Enqueue Command (CMD_CREATE_OFFLINE_SALE)
        Outbox->>Outbox: Persist to Dexie outboxCommands table
        Svc-->>Cart: Generate Provisional Offline Sale Receipt
        Note over Outbox,Worker: Background Reconnection Monitor
        Outbox->>Worker: POST /api/v1/offline/sales/commit
        Worker->>D1: Atomic Commit + Deduplication Check
        D1-->>Worker: Success
        Worker-->>Outbox: 200 OK (Committed)
        Outbox->>Outbox: Mark Outbox Command Completed
    end
```

---

## 4. Backend Request Lifecycle & Cloudflare Worker Architecture

```mermaid
flowchart TD
    Req["Incoming Fetch Request"] --> CORS["CORS & Request ID Handler (router.ts)"]
    CORS --> RouteMatch{"Router Match Path & Method?"}
    
    RouteMatch -- No --> Ret404["404 Not Found (JSON Envelope)"]
    RouteMatch -- Yes --> AuthCheck{"Public or Health Route?"}
    
    AuthCheck -- Yes --> Handler["Route Handler Execution"]
    AuthCheck -- No --> SessionMW["Session Middleware (sessionService.ts)"]
    
    SessionMW --> ValidSession{"Valid Session Token in Cookie/Bearer?"}
    ValidSession -- No --> Ret401["401 Unauthorized"]
    ValidSession -- Yes --> TenantMW["Tenant Middleware (tenantContext.ts)"]
    
    TenantMW --> ValidMembership{"Active Member of Business?"}
    ValidMembership -- No --> Ret403Tenant["403 Forbidden: Tenant Isolation"]
    ValidMembership -- Yes --> PermCheck{"Hold Required Role Permission?"}
    
    PermCheck -- No --> Ret403Perm["403 Forbidden: Permission Denied"]
    PermCheck -- Yes --> Service["Domain Service Execution"]
    
    Service --> Repo["Repository Layer"]
    Repo --> D1Stmt["D1 Prepared Statements (.prepare().bind())"]
    D1Stmt --> D1Exec{"D1 Execution (.first(), .all(), .batch())"}
    
    D1Exec -- Error / Constraint --> ErrCatch["HttpError / Domain Exception"]
    ErrCatch --> RetErr["Structured Error Envelope (code, message, requestId)"]
    
    D1Exec -- Success --> Audit["Audit Log / ChangeLog Trigger"]
    Audit --> RetSuccess["200/201 JSON Response Envelope"]
```

---

## 5. Authentication, Multi-Tenancy & RBAC Flow

```mermaid
graph TD
    subgraph GlobalIdentity ["Global Identity Context"]
        User["User Account (users table)"]
        Credentials["Password Hash (PBKDF2-SHA256)"]
        User --> Credentials
    end

    subgraph BusinessTenancy ["Multi-Tenant Boundary"]
        BizA["Business A (Retail Store)"]
        BizB["Business B (Supermarket)"]
        MemberA["business_members (Role: Manager)"]
        MemberB["business_members (Role: Cashier)"]
        User --> MemberA --> BizA
        User --> MemberB --> BizB
    end

    subgraph BranchAccess ["Branch Scoping"]
        Branch1["Branch 1 (Main Outlet)"]
        Branch2["Branch 2 (Express Outlet)"]
        MemberBranches["member_branches table"]
        MemberA --> MemberBranches
        MemberBranches --> Branch1
        MemberBranches --> Branch2
    end

    subgraph RBACValidation ["Permission Gate (ROLE_PERMISSIONS)"]
        Role{"Role in Active Business"}
        Role -->|Owner| PermAll["All Permissions (Full Control)"]
        Role -->|Admin| PermAdmin["Staff, Catalog, Operations, Reports (No Settings)"]
        Role -->|Manager| PermMgr["Catalog, Operations, Adjustments, Reports"]
        Role -->|Cashier| PermCashier["POS Sales, Payment Collection, Catalog Read"]
        Role -->|Accountant| PermAcct["Ledgers, Payments, Disbursals, Expenses, Reports"]
        Role -->|Inventory Manager| PermInv["Catalog Write, Stocktake, Purchases, Receipts"]
    end
```

---

## 6. State Management & Data Ownership

```mermaid
graph LR
    subgraph UIComponents ["UI Components Layer"]
        C1["PosPage"]
        C2["ExpenseTable"]
        C3["Sidebar"]
        C4["LedgerTable"]
    end

    subgraph StateOwners ["State Ownership & Persistence Layer"]
        Zustand["Zustand store (appStore.ts)<br/>Ownership: UI sidebar collapsed toggle<br/>Persistence: Session Memory"]
        TanStack["TanStack Query (queryClient.ts)<br/>Ownership: Server State (Products, Expenses, Staff)<br/>Persistence: In-Memory Query Cache + Stale Time"]
        Dexie["Dexie.js Offline DB (database.ts)<br/>Ownership: Catalog Cache, Outbox Commands, Offline Sales<br/>Persistence: Browser IndexedDB"]
        LocalStorage["Browser localStorage<br/>Ownership: In-Memory Demo Fallbacks (if VITE_DATA_SOURCE=mock)<br/>Persistence: Key-Value LocalStorage"]
        AuthCtx["AuthContext (useAuth.ts)<br/>Ownership: Session User, Active Business, Active Branch<br/>Persistence: Revalidated via GET /api/v1/auth/me"]
    end

    C3 <--> Zustand
    C1 <--> Dexie
    C2 <--> TanStack
    C4 <--> TanStack
    UIComponents <--> AuthCtx
    UIComponents -.->|Mock Only| LocalStorage
```

---

## 7. Complete Entity Relationship Diagram (ERD) — 46 Database Tables

```mermaid
erDiagram
    businesses ||--o{ branches : "has"
    businesses ||--o{ business_members : "employs"
    businesses ||--o{ business_settings : "configures"
    businesses ||--o{ categories : "classifies"
    businesses ||--o{ products : "sells"
    businesses ||--o{ customers : "serves"
    businesses ||--o{ suppliers : "sources_from"
    businesses ||--o{ sales : "records"
    businesses ||--o{ invoices : "issues"
    businesses ||--o{ payments : "receives"
    businesses ||--o{ customer_ledger_transactions : "tracks_ar"
    businesses ||--o{ purchases : "orders"
    businesses ||--o{ goods_receipts : "receives_stock"
    businesses ||--o{ supplier_payments : "disburses"
    businesses ||--o{ supplier_ledger_transactions : "tracks_ap"
    businesses ||--o{ inventory_balances : "maintains"
    businesses ||--o{ stock_movements : "audits"
    businesses ||--o{ stock_adjustments : "adjusts"
    businesses ||--o{ stock_counts : "audits_stock"
    businesses ||--o{ expense_categories : "categorizes_costs"
    businesses ||--o{ expenses : "spends"
    businesses ||--o{ audit_logs : "logs"
    businesses ||--o{ devices : "registers"
    businesses ||--o{ sync_change_log : "replicates"
    businesses ||--o{ offline_authorizations : "authorizes"
    businesses ||--o{ device_stock_allocations : "reserves"
    businesses ||--o{ staff_invitations : "invites"
    api_rate_limits ||--o{ devices : "throttles"

    users ||--o{ business_members : "joins"
    users ||--o{ sessions : "authenticates"
    users ||--o{ password_reset_tokens : "requests"
    users ||--o{ files : "uploads"

    business_members ||--o{ member_branches : "assigned_to"
    branches ||--o{ member_branches : "staffed_by"
    branches ||--o{ inventory_balances : "stores"
    branches ||--o{ sales : "transacts"

    categories ||--o{ products : "groups"
    suppliers ||--o{ supplier_products : "supplies"
    products ||--o{ supplier_products : "supplied_by"
    products ||--o{ inventory_balances : "counted_in"
    products ||--o{ stock_movements : "tracked_in"

    sales ||--o{ sale_items : "contains"
    sales ||--o| invoices : "generates"
    sales ||--o{ sale_returns : "refunds"
    sale_returns ||--o{ sale_return_items : "contains"
    customers ||--o{ sales : "purchases"
    customers ||--o{ payments : "pays"
    customers ||--o{ customer_ledger_transactions : "statement"

    payments ||--o{ payment_allocations : "allocates"
    invoices ||--o{ payment_allocations : "settled_by"
    payment_methods ||--o{ payments : "uses"

    purchases ||--o{ purchase_items : "contains"
    purchases ||--o{ goods_receipts : "fulfilled_by"
    goods_receipts ||--o{ goods_receipt_items : "contains"
    suppliers ||--o{ purchases : "bills"
    suppliers ||--o{ supplier_payments : "paid_by"
    supplier_payments ||--o{ supplier_payment_allocations : "allocates"
    purchases ||--o{ supplier_payment_allocations : "settled_by"
    suppliers ||--o{ supplier_ledger_transactions : "statement"

    stock_counts ||--o{ stock_count_items : "counts"
    expense_categories ||--o{ expenses : "classifies"
    devices ||--o{ device_registrations : "registers_history"
    devices ||--o{ device_stock_allocations : "holds_quota"
```

---

## 8. Business Workflow Diagrams

### Workflow A — Product Catalog & Pricing Setup
```mermaid
flowchart TD
    Start["User enters /products/new"] --> Form["Fill ProductForm (Name, SKU, Barcode, Prices, Stock)"]
    Form --> Submit["Click 'Save Product'"]
    Submit --> ClientValidation["Zod / React Hook Form Validation"]
    ClientValidation -- Invalid --> ShowErr["Display inline form validation errors"]
    ClientValidation -- Valid --> ApiCall["POST /api/v1/products"]
    ApiCall --> Worker["Products Route Handler (products.routes.ts)"]
    Worker --> UniqueCheck{"SKU or Barcode Duplicate in Business?"}
    UniqueCheck -- Yes --> RetConflict["409 Conflict: Duplicate code"]
    UniqueCheck -- No --> D1Insert["D1 Batch: INSERT into products + INSERT inventory_balances"]
    D1Insert --> ChangeLog["INSERT sync_change_log (Replication record)"]
    ChangeLog --> RetCreated["201 Created: ProductDTO"]
    RetCreated --> QueryInvalidate["TanStack Query: invalidateQueries(['products'])"]
    QueryInvalidate --> BgSync["syncCatalog() -> Update Dexie cachedProducts"]
    BgSync --> Redirect["Navigate to /products"]
```

### Workflow B & C — Customer & Supplier Creation
```mermaid
flowchart TD
    StartCust["User enters /customers/new or /suppliers/new"] --> Input["Fill Profile Details (Name, Phone, Email, Tax No, Opening Balance)"]
    Input --> Validate["Frontend validation (Unique name, valid phone format)"]
    Validate --> Dispatch{"Service Execution Mode"}
    Dispatch -- Online API --> Api["Worker API Endpoint (/customers or /suppliers)"]
    Dispatch -- Demo / Mock --> Local["customerService / supplierService in-memory repository"]
    Local --> AssignCode["Generate Customer/Supplier Code (CUS-1001 / SUP-1001)"]
    AssignCode --> UpdateList["Prepend record to state array"]
    UpdateList --> ReturnUI["Show Success Toast & Redirect to Profile"]
```

### Workflow D — POS Checkout & Atomic Settlement
```mermaid
flowchart TD
    Scan["Cashier scans barcode / searches item"] --> Cart["Add Item to POS Cart (PosPage)"]
    Cart --> Qty["Set Quantity & Item Discount"]
    Qty --> CustSel["Select Customer (Walk-in or Registered Account)"]
    CustSel --> PayModal["Click F8 / 'Payment' -> Open Payment Modal"]
    PayModal --> MethodSel["Select Payment Method (Cash, Card, Bank Transfer, Credit)"]
    MethodSel --> ValidChk{"Credit on Walk-in or Overpayment on Non-Cash?"}
    ValidChk -- Disallowed --> BlockMsg["Show Validation Error Alert"]
    ValidChk -- Allowed --> Complete["Click 'Complete Sale' (Ctrl + Enter)"]
    Complete --> Mutate["POST /api/v1/sales (Idempotency-Key)"]
    
    subgraph D1Transaction ["Cloudflare D1 Atomic Execution"]
        D1A["1. INSERT sales record"]
        D1B["2. INSERT sale_items records"]
        D1C["3. INSERT invoices record"]
        D1D["4. UPDATE inventory_balances (Deduct stock)"]
        D1E["5. INSERT stock_movements (Type: sale)"]
        D1F["6. INSERT payments + payment_allocations"]
        D1G["7. INSERT customer_ledger_transactions (Debit: sale, Credit: payment)"]
        D1H["8. INSERT sync_change_log records"]
        D1A --> D1B --> D1C --> D1D --> D1E --> D1F --> D1G --> D1H
    end

    Mutate --> D1Transaction
    D1Transaction --> Receipt["201 Created -> Render Thermal Receipt Modal"]
    Receipt --> Print["Print Receipt (ESC to reset cart for next customer)"]
```

### Workflow E & F — Customer Payment & Ledger Reconciliation
```mermaid
sequenceDiagram
    autonumber
    actor Acct as Accountant / Cashier
    participant UI as ReceivePaymentPage (/payments/new)
    participant Svc as paymentService.ts
    participant Worker as Cloudflare Worker API
    participant D1 as D1 Database
    participant Ledger as LedgerPage (/ledger?tab=customers)

    Acct->>UI: Select Customer & Enter Payment Amount
    UI->>UI: Auto-allocate payment to outstanding invoices (Oldest first)
    Acct->>UI: Click "Submit Payment"
    UI->>Svc: createPayment(draft)
    Svc->>Worker: POST /api/v1/customer-payments
    Worker->>D1: D1 Batch: INSERT payments + payment_allocations + UPDATE invoices
    Worker->>D1: INSERT customer_ledger_transactions (Credit entry)
    D1-->>Worker: Commit Success
    Worker-->>Svc: 201 Created (PaymentReceiptDTO)
    Svc-->>UI: Payment Confirmed
    UI->>Ledger: Navigate to Customer Ledger
    Ledger->>Worker: GET /api/v1/customers/:id/ledger
    Worker->>D1: SELECT customer_ledger_transactions ORDER BY created_at ASC
    D1-->>Worker: Transactions List
    Worker-->>Ledger: Running Balance Calculated (Opening + Debits - Credits)
    Ledger-->>Acct: Render Verified Statement with Zero Balance Discrepancy
```

### Workflow G & H — Purchases & Goods Receiving (Three-Way Match)
```mermaid
flowchart TD
    PO_Draft["Manager drafts Purchase Order (/purchases/new)"] --> PO_Confirm["Click 'Confirm Purchase' -> Status: 'ordered'"]
    PO_Confirm --> AwaitShipment["Physical shipment arrives at branch"]
    AwaitShipment --> OpenGR["Click 'Receive Goods' (/purchases/:id/receive)"]
    OpenGR --> EnterQty["Enter physical quantity received per item"]
    EnterQty --> CheckQty{"Received Quantity > Ordered Remaining?"}
    CheckQty -- Yes --> OverError["Error: Cannot receive more than ordered"]
    CheckQty -- No --> PostGR["Submit Goods Receipt (POST /api/v1/purchases/:id/receipts)"]
    
    subgraph StockUpdate ["Atomic Stock & Inventory Valuation"]
        GR1["1. INSERT goods_receipts + goods_receipt_items"]
        GR2["2. UPDATE inventory_balances (Increase quantity_on_hand)"]
        GR3["3. INSERT stock_movements (Type: purchase, Ref: GR-ID)"]
        GR4["4. UPDATE purchase_items (received_quantity)"]
        GR5["5. UPDATE purchases status ('partially_received' or 'received')"]
        GR6["6. INSERT supplier_ledger_transactions (Credit: Accounts Payable Liability)"]
        GR1 --> GR2 --> GR3 --> GR4 --> GR5 --> GR6
    end

    PostGR --> StockUpdate
    StockUpdate --> Finish["Stock Available for POS Sale Immediately"]
```

### Workflow I & J — Supplier Payments & Accounts Payable Settlement
```mermaid
sequenceDiagram
    autonumber
    actor Acct as Accountant
    participant UI as AddSupplierPaymentPage (/supplier-payments/new)
    participant Worker as Cloudflare Worker API
    participant D1 as D1 Database
    participant Ledger as Supplier Ledger (/ledger?tab=suppliers)

    Acct->>UI: Select Supplier & Enter Disbursed Amount
    UI->>UI: Select Confirmed Purchases for Allocation
    Acct->>UI: Click "Record Disbursal"
    UI->>Worker: POST /api/v1/supplier-payments
    Worker->>D1: INSERT supplier_payments + supplier_payment_allocations
    Worker->>D1: INSERT supplier_ledger_transactions (Debit: Reduces Liability)
    D1-->>Worker: Commit Success
    Worker-->>UI: 201 Created
    UI->>Ledger: View Supplier Account Statement
    Ledger->>Worker: GET /api/v1/suppliers/:id/ledger
    Worker->>D1: Calculate Running Balance (Opening Payable + Bills - Payments)
    D1-->>Worker: Statement Statement
    Worker-->>Ledger: Render Accounts Payable Statement
```

### Workflow K — Inventory Stock Count & Discrepancy Reconciliation
```mermaid
flowchart TD
    Start["Manager starts Stocktake (/inventory/count)"] --> Draft["Initialize Stock Count Draft (Captures System Snapshot)"]
    Draft --> Physical["Staff counts shelf stock and enters physical quantities"]
    Physical --> CalcVariance["System computes variance: (Physical - System Quantity)"]
    CalcVariance --> Confirm["Click 'Confirm Stock Count'"]
    Confirm --> CheckDrift{"Stock Changed during Count?"}
    CheckDrift -- Drift Detected --> Reaudit["Reject: Balances modified. Re-audit required."]
    CheckDrift -- No Drift --> ApplyAdj["POST /api/v1/inventory/counts/:id/complete"]
    
    subgraph D1Reconciliation ["Atomic Variance Adjustment"]
        ADJ1["1. UPDATE stock_counts status = 'completed'"]
        ADJ2["2. For each variance != 0: INSERT stock_adjustments"]
        ADJ3["3. UPDATE inventory_balances set quantity_on_hand = physical_quantity"]
        ADJ4["4. INSERT stock_movements (Type: 'stock_count', reason: 'Audit Reconciliation')"]
        ADJ1 --> ADJ2 --> ADJ3 --> ADJ4
    end

    ApplyAdj --> D1Reconciliation
    D1Reconciliation --> Done["Inventory Audited & Variance Closed"]
```

### Workflow L — Financial Reporting & Analytics Aggregation
```mermaid
flowchart TD
    User["User opens /reports or /dashboard"] --> SelectRange["Choose Date Range (Today, 7D, 30D, This Month, Custom)"]
    SelectRange --> ReqData["TanStack Query triggers API Fetch"]
    ReqData --> Worker["GET /api/v1/reports/*"]
    
    subgraph D1Analytics ["D1 Real-Time Analytical Queries"]
        Q1["SELECT SUM(total_amount_minor), COUNT(*) FROM sales WHERE date BETWEEN ? AND ?"]
        Q2["SELECT p.name, SUM(si.quantity), SUM(si.line_total_minor) FROM sale_items GROUP BY p.id"]
        Q3["SELECT payment_method, SUM(amount_minor) FROM payments GROUP BY payment_method"]
        Q4["SELECT SUM(quantity_on_hand * unit_cost_minor) FROM inventory_balances"]
        Q5["SELECT SUM(amount_minor) FROM expenses WHERE status = 'posted'"]
    end

    Worker --> D1Analytics
    D1Analytics --> Pack["Package Metrics into JSON Payload"]
    Pack --> Frontend["Render Recharts (Line/Bar charts) + Summary KPI Cards"]
    Frontend --> ExportOption{"User clicks 'Export CSV'?"}
    ExportOption -- Yes --> CsvStream["Stream CSV Blob -> Browser Download (RFC 4180)"]
    ExportOption -- No --> Idle["Interactive Drill-down"]
```


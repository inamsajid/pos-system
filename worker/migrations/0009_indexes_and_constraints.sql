-- ============================================================================
-- Migration 0009: Composite Performance Indexes & Lookups
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

-- Business & Members
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_business ON business_members(business_id);

-- Catalog
CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_category ON products(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id, barcode) WHERE barcode IS NOT NULL;

-- Customers & Suppliers
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(business_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers(business_id);

-- Inventory
CREATE INDEX IF NOT EXISTS idx_inv_balances_lookup ON inventory_balances(business_id, branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product_date ON stock_movements(business_id, product_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_stock_mov_ref ON stock_movements(business_id, reference_type, reference_id);

-- Sales & Invoices
CREATE INDEX IF NOT EXISTS idx_sales_biz_branch_date ON sales(business_id, branch_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(business_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(business_id, customer_id, business_date_key);

-- Payments & Ledgers
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(business_id, customer_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_sale ON payment_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_cust_ledger_history ON customer_ledger_transactions(business_id, customer_id, business_date_key);

-- Purchases & Supplier Ledgers
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(business_id, supplier_id, purchase_date_key);
CREATE INDEX IF NOT EXISTS idx_supp_ledger_history ON supplier_ledger_transactions(business_id, supplier_id, business_date_key);

-- Audit & Idempotency
CREATE INDEX IF NOT EXISTS idx_audit_logs_biz_date ON audit_logs(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(business_id, operation, idempotency_key);


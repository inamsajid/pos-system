INSERT OR REPLACE INTO users (id, email, phone, name, password_hash, email_verified, status)
VALUES ('usr_admin_001', 'admin@northstar.pk', '+923001234567', 'Ayesha Khan', 'pbkdf2:100000:09ddec0d1519857fe985df6c55400f3d:04fb717a8f67136b8b2d326e8fa77e3036f08ed7293753722386e98ed0b085f9', 1, 'active');

INSERT OR REPLACE INTO businesses (id, business_code, name, currency, country, timezone, status)
VALUES ('biz_northstar_001', 'NORTHSTAR', 'Northstar Market', 'PKR', 'Pakistan', 'Asia/Karachi', 'active');

INSERT OR REPLACE INTO branches (id, business_id, branch_code, name, is_main_branch, status)
VALUES ('branch_main_001', 'biz_northstar_001', 'MAIN', 'Main Branch', 1, 'active');

INSERT OR REPLACE INTO business_members (id, business_id, user_id, role, is_active)
VALUES ('mem_admin_001', 'biz_northstar_001', 'usr_admin_001', 'owner', 1);

INSERT OR REPLACE INTO member_branches (id, member_id, branch_id)
VALUES ('mbr_admin_001', 'mem_admin_001', 'branch_main_001');

INSERT OR REPLACE INTO business_settings (business_id, receipt_header, receipt_footer, default_tax_rate, allow_negative_stock)
VALUES ('biz_northstar_001', 'Northstar Market', 'Thank you for shopping with us!', 0.0, 1);


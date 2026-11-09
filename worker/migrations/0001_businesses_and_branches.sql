-- ============================================================================
-- Migration 0001: Businesses, Branches, Users, Memberships & Settings
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  business_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_number TEXT,
  currency TEXT NOT NULL DEFAULT 'PKR',
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'Pakistan',
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  status TEXT NOT NULL CHECK(status IN ('active', 'suspended', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  is_main_branch INTEGER NOT NULL DEFAULT 0 CHECK(is_main_branch IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, branch_code)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'banned')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_manager')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, user_id)
);

CREATE TABLE IF NOT EXISTS member_branches (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, branch_id)
);

CREATE TABLE IF NOT EXISTS business_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  receipt_header TEXT,
  receipt_footer TEXT,
  default_tax_rate REAL NOT NULL DEFAULT 0.0 CHECK(default_tax_rate >= 0),
  allow_negative_stock INTEGER NOT NULL DEFAULT 1 CHECK(allow_negative_stock IN (0, 1)),
  max_void_hours INTEGER NOT NULL DEFAULT 24 CHECK(max_void_hours >= 1),
  settings_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


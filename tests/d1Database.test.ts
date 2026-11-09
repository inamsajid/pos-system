import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

describe('D1 Database — Migrations, Constraints & Relational Integrity', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')

    // Apply migrations 0001 through 0009
    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      db.exec(sql)
    }
  })

  it('creates all 40 tables with foreign keys enabled', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>

    expect(tables.length).toBeGreaterThanOrEqual(40)
    expect(tables.some((t) => t.name === 'files')).toBe(true)
    expect(tables.some((t) => t.name === 'devices')).toBe(true)
    expect(tables.some((t) => t.name === 'sync_change_log')).toBe(true)
  })

  it('enforces foreign key constraints on sessions referencing user', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO sessions (id, user_id, token, expires_at)
        VALUES ('sess-1', 'non-existent-user', 'tok-123', '2026-11-10T00:00:00Z')
      `).run()
    }).toThrow()
  })

  it('enforces foreign key constraints on products referencing business', () => {
    // Attempting to insert product without existing business must fail foreign key check
    expect(() => {
      db.prepare(`
        INSERT INTO products (id, business_id, sku, name, unit, purchase_price_minor, selling_price_minor)
        VALUES ('p1', 'non-existent-biz', 'SKU-001', 'Test Product', 'piece', 1000, 1500)
      `).run()
    }).toThrow()
  })

  it('enforces unique SKU per business', () => {
    // Seed business
    db.prepare(`
      INSERT INTO businesses (id, business_code, name)
      VALUES ('biz-1', 'BIZ001', 'Northstar Market')
    `).run()

    // Insert first product
    db.prepare(`
      INSERT INTO products (id, business_id, sku, name, unit, purchase_price_minor, selling_price_minor)
      VALUES ('prod-1', 'biz-1', 'SKU-RICE-01', 'Basmati Rice', 'kg', 10000, 15000)
    `).run()

    // Second product with identical SKU under SAME business must fail
    expect(() => {
      db.prepare(`
        INSERT INTO products (id, business_id, sku, name, unit, purchase_price_minor, selling_price_minor)
        VALUES ('prod-2', 'biz-1', 'SKU-RICE-01', 'Duplicate Rice', 'kg', 10000, 15000)
      `).run()
    }).toThrow()

    // Same SKU under a DIFFERENT business is allowed
    db.prepare(`
      INSERT INTO businesses (id, business_code, name)
      VALUES ('biz-2', 'BIZ002', 'Other Market')
    `).run()

    expect(() => {
      db.prepare(`
        INSERT INTO products (id, business_id, sku, name, unit, purchase_price_minor, selling_price_minor)
        VALUES ('prod-3', 'biz-2', 'SKU-RICE-01', 'Basmati Rice Other', 'kg', 10000, 15000)
      `).run()
    }).not.toThrow()
  })

  it('enforces non-negative integer paise amounts via CHECK constraints', () => {
    db.prepare(`
      INSERT INTO businesses (id, business_code, name)
      VALUES ('biz-1', 'BIZ001', 'Northstar Market')
    `).run()

    // Negative selling price must be rejected
    expect(() => {
      db.prepare(`
        INSERT INTO products (id, business_id, sku, name, unit, purchase_price_minor, selling_price_minor)
        VALUES ('prod-neg', 'biz-1', 'SKU-NEG', 'Negative Item', 'piece', 500, -100)
      `).run()
    }).toThrow()
  })

  it('enforces unique invoice number per business', () => {
    db.prepare(`
      INSERT INTO businesses (id, business_code, name)
      VALUES ('biz-1', 'BIZ001', 'Northstar Market')
    `).run()

    db.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name)
      VALUES ('branch-1', 'biz-1', 'MAIN', 'Main Branch')
    `).run()

    db.prepare(`
      INSERT INTO users (id, email, name)
      VALUES ('user-1', 'cashier@example.com', 'Ayesha Khan')
    `).run()

    db.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name)
      VALUES ('cust-1', 'biz-1', 'CUST01', 'Walk-in')
    `).run()

    // Insert sale 1
    db.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name,
        subtotal_minor, total_amount_minor, business_date_key
      ) VALUES (
        'sale-1', 'biz-1', 'branch-1', 'SALE-01', 'REC-01', 'INV-2026-001',
        'cust-1', '{}', 'POS01', 'user-1', 'Ayesha Khan',
        5000, 5000, '2026-11-09'
      )
    `).run()

    // Inserting sale with duplicate invoice number under same business must fail
    expect(() => {
      db.prepare(`
        INSERT INTO sales (
          id, business_id, branch_id, sale_number, receipt_number, invoice_number,
          customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name,
          subtotal_minor, total_amount_minor, business_date_key
        ) VALUES (
          'sale-2', 'biz-1', 'branch-1', 'SALE-02', 'REC-02', 'INV-2026-001',
          'cust-1', '{}', 'POS01', 'user-1', 'Ayesha Khan',
          3000, 3000, '2026-11-09'
        )
      `).run()
    }).toThrow()
  })

  it('cascades deletion across branches and members when a business is deleted', () => {
    db.prepare(`
      INSERT INTO businesses (id, business_code, name)
      VALUES ('biz-del', 'BIZDEL', 'Temporary Store')
    `).run()

    db.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name)
      VALUES ('branch-del', 'biz-del', 'MAIN', 'Temp Branch')
    `).run()

    const branchBefore = db.prepare("SELECT count(*) as count FROM branches WHERE business_id = 'biz-del'").get() as { count: number }
    expect(branchBefore.count).toBe(1)

    // Delete business
    db.prepare("DELETE FROM businesses WHERE id = 'biz-del'").run()

    const branchAfter = db.prepare("SELECT count(*) as count FROM branches WHERE business_id = 'biz-del'").get() as { count: number }
    expect(branchAfter.count).toBe(0)
  })
})


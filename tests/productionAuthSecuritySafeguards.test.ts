import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { createTestD1Database } from './offline/testD1Helper'

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Production Authentication & Secret Safeguards Regression', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_auth_guard'
  const branchId = 'branch_auth_guard'
  const ownerUserId = 'usr_owner_guard'
  const cashierUserId = 'usr_cashier_guard'

  let cashierToken: string

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
    }

    d1 = createTestD1Database(sqlite)
    env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'production',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
      // Intentionally configured with valid secret initially
      AUTH_SECRET: 'super-secure-production-secret-key-32-chars',
    }

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'SEC01', 'Auth Guard Business', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Security Main Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock, default_tax_rate)
      VALUES (?, 1, 0.0)
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@guard.pk', 'Owner', 'hash', 'active'),
             (?, 'cashier@guard.pk', 'Cashier', 'hash', 'active')
    `).run(ownerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_sec', ?, ?, 'owner', 1),
             ('mem_cashier_sec', ?, ?, 'cashier', 1)
    `).run(businessId, ownerUserId, businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_sec', 'mem_cashier_sec', ?)
    `).run(branchId)

    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES ('dev_guard_01', 'inst_guard_01', ?, ?, 'POS Terminal Sec', 'active')
    `).run(businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_sec_1', ?, 'Secure Product', 'SEC-01', '3001', 'piece', 1000, 2000, 0, 'active')
    `).run(businessId)

    const session = await createSession(d1, cashierUserId, '127.0.0.1', 'Vitest Security Agent')
    cashierToken = session.token
  })

  // 1. Bootstrap Idempotency and Anti-Takeover Safeguards
  describe('Bootstrap Endpoint Safeguards', () => {
    it('fails closed with 409 Conflict when users already exist in the database', async () => {
      const bootstrapReq = new Request('http://localhost/api/v1/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@evil.com',
          password: 'Password123!',
          name: 'Hacker',
          businessName: 'Takeover Corp',
        }),
      })

      const res = await worker.fetch(bootstrapReq, env, executionCtx)
      expect(res.status).toBe(409)
      const data = await res.json() as { error: { message: string; code: string } }
      expect(data.error.message).toContain('Bootstrap already completed')
      expect(data.error.code).toBe('CONFLICT')
    })
  })

  // 2. AUTH_SECRET Failure Modes and Fail-Closed Verification
  describe('Cryptographic AUTH_SECRET Fail-Closed Enforcement', () => {
    it('fails closed with 500 CONFIGURATION_ERROR if AUTH_SECRET is completely missing in environment', async () => {
      // Remove AUTH_SECRET from environment
      const brokenEnv: Env = {
        ...env,
        AUTH_SECRET: undefined,
      }

      const authReq = new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cashierToken}`,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId: 'dev_guard_01',
          durationHours: 8,
          products: [{ productId: 'prod_sec_1', allocatedQuantity: 10 }],
        }),
      })

      const res = await worker.fetch(authReq, brokenEnv, executionCtx)
      expect(res.status).toBe(500)
      const data = await res.json() as { error: { message: string; code: string } }
      expect(data.error.code).toBe('CONFIGURATION_ERROR')
      expect(data.error.message).toContain('AUTH_SECRET')
      // Ensure the actual secret is not leaked
      expect(JSON.stringify(data)).not.toContain('super-secure-production-secret')
    })

    it('fails closed with 500 CONFIGURATION_ERROR if AUTH_SECRET is insufficiently short (<16 chars)', async () => {
      const weakEnv: Env = {
        ...env,
        AUTH_SECRET: 'too-short', // Only 9 characters
      }

      const authReq = new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cashierToken}`,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId: 'dev_guard_01',
          durationHours: 8,
          products: [{ productId: 'prod_sec_1', allocatedQuantity: 10 }],
        }),
      })

      const res = await worker.fetch(authReq, weakEnv, executionCtx)
      expect(res.status).toBe(500)
      const data = await res.json() as { error: { message: string; code: string } }
      expect(data.error.code).toBe('CONFIGURATION_ERROR')
      expect(data.error.message).toContain('insufficiently configured')
    })

    it('fails closed on offline sale commit if AUTH_SECRET is missing', async () => {
      const brokenEnv: Env = {
        ...env,
        AUTH_SECRET: undefined,
      }

      const commitReq = new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cashierToken}`,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          authorizationId: 'auth_dummy_123',
          deviceId: 'dev_guard_01',
          provisionalReceiptNumber: 'OFF-REC-001',
          items: [{ productId: 'prod_sec_1', quantity: 1, unitPriceMinor: 2000 }],
        }),
      })

      const res = await worker.fetch(commitReq, brokenEnv, executionCtx)
      expect(res.status).toBe(500)
      const data = await res.json() as { error: { message: string; code: string } }
      expect(data.error.code).toBe('CONFIGURATION_ERROR')
    })
  })

  // 3. Secret Exposure Prevention
  describe('Secret Masking & Information Leakage', () => {
    it('never prints or exposes secret values in health, ready, or root informational endpoints', async () => {
      const endpoints = ['/', '/api/v1/health', '/api/v1/ready']
      for (const endpoint of endpoints) {
        const req = new Request(`http://localhost${endpoint}`)
        const res = await worker.fetch(req, env, executionCtx)
        expect(res.status).toBe(200)
        const bodyText = await res.text()
        expect(bodyText).not.toContain('super-secure-production-secret')
        expect(bodyText).not.toContain('AUTH_SECRET')
      }
    })
  })
})


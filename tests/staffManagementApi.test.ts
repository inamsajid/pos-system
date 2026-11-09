import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'

function createRealD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = Record<string, unknown>>() {
              const stmt = sqlite.prepare(query)
              const row = stmt.get(...args)
              return (row as T) || null
            },
            async all<T = Record<string, unknown>>() {
              const stmt = sqlite.prepare(query)
              const results = stmt.all(...args) as T[]
              return { results, success: true, meta: {} }
            },
            async run() {
              const stmt = sqlite.prepare(query)
              const info = stmt.run(...args)
              return { success: true, meta: { changes: info.changes } }
            },
          } as unknown as D1PreparedStatement
        },
        async first<T = Record<string, unknown>>() {
          const stmt = sqlite.prepare(query)
          const row = stmt.get()
          return (row as T) || null
        },
        async all<T = Record<string, unknown>>() {
          const stmt = sqlite.prepare(query)
          const results = stmt.all() as T[]
          return { results, success: true, meta: {} }
        },
        async run() {
          const stmt = sqlite.prepare(query)
          const info = stmt.run()
          return { success: true, meta: { changes: info.changes } }
        },
      } as unknown as D1PreparedStatement
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      sqlite.exec('BEGIN TRANSACTION;')
      try {
        const results = []
        for (const s of statements) {
          results.push(await s.run())
        }
        sqlite.exec('COMMIT;')
        return results
      } catch (e) {
        sqlite.exec('ROLLBACK;')
        throw e
      }
    },
    async exec(query: string) {
      sqlite.exec(query)
      return { count: 1, duration: 0 }
    },
  } as unknown as D1Database
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Step 14.3 — Staff Management API (/api/v1/staff)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_staff_14'
  const branchId = 'br_staff_14'
  const ownerUserId = 'usr_owner_staff'
  const adminUserId = 'usr_admin_staff'
  const cashierUserId = 'usr_cashier_staff'

  let ownerToken: string
  let adminToken: string
  let cashierToken: string

  const ownerMemberId = 'bm_owner_14'
  const adminMemberId = 'bm_admin_14'
  const cashierMemberId = 'bm_cashier_14'

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      sqlite.exec(sql)
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZSTAFF', 'Team Retail Solutions', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BRMAIN', 'Main Store', 1, 'active')
    `).run(branchId, businessId)

    // Seed Users
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'owner@team.com', 'Ayesha Khan', 'active')`).run(ownerUserId)
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'admin@team.com', 'Bilal Ahmed', 'active')`).run(adminUserId)
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'cashier@team.com', 'Fatima Noor', 'active')`).run(cashierUserId)

    // Seed Memberships
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES (?, ?, ?, 'owner', 1)`).run(ownerMemberId, businessId, ownerUserId)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES (?, ?, ?, 'admin', 1)`).run(adminMemberId, businessId, adminUserId)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES (?, ?, ?, 'cashier', 1)`).run(cashierMemberId, businessId, cashierUserId)

    // Seed Member Branches
    sqlite.prepare(`INSERT INTO member_branches (id, member_id, branch_id) VALUES ('mb_01', ?, ?)`).run(cashierMemberId, branchId)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token

    const adminSession = await createSession(d1, adminUserId)
    adminToken = adminSession.token

    const cashierSession = await createSession(d1, cashierUserId)
    cashierToken = cashierSession.token
  })

  it('lists all staff members with assigned branches and user profiles', async () => {
    const req = new Request('https://api.pos.local/api/v1/staff', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const staff = json.data as any[]
    expect(staff.length).toBe(3)
    const cashier = staff.find(s => s.id === cashierMemberId)
    expect(cashier).toBeDefined()
    expect(cashier.name).toBe('Fatima Noor')
    expect(cashier.role).toBe('cashier')
    expect(cashier.assignedBranches.length).toBe(1)
    expect(cashier.assignedBranches[0].branchCode).toBe('BRMAIN')
  })

  it('generates secure invitation token with SHA-256 hash storage', async () => {
    const req = new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        email: 'new.manager@team.com',
        role: 'manager',
        branchIds: [branchId],
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)

    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const invitation = json.data
    expect(invitation.email).toBe('new.manager@team.com')
    expect(invitation.role).toBe('manager')
    expect(invitation.invitationToken).toBeDefined()
    expect(invitation.invitationLink).toContain('invitation=')

    // Verify SHA-256 hash stored in D1
    const stored = sqlite.prepare(`SELECT * FROM staff_invitations WHERE id = ?`).get(invitation.id) as any
    expect(stored).toBeDefined()
    expect(stored.token_hash).toBeDefined()
    expect(stored.token_hash).not.toBe(invitation.invitationToken) // Hashed, not plain text
  })

  it('enforces RBAC: admin cannot invite someone as an owner', async () => {
    const req = new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        email: 'another.owner@team.com',
        role: 'owner',
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
  })

  it('rejects cashier from managing staff or invitations', async () => {
    const req = new Request('https://api.pos.local/api/v1/staff', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cashierToken}`,
        'X-Business-Id': businessId,
      },
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
  })

  it('prevents demoting the last active owner of the business', async () => {
    const req = new Request(`https://api.pos.local/api/v1/staff/${ownerMemberId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        role: 'cashier',
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const err = (await res.json()) as any
    expect(err.error.message).toContain('Cannot demote the only remaining active owner')
  })

  it('prevents an account from suspending itself', async () => {
    const req = new Request(`https://api.pos.local/api/v1/staff/${ownerMemberId}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const err = (await res.json()) as any
    expect(err.error.message).toContain('cannot suspend your own account')
  })

  it('suspends and reactivates a staff member with audit logging', async () => {
    // 1. Suspend cashier
    const suspReq = new Request(`https://api.pos.local/api/v1/staff/${cashierMemberId}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })
    const suspRes = await worker.fetch(suspReq, env, executionCtx)
    expect(suspRes.status).toBe(200)
    const suspJson = (await suspRes.json()) as any
    expect(suspJson.success).toBe(true)
    expect(suspJson.data.isActive).toBe(false)

    // 2. Reactivate cashier
    const reactReq = new Request(`https://api.pos.local/api/v1/staff/${cashierMemberId}/reactivate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })
    const reactRes = await worker.fetch(reactReq, env, executionCtx)
    expect(reactRes.status).toBe(200)
    const reactJson = (await reactRes.json()) as any
    expect(reactJson.success).toBe(true)
    expect(reactJson.data.isActive).toBe(true)

    // 3. Verify audit log was recorded
    const logs = sqlite.prepare(`SELECT * FROM audit_logs WHERE business_id = ? AND entity_id = ?`).all(businessId, cashierMemberId)
    expect(logs.length).toBeGreaterThanOrEqual(2)
  })

  it('updates branch assignments for a staff member', async () => {
    // Add second branch
    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES ('br_second', ?, 'BRSEC', 'Second Branch', 0, 'active')
    `).run(businessId)

    const updateReq = new Request(`https://api.pos.local/api/v1/staff/${cashierMemberId}/branches`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        branchIds: [branchId, 'br_second'],
      }),
    })

    const res = await worker.fetch(updateReq, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const updated = json.data
    expect(updated.assignedBranches.length).toBe(2)
  })

  it('lists pending invitations and revokes an invitation', async () => {
    // 1. Create invitation
    await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ email: 'to.revoke@team.com', role: 'cashier' }),
    }), env, executionCtx)

    // 2. List
    const listRes = await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    }), env, executionCtx)
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as any
    expect(listJson.success).toBe(true)
    const list = listJson.data as any[]
    expect(list.length).toBe(1)
    const inviteId = list[0].id

    // 3. Revoke
    const revokeRes = await worker.fetch(new Request(`https://api.pos.local/api/v1/staff/invitations/${inviteId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    }), env, executionCtx)
    expect(revokeRes.status).toBe(200)

    // 4. Verify no longer pending
    const listAfterRes = await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    }), env, executionCtx)
    const listAfterJson = (await listAfterRes.json()) as any
    const listAfter = listAfterJson.data as any[]
    expect(listAfter.length).toBe(0)
  })

  it('retrieves staff permissions and branch assignments endpoints', async () => {
    // 1. Permissions
    const permRes = await worker.fetch(new Request(`https://api.pos.local/api/v1/staff/${cashierMemberId}/permissions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    }), env, executionCtx)

    expect(permRes.status).toBe(200)
    const permJson = (await permRes.json()) as any
    expect(permJson.data.role).toBe('cashier')
    expect(permJson.data.permissions).toContain('pos_sale')
    expect(permJson.data.permissions).not.toContain('manage_staff')

    // 2. Branches
    const branchRes = await worker.fetch(new Request(`https://api.pos.local/api/v1/staff/${cashierMemberId}/branches`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    }), env, executionCtx)

    expect(branchRes.status).toBe(200)
    const branchJson = (await branchRes.json()) as any
    expect(Array.isArray(branchJson.data)).toBe(true)
  })

  it('handles invitation acceptance flow with email validation', async () => {
    // 1. Create invitation for new user email
    const newStaffEmail = 'new.recruit@team.com'
    const invRes = await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ email: newStaffEmail, role: 'cashier', branchIds: [branchId] }),
    }), env, executionCtx)

    const invJson = (await invRes.json()) as any
    const token = invJson.data.invitationToken

    // 2. Create the new user account and session
    const recruitUserId = 'usr_recruit_99'
    sqlite.prepare(`
      INSERT INTO users (id, email, name, status)
      VALUES (?, ?, 'New Recruit', 'active')
    `).run(recruitUserId, newStaffEmail)

    const recruitSession = await createSession(d1, recruitUserId)

    // 3. Attempt accept with wrong user (owner trying to accept recruit's invite -> 403)
    const wrongAcceptRes = await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ token }),
    }), env, executionCtx)
    expect(wrongAcceptRes.status).toBe(403)

    // 4. Correct user accepts invitation
    const acceptRes = await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recruitSession.token}` },
      body: JSON.stringify({ token }),
    }), env, executionCtx)

    expect(acceptRes.status).toBe(200)
    const acceptJson = (await acceptRes.json()) as any
    expect(acceptJson.data.businessId).toBe(businessId)
    expect(acceptJson.data.role).toBe('cashier')

    // Verify member exists in business_members
    const memberRow = sqlite.prepare(`SELECT * FROM business_members WHERE business_id = ? AND user_id = ?`).get(businessId, recruitUserId) as any
    expect(memberRow).toBeDefined()
    expect(memberRow.role).toBe('cashier')
    expect(memberRow.is_active).toBe(1)
  })
})

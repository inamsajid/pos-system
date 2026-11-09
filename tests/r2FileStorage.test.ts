import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'

class MockR2Bucket {
  private store = new Map<string, { body: Uint8Array; httpMetadata?: Record<string, string>; customMetadata?: Record<string, string>; etag: string }>()

  async put(key: string, value: any, options?: any): Promise<R2Object> {
    let bytes: Uint8Array
    if (value instanceof Uint8Array) {
      bytes = value
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value)
    } else if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value)
    } else {
      bytes = new Uint8Array(0)
    }
    const etag = `etag_${Math.random().toString(36).slice(2)}`
    this.store.set(key, {
      body: bytes,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      etag,
    })
    return {
      key,
      version: '1',
      size: bytes.byteLength,
      etag,
      httpEtag: `"${etag}"`,
      uploaded: new Date(),
      httpMetadata: options?.httpMetadata || {},
      customMetadata: options?.customMetadata || {},
    } as unknown as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.store.get(key)
    if (!item) return null
    return {
      key,
      version: '1',
      size: item.body.byteLength,
      etag: item.etag,
      httpEtag: `"${item.etag}"`,
      uploaded: new Date(),
      httpMetadata: item.httpMetadata || {},
      customMetadata: item.customMetadata || {},
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(item.body)
          controller.close()
        },
      }),
      arrayBuffer: async () => item.body.buffer,
      text: async () => new TextDecoder().decode(item.body),
    } as unknown as R2ObjectBody
  }

  async delete(keys: string | string[]): Promise<void> {
    const arr = Array.isArray(keys) ? keys : [keys]
    for (const k of arr) {
      this.store.delete(k)
    }
  }

  async head(key: string): Promise<R2Object | null> {
    const item = this.store.get(key)
    if (!item) return null
    return {
      key,
      size: item.body.byteLength,
      etag: item.etag,
    } as unknown as R2Object
  }
}

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
            async raw() {
              const stmt = sqlite.prepare(query)
              return stmt.all(...args) as unknown[]
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

describe('Cloudflare R2 Private File Storage (Step 12.6)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let mockR2: MockR2Bucket
  let env: Env

  const bizA = 'biz_file_a'
  const bizB = 'biz_file_b'
  const branchA = 'branch_file_a'
  const ownerUserId = 'usr_file_owner'
  const userBId = 'usr_file_b'
  let ownerToken: string
  let userBToken: string

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      sqlite.exec(sql)
    }

    d1 = createRealD1(sqlite)
    mockR2 = new MockR2Bucket()

    env = {
      DB: d1,
      FILES: mockR2 as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }

    // Seed Businesses
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZFA', 'File Store A', 'active'),
             (?, 'BIZFB', 'File Store B', 'active')
    `).run(bizA, bizB)

    // Seed Branch
    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store', 1, 'active')
    `).run(branchA, bizA)

    // Seed Users
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'owner@fa.pk', 'hash', 'Store A Owner', 'active'),
             (?, 'owner@fb.pk', 'hash', 'Store B Owner', 'active')
    `).run(ownerUserId, userBId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_fa', ?, ?, 'owner', 1),
             ('bm_fb', ?, ?, 'owner', 1)
    `).run(bizA, ownerUserId, bizB, userBId)

    const sessA = await createSession(d1, ownerUserId)
    ownerToken = sessA.token

    const sessB = await createSession(d1, userBId)
    userBToken = sessB.token

    // Seed Category & Product in Business A
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, status)
      VALUES ('cat_files', ?, 'File Cat', 'file-cat', 'active')
    `).run(bizA)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, status)
      VALUES ('prod_files', ?, 'cat_files', 'SKU-FILE', 'Target Product', 'piece', 100, 200, 'active')
    `).run(bizA)
  })

  it('uploads a valid PNG image and verifies R2 write and D1 metadata', async () => {
    // Valid PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    const pngBlob = new Blob([pngBytes], { type: 'image/png' })

    const form = new FormData()
    form.append('file', pngBlob, 'product-photo.png')
    form.append('category', 'product_image')
    form.append('relatedType', 'product')
    form.append('relatedId', 'prod_files')

    const req = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
      body: form,
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: any }
    const file = json.data

    expect(file.id).toMatch(/^file_/)
    expect(file.businessId).toBe(bizA)
    expect(file.category).toBe('product_image')
    expect(file.originalFilename).toBe('product-photo.png')
    expect(file.sanitizedFilename).toBe('product-photo.png')
    expect(file.contentType).toBe('image/png')
    expect(file.status).toBe('available')
    expect(file.objectKey).toContain(`businesses/${bizA}/product_image/`)
    expect(file.downloadUrl).toBe(`/api/v1/files/${file.id}/content`)

    // Verify written to mock R2
    const inBucket = await mockR2.get(file.objectKey)
    expect(inBucket).not.toBeNull()
  })

  it('uploads a valid PDF document with attachment headers', async () => {
    // Valid PDF signature: %PDF-
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' })

    const form = new FormData()
    form.append('file', pdfBlob, 'invoice-scan.pdf')
    form.append('category', 'invoice_pdf')

    const req = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
      body: form,
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: any }
    expect(json.data.contentType).toBe('application/pdf')
  })

  it('rejects files with invalid magic bytes or disallowed content types', async () => {
    // Declared image/png but body is plain text
    const fakeBytes = new TextEncoder().encode('Not a real png')
    const fakeBlob = new Blob([fakeBytes], { type: 'image/png' })

    const form1 = new FormData()
    form1.append('file', fakeBlob, 'fake.png')
    form1.append('category', 'product_image')

    const req1 = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
      body: form1,
    })
    const res1 = await worker.fetch(req1, env, executionCtx)
    expect(res1.status).toBe(400)
    const body1 = (await res1.json()) as { error: { message: string } }
    expect(body1.error.message).toMatch(/PNG image signature/i)

    // Forbidden executable format (.exe / MZ)
    const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00])
    const exeBlob = new Blob([exeBytes], { type: 'application/pdf' })
    const form2 = new FormData()
    form2.append('file', exeBlob, 'virus.pdf')
    form2.append('category', 'purchase_document')

    const req2 = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
      body: form2,
    })
    const res2 = await worker.fetch(req2, env, executionCtx)
    expect(res2.status).toBe(400)
    const body2 = (await res2.json()) as { error: { message: string } }
    expect(body2.error.message).toMatch(/Executable files/i)
  })

  it('prevents path traversal and sanitizes filenames', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const blob = new Blob([pngBytes], { type: 'image/png' })

    const form = new FormData()
    form.append('file', blob, '../../../etc/passwd.png')
    form.append('category', 'product_image')

    const req = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
      body: form,
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: any }
    expect(json.data.sanitizedFilename).toBe('passwd.png')
    expect(json.data.objectKey).not.toContain('..')
  })

  it('validates related entity ownership: rejects attaching file to non-existent entity', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const blob = new Blob([pngBytes], { type: 'image/png' })

    const form = new FormData()
    form.append('file', blob, 'photo.png')
    form.append('category', 'product_image')
    form.append('relatedType', 'product')
    form.append('relatedId', 'non_existent_prod')

    const req = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
      body: form,
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/does not exist in business/i)
  })

  it('streams file content with security headers and enforces tenant isolation', async () => {
    // 1. Upload file to Business A
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const blob = new Blob([pngBytes], { type: 'image/png' })
    const form = new FormData()
    form.append('file', blob, 'logo.png')
    form.append('category', 'business_logo')

    const upReq = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
      body: form,
    })
    const upRes = await worker.fetch(upReq, env, executionCtx)
    const upJson = (await upRes.json()) as { data: any }
    const fileId = upJson.data.id

    // 2. Stream content as Business A owner
    const getReq = new Request(`http://localhost/api/v1/files/${fileId}/content`, {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
    })
    const getRes = await worker.fetch(getReq, env, executionCtx)
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get('Content-Type')).toBe('image/png')
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(getRes.headers.get('Content-Disposition')).toBe('inline; filename="logo.png"')
    expect(getRes.headers.get('Cache-Control')).toMatch(/private/i)

    // 3. User from Business B attempts to download Business A file -> 404 Not Found
    const crossReq = new Request(`http://localhost/api/v1/files/${fileId}/content`, {
      headers: { Cookie: `__session=${userBToken}`, 'X-Business-Id': bizB },
    })
    const crossRes = await worker.fetch(crossReq, env, executionCtx)
    expect(crossRes.status).toBe(404)
  })

  it('safely deletes file from R2 and D1 with idempotent repeat delete', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const blob = new Blob([pngBytes], { type: 'image/png' })
    const form = new FormData()
    form.append('file', blob, 'to-delete.png')
    form.append('category', 'product_image')

    const upReq = new Request('http://localhost/api/v1/files', {
      method: 'POST',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
      body: form,
    })
    const upRes = await worker.fetch(upReq, env, executionCtx)
    const upJson = (await upRes.json()) as { data: any }
    const fileId = upJson.data.id
    const objectKey = upJson.data.objectKey

    // Delete file
    const delReq = new Request(`http://localhost/api/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
    })
    const delRes = await worker.fetch(delReq, env, executionCtx)
    expect(delRes.status).toBe(200)

    // Verify object removed from R2
    const inBucket = await mockR2.get(objectKey)
    expect(inBucket).toBeNull()

    // Repeat delete must succeed idempotently
    const repeatReq = new Request(`http://localhost/api/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
    })
    const repeatRes = await worker.fetch(repeatReq, env, executionCtx)
    expect(repeatRes.status).toBe(200)
  })
})


import { describe, it, expect } from 'vitest'

/**
 * In-memory test emulator implementing Cloudflare R2Bucket contract.
 * Validates local put, get, delete, and missing object operations.
 */
class LocalR2BucketMock {
  private storage = new Map<string, { body: ArrayBuffer; customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> }>()

  async put(
    key: string,
    value: ArrayBuffer | string | ReadableStream,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> }
  ): Promise<{ key: string; size: number }> {
    let buffer: ArrayBuffer
    if (typeof value === 'string') {
      buffer = new TextEncoder().encode(value).buffer as ArrayBuffer
    } else if (value instanceof ArrayBuffer) {
      buffer = value
    } else {
      buffer = new ArrayBuffer(0)
    }

    this.storage.set(key, {
      body: buffer,
      customMetadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
    })

    return {
      key,
      size: buffer.byteLength,
    }
  }

  async get(key: string): Promise<{ key: string; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> } | null> {
    const item = this.storage.get(key)
    if (!item) return null

    return {
      key,
      text: async () => new TextDecoder().decode(item.body),
      arrayBuffer: async () => item.body,
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyList = Array.isArray(keys) ? keys : [keys]
    for (const key of keyList) {
      this.storage.delete(key)
    }
  }
}

describe('R2 Storage — Local Bucket Binding Contract', () => {
  it('puts, gets, and deletes an object in local storage', async () => {
    const r2 = new LocalR2BucketMock()
    const testKey = 'businesses/biz-1/branding/logo.txt'
    const testPayload = 'test-logo-binary-content'

    // Put
    const putResult = await r2.put(testKey, testPayload, {
      customMetadata: { businessId: 'biz-1' },
      httpMetadata: { contentType: 'text/plain' },
    })
    expect(putResult.key).toBe(testKey)
    expect(putResult.size).toBe(testPayload.length)

    // Get
    const getResult = await r2.get(testKey)
    expect(getResult).not.toBeNull()
    expect(await getResult?.text()).toBe(testPayload)

    // Delete
    await r2.delete(testKey)
    const afterDelete = await r2.get(testKey)
    expect(afterDelete).toBeNull()
  })

  it('returns null when querying non-existent objects', async () => {
    const r2 = new LocalR2BucketMock()
    const missing = await r2.get('businesses/biz-1/missing.png')
    expect(missing).toBeNull()
  })
})


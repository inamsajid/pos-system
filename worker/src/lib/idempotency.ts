import { HttpError } from './errors'

export interface CachedIdempotentResponse {
  isCached: true
  status: number
  body: unknown
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
  return `{${entries.join(',')}}`
}

export async function computeCanonicalRequestHash(body: unknown): Promise<string> {
  const canonicalJson = canonicalStringify(body ?? {})
  const encoder = new TextEncoder()
  const data = encoder.encode(canonicalJson)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checkIdempotency(
  db: D1Database,
  businessId: string,
  operation: string,
  idempotencyKey: string,
  requestHash: string
): Promise<CachedIdempotentResponse | null> {
  const sql = `
    SELECT response_status, response_body_json, request_hash
    FROM idempotency_keys
    WHERE business_id = ? AND operation = ? AND idempotency_key = ?
    LIMIT 1
  `
  const row = await db
    .prepare(sql)
    .bind(businessId, operation, idempotencyKey)
    .first<{ response_status: number; response_body_json: string; request_hash: string }>()

  if (!row) {
    return null
  }

  if (row.request_hash !== requestHash) {
    throw new HttpError(
      409,
      'CONFLICT',
      'This idempotency key has already been used with a different request payload.'
    )
  }

  try {
    const body = JSON.parse(row.response_body_json)
    return {
      isCached: true,
      status: row.response_status,
      body,
    }
  } catch {
    return {
      isCached: true,
      status: row.response_status,
      body: row.response_body_json,
    }
  }
}

export function buildIdempotencyInsertStatement(
  db: D1Database,
  businessId: string,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
  status: number,
  body: unknown
): D1PreparedStatement {
  const id = `idemp_${crypto.randomUUID()}`
  const bodyJson = JSON.stringify(body)
  const sql = `
    INSERT INTO idempotency_keys (
      id,
      business_id,
      operation,
      idempotency_key,
      request_hash,
      response_status,
      response_body_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `
  return db.prepare(sql).bind(id, businessId, operation, idempotencyKey, requestHash, status, bodyJson)
}

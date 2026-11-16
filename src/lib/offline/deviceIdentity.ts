import type { Dexie } from 'dexie'
import type { DeviceMetadataRecord } from './database.types'
import { CURRENT_OFFLINE_SCHEMA_VERSION } from './database.schema'

let cachedDeviceId: string | null = null

/**
 * Returns the stable synthetic device installation identifier.
 * Initializes and persists a random UUID in Dexie if not already present.
 */
export async function getOrCreateDeviceId(db: Dexie): Promise<string> {
  if (cachedDeviceId) {
    return cachedDeviceId
  }

  const table = db.table<DeviceMetadataRecord, string>('deviceMetadata')

  try {
    const existing = await table.get('singleton')
    if (existing && existing.deviceId) {
      cachedDeviceId = existing.deviceId
      return existing.deviceId
    }

    const newId = `dev_${crypto.randomUUID()}`
    const record: DeviceMetadataRecord = {
      id: 'singleton',
      deviceId: newId,
      schemaVersion: CURRENT_OFFLINE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      lastHealthCheckAt: new Date().toISOString(),
      appVersion: '1.0.0',
      platform: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'node',
    }

    await table.put(record)
    cachedDeviceId = newId
    return newId
  } catch {
    // Fallback in case of storage failure or SSR
    const fallbackId = `dev_ephemeral_${crypto.randomUUID()}`
    cachedDeviceId = fallbackId
    return fallbackId
  }
}

/**
 * Resets in-memory device cache (primarily for isolated test fixtures).
 */
export function resetInMemoryDeviceIdentity(): void {
  cachedDeviceId = null
}


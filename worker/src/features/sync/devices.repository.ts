import type { DeviceRow, RegisterDeviceInput } from './sync.types'

export class DevicesRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async registerDevice(
    id: string,
    businessId: string,
    userId: string,
    input: RegisterDeviceInput
  ): Promise<DeviceRow> {
    const label = input.label?.trim() || null

    // Check if record exists
    const existing = await this.db
      .prepare(
        `SELECT * FROM devices WHERE business_id = ? AND user_id = ? AND installation_id = ?`
      )
      .bind(businessId, userId, input.installationId)
      .first<DeviceRow>()

    if (existing) {
      // If device was revoked, keep revoked unless re-activated by an explicit registration
      const newStatus = 'active'
      const updated = await this.db
        .prepare(
          `UPDATE devices
           SET label = COALESCE(?, label), status = ?, last_seen_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?
           RETURNING *`
        )
        .bind(label, newStatus, existing.id)
        .first<DeviceRow>()

      if (!updated) {
        throw new Error('Failed to update device registration.')
      }
      return updated
    }

    const inserted = await this.db
      .prepare(
        `INSERT INTO devices (
           id, installation_id, business_id, user_id, label, status, registered_at, last_seen_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
         RETURNING *`
      )
      .bind(id, input.installationId, businessId, userId, label)
      .first<DeviceRow>()

    if (!inserted) {
      throw new Error('Failed to insert device registration.')
    }
    return inserted
  }

  async getDeviceByInstallation(
    businessId: string,
    installationId: string
  ): Promise<DeviceRow | null> {
    return this.db
      .prepare(
        `SELECT * FROM devices WHERE business_id = ? AND installation_id = ? ORDER BY updated_at DESC LIMIT 1`
      )
      .bind(businessId, installationId)
      .first<DeviceRow>()
  }

  async getDeviceById(businessId: string, id: string): Promise<DeviceRow | null> {
    return this.db
      .prepare(`SELECT * FROM devices WHERE business_id = ? AND id = ?`)
      .bind(businessId, id)
      .first<DeviceRow>()
  }

  async listDevices(businessId: string, userId?: string): Promise<DeviceRow[]> {
    if (userId) {
      const result = await this.db
        .prepare(
          `SELECT * FROM devices WHERE business_id = ? AND user_id = ? ORDER BY last_seen_at DESC`
        )
        .bind(businessId, userId)
        .all<DeviceRow>()
      return result.results || []
    }

    const result = await this.db
      .prepare(`SELECT * FROM devices WHERE business_id = ? ORDER BY last_seen_at DESC`)
      .bind(businessId)
      .all<DeviceRow>()
    return result.results || []
  }

  async revokeDevice(businessId: string, id: string): Promise<DeviceRow | null> {
    return this.db
      .prepare(
        `UPDATE devices
         SET status = 'revoked', updated_at = datetime('now')
         WHERE business_id = ? AND id = ?
         RETURNING *`
      )
      .bind(businessId, id)
      .first<DeviceRow>()
  }

  async recordHeartbeat(businessId: string, installationId: string): Promise<DeviceRow | null> {
    return this.db
      .prepare(
        `UPDATE devices
         SET last_seen_at = datetime('now'), updated_at = datetime('now')
         WHERE business_id = ? AND installation_id = ?
         RETURNING *`
      )
      .bind(businessId, installationId)
      .first<DeviceRow>()
  }

  async updateSyncTimestamp(businessId: string, installationId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE devices
         SET last_sync_at = datetime('now'), last_seen_at = datetime('now'), updated_at = datetime('now')
         WHERE business_id = ? AND installation_id = ?`
      )
      .bind(businessId, installationId)
      .run()
  }
}

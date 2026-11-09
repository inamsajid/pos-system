import { HttpError } from '../../lib/errors'
import { DevicesRepository } from './devices.repository'
import { ChangeLogRepository } from './changeLog.repository'
import type {
  DeviceDTO,
  DeviceRow,
  RegisterDeviceInput,
  PullChangesResult,
  SyncChangeDTO,
} from './sync.types'

function mapDeviceToDTO(row: DeviceRow): DeviceDTO {
  return {
    id: row.id,
    installationId: row.installation_id,
    businessId: row.business_id,
    userId: row.user_id,
    label: row.label,
    status: row.status,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SyncService {
  private readonly devicesRepo: DevicesRepository
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.devicesRepo = new DevicesRepository(db)
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  async registerDevice(
    businessId: string,
    userId: string,
    input: RegisterDeviceInput
  ): Promise<DeviceDTO> {
    if (!input.installationId || typeof input.installationId !== 'string' || !input.installationId.trim()) {
      throw HttpError.badRequest('installationId is required.')
    }

    const deviceId = `dev_reg_${crypto.randomUUID()}`
    const row = await this.devicesRepo.registerDevice(deviceId, businessId, userId, input)
    return mapDeviceToDTO(row)
  }

  async listDevices(
    businessId: string,
    userId: string,
    userRole: string
  ): Promise<DeviceDTO[]> {
    const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin'
    // Owners/admins view all devices; staff view devices registered by themselves
    const rows = await this.devicesRepo.listDevices(businessId, isOwnerOrAdmin ? undefined : userId)
    return rows.map(mapDeviceToDTO)
  }

  async heartbeat(
    businessId: string,
    installationId: string
  ): Promise<{ success: boolean; status: 'active' | 'revoked' }> {
    if (!installationId) {
      throw HttpError.badRequest('installationId is required.')
    }

    const device = await this.devicesRepo.getDeviceByInstallation(businessId, installationId)
    if (!device) {
      throw HttpError.notFound('Device is not registered in this business.')
    }

    await this.devicesRepo.recordHeartbeat(businessId, installationId)
    return {
      success: true,
      status: device.status,
    }
  }

  async revokeDevice(
    businessId: string,
    userId: string,
    userRole: string,
    deviceId: string
  ): Promise<DeviceDTO> {
    const device = await this.devicesRepo.getDeviceById(businessId, deviceId)
    if (!device) {
      throw HttpError.notFound('Device registration not found.')
    }

    const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin'
    if (!isOwnerOrAdmin && device.user_id !== userId) {
      throw HttpError.forbidden('You do not have permission to revoke this device.')
    }

    const updated = await this.devicesRepo.revokeDevice(businessId, deviceId)
    if (!updated) {
      throw HttpError.internal('Failed to revoke device.')
    }

    return mapDeviceToDTO(updated)
  }

  async pullChanges(params: {
    businessId: string
    userId: string
    installationId: string
    cursor?: string | null
    limit?: number
    branchId?: string | null
    authorizedBranchIds?: string[]
  }): Promise<PullChangesResult> {
    const {
      businessId,
      installationId,
      cursor,
      limit = 50,
      branchId = null,
      authorizedBranchIds = [],
    } = params

    if (!installationId) {
      throw HttpError.unauthorized('Device installation ID is required (X-Device-Id).')
    }

    // Validate device registration
    const device = await this.devicesRepo.getDeviceByInstallation(businessId, installationId)
    if (!device) {
      throw HttpError.forbidden('Device is not registered in this business.')
    }
    if (device.status === 'revoked') {
      throw HttpError.forbidden('Device access has been revoked.')
    }

    // Validate branch authorization if branch-specific stock is requested
    if (branchId) {
      if (!authorizedBranchIds.includes(branchId)) {
        throw HttpError.forbidden('You are not authorized to access stock changes for this branch.')
      }
    }

    // Parse cursor (e.g. "seq_10" or "10" or empty)
    let afterSeq = 0
    if (cursor && cursor.trim()) {
      const trimmed = cursor.trim()
      const raw = trimmed.startsWith('seq_') ? trimmed.substring(4) : trimmed
      const parsed = parseInt(raw, 10)
      if (isNaN(parsed) || parsed < 0) {
        throw HttpError.badRequest('Invalid sync cursor format.')
      }
      afterSeq = parsed
    }

    const currentMaxSeq = await this.changeLogRepo.getMaxSequence(businessId)
    if (afterSeq > currentMaxSeq) {
      throw HttpError.badRequest('Invalid cursor: sequence exceeds current server history.')
    }

    const { changes, maxSeq, hasMore } = await this.changeLogRepo.getChanges({
      businessId,
      afterSeq,
      limit,
      branchId,
    })

    const changeDtos: SyncChangeDTO[] = changes.map((row) => {
      let parsedPayload: Record<string, unknown> = {}
      try {
        parsedPayload = JSON.parse(row.payload)
      } catch {
        parsedPayload = {}
      }

      return {
        seq: row.id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        resourceVersion: row.resource_version,
        operation: row.operation,
        branchId: row.branch_id,
        data: parsedPayload,
        createdAt: row.created_at,
      }
    })

    // Record last seen for the device
    await this.devicesRepo.recordHeartbeat(businessId, installationId)

    return {
      changes: changeDtos,
      nextCursor: `seq_${maxSeq}`,
      hasMore,
      serverTime: new Date().toISOString(),
    }
  }

  async ackChanges(
    businessId: string,
    installationId: string,
    cursor: string
  ): Promise<{ success: boolean; acknowledgedCursor: string }> {
    if (!installationId) {
      throw HttpError.unauthorized('Device installation ID is required.')
    }

    const device = await this.devicesRepo.getDeviceByInstallation(businessId, installationId)
    if (!device) {
      throw HttpError.forbidden('Device is not registered.')
    }
    if (device.status === 'revoked') {
      throw HttpError.forbidden('Device access has been revoked.')
    }

    await this.devicesRepo.updateSyncTimestamp(businessId, installationId)

    return {
      success: true,
      acknowledgedCursor: cursor,
    }
  }
}

import { offlineDb, NorthstarOfflineDatabase } from '../database'
import type {
  ProvisionalOfflineSaleRecord,
  LocalOfflineAuthorizationRecord,
  LocalDeviceAllocationRecord,
} from '../database.types'

export class OfflineSalesRepository {
  private readonly db: NorthstarOfflineDatabase

  constructor(db: NorthstarOfflineDatabase = offlineDb) {
    this.db = db
  }

  /**
   * Stores an offline authorization package and its product allocations locally.
   */
  async saveAuthorizationPackage(
    auth: LocalOfflineAuthorizationRecord,
    allocations: LocalDeviceAllocationRecord[]
  ): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.offlineAuthorizations, this.db.offlineAllocations],
      async () => {
        await this.db.offlineAuthorizations.put(auth)
        for (const alloc of allocations) {
          await this.db.offlineAllocations.put(alloc)
        }
      }
    )
  }

  /**
   * Retrieves an active offline authorization package for the terminal session.
   */
  async getActiveAuthorization(
    userId: string,
    businessId: string,
    branchId: string,
    deviceId: string
  ): Promise<LocalOfflineAuthorizationRecord | null> {
    const now = new Date().toISOString()
    const candidates = await this.db.offlineAuthorizations
      .where('[userId+businessId+deviceId]')
      .equals([userId, businessId, deviceId])
      .toArray()

    const valid = candidates.find(
      (a) => a.branchId === branchId && a.status === 'active' && a.expiresAt > now
    )

    return valid || null
  }

  /**
   * Retrieves active device allocations for an authorization.
   */
  async getAllocationsForAuth(authorizationId: string): Promise<LocalDeviceAllocationRecord[]> {
    return this.db.offlineAllocations
      .filter((a) => a.authorizationId === authorizationId && a.status === 'active')
      .toArray()
  }

  /**
   * Retrieves active allocation for a specific product and device.
   */
  async getAllocationForProduct(
    businessId: string,
    branchId: string,
    deviceId: string,
    productId: string
  ): Promise<LocalDeviceAllocationRecord | null> {
    const list = await this.db.offlineAllocations
      .where('[businessId+branchId+deviceId]')
      .equals([businessId, branchId, deviceId])
      .toArray()

    const found = list.find((a) => a.productId === productId && a.status === 'active')
    return found || null
  }

  /**
   * Saves a provisional offline sale.
   */
  async saveProvisionalSale(sale: ProvisionalOfflineSaleRecord): Promise<void> {
    await this.db.offlineSales.put(sale)
  }

  /**
   * Retrieves a provisional offline sale by ID.
   */
  async findSaleById(id: string): Promise<ProvisionalOfflineSaleRecord | null> {
    const record = await this.db.offlineSales.get(id)
    return record || null
  }

  /**
   * Lists provisional sales for a user and business scope.
   */
  async listSalesByTenant(
    userId: string,
    businessId: string,
    branchId?: string
  ): Promise<ProvisionalOfflineSaleRecord[]> {
    let collection = this.db.offlineSales
      .where('[userId+businessId+status]')
      .anyOf([
        [userId, businessId, 'provisional'],
        [userId, businessId, 'synchronized'],
        [userId, businessId, 'rejected'],
        [userId, businessId, 'conflict'],
        [userId, businessId, 'reconciliation_required'],
      ])

    let records = await collection.toArray()
    if (branchId) {
      records = records.filter((s) => s.branchId === branchId)
    }
    return records
  }

  /**
   * Updates provisional sale to synchronized once accepted by central server.
   */
  async acknowledgeSale(
    id: string,
    serverSaleId: string,
    officialInvoiceNumber: string
  ): Promise<void> {
    const nowIso = new Date().toISOString()
    await this.db.offlineSales.update(id, {
      status: 'synchronized',
      serverSaleId,
      officialInvoiceNumber,
      acknowledgedAt: nowIso,
    })
  }

  /**
   * Updates provisional sale status (e.g. conflict, reconciliation_required, rejected).
   */
  async markSaleStatus(
    id: string,
    status: ProvisionalOfflineSaleRecord['status'],
    rejectionReason?: string
  ): Promise<void> {
    await this.db.offlineSales.update(id, {
      status,
      rejectionReason: rejectionReason || null,
    })
  }
}

export const offlineSalesRepository = new OfflineSalesRepository()


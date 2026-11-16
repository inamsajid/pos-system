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
   * Matches canonical server deviceId OR browser installationId.
   */
  async getActiveAuthorization(
    userId: string,
    businessId: string,
    branchId: string,
    deviceId: string
  ): Promise<LocalOfflineAuthorizationRecord | null> {
    const now = new Date().toISOString()
    const directCandidates = await this.db.offlineAuthorizations
      .where('[userId+businessId+deviceId]')
      .equals([userId, businessId, deviceId])
      .toArray()

    const directMatch = directCandidates.find(
      (a) => a.branchId === branchId && a.status === 'active' && a.expiresAt > now
    )
    if (directMatch) return directMatch

    const fallbackCandidates = await this.db.offlineAuthorizations
      .filter(
        (a) =>
          a.userId === userId &&
          a.businessId === businessId &&
          a.branchId === branchId &&
          a.status === 'active' &&
          a.expiresAt > now &&
          (a.deviceId === deviceId || a.installationId === deviceId)
      )
      .toArray()

    fallbackCandidates.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    return fallbackCandidates[0] || null
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
    productId: string,
    options?: { userId?: string; authorizationId?: string }
  ): Promise<LocalDeviceAllocationRecord | null> {
    if (options?.authorizationId) {
      const authMatches = await this.db.offlineAllocations
        .filter(
          (a) =>
            a.authorizationId === options.authorizationId &&
            a.businessId === businessId &&
            a.branchId === branchId &&
            a.productId === productId &&
            a.status === 'active' &&
            (!options.userId || !a.userId || a.userId === options.userId)
        )
        .toArray()
      if (authMatches.length > 0) return authMatches[0]
    }

    const list = await this.db.offlineAllocations
      .where('[businessId+branchId+deviceId]')
      .equals([businessId, branchId, deviceId])
      .toArray()

    const found = list.find(
      (a) =>
        a.productId === productId &&
        a.status === 'active' &&
        (!options?.userId || !a.userId || a.userId === options.userId)
    )
    return found || null
  }

  /**
   * Returns count of unsynchronized provisional sales belonging to userId (optionally filtered by businessId).
   */
  async getPendingSalesCount(userId: string, businessId?: string): Promise<number> {
    const pendingStatuses = new Set(['provisional', 'conflict', 'reconciliation_required'])
    return this.db.offlineSales
      .filter(
        (s) =>
          s.userId === userId &&
          pendingStatuses.has(s.status) &&
          (!businessId || s.businessId === businessId)
      )
      .count()
  }

  /**
   * Atomically rolls back local allocation & authorization quota counters for a provisional sale
   * that was cancelled or definitively rejected prior to server acceptance.
   */
  async rollbackSaleQuota(
    provisionalSaleId: string,
    newStatus: ProvisionalOfflineSaleRecord['status'] = 'rejected',
    rejectionReason?: string
  ): Promise<void> {
    const nowIso = new Date().toISOString()
    await this.db.transaction(
      'rw',
      [this.db.offlineSales, this.db.offlineAllocations, this.db.offlineAuthorizations],
      async () => {
        const sale = await this.db.offlineSales.get(provisionalSaleId)
        if (!sale || sale.status === 'rejected' || sale.status === 'synchronized') {
          return
        }

        const lineItems = Array.isArray(sale.items) ? sale.items : []
        for (const item of lineItems) {
          if (!item.allocationId) continue
          const alloc = await this.db.offlineAllocations.get(item.allocationId)
          if (alloc && alloc.status === 'active') {
            alloc.consumedQuantity = Math.max(0, alloc.consumedQuantity - item.quantity)
            alloc.remainingQuantity = Math.min(
              alloc.allocatedQuantity,
              alloc.remainingQuantity + item.quantity
            )
            alloc.updatedAt = nowIso
            await this.db.offlineAllocations.put(alloc)
          }
        }

        if (sale.authorizationId) {
          const auth = await this.db.offlineAuthorizations.get(sale.authorizationId)
          if (auth) {
            auth.usedTransactions = Math.max(0, (auth.usedTransactions ?? 0) - 1)
            auth.usedTotalAmountMinor = Math.max(
              0,
              (auth.usedTotalAmountMinor ?? 0) - sale.totalAmountMinor
            )
            await this.db.offlineAuthorizations.put(auth)
          }
        }

        await this.db.offlineSales.update(provisionalSaleId, {
          status: newStatus,
          rejectionReason: rejectionReason ?? sale.rejectionReason ?? null,
        })
      }
    )
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


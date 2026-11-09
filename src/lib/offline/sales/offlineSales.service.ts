import { offlineDb, NorthstarOfflineDatabase } from '../database'
import { offlineSalesRepository, OfflineSalesRepository } from './offlineSales.repository'
import { outboxService, OutboxService } from '../outbox/outbox.service'
import { OutboxValidationError } from '../outbox/outbox.errors'
import { computePayloadHash } from '../outbox/outbox.service'
import type {
  RecordOfflineSaleInput,
  OfflineCheckoutResult,
  OfflineReceiptData,
} from './offlineSales.types'
import type {
  ProvisionalOfflineSaleRecord,
  LocalOfflineAuthorizationRecord,
  LocalDeviceAllocationRecord,
} from '../database.types'

export class OfflineSalesService {
  private readonly db: NorthstarOfflineDatabase
  private readonly repo: OfflineSalesRepository
  private readonly outbox: OutboxService

  constructor(
    db: NorthstarOfflineDatabase = offlineDb,
    repo: OfflineSalesRepository = offlineSalesRepository,
    outbox: OutboxService = outboxService
  ) {
    this.db = db
    this.repo = repo
    this.outbox = outbox
  }

  /**
   * Caches a server-issued offline authorization package and initial stock quotas.
   */
  async cacheAuthorizationPackage(authPackage: {
    authorizationId: string
    businessId: string
    branchId: string
    userId: string
    deviceId: string
    catalogVersion: number
    pricingVersion: number
    maxTransactions: number
    maxTotalAmountMinor: number
    allowDiscounts: boolean
    status: 'active' | 'revoked' | 'expired' | 'completed'
    issuedAt: string
    expiresAt: string
    allowedPaymentMethods: string[]
    signature: string
    productAllocations: Array<{
      allocationId: string
      productId: string
      sku: string
      name: string
      unit: string
      sellingPriceMinor: number
      allocatedQuantity: number
      consumedQuantity: number
      remainingQuantity: number
    }>
  }): Promise<void> {
    const nowIso = new Date().toISOString()

    const authRecord: LocalOfflineAuthorizationRecord = {
      id: authPackage.authorizationId,
      userId: authPackage.userId,
      businessId: authPackage.businessId,
      branchId: authPackage.branchId,
      deviceId: authPackage.deviceId,
      catalogVersion: authPackage.catalogVersion,
      pricingVersion: authPackage.pricingVersion,
      maxTransactions: authPackage.maxTransactions,
      maxTotalAmountMinor: authPackage.maxTotalAmountMinor,
      allowDiscounts: authPackage.allowDiscounts,
      status: authPackage.status,
      issuedAt: authPackage.issuedAt,
      expiresAt: authPackage.expiresAt,
      allowedPaymentMethods: authPackage.allowedPaymentMethods,
      signature: authPackage.signature,
      cachedAt: nowIso,
    }

    const allocationRecords: LocalDeviceAllocationRecord[] = authPackage.productAllocations.map(
      (p) => ({
        id: p.allocationId,
        authorizationId: authPackage.authorizationId,
        businessId: authPackage.businessId,
        branchId: authPackage.branchId,
        deviceId: authPackage.deviceId,
        productId: p.productId,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        sellingPriceMinor: p.sellingPriceMinor,
        allocatedQuantity: p.allocatedQuantity,
        consumedQuantity: p.consumedQuantity,
        remainingQuantity: p.remainingQuantity,
        status: 'active',
        allocatedAt: authPackage.issuedAt,
        updatedAt: nowIso,
      })
    )

    await this.repo.saveAuthorizationPackage(authRecord, allocationRecords)
  }

  /**
   * Performs local offline checkout: validates quota, creates provisional sale,
   * consumes local allocation, and enqueues command in durable outbox.
   */
  async recordOfflineSale(input: RecordOfflineSaleInput): Promise<OfflineCheckoutResult> {
    const { userId, businessId, branchId, deviceId, authorizationId, items, cashTenderedMinor } = input

    if (!items || items.length === 0) {
      throw new OutboxValidationError('Offline sale must contain at least one line item.')
    }

    // 1. Validate Active Offline Authorization
    const auth = await this.repo.getActiveAuthorization(userId, businessId, branchId, deviceId)
    if (!auth || auth.id !== authorizationId) {
      throw new OutboxValidationError(
        'Offline POS operation is not permitted: Missing or invalid offline authorization package.'
      )
    }

    const now = new Date()
    if (new Date(auth.expiresAt).getTime() <= now.getTime()) {
      throw new OutboxValidationError(
        `Offline authorization '${auth.id}' expired at ${auth.expiresAt}. Reconnection required.`
      )
    }

    // 2. Validate Items & Local Quotas
    let computedTotalMinor = 0
    const allocationsToUpdate: Array<{ alloc: LocalDeviceAllocationRecord; deductQty: number }> = []

    for (let i = 0; i < items.length; i++) {
      const line = items[i]
      if (line.quantity <= 0) {
        throw new OutboxValidationError(`Invalid quantity ${line.quantity} at line ${i + 1}.`)
      }

      const alloc = await this.repo.getAllocationForProduct(businessId, branchId, deviceId, line.productId)
      if (!alloc) {
        throw new OutboxValidationError(
          `Product '${line.name}' (${line.productId}) does not have an active offline stock allocation.`
        )
      }

      if (alloc.remainingQuantity < line.quantity) {
        throw new OutboxValidationError(
          `Offline allocation quota exceeded for '${line.name}'. Remaining quota: ${alloc.remainingQuantity}, Requested: ${line.quantity}.`
        )
      }

      const lineTotal = line.quantity * line.unitPriceMinor
      computedTotalMinor += lineTotal

      allocationsToUpdate.push({ alloc, deductQty: line.quantity })
    }

    // 3. Validate Cash Payment
    if (cashTenderedMinor < computedTotalMinor) {
      throw new OutboxValidationError(
        `Cash tendered (${cashTenderedMinor} paise) is less than total sale amount (${computedTotalMinor} paise).`
      )
    }
    const changeReturnedMinor = cashTenderedMinor - computedTotalMinor

    // 4. Generate Identifiers
    const provisionalSaleId = `prov_sale_${crypto.randomUUID()}`
    const deviceShort = deviceId.replace(/^dev_/, '').slice(0, 6).toUpperCase()
    const seq = now.getTime().toString(36).toUpperCase()
    const provisionalReceiptNumber = `OFF-${deviceShort}-${seq}`
    const idempotencyKey = input.idempotencyKey || `idem_off_${crypto.randomUUID()}`
    const businessDateKey = now.toISOString().split('T')[0]
    const nowIso = now.toISOString()

    // 5. Build Payload & Hash
    const commandPayload = {
      authorizationId: auth.id,
      deviceId,
      provisionalSaleId,
      provisionalReceiptNumber,
      items: items.map((line) => ({
        productId: line.productId,
        allocationId: line.allocationId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        subtotalMinor: line.quantity * line.unitPriceMinor,
        lineTotalMinor: line.quantity * line.unitPriceMinor,
      })),
      cashTenderedMinor,
      offlineCreatedAt: nowIso,
      terminalId: input.terminalId || 'OFFLINE-TERMINAL',
    }

    const payloadHash = await computePayloadHash(commandPayload)

    const provisionalSaleRecord: ProvisionalOfflineSaleRecord = {
      id: provisionalSaleId,
      outboxCommandId: '', // Populated on enqueue
      idempotencyKey,
      userId,
      businessId,
      branchId,
      deviceId,
      authorizationId: auth.id,
      provisionalReceiptNumber,
      items: items.map((i) => ({
        productId: i.productId,
        sku: i.sku,
        name: i.name,
        unit: i.unit,
        allocationId: i.allocationId,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        subtotalMinor: i.quantity * i.unitPriceMinor,
        lineTotalMinor: i.quantity * i.unitPriceMinor,
      })),
      totalAmountMinor: computedTotalMinor,
      cashTenderedMinor,
      changeReturnedMinor,
      status: 'provisional',
      createdAt: nowIso,
      businessDateKey,
      payloadHash,
    }

    // 6. Enqueue Command into Durable Outbox
    const command = await this.outbox.enqueue({
      userId,
      businessId,
      branchId,
      deviceId,
      commandType: 'create_offline_sale',
      idempotencyKey,
      payload: commandPayload,
    })

    provisionalSaleRecord.outboxCommandId = command.id

    // 7. Atomic Dexie Transaction: Store Provisional Sale & Consume Local Quota
    await this.db.transaction(
      'rw',
      [this.db.offlineSales, this.db.offlineAllocations],
      async () => {
        await this.db.offlineSales.put(provisionalSaleRecord)
        for (const { alloc, deductQty } of allocationsToUpdate) {
          const freshAlloc = await this.db.offlineAllocations.get(alloc.id)
          if (freshAlloc) {
            freshAlloc.consumedQuantity += deductQty
            freshAlloc.remainingQuantity = Math.max(0, freshAlloc.remainingQuantity - deductQty)
            freshAlloc.updatedAt = nowIso
            await this.db.offlineAllocations.put(freshAlloc)
          }
        }
      }
    )

    return {
      provisionalSaleId,
      provisionalReceiptNumber,
      outboxCommandId: command.id,
      idempotencyKey,
      totalAmountMinor: computedTotalMinor,
      cashTenderedMinor,
      changeReturnedMinor,
      itemsCount: items.length,
      status: 'provisional',
      createdAt: nowIso,
      warning: 'PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE',
    }
  }

  /**
   * Generates display receipt payload for provisional print/view.
   */
  formatProvisionalReceipt(sale: ProvisionalOfflineSaleRecord): OfflineReceiptData {
    return {
      provisionalReceiptNumber: sale.provisionalReceiptNumber,
      notice: 'PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE',
      createdAt: sale.createdAt,
      deviceId: sale.deviceId,
      items: sale.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        unitPriceMinor: i.unitPriceMinor,
        lineTotalMinor: i.lineTotalMinor,
      })),
      totalAmountMinor: sale.totalAmountMinor,
      cashTenderedMinor: sale.cashTenderedMinor,
      changeReturnedMinor: sale.changeReturnedMinor,
    }
  }
}

export const offlineSalesService = new OfflineSalesService()


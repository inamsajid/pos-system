import { offlineDb, NorthstarOfflineDatabase } from '../database'
import { offlineSalesRepository, OfflineSalesRepository } from './offlineSales.repository'
import { outboxService, OutboxService } from '../outbox/outbox.service'
import { OutboxValidationError } from '../outbox/outbox.errors'
import { computePayloadHash } from '../outbox/outbox.service'
import { apiClient } from '../../api-client'
import { SyncClient } from '../sync/sync.client'
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
    installationId?: string
    catalogVersion: number
    pricingVersion: number
    maxTransactions: number
    maxTotalAmountMinor: number
    usedTransactions?: number
    usedTotalAmountMinor?: number
    allowDiscounts: boolean
    taxRatePercent?: number
    taxInclusive?: boolean
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
      installationId: authPackage.installationId,
      catalogVersion: authPackage.catalogVersion,
      pricingVersion: authPackage.pricingVersion,
      maxTransactions: authPackage.maxTransactions,
      maxTotalAmountMinor: authPackage.maxTotalAmountMinor,
      usedTransactions: authPackage.usedTransactions ?? 0,
      usedTotalAmountMinor: authPackage.usedTotalAmountMinor ?? 0,
      allowDiscounts: authPackage.allowDiscounts,
      taxRatePercent: authPackage.taxRatePercent ?? 0,
      taxInclusive: authPackage.taxInclusive ?? false,
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
        userId: authPackage.userId,
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

    const taxRateBps = Math.max(0, Math.round((auth.taxRatePercent ?? 0) * 100))
    const taxInclusive = Boolean(auth.taxInclusive)

    // 2. Validate Items & Local Quotas
    let computedTotalMinor = 0
    const computedLines: Array<{
      productId: string
      sku: string
      name: string
      unit: string
      allocationId: string
      quantity: number
      unitPriceMinor: number
      subtotalMinor: number
      taxMinor: number
      lineTotalMinor: number
    }> = []
    const allocationsToUpdate: Array<{ alloc: LocalDeviceAllocationRecord; deductQty: number }> = []

    for (let i = 0; i < items.length; i++) {
      const line = items[i]
      if (line.quantity <= 0) {
        throw new OutboxValidationError(`Invalid quantity ${line.quantity} at line ${i + 1}.`)
      }

      const alloc = await this.repo.getAllocationForProduct(businessId, branchId, deviceId, line.productId, {
        userId,
        authorizationId: auth.id,
      })
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

      const unitPriceMinor = alloc.sellingPriceMinor
      const subtotalMinor = Math.round(line.quantity * unitPriceMinor)
      const lineTaxMinor =
        taxRateBps <= 0
          ? 0
          : taxInclusive
            ? Math.round((subtotalMinor * taxRateBps) / (10000 + taxRateBps))
            : Math.round((subtotalMinor * taxRateBps) / 10000)
      const lineTotalMinor = taxInclusive ? subtotalMinor : subtotalMinor + lineTaxMinor
      computedTotalMinor += lineTotalMinor

      computedLines.push({
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        unit: line.unit,
        allocationId: alloc.id,
        quantity: line.quantity,
        unitPriceMinor,
        subtotalMinor,
        taxMinor: lineTaxMinor,
        lineTotalMinor,
      })

      allocationsToUpdate.push({ alloc, deductQty: line.quantity })
    }

    // 2b. Validate Aggregate Authorization Transaction & Amount Limits
    const usedTx = auth.usedTransactions ?? 0
    const usedAmt = auth.usedTotalAmountMinor ?? 0
    if (usedTx + 1 > auth.maxTransactions) {
      throw new OutboxValidationError(
        `Offline authorization transaction limit (${auth.maxTransactions}) reached. Reconnection required.`
      )
    }
    if (usedAmt + computedTotalMinor > auth.maxTotalAmountMinor) {
      throw new OutboxValidationError(
        `Offline authorization cumulative limit (${auth.maxTotalAmountMinor} paise) exceeded. Reconnection required.`
      )
    }

    // 3. Validate Cash Payment
    if (cashTenderedMinor < computedTotalMinor) {
      throw new OutboxValidationError(
        `Cash tendered (${cashTenderedMinor} paise) is less than total sale amount (${computedTotalMinor} paise).`
      )
    }
    const changeReturnedMinor = cashTenderedMinor - computedTotalMinor

    // 4. Generate Identifiers
    const effectiveDeviceId = auth.deviceId || deviceId
    const provisionalSaleId = `prov_sale_${crypto.randomUUID()}`
    const deviceShort = effectiveDeviceId.replace(/^dev_/, '').slice(0, 6).toUpperCase()
    const seq = now.getTime().toString(36).toUpperCase()
    const provisionalReceiptNumber = `OFF-${deviceShort}-${seq}`
    const idempotencyKey = input.idempotencyKey || `idem_off_${crypto.randomUUID()}`
    const businessDateKey = now.toISOString().split('T')[0]
    const nowIso = now.toISOString()

    // 5. Build Payload & Hash
    const commandPayload = {
      authorizationId: auth.id,
      deviceId: effectiveDeviceId,
      installationId: auth.installationId || deviceId,
      provisionalSaleId,
      provisionalReceiptNumber,
      items: computedLines.map((line) => ({
        productId: line.productId,
        allocationId: line.allocationId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        taxMinor: line.taxMinor,
        subtotalMinor: line.subtotalMinor,
        lineTotalMinor: line.lineTotalMinor,
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
      deviceId: effectiveDeviceId,
      authorizationId: auth.id,
      provisionalReceiptNumber,
      items: computedLines.map((i) => ({
        productId: i.productId,
        sku: i.sku,
        name: i.name,
        unit: i.unit,
        allocationId: i.allocationId,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        subtotalMinor: i.subtotalMinor,
        lineTotalMinor: i.lineTotalMinor,
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
      deviceId: effectiveDeviceId,
      commandType: 'create_offline_sale',
      idempotencyKey,
      payload: commandPayload,
    })

    provisionalSaleRecord.outboxCommandId = command.id

    // 7. Atomic Dexie Transaction: Store Provisional Sale, Consume Local Quota, & Increment Auth Usage
    try {
      await this.db.transaction(
        'rw',
        [this.db.offlineSales, this.db.offlineAllocations, this.db.offlineAuthorizations],
        async () => {
          const freshAuth = await this.db.offlineAuthorizations.get(auth.id)
          if (!freshAuth || freshAuth.status !== 'active') {
            throw new OutboxValidationError('Offline authorization is no longer active.')
          }
          const currentTx = freshAuth.usedTransactions ?? 0
          const currentAmt = freshAuth.usedTotalAmountMinor ?? 0
          if (
            currentTx + 1 > freshAuth.maxTransactions ||
            currentAmt + computedTotalMinor > freshAuth.maxTotalAmountMinor
          ) {
            throw new OutboxValidationError('Offline authorization quota limit exceeded during commit.')
          }
          freshAuth.usedTransactions = currentTx + 1
          freshAuth.usedTotalAmountMinor = currentAmt + computedTotalMinor
          await this.db.offlineAuthorizations.put(freshAuth)

          for (const { alloc, deductQty } of allocationsToUpdate) {
            const freshAlloc = await this.db.offlineAllocations.get(alloc.id)
            if (!freshAlloc || freshAlloc.remainingQuantity < deductQty) {
              throw new OutboxValidationError(
                `Offline allocation quota exceeded for '${alloc.name}'.`
              )
            }
            freshAlloc.consumedQuantity += deductQty
            freshAlloc.remainingQuantity = Math.max(0, freshAlloc.remainingQuantity - deductQty)
            freshAlloc.updatedAt = nowIso
            await this.db.offlineAllocations.put(freshAlloc)
          }

          await this.db.offlineSales.put(provisionalSaleRecord)
        }
      )
    } catch (txErr) {
      // Remove orphaned unacknowledged outbox command if atomic local quota reservation failed
      await this.db.outboxCommands.delete(command.id).catch(() => {})
      throw txErr
    }

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
   * Registers this terminal if needed and requests a fresh signed server offline authorization
   * package with stock quotas, caching it cleanly into IndexedDB for offline checkout readiness.
   */
  async prepareTerminalAuthorization(params: {
    userId: string
    businessId: string
    branchId: string
    products: Array<{ id: string; trackInventory: boolean; stockQuantity: number; status?: string }>
    durationHours?: number
  }): Promise<LocalOfflineAuthorizationRecord> {
    const { userId, businessId, branchId, products, durationHours = 8 } = params
    const client = new SyncClient({ db: this.db, api: apiClient })
    let reg: Awaited<ReturnType<SyncClient['registerDevice']>>
    try {
      reg = await client.registerDevice()
    } finally {
      client.destroy()
    }

    const eligibleProducts = products
      .filter((p) => (p.status || 'active') === 'active' && (!p.trackInventory || p.stockQuantity >= 1))
      .slice(0, 50)

    if (eligibleProducts.length === 0) {
      throw new OutboxValidationError('No active in-stock products available to allocate for offline operation.')
    }

    const dto = await apiClient.post<{
      authorizationId: string
      businessId: string
      branchId: string
      userId: string
      deviceId: string
      installationId?: string
      catalogVersion: number
      pricingVersion: number
      maxTransactions: number
      maxTotalAmountMinor: number
      usedTransactions?: number
      usedTotalAmountMinor?: number
      allowDiscounts: boolean
      taxRatePercent?: number
      taxInclusive?: boolean
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
    }>('/offline/authorizations', {
      deviceId: reg.id,
      branchId,
      durationHours,
      products: eligibleProducts.map((p) => ({
        productId: p.id,
        allocatedQuantity: p.trackInventory
          ? Math.min(Math.max(1, Math.floor(p.stockQuantity)), 25)
          : 25,
      })),
    })

    await this.cacheAuthorizationPackage(dto)
    const saved = await this.repo.getActiveAuthorization(userId, businessId, branchId, reg.id)
    if (!saved) {
      throw new OutboxValidationError('Failed to persist offline authorization locally.')
    }
    return saved
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


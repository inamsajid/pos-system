import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import { hasPermission, type MemberRole } from '../../auth/tenantContext'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import {
  validateQuantityByUnit,
  calculateLineSubtotalMinor,
  calculateTaxMinor,
  bpsFromPercent,
} from '../../lib/money'
import {
  signAuthorizationPayload,
  verifyAuthorizationPayload,
  signPricingSnapshot,
  verifyPricingSnapshot,
  type OfflinePricingSnapshot,
} from './offlineCrypto'
import { ChangeLogRepository } from '../sync/changeLog.repository'
import type {
  CreateOfflineAuthorizationInput,
  OfflineAuthorizationDTO,
  ProductAllocationDTO,
  CommitOfflineSaleInput,
  CommitOfflineSaleResponse,
  AllocationReconciliationResponse,
} from './offline.types'

interface ProductRow {
  id: string
  name: string
  sku: string
  unit: string
  selling_price_minor: number
  purchase_price_minor: number
  track_inventory: number
  status: string
}

interface DeviceRow {
  id: string
  business_id: string
  user_id: string
  status: string
  installation_id: string
}

interface AuthRow {
  id: string
  business_id: string
  branch_id: string
  user_id: string
  device_id: string
  catalog_version: number
  pricing_version: number
  max_transactions: number
  max_total_amount_minor: number
  used_transactions: number
  used_total_amount_minor: number
  allow_discounts: number
  status: string
  issued_at: string
  expires_at: string
  signature: string
  pricing_snapshot_json?: string | null
  pricing_signature?: string | null
}

interface AllocationRow {
  id: string
  authorization_id: string
  business_id: string
  branch_id: string
  device_id: string
  user_id: string
  product_id: string
  allocated_quantity: number
  consumed_quantity: number
  status: string
}

export class OfflineService {
  private readonly db: D1Database
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.db = db
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  /**
   * Generates a cryptographically signed offline authorization package and allocates device stock.
   */
  async createAuthorization(params: {
    businessId: string
    branchId: string
    userId: string
    actorRole?: MemberRole
    input: CreateOfflineAuthorizationInput
    secret: string
  }): Promise<OfflineAuthorizationDTO> {
    const { businessId, branchId, userId, actorRole = 'cashier', input, secret } = params

    // 1. Validate device registration (accept registered id or user-scoped installationId)
    const device = await this.db
      .prepare(
        `SELECT id, business_id, user_id, status, installation_id
         FROM devices
         WHERE business_id = ? AND (id = ? OR (installation_id = ? AND user_id = ?))
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`
      )
      .bind(businessId, input.deviceId, input.deviceId, userId, input.deviceId)
      .first<DeviceRow>()

    if (!device) {
      throw HttpError.notFound(`Device '${input.deviceId}' is not registered with business '${businessId}'.`)
    }
    if (device.status !== 'active') {
      throw HttpError.forbidden(`Device '${input.deviceId}' is revoked and cannot be authorized for offline sales.`)
    }
    const isManagerOrAbove = actorRole === 'owner' || actorRole === 'admin' || actorRole === 'manager'
    if (device.user_id && device.user_id !== userId && !isManagerOrAbove) {
      throw HttpError.forbidden(`Only managers or the registered device operator can authorize device '${device.id}'.`)
    }
    const authorizedUserId = device.user_id || userId
    const canonicalDeviceId = device.id

    if (!input.products || input.products.length === 0) {
      throw HttpError.badRequest('At least one product allocation is required for offline authorization.')
    }

    // 2. Validate products & check available stock
    const productIds = input.products.map((p) => p.productId)
    const placeholders = productIds.map(() => '?').join(', ')

    const productsRes = await this.db
      .prepare(
        `SELECT id, name, sku, unit, selling_price_minor, purchase_price_minor, track_inventory, status
         FROM products
         WHERE business_id = ? AND id IN (${placeholders})`
      )
      .bind(businessId, ...productIds)
      .all<ProductRow>()

    const productMap = new Map<string, ProductRow>()
    for (const p of productsRes.results || []) {
      productMap.set(p.id, p)
    }

    // Query physical inventory
    const invRes = await this.db
      .prepare(
        `SELECT product_id, quantity_on_hand
         FROM inventory_balances
         WHERE business_id = ? AND branch_id = ? AND product_id IN (${placeholders})`
      )
      .bind(businessId, branchId, ...productIds)
      .all<{ product_id: string; quantity_on_hand: number }>()

    const physicalMap = new Map<string, number>()
    for (const r of invRes.results || []) {
      physicalMap.set(r.product_id, r.quantity_on_hand)
    }

    // Query active allocations on other/current devices for these products
    const allocRes = await this.db
      .prepare(
        `SELECT product_id, SUM(allocated_quantity - consumed_quantity) as reserved_quantity
         FROM device_stock_allocations
         WHERE business_id = ? AND branch_id = ? AND status = 'active' AND product_id IN (${placeholders})
         GROUP BY product_id`
      )
      .bind(businessId, branchId, ...productIds)
      .all<{ product_id: string; reserved_quantity: number }>()

    const reservedMap = new Map<string, number>()
    for (const r of allocRes.results || []) {
      reservedMap.set(r.product_id, r.reserved_quantity || 0)
    }

    // Validate allocations
    const allocationDTOs: ProductAllocationDTO[] = []
    const allocationInserts: D1PreparedStatement[] = []
    const authId = `auth_${crypto.randomUUID()}`
    const now = new Date()
    const nowIso = now.toISOString()

    const durationHours = Math.min(Math.max(input.durationHours || 8, 1), 24)
    const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString()

    for (const req of input.products) {
      const prod = productMap.get(req.productId)
      if (!prod || prod.status !== 'active') {
        throw HttpError.badRequest(`Product '${req.productId}' is inactive or does not belong to this business.`)
      }

      const validatedQty = validateQuantityByUnit(req.allocatedQuantity, prod.unit, 'allocatedQuantity')
      const physical = physicalMap.get(prod.id) ?? 0
      const reserved = reservedMap.get(prod.id) ?? 0
      const availableToSell = Math.max(0, physical - reserved)

      if (Boolean(prod.track_inventory) && availableToSell < validatedQty) {
        throw new HttpError(
          422,
          'INSUFFICIENT_STOCK',
          `Insufficient available stock for '${prod.name}'. Available: ${availableToSell} ${prod.unit} (Physical: ${physical}, Active Allocations: ${reserved}), Requested: ${validatedQty} ${prod.unit}.`,
          {
            productId: prod.id,
            availableQuantity: availableToSell,
            requestedQuantity: validatedQty,
          }
        )
      }

      // Reserve in running map to prevent double-counting across line items
      reservedMap.set(prod.id, reserved + validatedQty)

      const allocId = `alloc_${crypto.randomUUID()}`
      allocationDTOs.push({
        allocationId: allocId,
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        unit: prod.unit,
        sellingPriceMinor: prod.selling_price_minor,
        allocatedQuantity: validatedQty,
        consumedQuantity: 0,
        remainingQuantity: validatedQty,
      })

      allocationInserts.push(
        this.db
          .prepare(
            `INSERT INTO device_stock_allocations (
               id, authorization_id, business_id, branch_id, device_id, user_id,
               product_id, allocated_quantity, consumed_quantity, status, allocated_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`
          )
          .bind(
            allocId,
            authId,
            businessId,
            branchId,
            canonicalDeviceId,
            userId,
            prod.id,
            validatedQty,
            nowIso,
            nowIso,
            nowIso
          )
      )
    }

    // 2b. Fetch authoritative business tax policy for signed pricing snapshot
    const bizSettings = await this.db
      .prepare('SELECT default_tax_rate, settings_json FROM business_settings WHERE business_id = ? LIMIT 1')
      .bind(businessId)
      .first<{ default_tax_rate: number; settings_json: string | null }>()

    let parsedBizJson: Record<string, unknown> = {}
    if (bizSettings?.settings_json) {
      try {
        parsedBizJson = JSON.parse(bizSettings.settings_json) as Record<string, unknown>
      } catch {
        parsedBizJson = {}
      }
    }
    const taxRatePercent =
      typeof bizSettings?.default_tax_rate === 'number' &&
      Number.isFinite(bizSettings.default_tax_rate) &&
      bizSettings.default_tax_rate > 0
        ? bizSettings.default_tax_rate
        : 0
    const taxRateBps = bpsFromPercent(taxRatePercent)
    const taxInclusive = Boolean(parsedBizJson.taxInclusive ?? false)

    // 3. Generate Cryptographic Signatures (Authorization + Pricing Policy Snapshot)
    const sortedProductIds = [...new Set(productIds)].sort()
    const signature = await signAuthorizationPayload(secret, {
      authorizationId: authId,
      businessId,
      branchId,
      userId: authorizedUserId,
      deviceId: canonicalDeviceId,
      expiresAt,
      productIds: sortedProductIds,
    })

    const maxTransactions =
      typeof input.maxTransactions === 'number' && Number.isInteger(input.maxTransactions) && input.maxTransactions > 0
        ? input.maxTransactions
        : 100
    const maxTotalAmountMinor =
      typeof input.maxTotalAmountMinor === 'number' &&
      Number.isInteger(input.maxTotalAmountMinor) &&
      input.maxTotalAmountMinor > 0
        ? input.maxTotalAmountMinor
        : 5_000_000

    const productPrices: Record<string, number> = {}
    for (const pid of sortedProductIds) {
      const prod = productMap.get(pid)
      if (prod) {
        productPrices[pid] = prod.selling_price_minor
      }
    }

    const pricingSnapshot: OfflinePricingSnapshot = {
      authorizationId: authId,
      businessId,
      branchId,
      maxTransactions,
      maxTotalAmountMinor,
      allowDiscounts: false,
      taxRateBps,
      taxInclusive,
      productPrices,
    }
    const pricingSnapshotJson = JSON.stringify(pricingSnapshot)
    const pricingSignature = await signPricingSnapshot(secret, pricingSnapshot)

    const authInsert = this.db
      .prepare(
        `INSERT INTO offline_authorizations (
           id, business_id, branch_id, user_id, device_id, catalog_version, pricing_version,
           max_transactions, max_total_amount_minor, used_transactions, used_total_amount_minor,
           allow_discounts, status, issued_at, expires_at,
           signature, pricing_snapshot_json, pricing_signature, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 0, 0, 0, 'active', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        authId,
        businessId,
        branchId,
        authorizedUserId,
        canonicalDeviceId,
        maxTransactions,
        maxTotalAmountMinor,
        nowIso,
        expiresAt,
        signature,
        pricingSnapshotJson,
        pricingSignature,
        nowIso,
        nowIso
      )

    // Execute atomic batch insert
    await this.db.batch([authInsert, ...allocationInserts])

    return {
      authorizationId: authId,
      businessId,
      branchId,
      userId: authorizedUserId,
      deviceId: canonicalDeviceId,
      installationId: device.installation_id,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions,
      maxTotalAmountMinor,
      usedTransactions: 0,
      usedTotalAmountMinor: 0,
      allowDiscounts: false,
      taxRatePercent,
      taxInclusive,
      status: 'active',
      issuedAt: nowIso,
      expiresAt,
      allowedPaymentMethods: ['cash'],
      productAllocations: allocationDTOs,
      signature,
    }
  }

  /**
   * Commits a provisional offline cash sale into central D1 with atomic financial and inventory updates.
   */
  async commitOfflineSale(params: {
    businessId: string
    branchId: string
    userId: string
    cashierName: string
    input: CommitOfflineSaleInput
    idempotencyKey?: string
    secret: string
    actorRole?: MemberRole
  }): Promise<CommitOfflineSaleResponse> {
    const {
      businessId,
      branchId,
      userId,
      cashierName,
      input,
      idempotencyKey,
      secret,
      actorRole = 'cashier',
    } = params

    // 1. Check Idempotency First (Ensures Exactly-Once Processing and Response Recovery)
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'commit_offline_sale',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return {
          ...(cached.body as CommitOfflineSaleResponse),
          isCached: true,
        }
      }
    }

    // 2. Validate Device (accept canonical device.id OR installation_id bound to user/authorization)
    const device = await this.db
      .prepare(
        `SELECT id, business_id, user_id, status, installation_id
         FROM devices
         WHERE business_id = ?
           AND (
             id = ?
             OR (
               installation_id = ?
               AND (
                 user_id = ?
                 OR id = (SELECT device_id FROM offline_authorizations WHERE id = ? AND business_id = ? LIMIT 1)
               )
             )
           )
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`
      )
      .bind(businessId, input.deviceId, input.deviceId, userId, input.authorizationId, businessId, input.deviceId)
      .first<DeviceRow>()

    if (!device || device.status !== 'active') {
      throw HttpError.forbidden(`Device '${input.deviceId}' is revoked or not found for business '${businessId}'.`)
    }

    // 3. Validate Authorization
    const auth = await this.db
      .prepare('SELECT * FROM offline_authorizations WHERE id = ? AND business_id = ? LIMIT 1')
      .bind(input.authorizationId, businessId)
      .first<AuthRow>()

    if (!auth) {
      throw HttpError.notFound(`Offline authorization '${input.authorizationId}' not found.`)
    }
    if (auth.status !== 'active') {
      throw HttpError.forbidden(`Offline authorization '${auth.id}' is '${auth.status}'.`)
    }
    if (auth.branch_id !== branchId) {
      throw HttpError.forbidden(`Offline authorization is bound to branch '${auth.branch_id}', not '${branchId}'.`)
    }
    if (auth.device_id !== device.id) {
      throw HttpError.forbidden(`Offline authorization is bound to device '${auth.device_id}', not '${input.deviceId}'.`)
    }

    const isManagerOrAbove = actorRole === 'owner' || actorRole === 'admin' || actorRole === 'manager'
    if (auth.user_id !== userId && !isManagerOrAbove) {
      throw HttpError.forbidden(`Offline authorization is bound to another user and cannot be committed by '${userId}'.`)
    }

    // Validate creation time against authorization window & post-expiry sync ceiling
    const now = new Date()
    const offlineCreatedMs = Date.parse(input.offlineCreatedAt)
    if (!input.offlineCreatedAt || !Number.isFinite(offlineCreatedMs)) {
      throw HttpError.badRequest('Valid ISO offlineCreatedAt timestamp is required.')
    }
    if (offlineCreatedMs > now.getTime() + 10 * 60_000) {
      throw HttpError.badRequest('offlineCreatedAt timestamp cannot be in the future.')
    }
    const issuedAtMs = Date.parse(auth.issued_at)
    if (Number.isFinite(issuedAtMs) && offlineCreatedMs < issuedAtMs - 15 * 60_000) {
      throw HttpError.forbidden(`Offline sale timestamp precedes authorization issuance (${auth.issued_at}).`)
    }
    const expiresAtMs = Date.parse(auth.expires_at)
    if (offlineCreatedMs > expiresAtMs) {
      throw HttpError.forbidden(`Offline authorization '${auth.id}' expired at ${auth.expires_at}.`)
    }
    if (now.getTime() > expiresAtMs + 7 * 24 * 3600 * 1000) {
      throw HttpError.forbidden(`Offline authorization '${auth.id}' post-expiry synchronization window has elapsed.`)
    }

    // 4. Load ALL authorization allocations to reconstruct authoritative granted product list
    const allAllocationsRes = await this.db
      .prepare(
        `SELECT * FROM device_stock_allocations
         WHERE business_id = ? AND authorization_id = ? AND device_id = ?`
      )
      .bind(businessId, auth.id, auth.device_id)
      .all<AllocationRow>()

    const allAuthAllocations = allAllocationsRes.results || []
    const grantedProductIds = [...new Set(allAuthAllocations.map((a) => a.product_id))].sort()

    // Validate Cryptographic Authorization Signature against ALL granted products (supports subset carts)
    const isSignatureValid = await verifyAuthorizationPayload(
      secret,
      {
        authorizationId: auth.id,
        businessId,
        branchId,
        userId: auth.user_id,
        deviceId: auth.device_id,
        expiresAt: auth.expires_at,
        productIds: grantedProductIds,
      },
      auth.signature
    )

    if (!isSignatureValid) {
      throw HttpError.forbidden('Invalid or tampered offline authorization signature.')
    }

    // Validate Signed Pricing Snapshot if present (tampered snapshot/signature always rejected)
    let pricingSnapshot: OfflinePricingSnapshot | null = null
    if (auth.pricing_snapshot_json || auth.pricing_signature) {
      if (!auth.pricing_snapshot_json || !auth.pricing_signature) {
        throw HttpError.forbidden('Corrupted or partial offline pricing snapshot signature.')
      }
      try {
        pricingSnapshot = JSON.parse(auth.pricing_snapshot_json) as OfflinePricingSnapshot
      } catch {
        throw HttpError.forbidden('Malformed offline pricing snapshot payload.')
      }
      const pricingSigValid = await verifyPricingSnapshot(
        secret,
        pricingSnapshot,
        auth.pricing_signature
      )
      if (!pricingSigValid) {
        throw HttpError.forbidden('Invalid or tampered offline pricing snapshot signature.')
      }
      if (
        pricingSnapshot.authorizationId !== auth.id ||
        pricingSnapshot.businessId !== businessId ||
        pricingSnapshot.branchId !== branchId
      ) {
        throw HttpError.forbidden('Offline pricing snapshot scope mismatch.')
      }
    }

    // 5. Validate Line Items, Allocations, Quota, and Price Policy
    const productIds = input.items.map((i) => i.productId)
    const placeholders = productIds.map(() => '?').join(', ')
    const productsRes = await this.db
      .prepare(
        `SELECT id, name, sku, unit, selling_price_minor, purchase_price_minor, track_inventory, status
         FROM products
         WHERE business_id = ? AND id IN (${placeholders})`
      )
      .bind(businessId, ...productIds)
      .all<ProductRow>()

    const productMap = new Map<string, ProductRow>()
    for (const p of productsRes.results || []) {
      productMap.set(p.id, p)
    }

    const allocationMap = new Map<string, AllocationRow>()
    for (const a of allAuthAllocations) {
      allocationMap.set(a.id, a)
    }

    const nowIso = now.toISOString()
    const saleId = `sale_${crypto.randomUUID()}`
    const taxRateBps = pricingSnapshot?.taxRateBps ?? 0
    const taxInclusive = pricingSnapshot?.taxInclusive ?? false

    interface ProcessedOfflineLine {
      id: string
      product: ProductRow
      allocation: AllocationRow
      quantity: number
      unitPriceMinor: number
      originalUnitPriceMinor: number | null
      priceOverrideReason: string | null
      priceOverrideBy: string | null
      priceOverrideAt: string | null
      unitCostMinor: number
      subtotalMinor: number
      taxMinor: number
      lineTotalMinor: number
    }

    const processedLines: ProcessedOfflineLine[] = []
    const offlinePriceConflicts: Array<{
      productId: string
      name: string
      authorizedPriceMinor: number
      currentCatalogPriceMinor: number
    }> = []
    const overrideAuditEntries: Array<{ action: string; diff: Record<string, unknown> }> = []
    let computedSubtotalMinor = 0
    let computedTaxMinor = 0
    let computedTotalMinor = 0

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]
      const product = productMap.get(item.productId)
      if (!product || product.status !== 'active') {
        throw HttpError.badRequest(`Product at line ${i + 1} does not exist or is inactive.`)
      }

      const validatedQty = validateQuantityByUnit(item.quantity, product.unit, `items[${i}].quantity`)
      const allocation = allocationMap.get(item.allocationId)
      if (!allocation || allocation.status !== 'active') {
        throw HttpError.badRequest(`Active stock allocation not found for product '${product.name}'.`)
      }
      if (allocation.product_id !== product.id) {
        throw HttpError.badRequest(`Allocation '${item.allocationId}' belongs to different product.`)
      }

      const remainingQuota = allocation.allocated_quantity - allocation.consumed_quantity
      if (remainingQuota < validatedQty) {
        throw new HttpError(
          422,
          'ALLOCATION_EXCEEDS_BALANCE',
          `Offline allocation quota exceeded for '${product.name}'. Remaining quota: ${remainingQuota}, Requested: ${validatedQty}.`,
          {
            productId: product.id,
            remainingQuota,
            requestedQuantity: validatedQty,
          }
        )
      }

      if (item.discountMinor !== undefined && item.discountMinor > 0 && !auth.allow_discounts) {
        throw HttpError.forbidden(
          `Discounts are not permitted under offline authorization '${auth.id}'.`,
          { field: `items[${i}].discountMinor` }
        )
      }

      const authorizedSnapshotPriceMinor =
        pricingSnapshot?.productPrices?.[product.id] ?? product.selling_price_minor

      if (item.unitPriceMinor !== undefined && item.unitPriceMinor !== authorizedSnapshotPriceMinor) {
        throw HttpError.forbidden(
          `Submitted offline unit price for '${product.name}' (${item.unitPriceMinor} paise) does not match authorized pricing snapshot (${authorizedSnapshotPriceMinor} paise).`,
          {
            code: 'OFFLINE_PRICE_TAMPERED',
            productId: product.id,
            authorizedPriceMinor: authorizedSnapshotPriceMinor,
            submittedPriceMinor: item.unitPriceMinor,
          }
        )
      }

      let unitPriceMinor = authorizedSnapshotPriceMinor
      let originalUnitPriceMinor: number | null = null
      let priceOverrideReason: string | null = null
      let priceOverrideBy: string | null = null
      let priceOverrideAt: string | null = null

      // Detect live catalog price drift since offline authorization was issued
      if (authorizedSnapshotPriceMinor !== product.selling_price_minor) {
        const resolution = input.priceConflictResolution
        if (!resolution) {
          offlinePriceConflicts.push({
            productId: product.id,
            name: product.name,
            authorizedPriceMinor: authorizedSnapshotPriceMinor,
            currentCatalogPriceMinor: product.selling_price_minor,
          })
        } else {
          if (!hasPermission(actorRole, 'price_override')) {
            throw HttpError.forbidden(
              `Resolving offline price conflict for '${product.name}' requires price_override permission.`
            )
          }
          const reason = (resolution.reason || '').trim()
          if (reason.length < 3) {
            throw HttpError.badRequest(
              'A conflict resolution reason (minimum 3 characters) is required for offline price drift.'
            )
          }
          if (resolution.mode === 'accept_offline_price') {
            unitPriceMinor = authorizedSnapshotPriceMinor
            originalUnitPriceMinor = product.selling_price_minor
            priceOverrideReason = reason
            priceOverrideBy = userId
            priceOverrideAt = nowIso
            overrideAuditEntries.push({
              action: 'SALE_PRICE_OVERRIDE',
              diff: {
                source: 'offline_price_conflict',
                mode: resolution.mode,
                productId: product.id,
                currentCatalogPriceMinor: product.selling_price_minor,
                acceptedOfflinePriceMinor: authorizedSnapshotPriceMinor,
                reason,
              },
            })
          } else {
            unitPriceMinor = product.selling_price_minor
            overrideAuditEntries.push({
              action: 'OFFLINE_PRICE_CONFLICT_RESOLVED',
              diff: {
                source: 'offline_price_conflict',
                mode: resolution.mode,
                productId: product.id,
                authorizedOfflinePriceMinor: authorizedSnapshotPriceMinor,
                appliedCatalogPriceMinor: product.selling_price_minor,
                reason,
              },
            })
          }
        }
      }

      const subtotalMinor = calculateLineSubtotalMinor(validatedQty, unitPriceMinor)
      const serverTaxMinor = calculateTaxMinor(subtotalMinor, taxRateBps, taxInclusive)
      if (item.taxMinor !== undefined && item.taxMinor !== serverTaxMinor) {
        throw HttpError.forbidden(
          `Offline tax override for '${product.name}' is not permitted.`,
          {
            field: `items[${i}].taxMinor`,
            expectedTaxMinor: serverTaxMinor,
            submittedTaxMinor: item.taxMinor,
          }
        )
      }

      const lineTotalMinor = taxInclusive ? subtotalMinor : subtotalMinor + serverTaxMinor
      computedSubtotalMinor += subtotalMinor
      computedTaxMinor += serverTaxMinor
      computedTotalMinor += lineTotalMinor

      processedLines.push({
        id: `si_${crypto.randomUUID()}`,
        product,
        allocation,
        quantity: validatedQty,
        unitPriceMinor,
        originalUnitPriceMinor,
        priceOverrideReason,
        priceOverrideBy,
        priceOverrideAt,
        unitCostMinor: product.purchase_price_minor,
        subtotalMinor,
        taxMinor: serverTaxMinor,
        lineTotalMinor,
      })
    }

    if (offlinePriceConflicts.length > 0) {
      throw new HttpError(
        409,
        'OFFLINE_PRICE_CONFLICT',
        `Catalog price changed while terminal was offline for ${offlinePriceConflicts.map((c) => c.name).join(', ')}. Manager price conflict resolution is required.`,
        { conflicts: offlinePriceConflicts }
      )
    }

    // 6. Validate Cash Payment & Offline Authorization Aggregate Limits
    if (input.cashTenderedMinor < computedTotalMinor) {
      throw HttpError.badRequest(
        `Cash tendered (${input.cashTenderedMinor} paise) is less than total sale amount (${computedTotalMinor} paise).`
      )
    }
    const changeReturnedMinor = input.cashTenderedMinor - computedTotalMinor

    const currentUsedTx = Number(auth.used_transactions ?? 0)
    const currentUsedAmountMinor = Number(auth.used_total_amount_minor ?? 0)
    if (currentUsedTx + 1 > auth.max_transactions) {
      throw new HttpError(
        422,
        'OFFLINE_LIMIT_EXCEEDED',
        `Offline authorization '${auth.id}' transaction limit (${auth.max_transactions}) exceeded.`,
        { maxTransactions: auth.max_transactions, usedTransactions: currentUsedTx }
      )
    }
    if (currentUsedAmountMinor + computedTotalMinor > auth.max_total_amount_minor) {
      throw new HttpError(
        422,
        'OFFLINE_LIMIT_EXCEEDED',
        `Offline authorization '${auth.id}' cumulative amount limit (${auth.max_total_amount_minor} paise) exceeded.`,
        {
          maxTotalAmountMinor: auth.max_total_amount_minor,
          usedTotalAmountMinor: currentUsedAmountMinor,
          attemptedAmountMinor: computedTotalMinor,
        }
      )
    }

    // 7. Auto-provision or query Walk-in Customer for this business
    let walkIn = await this.db
      .prepare('SELECT id, name, customer_code FROM customers WHERE business_id = ? AND is_walk_in = 1 LIMIT 1')
      .bind(businessId)
      .first<{ id: string; name: string; customer_code: string }>()

    if (!walkIn) {
      const walkInId = `cust_walkin_${businessId}`
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO customers (id, business_id, customer_code, name, type, is_walk_in, status, created_at, updated_at)
           VALUES (?, ?, 'WALKIN', 'Walk-in Customer', 'individual', 1, 'active', datetime('now'), datetime('now'))`
        )
        .bind(walkInId, businessId)
        .run()

      walkIn = (await this.db
        .prepare('SELECT id, name, customer_code FROM customers WHERE business_id = ? AND is_walk_in = 1 LIMIT 1')
        .bind(businessId)
        .first<{ id: string; name: string; customer_code: string }>())!
    }

    const customerSnapshot = {
      id: walkIn.id,
      name: walkIn.name,
      customerCode: walkIn.customer_code,
      isWalkIn: true,
    }

    // 8. Generate Primary Financial Keys
    const invoiceId = `inv_${crypto.randomUUID()}`
    const paymentId = `pay_${crypto.randomUUID()}`
    const allocationId = `alloc_pay_${crypto.randomUUID()}`
    const businessDateKey = getCurrentBusinessDateKey()
    const timestamp = now.getTime()

    const saleNumber = `SALE-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
    const receiptNumber = `RCP-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
    const invoiceNumber = `INV-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
    const paymentReceiptNumber = `PAY-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`

    const statements: D1PreparedStatement[] = []

    // Statement 1: Insert Sale Header
    statements.push(
      this.db
        .prepare(
          `INSERT INTO sales (
             id, business_id, branch_id, sale_number, receipt_number, invoice_number,
             customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name,
             subtotal_minor, discount_type, discount_value, discount_minor, tax_minor,
             total_amount_minor, amount_paid_minor, remaining_balance_minor,
             change_returned_minor, status, business_date_key, idempotency_key, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fixed', 0, 0, ?, ?, ?, 0, ?, 'completed', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          saleId,
          businessId,
          branchId,
          saleNumber,
          receiptNumber,
          invoiceNumber,
          walkIn.id,
          JSON.stringify(customerSnapshot),
          input.terminalId || 'OFFLINE-POS',
          userId,
          cashierName,
          computedSubtotalMinor,
          computedTaxMinor,
          computedTotalMinor,
          computedTotalMinor,
          changeReturnedMinor,
          businessDateKey,
          idempotencyKey ?? null
        )
    )

    // Audit log entries for conflict resolution if any
    for (const auditEntry of overrideAuditEntries) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
             VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, datetime('now'))`
          )
          .bind(
            `aud_${crypto.randomUUID()}`,
            businessId,
            branchId,
            userId,
            auditEntry.action,
            saleId,
            JSON.stringify(auditEntry.diff)
          )
      )
    }

    // Statement 2: Insert Sale Items
    for (const line of processedLines) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO sale_items (
               id, sale_id, product_id, sku, product_name, unit,
               unit_price_minor, original_unit_price_minor, price_override_reason, price_override_by, price_override_at,
               unit_cost_minor, cogs_estimated, quantity, subtotal_minor, discount_minor, tax_minor, line_total_minor,
               returned_quantity
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, 0.0)`
          )
          .bind(
            line.id,
            saleId,
            line.product.id,
            line.product.sku,
            line.product.name,
            line.product.unit,
            line.unitPriceMinor,
            line.originalUnitPriceMinor,
            line.priceOverrideReason,
            line.priceOverrideBy,
            line.priceOverrideAt,
            line.unitCostMinor,
            line.quantity,
            line.subtotalMinor,
            line.taxMinor,
            line.lineTotalMinor
          )
      )

      // Statement 3: Consume Device Allocation Quota (Guarded by CHECK constraint: consumed_quantity <= allocated_quantity)
      statements.push(
        this.db
          .prepare(
            `UPDATE device_stock_allocations
             SET consumed_quantity = consumed_quantity + ?, updated_at = datetime('now')
             WHERE id = ? AND authorization_id = ? AND business_id = ?`
          )
          .bind(line.quantity, line.allocation.id, auth.id, businessId)
      )

      if (line.product.track_inventory) {
        const movementId = `mov_${crypto.randomUUID()}`
        const movementNumber = `SM-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`

        // Statement 4: Ensure inventory balance row exists initialized to 0.0
        statements.push(
          this.db
            .prepare(
              `INSERT OR IGNORE INTO inventory_balances (
                 id, business_id, branch_id, product_id, quantity_on_hand, updated_at
               ) VALUES (?, ?, ?, ?, 0.0, datetime('now'))`
            )
            .bind(`bal_${crypto.randomUUID()}`, businessId, branchId, line.product.id)
        )

        // Statement 5: Insert Stock Movement reading live in-transaction inventory balance
        statements.push(
          this.db
            .prepare(
              `INSERT INTO stock_movements (
                 id, business_id, branch_id, movement_number, product_id, type,
                 quantity_change, previous_quantity, new_quantity, unit_cost_minor,
                 reference_type, reference_id, reference_number, notes, business_date_key,
                 created_by, created_at
               ) VALUES (
                 ?, ?, ?, ?, ?, 'sale',
                 ?,
                 COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
                 COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) - ?,
                 ?, 'sale', ?, ?, 'Offline POS Cash Sale', ?, ?, datetime('now')
               )`
            )
            .bind(
              movementId,
              businessId,
              branchId,
              movementNumber,
              line.product.id,
              -line.quantity,
              businessId,
              branchId,
              line.product.id,
              businessId,
              branchId,
              line.product.id,
              line.quantity,
              line.unitCostMinor,
              saleId,
              saleNumber,
              businessDateKey,
              userId
            )
        )

        // Statement 6: Decrement Physical Inventory Balance
        statements.push(
          this.db
            .prepare(
              `UPDATE inventory_balances
               SET quantity_on_hand = quantity_on_hand - ?, updated_at = datetime('now')
               WHERE business_id = ? AND branch_id = ? AND product_id = ?`
            )
            .bind(line.quantity, businessId, branchId, line.product.id)
        )

        // Statement 7: Multi-Device Change Feed Log with Authoritative Post-Commit quantityOnHand
        statements.push(
          this.changeLogRepo.createLiveStockChangeEventStatement({
            businessId,
            branchId,
            productId: line.product.id,
            resourceId: line.product.id,
            resourceVersion: 1,
            unit: line.product.unit,
            updatedAt: nowIso,
            eventId: `evt_${crypto.randomUUID()}`,
            extraPayload: {
              quantityDeducted: line.quantity,
              reason: 'offline_sale_commit',
            },
          })
        )
      }
    }

    // Statement 7: Insert Invoice
    statements.push(
      this.db
        .prepare(
          `INSERT INTO invoices (
             id, business_id, branch_id, invoice_number, sale_id, customer_id,
             business_date_key, total_amount_minor, paid_amount_minor, remaining_amount_minor,
             payment_status, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'paid', 'active', datetime('now'), datetime('now'))`
        )
        .bind(
          invoiceId,
          businessId,
          branchId,
          invoiceNumber,
          saleId,
          walkIn.id,
          businessDateKey,
          computedTotalMinor,
          computedTotalMinor
        )
    )

    // Statement 8: Insert Cash Payment
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payments (
             id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json,
             amount_minor, unallocated_amount_minor, source, notes, business_date_key,
             received_by, received_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pos_checkout', 'Offline POS Cash Tender', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          paymentId,
          businessId,
          branchId,
          paymentReceiptNumber,
          walkIn.id,
          JSON.stringify(customerSnapshot),
          computedTotalMinor,
          businessDateKey,
          userId
        )
    )

    // Statement 9: Insert Payment Method (cash)
    const methodId = `pm_${crypto.randomUUID()}`
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payment_methods (id, payment_id, method, amount_minor, reference)
           VALUES (?, ?, 'cash', ?, ?)`
        )
        .bind(methodId, paymentId, computedTotalMinor, input.provisionalReceiptNumber)
    )

    // Statement 10: Insert Payment Allocation
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor, allocated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .bind(allocationId, businessId, paymentId, saleId, invoiceNumber, computedTotalMinor)
    )

    const responseDTO: CommitOfflineSaleResponse = {
      saleId,
      saleNumber,
      invoiceId,
      invoiceNumber,
      totalAmountMinor: computedTotalMinor,
      cashTenderedMinor: input.cashTenderedMinor,
      changeReturnedMinor,
      provisionalReceiptNumber: input.provisionalReceiptNumber,
      provisionalSaleId: input.provisionalSaleId,
      status: 'completed',
      createdAt: nowIso,
    }

    // Statement 11: Atomically Track Authorization Usage & Guard Aggregate Caps
    statements.push(
      this.db
        .prepare(
          `UPDATE offline_authorizations
           SET used_transactions = CASE
                 WHEN used_transactions + 1 <= max_transactions THEN used_transactions + 1
                 ELSE NULL
               END,
               used_total_amount_minor = CASE
                 WHEN used_total_amount_minor + ? <= max_total_amount_minor THEN used_total_amount_minor + ?
                 ELSE NULL
               END,
               updated_at = datetime('now')
           WHERE id = ? AND business_id = ? AND status = 'active'`
        )
        .bind(computedTotalMinor, computedTotalMinor, auth.id, businessId)
    )

    // Statement 12: Idempotency Key Insert
    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'commit_offline_sale',
          idempotencyKey,
          requestHash,
          201,
          responseDTO
        )
      )
    }

    // 8. Execute Atomic D1 Batch
    try {
      await this.db.batch(statements)
    } catch (err) {
      if (err instanceof Error && err.message.includes('NOT NULL constraint failed: offline_authorizations')) {
        throw new HttpError(
          422,
          'OFFLINE_LIMIT_EXCEEDED',
          'Offline authorization transaction or cumulative amount cap exceeded during sync commit.'
        )
      }
      if (err instanceof Error && err.message.includes('CHECK constraint failed')) {
        throw new HttpError(
          422,
          'ALLOCATION_EXCEEDS_BALANCE',
          'Offline allocation quota exceeded during concurrent sync commit.'
        )
      }
      throw err
    }

    return responseDTO
  }

  /**
   * Reconciles an allocation, releasing unconsumed quota back into available inventory pool.
   */
  async reconcileAllocation(
    businessId: string,
    allocationId: string,
    authorizedBranchIds?: string[]
  ): Promise<AllocationReconciliationResponse> {
    const alloc = await this.db
      .prepare('SELECT * FROM device_stock_allocations WHERE id = ? AND business_id = ? LIMIT 1')
      .bind(allocationId, businessId)
      .first<AllocationRow>()

    if (!alloc) {
      throw HttpError.notFound(`Stock allocation '${allocationId}' not found.`)
    }

    if (authorizedBranchIds && !authorizedBranchIds.includes(alloc.branch_id)) {
      throw HttpError.forbidden('You are not authorized to reconcile stock allocations in this branch.')
    }

    const nowIso = new Date().toISOString()
    const released = Math.max(0, alloc.allocated_quantity - alloc.consumed_quantity)

    await this.db
      .prepare(
        `UPDATE device_stock_allocations
         SET status = 'reconciled', reconciled_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(nowIso, nowIso, alloc.id)
      .run()

    return {
      allocationId: alloc.id,
      productId: alloc.product_id,
      allocatedQuantity: alloc.allocated_quantity,
      consumedQuantity: alloc.consumed_quantity,
      releasedQuantity: released,
      status: 'reconciled',
      reconciledAt: nowIso,
    }
  }

  /**
   * Admin-initiated reconciliation for a lost or stolen device.
   */
  async reconcileLostDevice(
    businessId: string,
    deviceId: string
  ): Promise<{ deviceId: string; status: 'revoked'; reconciledAllocationsCount: number }> {
    const nowIso = new Date().toISOString()

    const allocations = await this.db
      .prepare('SELECT id FROM device_stock_allocations WHERE business_id = ? AND device_id = ? AND status = ?')
      .bind(businessId, deviceId, 'active')
      .all<{ id: string }>()

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?')
        .bind('revoked', nowIso, deviceId, businessId),
      this.db
        .prepare(
          'UPDATE offline_authorizations SET status = ?, updated_at = ? WHERE business_id = ? AND device_id = ? AND status = ?'
        )
        .bind('revoked', nowIso, businessId, deviceId, 'active'),
      this.db
        .prepare(
          'UPDATE device_stock_allocations SET status = ?, reconciled_at = ?, updated_at = ? WHERE business_id = ? AND device_id = ? AND status = ?'
        )
        .bind('revoked', nowIso, nowIso, businessId, deviceId, 'active'),
    ]

    await this.db.batch(stmts)

    return {
      deviceId,
      status: 'revoked',
      reconciledAllocationsCount: allocations.results?.length || 0,
    }
  }
}

import { productService } from '../../products/services/productService'
import { supplierService } from '../../suppliers/services/supplierService'
import { getProductStock, recordStockChanges } from '../../inventory/services/inventoryService'
import { money } from '../../pos/utils/checkoutCalculations'
import { apiClient } from '../../../lib/api-client'
import type { GoodsReceipt, Purchase, PurchaseDraft } from '../types/purchase.types'

const PURCHASES_KEY = 'northstar.purchases.v1'
const RECEIPTS_KEY = 'northstar.goods-receipts.v1'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

function load<T>(key: string): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

let purchases = load<Purchase>(PURCHASES_KEY)
let receipts = load<GoodsReceipt>(RECEIPTS_KEY)

function save() {
  try {
    localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases))
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts))
  } catch {
    /* Keep this mock repository usable when browser storage is unavailable. */
  }
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function copyPurchase(p: Purchase): Purchase {
  return {
    ...p,
    supplierSnapshot: { ...p.supplierSnapshot },
    items: p.items.map((item) => ({ ...item, productSnapshot: { ...item.productSnapshot } })),
  }
}

function copyReceipt(r: GoodsReceipt): GoodsReceipt {
  return {
    ...r,
    supplierSnapshot: { ...r.supplierSnapshot },
    items: r.items.map((item) => ({ ...item, productSnapshot: { ...item.productSnapshot } })),
  }
}

function find(idValue: string) {
  const purchase = purchases.find((p) => p.id === idValue)
  if (!purchase) throw new Error('Purchase not found.')
  return purchase
}

function numberFor(purchaseId: string) {
  return `PO-${new Date().getFullYear()}-${purchaseId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`
}

interface WorkerPurchaseItemDTO {
  id: string
  purchaseId: string
  productId: string
  productName: string
  sku: string
  unit: string
  orderedQuantity: number
  receivedQuantity: number
  unitCostMinor: number
  discountMinor: number
  lineTotalMinor: number
}

interface WorkerPurchaseDTO {
  id: string
  businessId: string
  branchId: string
  purchaseNumber: string
  supplierId: string
  supplierName?: string
  supplierSnapshot?: {
    id: string
    supplierCode: string
    name: string
    companyName: string | null
    phone: string | null
    email: string | null
  }
  supplierInvoiceNumber: string | null
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalAmountMinor: number
  paidAmountMinor: number
  remainingAmountMinor: number
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'
  purchaseDateKey: string
  expectedDeliveryDate: string | null
  notes: string | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
  items?: WorkerPurchaseItemDTO[]
}

function mapWorkerPurchaseToPurchase(dto: WorkerPurchaseDTO): Purchase {
  return {
    id: dto.id,
    purchaseNumber: dto.purchaseNumber,
    supplierId: dto.supplierId,
    supplierSnapshot: {
      name: dto.supplierSnapshot?.name || dto.supplierName || 'Supplier',
      supplierCode: dto.supplierSnapshot?.supplierCode || 'SUP',
      companyName: dto.supplierSnapshot?.companyName ?? undefined,
    },
    supplierInvoiceNumber: dto.supplierInvoiceNumber ?? undefined,
    items: (dto.items || []).map((item) => ({
      id: item.id,
      productId: item.productId,
      productSnapshot: {
        name: item.productName,
        sku: item.sku,
        unit: item.unit as any,
        categoryId: '',
      },
      orderedQuantity: item.orderedQuantity,
      receivedQuantity: item.receivedQuantity,
      unitCost: item.unitCostMinor / 100,
      discountAmount: item.discountMinor / 100,
      lineTotal: item.lineTotalMinor / 100,
    })),
    subtotal: dto.subtotalMinor / 100,
    discountAmount: dto.discountMinor / 100,
    taxAmount: dto.taxMinor / 100,
    totalAmount: dto.totalAmountMinor / 100,
    status: (dto.status === 'ordered' ? 'confirmed' : dto.status) as any,
    purchaseDate: dto.purchaseDateKey || dto.createdAt,
    expectedDeliveryDate: dto.expectedDeliveryDate ?? undefined,
    notes: dto.notes ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    confirmedAt: dto.confirmedAt ?? undefined,
  }
}

async function buildPurchase(draft: PurchaseDraft, existing?: Purchase): Promise<Purchase> {
  if (!draft.supplierId) throw new Error('Select a supplier.')
  const supplier = await supplierService.getSupplierById(draft.supplierId)
  if (!supplier || supplier.status !== 'active') throw new Error('Select an active supplier.')
  if (!draft.items.length) throw new Error('Add at least one product to this purchase.')
  if ((draft.taxAmount ?? 0) !== 0) throw new Error('Tax is not configured. Set tax to zero for this purchase.')
  const catalog = await productService.getProducts()
  const items = draft.items.map((item) => {
    const product = catalog.find((p) => p.id === item.productId)
    if (!product || product.status !== 'active') throw new Error('Only active products can be added to purchases.')
    if (!Number.isFinite(item.orderedQuantity) || item.orderedQuantity <= 0)
      throw new Error(`Enter a valid quantity for ${product.name}.`)
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0)
      throw new Error(`Enter a valid purchase cost for ${product.name}.`)
    const lineBeforeDiscount = money(item.orderedQuantity * item.unitCost)
    const discountAmount = money(item.discountAmount ?? 0)
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > lineBeforeDiscount)
      throw new Error(`Check the discount for ${product.name}.`)
    return {
      id: existing?.items.find((old) => old.productId === product.id)?.id ?? id(),
      productId: product.id,
      productSnapshot: { name: product.name, sku: product.sku, unit: product.unit, categoryId: product.categoryId },
      orderedQuantity: item.orderedQuantity,
      receivedQuantity: existing?.items.find((old) => old.productId === product.id)?.receivedQuantity ?? 0,
      unitCost: money(item.unitCost),
      discountAmount,
      lineTotal: money(lineBeforeDiscount - discountAmount),
    }
  })
  if (new Set(items.map((item) => item.productId)).size !== items.length)
    throw new Error('Each product can appear only once. Update the existing line quantity instead.')
  const subtotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0))
  const discountAmount = money(draft.discountAmount ?? 0)
  if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal)
    throw new Error('Purchase discount cannot exceed the subtotal.')
  const now = new Date().toISOString()
  const purchaseId = existing?.id ?? id()
  return {
    id: purchaseId,
    purchaseNumber: existing?.purchaseNumber ?? numberFor(purchaseId),
    supplierId: supplier.id,
    supplierSnapshot: { name: supplier.name, supplierCode: supplier.supplierCode, companyName: supplier.companyName },
    supplierInvoiceNumber: draft.supplierInvoiceNumber?.trim() || undefined,
    items,
    subtotal,
    discountAmount,
    taxAmount: 0,
    totalAmount: money(subtotal - discountAmount),
    status: existing?.status ?? 'draft',
    purchaseDate: draft.purchaseDate,
    expectedDeliveryDate: draft.expectedDeliveryDate || undefined,
    notes: draft.notes?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    confirmedAt: existing?.confirmedAt,
  }
}

export async function fetchPurchases(): Promise<Purchase[]> {
  if (!isExplicitDemo()) {
    const res = await apiClient.get<{ items: WorkerPurchaseDTO[] } | WorkerPurchaseDTO[]>('/purchases?limit=100')
    const list = Array.isArray(res) ? res : res.items || []
    const mapped = list.map(mapWorkerPurchaseToPurchase)
    purchases = mapped
    return mapped.map(copyPurchase)
  }
  return getPurchases()
}

export function getPurchases() {
  return purchases
    .map(copyPurchase)
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))
}

export async function fetchPurchaseById(purchaseId: string): Promise<Purchase | undefined> {
  if (!isExplicitDemo()) {
    try {
      const dto = await apiClient.get<WorkerPurchaseDTO>(`/purchases/${purchaseId}`)
      return mapWorkerPurchaseToPurchase(dto)
    } catch {
      return undefined
    }
  }
  return getPurchaseById(purchaseId)
}

export function getPurchaseById(purchaseId: string) {
  const purchase = purchases.find((p) => p.id === purchaseId)
  return purchase ? copyPurchase(purchase) : undefined
}

export function getGoodsReceipts(purchaseId?: string) {
  return receipts
    .filter((r) => !purchaseId || r.purchaseId === purchaseId)
    .map(copyReceipt)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

export function getGoodsReceiptById(receiptId: string) {
  const receipt = receipts.find((r) => r.id === receiptId)
  return receipt ? copyReceipt(receipt) : undefined
}

export async function createPurchaseDraft(draft: PurchaseDraft): Promise<Purchase> {
  if (!isExplicitDemo()) {
    const payload = {
      supplierId: draft.supplierId,
      supplierInvoiceNumber: draft.supplierInvoiceNumber?.trim() || undefined,
      purchaseDate: draft.purchaseDate,
      expectedDeliveryDate: draft.expectedDeliveryDate || undefined,
      discountMinor: Math.round((draft.discountAmount ?? 0) * 100),
      notes: draft.notes?.trim() || undefined,
      items: draft.items.map((item) => ({
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        unitCostMinor: Math.round(item.unitCost * 100),
        discountMinor: Math.round((item.discountAmount ?? 0) * 100),
      })),
    }
    const dto = await apiClient.post<WorkerPurchaseDTO>('/purchases', payload)
    const created = mapWorkerPurchaseToPurchase(dto)
    purchases = [created, ...purchases.filter((p) => p.id !== created.id)]
    save()
    return copyPurchase(created)
  }

  const purchase = await buildPurchase({ ...draft, taxAmount: 0 })
  purchases = [purchase, ...purchases]
  save()
  return copyPurchase(purchase)
}

export async function updatePurchaseDraft(purchaseId: string, draft: PurchaseDraft): Promise<Purchase> {
  const existing = find(purchaseId)
  if (existing.status !== 'draft') throw new Error('Only draft purchases can be edited.')

  if (!isExplicitDemo()) {
    const payload = {
      supplierId: draft.supplierId,
      supplierInvoiceNumber: draft.supplierInvoiceNumber?.trim() || undefined,
      purchaseDate: draft.purchaseDate,
      expectedDeliveryDate: draft.expectedDeliveryDate || undefined,
      discountMinor: Math.round((draft.discountAmount ?? 0) * 100),
      notes: draft.notes?.trim() || undefined,
      items: draft.items.map((item) => ({
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        unitCostMinor: Math.round(item.unitCost * 100),
        discountMinor: Math.round((item.discountAmount ?? 0) * 100),
      })),
    }
    const dto = await apiClient.patch<WorkerPurchaseDTO>(`/purchases/${purchaseId}`, payload)
    const updated = mapWorkerPurchaseToPurchase(dto)
    purchases = purchases.map((p) => (p.id === purchaseId ? updated : p))
    save()
    return copyPurchase(updated)
  }

  const updated = await buildPurchase({ ...draft, taxAmount: 0 }, existing)
  purchases = purchases.map((p) => (p.id === purchaseId ? updated : p))
  save()
  return copyPurchase(updated)
}

export async function confirmPurchase(purchaseId: string): Promise<Purchase> {
  if (!isExplicitDemo()) {
    const dto = await apiClient.post<WorkerPurchaseDTO>(`/purchases/${purchaseId}/confirm`)
    const updated = mapWorkerPurchaseToPurchase(dto)
    purchases = purchases.map((p) => (p.id === purchaseId ? updated : p))
    save()
    return copyPurchase(updated)
  }

  const existing = find(purchaseId)
  if (existing.status !== 'draft') throw new Error('Only draft purchases can be confirmed.')
  const confirmed: Purchase = {
    ...existing,
    status: 'ordered',
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  purchases = purchases.map((p) => (p.id === purchaseId ? confirmed : p))
  save()
  return copyPurchase(confirmed)
}

export async function cancelPurchase(purchaseId: string): Promise<Purchase> {
  if (!isExplicitDemo()) {
    const dto = await apiClient.post<WorkerPurchaseDTO>(`/purchases/${purchaseId}/cancel`)
    const updated = mapWorkerPurchaseToPurchase(dto)
    purchases = purchases.map((p) => (p.id === purchaseId ? updated : p))
    save()
    return copyPurchase(updated)
  }

  const existing = find(purchaseId)
  if (!['draft', 'ordered'].includes(existing.status)) throw new Error('Received purchases cannot be cancelled.')
  const cancelled: Purchase = { ...existing, status: 'cancelled', updatedAt: new Date().toISOString() }
  purchases = purchases.map((p) => (p.id === purchaseId ? cancelled : p))
  save()
  return copyPurchase(cancelled)
}

export async function createGoodsReceipt(
  purchaseId: string,
  quantities: Record<string, number>,
  notes = '',
  requestId?: string
): Promise<GoodsReceipt> {
  const previousReceipt = requestId ? receipts.find((r) => r.requestId === requestId) : undefined
  if (previousReceipt) return copyReceipt(previousReceipt)

  if (!isExplicitDemo()) {
    const purchase = find(purchaseId)
    const lines = purchase.items
      .map((item) => ({ item, received: quantities[item.id] ?? 0 }))
      .filter((line) => line.received > 0)
    if (!lines.length) throw new Error('Enter a quantity for at least one purchase item.')

    const payload = {
      notes: notes.trim() || undefined,
      items: lines.map(({ item, received }) => ({
        purchaseItemId: item.id,
        productId: item.productId,
        quantityReceived: received,
      })),
    }

    const dto = await apiClient.post<any>(`/purchases/${purchaseId}/receipts`, payload)
    const receipt: GoodsReceipt = {
      id: dto.id || requestId || id(),
      requestId: requestId || dto.id || id(),
      receiptNumber: dto.receiptNumber || `GR-${new Date().getFullYear()}-${id().slice(-8).toUpperCase()}`,
      purchaseId,
      supplierId: purchase.supplierId,
      supplierSnapshot: { ...purchase.supplierSnapshot },
      items: lines.map(({ item, received }) => ({
        purchaseItemId: item.id,
        productId: item.productId,
        productSnapshot: { name: item.productSnapshot.name, sku: item.productSnapshot.sku, unit: item.productSnapshot.unit },
        quantityReceived: received,
      })),
      receivedAt: dto.receivedAt || new Date().toISOString(),
      receivedBy: 'Ayesha Khan',
      notes: notes.trim() || undefined,
    }
    receipts = [receipt, ...receipts]
    save()
    return copyReceipt(receipt)
  }

  const purchase = find(purchaseId)
  if (!['ordered', 'partially_received'].includes(purchase.status))
    throw new Error('Only confirmed purchases can receive goods.')
  const lines = purchase.items
    .map((item) => ({ item, received: quantities[item.id] ?? 0 }))
    .filter((line) => line.received > 0)
  if (!lines.length) throw new Error('Enter a quantity for at least one purchase item.')
  for (const { item, received } of lines) {
    const remaining = item.orderedQuantity - item.receivedQuantity
    if (!Number.isFinite(received) || received < 0 || received > remaining)
      throw new Error(`${item.productSnapshot.name} can receive up to ${remaining} ${item.productSnapshot.unit}.`)
  }
  const receiptId = requestId || id()
  const receiptNumber = `GR-${new Date().getFullYear()}-${receiptId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`
  const catalog = await productService.getProducts()
  const stockChanges = []
  for (const { item, received } of lines) {
    const current = catalog.find((product) => product.id === item.productId)
    if (!current) throw new Error(`Product ${item.productSnapshot.name} is no longer available.`)
    if (current.trackInventory && current.status !== 'active')
      throw new Error(`${current.name} must be reactivated before stock can be received.`)
    if (current.trackInventory)
      stockChanges.push({
        product: {
          ...current,
          name: item.productSnapshot.name,
          sku: item.productSnapshot.sku,
          unit: item.productSnapshot.unit,
        },
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: received,
          unitCost: item.unitCost,
          referenceType: 'purchase' as const,
          referenceId: receiptId,
          referenceNumber: receiptNumber,
          reason: `Goods received for ${purchase.purchaseNumber}`,
          notes: notes.trim() || undefined,
        },
      })
  }
  const receipt: GoodsReceipt = {
    id: receiptId,
    requestId: requestId || id(),
    receiptNumber,
    purchaseId,
    supplierId: purchase.supplierId,
    supplierSnapshot: { ...purchase.supplierSnapshot },
    items: lines.map(({ item, received }) => ({
      purchaseItemId: item.id,
      productId: item.productId,
      productSnapshot: { name: item.productSnapshot.name, sku: item.productSnapshot.sku, unit: item.productSnapshot.unit },
      quantityReceived: received,
    })),
    receivedAt: new Date().toISOString(),
    receivedBy: 'Ayesha Khan',
    notes: notes.trim() || undefined,
  }
  recordStockChanges(stockChanges)
  const newItems = purchase.items.map((item) => ({
    ...item,
    receivedQuantity: money(item.receivedQuantity + (quantities[item.id] ?? 0)),
  }))
  const complete = newItems.every((item) => item.receivedQuantity >= item.orderedQuantity)
  const hasReceived = newItems.some((item) => item.receivedQuantity > 0)
  const updated: Purchase = {
    ...purchase,
    items: newItems,
    status: complete ? 'received' : hasReceived ? 'partially_received' : purchase.status,
    updatedAt: receipt.receivedAt,
  }
  receipts = [receipt, ...receipts]
  purchases = purchases.map((p) => (p.id === purchaseId ? updated : p))
  save()
  return copyReceipt(receipt)
}

export function getPurchaseStockPreview(purchaseId: string) {
  const purchase = getPurchaseById(purchaseId)
  return (
    purchase?.items.map((item) => ({
      ...item,
      currentStock: getProductStock(item.productId),
      remainingQuantity: Math.max(0, item.orderedQuantity - item.receivedQuantity),
    })) ?? []
  )
}

export function getPurchaseStatistics() {
  const confirmed = purchases.filter((p) => !['draft', 'cancelled'].includes(p.status))
  return {
    totalAmount: money(confirmed.reduce((sum, p) => sum + p.totalAmount, 0)),
    transactions: confirmed.length,
    pendingReceipts: confirmed.filter((p) => p.status === 'ordered' || p.status === 'partially_received').length,
    totalPurchases: purchases.length,
    drafts: purchases.filter((p) => p.status === 'draft').length,
    confirmed: confirmed.length,
    partiallyReceived: purchases.filter((p) => p.status === 'partially_received').length,
    received: purchases.filter((p) => p.status === 'received').length,
    cancelled: purchases.filter((p) => p.status === 'cancelled').length,
    totalValue: money(confirmed.reduce((sum, p) => sum + p.totalAmount, 0)),
  }
}

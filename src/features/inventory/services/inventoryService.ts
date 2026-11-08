import type { Product } from '../../products/types/product.types'
import { money } from '../../pos/utils/checkoutCalculations'
import type { StockMovement, StockMovementInput, StockMovementType } from '../types/inventory.types'
import type { StockCountDraft } from '../types/inventory.types'

const BALANCES_KEY = 'northstar.inventory-balances.v1'
const MOVEMENTS_KEY = 'northstar.inventory-movements.v1'
const COUNTS_KEY = 'northstar.inventory-counts.v1'
type Snapshot = Pick<Product, 'id' | 'name' | 'sku' | 'unit' | 'status' | 'trackInventory' | 'stockQuantity' | 'updatedAt'>
type MovementInput = Omit<StockMovementInput, 'type'> & { type: StockMovementType }
type Change = { product: Snapshot; input: StockMovementInput }
let balances: Record<string, number> = read<Record<string, number>>(BALANCES_KEY, {})
let movements: StockMovement[] = read<StockMovement[]>(MOVEMENTS_KEY, [])
let counts: StockCountDraft[] = read<StockCountDraft[]>(COUNTS_KEY, [])

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}
function persist() {
  try { localStorage.setItem(BALANCES_KEY, JSON.stringify(balances)); localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(movements)); localStorage.setItem(COUNTS_KEY, JSON.stringify(counts)) } catch { /* The in-memory repository remains usable when browser storage is unavailable. */ }
}
function quantity(value: number) { return Math.round((value + Number.EPSILON) * 1000) / 1000 }
function createId() { return globalThis.crypto?.randomUUID?.() ?? `stock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function makeMovement(product: Snapshot, change: MovementInput, previous: number, createdAt: string): StockMovement {
  const id = change.movementId ?? createId()
  const suffix = id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  return {
    id, movementNumber: `MOV-${Date.now().toString().slice(-8)}-${suffix}`, productId: product.id,
    productSnapshot: { name: product.name, sku: product.sku, unit: product.unit }, type: change.type,
    quantityChange: quantity(change.quantityChange), previousQuantity: previous, newQuantity: quantity(previous + change.quantityChange),
    unitCost: change.unitCost === undefined ? undefined : money(change.unitCost), referenceType: change.referenceType,
    referenceId: change.referenceId, referenceNumber: change.referenceNumber, reason: change.reason, notes: change.notes,
    createdAt, createdBy: change.createdBy ?? 'Ayesha Khan',
  }
}

function commit(changes: Change[]) {
  if (!changes.length) return []
  const idempotent = changes.every(({ product, input }) => input.referenceId && movements.some(m => m.productId === product.id && m.referenceId === input.referenceId && m.type === input.type))
  if (idempotent) return changes.map(({ product, input }) => movements.find(m => m.productId === product.id && m.referenceId === input.referenceId && m.type === input.type)).filter((m): m is StockMovement => Boolean(m))
  const proposed = new Map<string, number>()
  for (const { product, input } of changes) {
    if (!product.trackInventory) throw new Error(`${product.name} is not inventory tracked.`)
    if (product.status !== 'active') throw new Error(`${product.name} is archived and cannot have stock changed.`)
    if (!Number.isFinite(input.quantityChange) || input.quantityChange === 0) throw new Error('A stock movement must have a valid non-zero quantity.')
    const current = proposed.get(product.id) ?? balances[product.id] ?? quantity(product.stockQuantity)
    const next = quantity(current + input.quantityChange)
    if (next < 0) throw new Error(`${product.name} does not have enough stock.`)
    proposed.set(product.id, next)
  }
  const createdAt = new Date().toISOString()
  const prior = new Map<string, number>()
  const batch = changes.map(({ product, input }) => {
    const previous = prior.has(product.id) ? prior.get(product.id)! : balances[product.id] ?? quantity(product.stockQuantity)
    prior.set(product.id, quantity(previous + input.quantityChange))
    return makeMovement(product, input, previous, createdAt)
  })
  balances = { ...balances, ...Object.fromEntries(proposed) }
  movements = [...batch, ...movements]
  persist()
  return batch.map(copyMovement)
}
function copyMovement(movement: StockMovement): StockMovement { return { ...movement, productSnapshot: { ...movement.productSnapshot } } }

/** Seeds only absent balances. Existing product quantities become one opening movement and are never reset. */
export function initializeInventory(products: Snapshot[]) {
  let changed = false
  for (const product of products) {
    if (balances[product.id] !== undefined) continue
    const startingQuantity = product.trackInventory ? quantity(product.stockQuantity) : 0
    balances[product.id] = startingQuantity
    changed = true
    if (product.trackInventory && startingQuantity > 0 && !movements.some(m => m.productId === product.id && m.type === 'opening_stock')) {
      const input: MovementInput = { type: 'opening_stock', quantityChange: startingQuantity, referenceType: 'opening_stock', referenceNumber: 'OPENING', movementId: `opening-${product.id}`, reason: 'Opening stock' }
      movements.unshift(makeMovement(product, input, 0, product.updatedAt))
    }
  }
  if (changed) persist()
}

export function initializeProduct(product: Snapshot) {
  if (balances[product.id] !== undefined) return
  initializeInventory([product])
}
export function getProductStock(productId: string) { return balances[productId] ?? 0 }
export function getInventoryMovements() { return movements.map(copyMovement).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) }
export function getInventoryMovement(id: string) { const found = movements.find(m => m.id === id); return found ? copyMovement(found) : undefined }
export function getProductMovements(productId: string) { return getInventoryMovements().filter(m => m.productId === productId) }
export function recordStockChanges(changes: Change[]) { return commit(changes) }
export function recordStockAdjustment(product: Snapshot, input: StockMovementInput) { return commit([{ product, input }])[0] }
export function recordSaleStockMovements(items: Array<{ product: Snapshot; quantity: number }>, sale: { id: string; number: string }) {
  const grouped = new Map<string, { product: Snapshot; quantity: number }>()
  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Sale quantities must be greater than zero.')
    const previous = grouped.get(item.product.id)
    grouped.set(item.product.id, { product: item.product, quantity: quantity((previous?.quantity ?? 0) + item.quantity) })
  }
  return commit([...grouped.values()].filter(({ product }) => product.trackInventory).map(({ product, quantity: amount }) => ({ product, input: { type: 'sale', quantityChange: -amount, referenceType: 'sale', referenceId: sale.id, referenceNumber: sale.number, reason: 'POS sale' } })) )
}
export function getInventoryStatistics(products: Product[]) {
  const tracked = products.filter(product => product.trackInventory)
  const lowStock = tracked.filter(product => product.status === 'active' && getProductStock(product.id) > 0 && getProductStock(product.id) <= product.lowStockThreshold)
  const outOfStock = tracked.filter(product => product.status === 'active' && getProductStock(product.id) === 0)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentMovements = getInventoryMovements().filter(movement => new Date(movement.createdAt).getTime() >= cutoff)
  return {
    productCount: tracked.length,
    totalUnits: quantity(tracked.reduce((sum, product) => sum + getProductStock(product.id), 0)),
    estimatedCostValue: money(tracked.reduce((sum, product) => sum + getProductStock(product.id) * product.purchasePrice, 0)),
    lowStockCount: lowStock.length, outOfStockCount: outOfStock.length, movementCount: recentMovements.length,
  }
}
export function getLowStockProducts(products: Product[]) { return products.filter(product => product.status === 'active' && product.trackInventory && getProductStock(product.id) > 0 && getProductStock(product.id) <= product.lowStockThreshold) }
export function getStockCounts() { return counts.map(count => ({ ...count, rows: count.rows.map(row => ({ ...row })) })) }
export function getStockCount(id: string) { const count = counts.find(item => item.id === id); return count ? { ...count, rows: count.rows.map(row => ({ ...row })) } : undefined }
export function saveStockCountDraft(draft: StockCountDraft) {
  if (draft.status !== 'draft') throw new Error('A confirmed stock count cannot be edited.')
  counts = [draft, ...counts.filter(item => item.id !== draft.id)]; persist(); return getStockCount(draft.id)!
}
export function confirmStockCount(countId: string, physicalCounts: Record<string, number>) {
  const count = counts.find(item => item.id === countId)
  if (!count) throw new Error('Save this stock count before confirming it.')
  if (count.status !== 'draft') throw new Error('This stock count has already been confirmed.')
  const changes: Change[] = []
  for (const row of count.rows) {
    const physical = physicalCounts[row.productId]
    if (!Number.isFinite(physical) || physical < 0) throw new Error(`Enter a valid physical count for ${row.productName}.`)
    const current = balances[row.productId] ?? row.systemQuantity
    if (current !== row.systemQuantity) throw new Error(`Stock changed for ${row.productName} after this count started. Start a new count before confirming.`)
    const variance = quantity(physical - row.systemQuantity)
    if (!variance) continue
    const snapshot: Snapshot = { id: row.productId, name: row.productName, sku: row.sku, unit: row.unit, status: 'active', trackInventory: true, stockQuantity: current, updatedAt: count.createdAt }
    changes.push({ product: snapshot, input: { type: 'stock_count_adjustment', quantityChange: variance, referenceType: 'stock_count', referenceId: countId, referenceNumber: count.name, movementId: `count-${countId}-${row.productId}`, reason: 'Physical stock count' } })
  }
  commit(changes)
  const confirmed = { ...count, status: 'confirmed' as const, confirmedAt: new Date().toISOString(), rows: count.rows.map(row => ({ ...row, physicalQuantity: physicalCounts[row.productId], systemQuantity: row.systemQuantity })) }
  counts = counts.map(item => item.id === countId ? confirmed : item); persist()
  return getStockCount(countId)!
}

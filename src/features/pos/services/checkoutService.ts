import { customerService } from '../../customers/services/customerService'
import { productService } from '../../products/services/productService'
import { apiClient } from '../../../lib/api-client'
import type { ProductUnit } from '../../products/types/product.types'
import type { CheckoutSale, CheckoutMethod, SalePayment, SaleItemSnapshot } from '../types/checkout.types'
import { discountAmount, money, orderTotal } from '../utils/checkoutCalculations'

const SALES_STORAGE_KEY = 'northstar.completed-sales.v1'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

function loadSales(): CheckoutSale[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const value = JSON.parse(localStorage.getItem(SALES_STORAGE_KEY) ?? '[]') as CheckoutSale[]
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

let sales: CheckoutSale[] = loadSales()

function persistSales() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(sales))
  } catch {
    /* Keep the in-memory mock repository usable if storage is unavailable. */
  }
}

export function getSales(): CheckoutSale[] {
  return sales.map((s) => ({
    ...s,
    items: s.items.map((i) => ({ ...i })),
    payments: s.payments.map((p) => ({ ...p })),
    businessSnapshot: { ...s.businessSnapshot },
  }))
}

export function getSaleById(id: string): CheckoutSale | undefined {
  return getSales().find((s) => s.id === id)
}

export function getSaleByInvoiceNumber(invoiceNumber: string): CheckoutSale | undefined {
  return getSales().find((s) => s.invoiceNumber === invoiceNumber)
}

export function getReceiptById(id: string): CheckoutSale | undefined {
  const sale = sales.find((s) => s.id === id)
  return sale
    ? {
        ...sale,
        items: sale.items.map((x) => ({ ...x })),
        payments: sale.payments.map((x) => ({ ...x })),
      }
    : undefined
}

export async function validateCheckout(
  quantities: Record<string, number>,
  customerId: string,
  discountType: 'fixed' | 'percent',
  discountValue: number,
  payments: SalePayment[]
) {
  const productIds = Object.keys(quantities).filter((id) => quantities[id] > 0)
  if (!productIds.length) throw new Error('Add at least one item to the cart.')

  const [all, customer] = await Promise.all([
    productService.getProducts(),
    customerService.getCustomerById(customerId),
  ])

  if (!customer || (!customer.isWalkIn && customer.status !== 'active')) {
    throw new Error('Select an active customer.')
  }

  const products = productIds.map((id) => {
    const p = all.find((x) => x.id === id)
    if (!p || p.status !== 'active') {
      throw new Error('A cart product is no longer available. Remove it and try again.')
    }
    const q = quantities[id]
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error(`Enter a valid quantity for ${p.name}.`)
    }
    if (p.trackInventory && q > p.stockQuantity) {
      throw new Error(`${p.name} only has ${p.stockQuantity} ${p.unit} in stock.`)
    }
    return p
  })

  const sub = money(products.reduce((sum, p) => sum + p.sellingPrice * quantities[p.id], 0))
  const discount = discountAmount(sub, discountType, discountValue)
  const total = orderTotal(sub, discount)

  if (payments.some((p) => !Number.isFinite(p.amount) || p.amount < 0)) {
    throw new Error('Payment amounts must be zero or more.')
  }

  const credit = money(payments.filter((p) => p.method === 'credit').reduce((sum, p) => sum + p.amount, 0))
  if (credit > 0 && customer.isWalkIn) {
    throw new Error('Walk-in Customer cannot use credit.')
  }

  const cash = money(payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0))
  const nonCash = money(
    payments.filter((p) => p.method !== 'cash' && p.method !== 'credit').reduce((sum, p) => sum + p.amount, 0)
  )

  if (nonCash + credit > total) {
    throw new Error('Non-cash payments and credit cannot exceed the total.')
  }

  const cashApplied = Math.min(cash, total - nonCash - credit)
  const remaining = money(total - nonCash - cashApplied)

  if (Math.abs(remaining - credit) > 0.01) {
    throw new Error('Payment does not cover the total or credit does not match the remaining balance.')
  }

  return {
    products,
    customer,
    subtotal: sub,
    discount,
    total,
    paid: money(nonCash + cashApplied),
    remaining,
    change: money(cash - cashApplied),
  }
}

interface WorkerSaleDTO {
  id: string
  businessId: string
  branchId: string
  saleNumber: string
  receiptNumber: string
  invoiceNumber: string
  customerId: string
  customerSnapshot?: {
    name?: string
    customerCode?: string
    phone?: string | null
    address?: string | null
    city?: string | null
    isWalkIn?: boolean
  }
  terminalId?: string
  cashierName?: string
  subtotalMinor: number
  discountType: 'fixed' | 'percent'
  discountValue: number
  discountMinor: number
  totalAmountMinor: number
  amountPaidMinor: number
  remainingBalanceMinor: number
  changeReturnedMinor: number
  status: string
  createdAt: string
  items: Array<{
    productId: string
    productName: string
    sku: string
    unit: string
    unitPriceMinor: number
    quantity: number
    lineTotalMinor: number
  }>
  payments?: Array<{
    method: string
    amountMinor: number
    reference?: string | null
  }>
}

function mapSaleDtoToCheckoutSale(dto: WorkerSaleDTO, fallbackCustomer: { name: string; customerCode?: string; phone?: string; address?: string }): CheckoutSale {
  const items: SaleItemSnapshot[] = (dto.items || []).map((item) => ({
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    unit: (item.unit as ProductUnit) || 'piece',
    unitPrice: item.unitPriceMinor / 100,
    quantity: item.quantity,
    lineTotal: item.lineTotalMinor / 100,
  }))

  const payments: SalePayment[] = (dto.payments || []).map((p) => ({
    method: (p.method === 'bank_transfer' ? 'bank-transfer' : p.method) as CheckoutMethod,
    amount: p.amountMinor / 100,
    reference: p.reference ?? undefined,
  }))

  return {
    id: dto.id,
    saleNumber: dto.saleNumber,
    receiptNumber: dto.receiptNumber,
    invoiceNumber: dto.invoiceNumber,
    customerId: dto.customerId,
    customerName: dto.customerSnapshot?.name || fallbackCustomer.name || 'Walk-in Customer',
    customerCode: dto.customerSnapshot?.customerCode || fallbackCustomer.customerCode,
    customerPhone: dto.customerSnapshot?.phone ?? fallbackCustomer.phone ?? undefined,
    customerAddress: [dto.customerSnapshot?.address, dto.customerSnapshot?.city].filter(Boolean).join(', ') || fallbackCustomer.address || undefined,
    cashierName: dto.cashierName || 'Cashier',
    businessSnapshot: {
      name: 'Northstar Market',
      address: 'Business address · Lahore',
      phone: 'Business phone',
      email: 'Business email',
    },
    items,
    subtotal: dto.subtotalMinor / 100,
    discountType: dto.discountType,
    discountValue: dto.discountValue,
    discountAmount: dto.discountMinor / 100,
    totalAmount: dto.totalAmountMinor / 100,
    payments,
    amountPaid: dto.amountPaidMinor / 100,
    remainingBalance: dto.remainingBalanceMinor / 100,
    changeReturned: dto.changeReturnedMinor / 100,
    createdAt: dto.createdAt,
    status: 'completed',
  }
}

let checkoutInProgress = false

export async function completeCheckout(
  quantities: Record<string, number>,
  customerId: string,
  discountType: 'fixed' | 'percent',
  discountValue: number,
  payments: SalePayment[]
): Promise<CheckoutSale> {
  if (checkoutInProgress) {
    throw new Error('A checkout is already being completed.')
  }
  checkoutInProgress = true

  try {
    const valid = await validateCheckout(quantities, customerId, discountType, discountValue, payments)

    if (!isExplicitDemo()) {
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `pos-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

      const salePayload = {
        customerId: valid.customer.isWalkIn || customerId === 'walk-in' ? undefined : valid.customer.id,
        items: valid.products.map((p) => ({
          productId: p.id,
          quantity: quantities[p.id],
          unitPriceMinor: Math.round(p.sellingPrice * 100),
        })),
        discountType,
        discountValue,
        payments: payments.map((p) => ({
          method: p.method === 'bank-transfer' ? 'bank_transfer' : p.method,
          amountMinor: Math.round(p.amount * 100),
          reference: p.reference ?? undefined,
        })),
      }

      const createdDto = await apiClient.post<WorkerSaleDTO>('/sales', salePayload, {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      })

      const completedSale = mapSaleDtoToCheckoutSale(createdDto, valid.customer)
      sales = [completedSale, ...sales.filter((s) => s.id !== completedSale.id)]
      persistSales()
      return completedSale
    }

    // Demo / mock execution
    const timestamp = Date.now()
    const id = globalThis.crypto?.randomUUID?.() ?? `sale-${timestamp}`
    const suffix = id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()
    const receiptNumber = `RCP-${timestamp.toString().slice(-8)}-${suffix}`
    const saleNumber = `SALE-${timestamp.toString().slice(-8)}-${suffix}`

    await productService.deductStockForSale(
      valid.products.map((p) => ({ productId: p.id, quantity: quantities[p.id] })),
      { id, number: saleNumber }
    )

    const items: SaleItemSnapshot[] = valid.products.map((p) => ({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      unit: p.unit,
      unitPrice: p.sellingPrice,
      quantity: quantities[p.id],
      lineTotal: money(p.sellingPrice * quantities[p.id]),
    }))

    const sale: CheckoutSale = {
      id,
      saleNumber,
      receiptNumber,
      invoiceNumber: `INV-${new Date(timestamp).getFullYear()}-${timestamp.toString().slice(-8)}-${suffix}`,
      customerId: valid.customer.id,
      customerName: valid.customer.name,
      customerCode: valid.customer.customerCode,
      customerPhone: valid.customer.phone,
      customerAddress: [valid.customer.address, valid.customer.city].filter(Boolean).join(', ') || undefined,
      cashierName: 'Ayesha Khan',
      businessSnapshot: {
        name: 'Northstar Market',
        address: 'Business address · Lahore',
        phone: 'Business phone',
        email: 'Business email',
      },
      items,
      subtotal: valid.subtotal,
      discountType,
      discountValue,
      discountAmount: valid.discount,
      totalAmount: valid.total,
      payments: payments.map((p) => ({ ...p })),
      amountPaid: valid.paid,
      remainingBalance: valid.remaining,
      changeReturned: valid.change,
      createdAt: new Date(timestamp).toISOString(),
      status: 'completed',
    }

    sales = [sale, ...sales]
    persistSales()
    return {
      ...sale,
      items: sale.items.map((x) => ({ ...x })),
      payments: sale.payments.map((x) => ({ ...x })),
      businessSnapshot: { ...sale.businessSnapshot },
    }
  } finally {
    checkoutInProgress = false
  }
}

export async function completeOfflineCheckout(params: {
  quantities: Record<string, number>
  cashTendered: number
  userId: string
  businessId: string
  branchId: string
  deviceId: string
  authorizationId: string
}): Promise<CheckoutSale> {
  const { quantities, cashTendered, userId, businessId, branchId, deviceId, authorizationId } = params

  const { offlineSalesService } = await import('../../../lib/offline/sales/offlineSales.service')
  const { offlineSalesRepository } = await import('../../../lib/offline/sales/offlineSales.repository')

  const allocs = await offlineSalesRepository.getAllocationsForAuth(authorizationId)
  const allocMap = new Map<string, (typeof allocs)[0]>()
  for (const a of allocs) {
    allocMap.set(a.productId, a)
  }

  const items = Object.keys(quantities)
    .filter((id) => quantities[id] > 0)
    .map((productId) => {
      const alloc = allocMap.get(productId)
      if (!alloc) {
        throw new Error(`Product '${productId}' is not in the active offline allocation.`)
      }
      const qty = quantities[productId]
      const subtotalMinor = Math.round(qty * alloc.sellingPriceMinor)
      return {
        productId,
        name: alloc.name,
        sku: alloc.sku,
        unit: alloc.unit,
        quantity: qty,
        unitPriceMinor: alloc.sellingPriceMinor,
        subtotalMinor,
        lineTotalMinor: subtotalMinor,
        allocationId: alloc.id,
      }
    })

  const cashTenderedMinor = Math.round(cashTendered * 100)

  const result = await offlineSalesService.recordOfflineSale({
    userId,
    businessId,
    branchId,
    deviceId,
    authorizationId,
    items,
    cashTenderedMinor,
  })

  return {
    id: result.provisionalSaleId,
    saleNumber: result.provisionalReceiptNumber,
    receiptNumber: result.provisionalReceiptNumber,
    invoiceNumber: 'PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE',
    customerId: 'walk-in',
    customerName: 'Walk-in Customer (Offline)',
    cashierName: 'Offline Terminal',
    businessSnapshot: {
      name: 'Northstar Market',
      address: 'Business address · Lahore',
      phone: 'Business phone',
      email: 'Business email',
    },
    items: items.map((i) => ({
      productId: i.productId,
      productName: i.name,
      sku: i.sku,
      unit: (i.unit as ProductUnit) || 'piece',
      unitPrice: i.unitPriceMinor / 100,
      quantity: i.quantity,
      lineTotal: i.lineTotalMinor / 100,
    })),
    subtotal: result.totalAmountMinor / 100,
    discountType: 'fixed',
    discountValue: 0,
    discountAmount: 0,
    totalAmount: result.totalAmountMinor / 100,
    payments: [{ method: 'cash', amount: cashTendered }],
    amountPaid: cashTendered,
    remainingBalance: 0,
    changeReturned: result.changeReturnedMinor / 100,
    createdAt: result.createdAt,
    status: 'completed',
  }
}

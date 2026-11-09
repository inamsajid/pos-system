import type {
  CanonicalProduct,
  CanonicalCustomer,
  CanonicalSupplier,
  CanonicalSale,
  CanonicalInvoice,
  CanonicalCustomerPayment,
  CanonicalPurchase,
  CanonicalStockMovement,
  CanonicalCustomerLedgerEntry,
  CanonicalSupplierLedgerEntry,
  CanonicalSaleReturn,
} from './models'

export interface IProductRepository {
  findById(id: string): Promise<CanonicalProduct | null>
  findBySku(sku: string): Promise<CanonicalProduct | null>
  findByBarcode(barcode: string): Promise<CanonicalProduct | null>
  findAll(filter?: { categoryId?: string; status?: CanonicalProduct['status'] }): Promise<CanonicalProduct[]>
  save(product: CanonicalProduct): Promise<void>
  updateStockAndCost(
    productId: string,
    quantityDelta: number,
    newAverageCostMinor?: number
  ): Promise<void>
}

export interface ICustomerRepository {
  findById(id: string): Promise<CanonicalCustomer | null>
  findByCode(customerCode: string): Promise<CanonicalCustomer | null>
  findAll(filter?: { status?: CanonicalCustomer['status']; search?: string }): Promise<CanonicalCustomer[]>
  save(customer: CanonicalCustomer): Promise<void>
}

export interface ISupplierRepository {
  findById(id: string): Promise<CanonicalSupplier | null>
  findByCode(supplierCode: string): Promise<CanonicalSupplier | null>
  findAll(filter?: { status?: CanonicalSupplier['status'] }): Promise<CanonicalSupplier[]>
  save(supplier: CanonicalSupplier): Promise<void>
}

export interface ISalesRepository {
  findById(id: string): Promise<CanonicalSale | null>
  findBySaleNumber(saleNumber: string): Promise<CanonicalSale | null>
  findByInvoiceNumber(invoiceNumber: string): Promise<CanonicalSale | null>
  findAll(filter?: {
    customerId?: string
    startDateKey?: string
    endDateKey?: string
    status?: CanonicalSale['status']
  }): Promise<CanonicalSale[]>
  save(sale: CanonicalSale): Promise<void>
  updateStatus(saleId: string, status: CanonicalSale['status']): Promise<void>
}

export interface IInvoiceRepository {
  findById(id: string): Promise<CanonicalInvoice | null>
  findByInvoiceNumber(invoiceNumber: string): Promise<CanonicalInvoice | null>
  findBySaleId(saleId: string): Promise<CanonicalInvoice | null>
  save(invoice: CanonicalInvoice): Promise<void>
  updatePayment(invoiceId: string, paidDeltaMinor: number): Promise<void>
}

export interface IPaymentRepository {
  findById(id: string): Promise<CanonicalCustomerPayment | null>
  findByReceiptNumber(receiptNumber: string): Promise<CanonicalCustomerPayment | null>
  findByCustomerId(customerId: string): Promise<CanonicalCustomerPayment[]>
  save(payment: CanonicalCustomerPayment): Promise<void>
}

export interface IPurchaseRepository {
  findById(id: string): Promise<CanonicalPurchase | null>
  findByPurchaseNumber(purchaseNumber: string): Promise<CanonicalPurchase | null>
  findAll(filter?: {
    supplierId?: string
    startDateKey?: string
    endDateKey?: string
    status?: CanonicalPurchase['status']
  }): Promise<CanonicalPurchase[]>
  save(purchase: CanonicalPurchase): Promise<void>
  updateStatus(purchaseId: string, status: CanonicalPurchase['status']): Promise<void>
}

export interface IInventoryRepository {
  recordMovement(movement: CanonicalStockMovement): Promise<void>
  getMovements(filter?: {
    productId?: string
    startDateKey?: string
    endDateKey?: string
  }): Promise<CanonicalStockMovement[]>
  getProductBalance(productId: string): Promise<{ quantity: number; unitCostMinor: number } | null>
}

export interface ILedgerRepository {
  recordCustomerEntry(entry: CanonicalCustomerLedgerEntry): Promise<void>
  getCustomerEntries(customerId: string): Promise<CanonicalCustomerLedgerEntry[]>
  recordSupplierEntry(entry: CanonicalSupplierLedgerEntry): Promise<void>
  getSupplierEntries(supplierId: string): Promise<CanonicalSupplierLedgerEntry[]>
}

export interface ISaleReturnRepository {
  findById(id: string): Promise<CanonicalSaleReturn | null>
  findByReturnNumber(returnNumber: string): Promise<CanonicalSaleReturn | null>
  findBySaleId(saleId: string): Promise<CanonicalSaleReturn[]>
  save(saleReturn: CanonicalSaleReturn): Promise<void>
}

/**
 * Transaction Unit of Work abstraction for Cloudflare D1 / SQL engines.
 * Ensures multi-entity mutations commit atomically or roll back completely.
 */
export interface IUnitOfWork {
  executeInTransaction<T>(work: () => Promise<T>): Promise<T>
}


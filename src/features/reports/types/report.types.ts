import type { CheckoutSale } from '../../pos/types/checkout.types'
import type { Customer } from '../../customers/types/customer.types'
import type { Product } from '../../products/types/product.types'
import type { Supplier } from '../../suppliers/types/supplier.types'
import type { CustomerPayment } from '../../payments/types/payment.types'
import type { SupplierPayment } from '../../supplier-payments/types/supplierPayment.types'
import type { StockMovement } from '../../inventory/types/inventory.types'
import type { Purchase } from '../../purchases/types/purchase.types'

export type ReportPreset = 'today' | 'yesterday' | '7d' | '30d' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'this-year' | 'last-year' | 'custom'
export type ComparisonMode = 'previous-period' | 'previous-month' | 'previous-year' | 'none'
export interface DateRange { from: string; to: string }
export interface ReportFilters extends DateRange { preset: ReportPreset; comparison: ComparisonMode; productId: string; categoryId: string; customerId: string; supplierId: string; paymentMethod: string; paymentStatus: string; transactionStatus: string }
export interface ReportDataset { sales: CheckoutSale[]; products: Product[]; customers: Customer[]; suppliers: Supplier[]; payments: CustomerPayment[]; supplierPayments: SupplierPayment[]; purchases: Purchase[]; movements: StockMovement[]; categories: Array<{ id: string; name: string }> }
export interface TrendPoint { label: string; sales: number; collections: number; orders: number }
export interface ReportMetric { label: string; value: number | null; previous: number | null; format?: 'currency' | 'number' | 'percent'; note?: string; valueText?: string }

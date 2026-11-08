import { getSaleById,getSales,getSaleByInvoiceNumber } from '../../pos/services/checkoutService'
import type { CheckoutSale } from '../../pos/types/checkout.types'
export const salesService={getSales,async getSaleById(id:string){return getSaleById(id)},async getSaleByInvoiceNumber(number:string){return getSaleByInvoiceNumber(number)}}
export type SaleRecord=CheckoutSale

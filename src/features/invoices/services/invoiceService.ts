import { getSales,getSaleById,getSaleByInvoiceNumber } from '../../pos/services/checkoutService'
import type { CheckoutSale } from '../../pos/types/checkout.types'
/** Invoices are a projection of canonical completed sales, never separate transactions. */
export const invoiceService={async getInvoices():Promise<CheckoutSale[]>{return getSales()},async getInvoiceById(id:string){return getSaleById(id)},async getInvoiceByNumber(number:string){return getSaleByInvoiceNumber(number)}}

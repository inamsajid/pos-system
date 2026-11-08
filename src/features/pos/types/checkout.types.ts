import type { ProductUnit } from '../../products/types/product.types'
export type CheckoutMethod='cash'|'card'|'bank-transfer'|'credit'
export interface CartLine{productId:string;quantity:number}
export interface SaleItemSnapshot{productId:string;productName:string;sku:string;unit:ProductUnit;unitPrice:number;quantity:number;lineTotal:number}
export interface SalePayment{method:CheckoutMethod;amount:number;reference?:string}
export interface CheckoutSale{id:string;saleNumber:string;receiptNumber:string;invoiceNumber:string;customerId:string;customerName:string;customerCode?:string;customerPhone?:string;customerAddress?:string;cashierName:string;businessSnapshot:{name:string;address:string;phone:string;email:string};items:SaleItemSnapshot[];subtotal:number;discountType:'fixed'|'percent';discountValue:number;discountAmount:number;totalAmount:number;payments:SalePayment[];amountPaid:number;remainingBalance:number;changeReturned:number;createdAt:string;status:'completed'}

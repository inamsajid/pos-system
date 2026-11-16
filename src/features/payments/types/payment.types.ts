export type PaymentMethod='cash'|'card'|'bank_transfer'|'digital_wallet'|'other'
export type PaymentSource='pos_checkout'|'manual'
export interface PaymentMethodAllocation{id:string;method:PaymentMethod;amount:number;reference?:string}
export interface PaymentInvoiceAllocation{invoiceId?:string;saleId:string;invoiceNumber:string;amount:number}
export interface CustomerPayment{id:string;receiptNumber:string;customerId?:string;customerSnapshot:{name:string;customerCode?:string;phone?:string;address?:string};amount:number;methodBreakdown:PaymentMethodAllocation[];allocations:PaymentInvoiceAllocation[];unallocatedAmount:number;source:PaymentSource;receivedAt:string;receivedBy:string;notes?:string;createdAt:string}
export interface PaymentDraft{customerId:string;amount:number;receivedAt:string;methodBreakdown:PaymentMethodAllocation[];allocations:PaymentInvoiceAllocation[];keepAsAdvance:boolean;notes?:string}
export interface OutstandingInvoice{invoiceId?:string;saleId:string;invoiceNumber:string;date:string;customerId:string;customerName:string;totalAmount:number;amountPaid:number;outstanding:number}

export type CustomerStatus = 'active' | 'inactive' | 'archived'
export type CustomerType = 'individual' | 'business'
export type AccountFilter = 'clear' | 'outstanding' | 'advance'
export interface Customer { id:string; customerCode:string; name:string; phone?:string; email?:string; type:CustomerType; companyName?:string; taxNumber?:string; address?:string; city?:string; notes?:string; status:CustomerStatus; isWalkIn?:boolean; createdAt:string; updatedAt:string }
export type CustomerDraft = Omit<Customer,'id'|'customerCode'|'createdAt'|'updatedAt'|'isWalkIn'>
export interface CustomerFinancialSummary { customerId:string; totalPurchases:number; totalPaid:number; outstandingBalance:number; advanceBalance:number; lastPurchaseDate?:string; openingBalance:number; currentAccountBalance?:number }
export interface CustomerInvoice { id:string; saleId?:string; customerId:string; invoiceNumber:string; date:string; totalAmount:number; paidAmount:number; paymentStatus:'paid'|'partial'|'unpaid' }
export interface CustomerPayment { id:string; customerId:string; reference:string; date:string; method:string; amount:number; unallocatedAmount?:number; invoiceNumber:string; status:'completed'|'pending' }
export interface AccountTransaction { id:string; customerId:string; date:string; reference:string; description:string; debit:number; credit:number; balance:number }

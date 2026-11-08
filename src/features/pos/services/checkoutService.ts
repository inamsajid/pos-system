import { customerService } from '../../customers/services/customerService'
import { productService } from '../../products/services/productService'
import type { CheckoutSale,SalePayment } from '../types/checkout.types'
import { discountAmount,money,orderTotal } from '../utils/checkoutCalculations'
const SALES_STORAGE_KEY='northstar.completed-sales.v1'
function loadSales():CheckoutSale[]{try{if(typeof localStorage==='undefined')return [];const value=JSON.parse(localStorage.getItem(SALES_STORAGE_KEY)??'[]') as CheckoutSale[];return Array.isArray(value)?value:[]}catch{return []}}
let sales:CheckoutSale[]=loadSales()
function persistSales(){try{if(typeof localStorage!=='undefined')localStorage.setItem(SALES_STORAGE_KEY,JSON.stringify(sales))}catch{/* Keep the in-memory mock repository usable if storage is unavailable. */}}
export function getSales(){return sales.map(s=>({...s,items:s.items.map(i=>({...i})),payments:s.payments.map(p=>({...p})),businessSnapshot:{...s.businessSnapshot}}))}
export function getSaleById(id:string){return getSales().find(s=>s.id===id)}
export function getSaleByInvoiceNumber(invoiceNumber:string){return getSales().find(s=>s.invoiceNumber===invoiceNumber)}
export async function validateCheckout(quantities:Record<string,number>,customerId:string,discountType:'fixed'|'percent',discountValue:number,payments:SalePayment[]){
 const productIds=Object.keys(quantities).filter(id=>quantities[id]>0);if(!productIds.length)throw Error('Add at least one item to the cart.')
 const[all,customer]=await Promise.all([productService.getProducts(),customerService.getCustomerById(customerId)]);if(!customer||customer.status!=='active')throw Error('Select an active customer.')
 const products=productIds.map(id=>{const p=all.find(x=>x.id===id);if(!p||p.status!=='active')throw Error('A cart product is no longer available. Remove it and try again.');const q=quantities[id];if(!Number.isFinite(q)||q<=0)throw Error(`Enter a valid quantity for ${p.name}.`);if(p.trackInventory&&q>p.stockQuantity)throw Error(`${p.name} only has ${p.stockQuantity} ${p.unit} in stock.`);return p})
 const sub=money(products.reduce((sum,p)=>sum+p.sellingPrice*quantities[p.id],0));const discount=discountAmount(sub,discountType,discountValue);const total=orderTotal(sub,discount)
 if(payments.some(p=>!Number.isFinite(p.amount)||p.amount<0))throw Error('Payment amounts must be zero or more.')
 const credit=money(payments.filter(p=>p.method==='credit').reduce((sum,p)=>sum+p.amount,0));if(credit>0&&customer.isWalkIn)throw Error('Walk-in Customer cannot use credit.')
 const cash=money(payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+p.amount,0));const nonCash=money(payments.filter(p=>p.method!=='cash'&&p.method!=='credit').reduce((sum,p)=>sum+p.amount,0));if(nonCash+credit>total)throw Error('Non-cash payments and credit cannot exceed the total.')
 const cashApplied=Math.min(cash,total-nonCash-credit);const remaining=money(total-nonCash-cashApplied);if(Math.abs(remaining-credit)>0.01)throw Error('Payment does not cover the total or credit does not match the remaining balance.')
 return{products,customer,subtotal:sub,discount,total,paid:money(nonCash+cashApplied),remaining,change:money(cash-cashApplied)}
}
let checkoutInProgress=false
export async function completeCheckout(quantities:Record<string,number>,customerId:string,discountType:'fixed'|'percent',discountValue:number,payments:SalePayment[]){
 if(checkoutInProgress)throw Error('A checkout is already being completed.')
 checkoutInProgress=true
 try{
  const valid=await validateCheckout(quantities,customerId,discountType,discountValue,payments)
  const timestamp=Date.now();const id=globalThis.crypto?.randomUUID?.()??`sale-${timestamp}`;const suffix=id.replace(/[^a-z0-9]/gi,'').slice(-6).toUpperCase();const receiptNumber=`RCP-${timestamp.toString().slice(-8)}-${suffix}`;const saleNumber=`SALE-${timestamp.toString().slice(-8)}-${suffix}`
  await productService.deductStockForSale(valid.products.map(p=>({productId:p.id,quantity:quantities[p.id]})),{id,number:saleNumber})
  const items=valid.products.map(p=>({productId:p.id,productName:p.name,sku:p.sku,unit:p.unit,unitPrice:p.sellingPrice,quantity:quantities[p.id],lineTotal:money(p.sellingPrice*quantities[p.id])}))
  const sale:CheckoutSale={id,saleNumber,receiptNumber,invoiceNumber:`INV-${new Date(timestamp).getFullYear()}-${timestamp.toString().slice(-8)}-${suffix}`,customerId:valid.customer.id,customerName:valid.customer.name,customerCode:valid.customer.customerCode,customerPhone:valid.customer.phone,customerAddress:[valid.customer.address,valid.customer.city].filter(Boolean).join(', ')||undefined,cashierName:'Ayesha Khan',businessSnapshot:{name:'Northstar Market',address:'Business address · Lahore',phone:'Business phone',email:'Business email'},items,subtotal:valid.subtotal,discountType,discountValue,discountAmount:valid.discount,totalAmount:valid.total,payments:payments.map(p=>({...p})),amountPaid:valid.paid,remainingBalance:valid.remaining,changeReturned:valid.change,createdAt:new Date(timestamp).toISOString(),status:'completed'}
  sales=[sale,...sales];persistSales();return {...sale,items:sale.items.map(x=>({...x})),payments:sale.payments.map(x=>({...x})),businessSnapshot:{...sale.businessSnapshot}}
 }finally{checkoutInProgress=false}
}
export function getReceiptById(id:string){const sale=sales.find(s=>s.id===id);return sale?{...sale,items:sale.items.map(x=>({...x})),payments:sale.payments.map(x=>({...x}))}:undefined}

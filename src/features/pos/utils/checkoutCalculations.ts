import type { Product } from '../../products/types/product.types'
export function money(value:number){return Math.round((value+Number.EPSILON)*100)/100}
export function subtotal(products:Product[],quantities:Record<string,number>){return money(products.reduce((sum,p)=>sum+p.sellingPrice*(quantities[p.id]??0),0))}
export function discountAmount(base:number,type:'fixed'|'percent',value:number){if(!Number.isFinite(value)||value<0)throw Error('Discount cannot be negative.');if(type==='percent'&&value>100)throw Error('Percentage discount must be from 0 to 100.');const amount=type==='percent'?base*value/100:value;if(amount>base)throw Error('Discount cannot exceed the subtotal.');return money(amount)}
export function orderTotal(base:number,discount:number){return money(Math.max(0,base-discount))}

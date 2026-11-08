import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { PageHeader } from '../../../components/common/PageHeader'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { ProductImage } from '../components/ProductImage'
import { ProductStatusBadge, StockStatusBadge } from '../components/ProductBadges'
import { ProductToast } from '../components/ProductToast'
import { StockAdjustmentModal } from '../components/StockAdjustmentModal'
import { categoryService } from '../../categories/services/categoryService'
import { productService } from '../services/productService'
import type { Product, StockAdjustmentInput } from '../types/product.types'
import { getProductMovements } from '../../inventory/services/inventoryService'
import type { StockMovement } from '../../inventory/types/inventory.types'
import { calculateProductProfit } from '../utils/productUtils'

export function ProductDetailsPage(){
  const {productId}=useParams()
  const location=useLocation()
  const navigate=useNavigate()
  const [product,setProduct]=useState<Product>()
  const [categoryName,setCategoryName]=useState('Uncategorized')
  const [adjustments,setAdjustments]=useState<StockMovement[]>([])
  const [loading,setLoading]=useState(true)
  const [adjustOpen,setAdjustOpen]=useState(false)
  const [notice,setNotice]=useState('')
  const routeNotice=location.state&&typeof location.state==='object'&&'notice' in location.state&&typeof location.state.notice==='string'?location.state.notice:''
  const dismissNotice=useCallback(()=>{setNotice('');if(routeNotice)navigate(location.pathname,{replace:true,state:null})},[location.pathname,navigate,routeNotice])
  const toastMessage=notice||routeNotice
  const load=useCallback(async()=>{
    const [result,history]=await Promise.all([productId?productService.getProductById(productId):Promise.resolve(undefined),productId?Promise.resolve(getProductMovements(productId)):Promise.resolve([])])
    setProduct(result);setAdjustments(history);setLoading(false)
  },[productId])
  // Product details are synchronized from the mock repository when the route ID changes.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(()=>{void load()},[load])
  useEffect(()=>{
    if(!product)return
    void categoryService.getCategoryById(product.categoryId).then((category)=>setCategoryName(category?.name??'Uncategorized'))
  },[product])
  const applyAdjustment=async(adjustment:StockAdjustmentInput)=>{if(!product)return;const updated=await productService.adjustProductStock(product.id,adjustment);setProduct(updated);setAdjustments(getProductMovements(product.id));setAdjustOpen(false);setNotice('Stock adjustment recorded in the inventory ledger.')}

  if(loading)return <div role="status" className="grid min-h-56 place-items-center text-sm text-slate-500">Loading product details…</div>
  if(!product)return <><PageHeader title="Product not found" description="This product is not available in the current catalog." action={<Link to="/products"><Button><ArrowLeft size={15}/>Back to products</Button></Link>}/><EmptyState title="We couldn't find that product" description="It may have been archived in another session or the link may be incorrect."/></>
  const category=categoryName
  const {profit,margin}=calculateProductProfit(product.purchasePrice,product.sellingPrice)
  const facts=[['SKU',product.sku],['Barcode',product.barcode||'Not provided'],['Category',category],['Unit',product.unit],['Purchase price',formatCurrency(product.purchasePrice)],['Selling price',formatCurrency(product.sellingPrice)],['Estimated profit',formatCurrency(profit)],['Profit margin',`${margin.toFixed(1)}%`],['Available stock',product.trackInventory?`${product.stockQuantity} ${product.unit}`:'Not tracked'],['Low-stock threshold',product.trackInventory?`${product.lowStockThreshold} ${product.unit}`:'Not tracked'],['Created',formatBusinessDate(new Date(product.createdAt))],['Last updated',formatBusinessDate(new Date(product.updatedAt))]]

  return <>
    <PageHeader title={product.name} description="Product details and inventory status." action={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><Link to={`/products/${product.id}/edit`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700"><Pencil size={15}/>Edit product</Link><Button variant="primary" disabled={!product.trackInventory||product.status==='archived'} onClick={()=>setAdjustOpen(true)}><SlidersHorizontal size={15}/>Adjust stock</Button></div>}/>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[.85fr_1.5fr]"><Card className="p-5 sm:p-6"><div className="flex flex-wrap items-start gap-4"><ProductImage name={product.name} imageUrl={product.imageUrl} className="h-24 w-24 rounded-2xl"/><div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-slate-900">{product.name}</h2><p className="mt-1 text-xs text-slate-500">{category}</p><div className="mt-3 flex flex-wrap gap-2"><ProductStatusBadge status={product.status}/><StockStatusBadge product={product}/></div></div></div><div className="mt-6 border-t border-slate-100 pt-5"><p className="text-xs font-semibold text-slate-600">Description</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{product.description||'No description has been added.'}</p></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] text-slate-500">Selling price</p><p className="mt-1 text-base font-bold text-slate-900">{formatCurrency(product.sellingPrice)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] text-slate-500">Purchase price</p><p className="mt-1 text-base font-bold text-slate-900">{formatCurrency(product.purchasePrice)}</p></div></div></Card>
      <Card className="p-5 sm:p-6"><h2 className="mb-4 text-sm font-bold text-slate-800">Product information</h2><dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">{facts.map(([label,value])=><div key={label} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="text-right text-xs font-semibold text-slate-700">{value}</dd></div>)}</dl></Card></div>
    <Card className="mt-5 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-slate-800">Stock movement history</h2><p className="mt-1 text-xs text-slate-400">Immutable history from the shared inventory ledger.</p></div><Link className="text-xs font-semibold text-blue-600" to={`/inventory/movements?productId=${product.id}`}>View all</Link></div>{adjustments.length?<div className="mt-4 space-y-3">{adjustments.slice(0,8).map(entry=><div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs"><div><p className="font-semibold text-slate-700">{entry.movementNumber} · {entry.type.replaceAll('_',' ')}</p><p className="mt-1 text-slate-500">{entry.reason??entry.referenceNumber??'Stock movement'}{entry.notes?` · ${entry.notes}`:''}</p></div><p className="text-slate-500">{entry.previousQuantity} → {entry.newQuantity} ({entry.quantityChange>0?'+':''}{entry.quantityChange}) · {formatBusinessDate(new Date(entry.createdAt),{dateStyle:'short',timeStyle:'short'})}</p></div>)}</div>:<p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">No stock movements have been recorded yet.</p>}</Card>
    <StockAdjustmentModal key={`${product.id}-${adjustOpen}`} product={product} open={adjustOpen} onClose={()=>setAdjustOpen(false)} onApply={applyAdjustment}/><ProductToast message={toastMessage} onClose={dismissNotice}/>
  </>
}

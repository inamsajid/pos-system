import { useMemo, type FormEvent } from 'react'
import { useForm, useWatch, type FieldErrors, type Resolver } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'
import { useCategories } from '../../categories/hooks/useCategories'
import type { Product, ProductDraft, ProductUnit } from '../types/product.types'
import { calculateProductProfit, normalizeProductCode } from '../utils/productUtils'
import { CategorySelector } from './CategorySelector'
import { ProductImageUpload } from './ProductImageUpload'

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required.'),
  sku: z.string().trim().min(1, 'SKU is required.'),
  barcode: z.string().trim().optional(),
  description: z.string().optional(),
  categoryId: z.string().min(1, 'Select a category.'),
  imageUrl: z.string().optional(),
  unit: z.enum(['piece','kg','gram','liter','meter','box','pack','dozen']),
  purchasePrice: z.number({ error: 'Enter a purchase price.' }).finite('Enter a valid purchase price.').min(0, 'Purchase price cannot be negative.'),
  sellingPrice: z.number({ error: 'Enter a selling price.' }).finite('Enter a valid selling price.').min(0, 'Selling price cannot be negative.'),
  stockQuantity: z.number({ error: 'Enter a stock quantity.' }).finite('Enter a valid stock quantity.').min(0, 'Stock cannot be negative.'),
  lowStockThreshold: z.number({ error: 'Enter a low-stock threshold.' }).finite('Enter a valid threshold.').min(0, 'Threshold cannot be negative.'),
  status: z.enum(['active','archived']),
  trackInventory: z.boolean(),
})

function productFormResolver(products: Product[], excludedProductId?: string): Resolver<ProductDraft> {
  return async (values) => {
    const parsed = productSchema.safeParse(values)
    const issues = parsed.success ? [] : [...parsed.error.issues]
    if (parsed.success) {
      const sku = normalizeProductCode(parsed.data.sku)
      if (products.some((product) => product.id !== excludedProductId && normalizeProductCode(product.sku) === sku)) issues.push({ code: 'custom', path: ['sku'], message: 'This SKU is already in use.' })
      const barcode = parsed.data.barcode?.trim()
      if (barcode && products.some((product) => product.id !== excludedProductId && product.barcode && normalizeProductCode(product.barcode) === normalizeProductCode(barcode))) issues.push({ code: 'custom', path: ['barcode'], message: 'This barcode is already in use.' })
    }
    if (issues.length) {
      const errors: FieldErrors<ProductDraft> = {}
      for (const issue of issues) {
        const field = issue.path[0]
        if (typeof field === 'string') Object.assign(errors, { [field]: { type: 'validate', message: issue.message } })
      }
      return { values: {}, errors }
    }
    return { values: parsed.success ? parsed.data : {}, errors: {} }
  }
}

const units: Array<{ value: ProductUnit; label: string }> = [
  {value:'piece',label:'Piece'},{value:'kg',label:'Kilogram (kg)'},{value:'gram',label:'Gram (g)'},{value:'liter',label:'Liter (L)'},
  {value:'meter',label:'Meter (m)'},{value:'box',label:'Box'},{value:'pack',label:'Pack'},{value:'dozen',label:'Dozen'},
]

export function ProductForm({product,products,onSubmit,onCancel,submitting=false}:{product?:Product;products:Product[];onSubmit:(draft:ProductDraft,addAnother:boolean)=>void|Promise<void>;onCancel:()=>void;submitting?:boolean}){
  const {categories: categoryRecords}=useCategories()
  const productCategories=categoryRecords.filter((category)=>category.status==='active'||category.id===product?.categoryId).map(({id,name})=>({id,name}))
  const defaultValues:ProductDraft=useMemo(()=>product?{
    name:product.name,sku:product.sku,barcode:product.barcode??'',description:product.description??'',categoryId:product.categoryId,imageUrl:product.imageUrl,
    unit:product.unit,purchasePrice:product.purchasePrice,sellingPrice:product.sellingPrice,stockQuantity:product.stockQuantity,lowStockThreshold:product.lowStockThreshold,status:product.status,trackInventory:product.trackInventory,
  }:{name:'',sku:'',barcode:'',description:'',categoryId:'',imageUrl:undefined,unit:'piece',purchasePrice:0,sellingPrice:0,stockQuantity:0,lowStockThreshold:5,status:'active',trackInventory:true},[product])
  const resolver=useMemo(()=>productFormResolver(products,product?.id),[products,product?.id])
  const {control,register,handleSubmit,setValue,reset,formState:{errors}}=useForm<ProductDraft>({defaultValues,resolver,mode:'onSubmit'})
  const purchasePrice=useWatch({control,name:'purchasePrice'})
  const sellingPrice=useWatch({control,name:'sellingPrice'})
  const tracking=useWatch({control,name:'trackInventory'})
  const imageUrl=useWatch({control,name:'imageUrl'})
  const categoryId=useWatch({control,name:'categoryId'})
  const safePurchase=Number.isFinite(purchasePrice)?purchasePrice:0
  const safeSelling=Number.isFinite(sellingPrice)?sellingPrice:0
  const {profit,margin}=calculateProductProfit(safePurchase,safeSelling)

  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    const submitter=(event.nativeEvent as SubmitEvent).submitter
    const addAnother=submitter instanceof HTMLButtonElement&&submitter.value==='save-another'
    void handleSubmit(async(values)=>{await onSubmit({...values,name:values.name.trim(),sku:values.sku.trim(),barcode:values.barcode?.trim()||undefined,description:values.description?.trim()||undefined,stockQuantity:values.trackInventory?values.stockQuantity:0},addAnother);if(addAnother)reset(defaultValues)})(event)
  }
  const fieldError=(name:keyof ProductDraft)=>errors[name]?.message
  const selectClass='mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

  return <form onSubmit={submit} noValidate className="space-y-5">
    <Card className="p-5 sm:p-6"><div className="mb-5"><h2 className="text-sm font-bold text-slate-800">Basic information</h2><p className="mt-1 text-xs text-slate-400">Product identity and how it appears in your catalog.</p></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div><Input label="Product name *" autoComplete="off" {...register('name')}/>{fieldError('name')&&<p className="mt-1 text-xs text-rose-600">{fieldError('name')}</p>}</div>
        <div><Input label="SKU *" autoComplete="off" {...register('sku')}/>{fieldError('sku')&&<p className="mt-1 text-xs text-rose-600">{fieldError('sku')}</p>}</div>
        <div><Input label="Barcode (optional)" autoComplete="off" {...register('barcode')}/>{fieldError('barcode')&&<p className="mt-1 text-xs text-rose-600">{fieldError('barcode')}</p>}</div>
        <CategorySelector categories={productCategories} value={categoryId} onChange={(value)=>setValue('categoryId',value,{shouldDirty:true,shouldValidate:true})} error={fieldError('categoryId')}/>
        <label className="block text-xs font-semibold text-slate-700">Product unit *<select {...register('unit')} className={selectClass}>{units.map((unit)=><option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
        <label className="block text-xs font-semibold text-slate-700 md:col-span-2">Description <textarea rows={3} {...register('description')} placeholder="Add useful product details" className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>
        <div className="md:col-span-2"><ProductImageUpload value={imageUrl} onChange={(value)=>setValue('imageUrl',value,{shouldDirty:true})}/></div>
      </div>
    </Card>

    <Card className="p-5 sm:p-6"><div className="mb-5"><h2 className="text-sm font-bold text-slate-800">Pricing information</h2><p className="mt-1 text-xs text-slate-400">Enter purchase cost and customer selling price in PKR.</p></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div><Input label="Purchase price (PKR) *" type="number" min="0" step="0.01" inputMode="decimal" {...register('purchasePrice',{valueAsNumber:true})}/>{fieldError('purchasePrice')&&<p className="mt-1 text-xs text-rose-600">{fieldError('purchasePrice')}</p>}</div>
        <div><Input label="Selling price (PKR) *" type="number" min="0" step="0.01" inputMode="decimal" {...register('sellingPrice',{valueAsNumber:true})}/>{fieldError('sellingPrice')&&<p className="mt-1 text-xs text-rose-600">{fieldError('sellingPrice')}</p>}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] font-medium text-slate-500">Estimated profit</p><p className={`mt-1 text-sm font-bold ${profit<0?'text-rose-600':'text-slate-800'}`}>{formatCurrency(profit)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] font-medium text-slate-500">Profit margin</p><p className="mt-1 text-sm font-bold text-slate-800">{margin.toFixed(1)}%</p></div></div>
    </Card>

    <Card className="p-5 sm:p-6"><div className="mb-5"><h2 className="text-sm font-bold text-slate-800">Inventory information</h2><p className="mt-1 text-xs text-slate-400">Choose whether the system should track this product's stock.</p></div>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" {...register('trackInventory')} className="mt-0.5 h-4 w-4 accent-blue-600"/><span><span className="block text-xs font-semibold text-slate-800">Track inventory</span><span className="mt-1 block text-[11px] text-slate-500">Receive low-stock alerts and adjust available quantities.</span></span></label>
      {tracking?<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"><div>{product?<><Input label="Current stock quantity" type="number" value={product.stockQuantity} disabled/><p className="mt-1 text-[11px] text-slate-500">Use Inventory or product details to record stock changes.</p></>:<><Input label="Initial stock quantity *" type="number" min="0" step="any" inputMode="decimal" {...register('stockQuantity',{valueAsNumber:true})}/>{fieldError('stockQuantity')&&<p className="mt-1 text-xs text-rose-600">{fieldError('stockQuantity')}</p>}</>}</div><div><Input label="Low-stock alert threshold *" type="number" min="0" step="any" inputMode="decimal" {...register('lowStockThreshold',{valueAsNumber:true})}/>{fieldError('lowStockThreshold')&&<p className="mt-1 text-xs text-rose-600">{fieldError('lowStockThreshold')}</p>}</div></div>:<p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Stock tracking is disabled. This product will not appear in low-stock alerts.</p>}
    </Card>

    <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-slate-200 bg-[#f5f7fb]/95 p-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
      <Button type="button" onClick={onCancel} className="w-full sm:w-auto">Cancel</Button>
      {!product&&<Button type="submit" value="save-another" disabled={submitting} className="w-full sm:w-auto">Save & add another</Button>}
      <Button type="submit" value="save" variant="primary" disabled={submitting} className="w-full sm:w-auto">{submitting?'Saving…':product?'Save changes':'Save product'}</Button>
    </div>
  </form>
}

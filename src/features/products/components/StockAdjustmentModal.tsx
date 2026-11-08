import { useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import type { Product, StockAdjustmentInput, StockAdjustmentType } from '../types/product.types'

export function StockAdjustmentModal({product,open,onClose,onApply}:{product?:Product;open:boolean;onClose:()=>void;onApply:(adjustment:StockAdjustmentInput)=>void|Promise<void>}){
  const [type,setType]=useState<StockAdjustmentType>('add')
  const [quantity,setQuantity]=useState('')
  const [reason,setReason]=useState('')
  const [notes,setNotes]=useState('')
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const numericQuantity=Number(quantity)
  const resultingStock=useMemo(()=>{if(!product||!Number.isFinite(numericQuantity))return product?.stockQuantity??0;if(type==='add')return product.stockQuantity+numericQuantity;if(type==='remove')return product.stockQuantity-numericQuantity;return numericQuantity},[numericQuantity,product,type])
  if(!product)return null

  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('')
    if(!quantity||!Number.isFinite(numericQuantity)||numericQuantity<0){setError('Enter a valid non-negative quantity.');return}
    if(type!=='set'&&numericQuantity===0){setError('Enter a quantity greater than zero.');return}
    if(resultingStock<0){setError('This adjustment would make stock negative.');return}
    if(!reason.trim()){setError('Enter a reason for this adjustment.');return}
    setSaving(true)
    try{await onApply({type,quantity:numericQuantity,reason:reason.trim(),notes:notes.trim()||undefined})}catch(applyError){setError(applyError instanceof Error?applyError.message:'Unable to adjust stock.')}finally{setSaving(false)}
  }

  return <Modal open={open} onClose={onClose} title={`Adjust stock · ${product.name}`}>
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">Current stock: <strong className="text-slate-800">{product.stockQuantity} {product.unit}</strong></p>
      <label className="block text-xs font-semibold text-slate-700">Adjustment type<select value={type} onChange={(event)=>setType(event.target.value as StockAdjustmentType)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500"><option value="add">Add stock</option><option value="remove">Remove stock</option><option value="set">Set stock manually</option></select></label>
      <Input label={type==='set'?'Physical count / new stock quantity':'Quantity *'} type="number" min="0" step="any" inputMode="decimal" value={quantity} onChange={(event)=>setQuantity(event.target.value)}/>
      <Input label="Reason *" value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="e.g. Supplier delivery"/>
      <label className="block text-xs font-semibold text-slate-700">Notes (optional)<textarea rows={2} value={notes} onChange={(event)=>setNotes(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500"/></label>
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center"><div><p className="text-[10px] text-slate-500">Previous</p><p className="mt-1 text-sm font-semibold">{product.stockQuantity}</p></div><div><p className="text-[10px] text-slate-500">Change</p><p className="mt-1 text-sm font-semibold">{type==='set'?'Set to':type==='add'?'+':'−'}{quantity||'0'}</p></div><div><p className="text-[10px] text-slate-500">New stock</p><p className={`mt-1 text-sm font-semibold ${resultingStock<0?'text-rose-600':'text-slate-800'}`}>{resultingStock}</p></div></div>
      {error&&<p role="alert" className="text-xs text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving?'Saving…':'Apply adjustment'}</Button></div>
      <p className="text-[10px] leading-4 text-slate-400">This action creates an immutable stock movement and updates the shared inventory balance.</p>
    </form>
  </Modal>
}

import { RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { CategorySelector } from './CategorySelector'
import type { ProductCategory } from '../types/product.types'

export interface ProductFiltersValue {
  categoryId: string
  status: '' | 'active' | 'archived'
  stockStatus: '' | 'in-stock' | 'low-stock' | 'out-of-stock'
  minPrice: string
  maxPrice: string
}

interface ProductFiltersProps {
  categories: ProductCategory[]
  value: ProductFiltersValue
  onChange: (value: ProductFiltersValue) => void
  onClear: () => void
  hasFilters: boolean
}

export function ProductFilters({ categories, value, onChange, onClear, hasFilters }: ProductFiltersProps) {
  const update = <K extends keyof ProductFiltersValue>(key: K, nextValue: ProductFiltersValue[K]) => onChange({ ...value, [key]: nextValue })
  const selectClass = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500'

  return <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_1fr_auto]">
    <CategorySelector categories={categories} value={value.categoryId} onChange={(next) => update('categoryId', next)} label="Category" includeAll/>
    <label className="block text-xs font-semibold text-slate-700">Product status<select value={value.status} onChange={(event) => update('status', event.target.value as ProductFiltersValue['status'])} className={selectClass}><option value="">All statuses</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
    <label className="block text-xs font-semibold text-slate-700">Stock status<select value={value.stockStatus} onChange={(event) => update('stockStatus', event.target.value as ProductFiltersValue['stockStatus'])} className={selectClass}><option value="">All stock</option><option value="in-stock">In stock</option><option value="low-stock">Low stock</option><option value="out-of-stock">Out of stock</option></select></label>
    <label className="block text-xs font-semibold text-slate-700">Min. price <input inputMode="decimal" type="number" min="0" value={value.minPrice} onChange={(event) => update('minPrice', event.target.value)} placeholder="0" className={selectClass}/></label>
    <label className="block text-xs font-semibold text-slate-700">Max. price <input inputMode="decimal" type="number" min="0" value={value.maxPrice} onChange={(event) => update('maxPrice', event.target.value)} placeholder="Any" className={selectClass}/></label>
    <Button onClick={onClear} disabled={!hasFilters} className="w-full sm:col-span-2 xl:col-span-1"><RotateCcw size={14}/>Clear</Button>
  </div>
}

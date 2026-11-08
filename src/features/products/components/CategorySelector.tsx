import type { ProductCategory } from '../types/product.types'

interface CategorySelectorProps {
  categories: ProductCategory[]
  value: string
  onChange: (value: string) => void
  label?: string
  error?: string
  includeAll?: boolean
}

export function CategorySelector({ categories, value, onChange, label = 'Category', error, includeAll = false }: CategorySelectorProps) {
  return <label className="block text-xs font-semibold text-slate-700">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
      {includeAll && <option value="">All categories</option>}
      {!includeAll && <option value="">Select a category</option>}
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
    {error && <span className="mt-1 block text-xs font-normal text-rose-600">{error}</span>}
  </label>
}

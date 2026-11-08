import { Search, X } from 'lucide-react'

export function ProductSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="relative min-w-0 flex-1">
    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
    <input type="search" aria-label="Search products" placeholder="Search name, SKU or barcode" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/>
    {value && <button type="button" onClick={() => onChange('')} aria-label="Clear product search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"><X size={14}/></button>}
  </div>
}

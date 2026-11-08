import { AlertTriangle, Boxes, CircleDollarSign, PackageX } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import type { Product } from '../types/product.types'
import { getProductStockStatus } from '../utils/productUtils'

export function ProductStats({ products }: { products: Product[] }) {
  const stats = [
    { label: 'Total products', value: products.length, icon: Boxes, color: 'text-blue-600 bg-blue-50' },
    { label: 'Active products', value: products.filter((product) => product.status === 'active').length, icon: CircleDollarSign, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Low stock', value: products.filter((product) => getProductStockStatus(product) === 'low-stock').length, icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
    { label: 'Out of stock', value: products.filter((product) => getProductStockStatus(product) === 'out-of-stock').length, icon: PackageX, color: 'text-rose-600 bg-rose-50' },
  ]
  const archivedCount = products.filter((product) => product.status === 'archived').length
  return <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon, color }) => <Card key={label} className="flex items-center justify-between gap-3 p-4 sm:p-5"><div className="min-w-0"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>{label === 'Total products' && <p className="mt-1 text-[11px] text-slate-400">{archivedCount} archived</p>}</div><span className={`rounded-xl p-2.5 ${color}`}><Icon size={19}/></span></Card>)}</div>
}

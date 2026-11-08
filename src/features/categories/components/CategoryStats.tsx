import { Archive, Boxes, FolderCheck, Package, Tags } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import type { CategoryWithStats } from '../types/category.types'

export function CategoryStats({ categories }: { categories: CategoryWithStats[] }) {
  const total = categories.length
  const active = categories.filter((c) => c.status === 'active').length
  const archived = categories.filter((c) => c.status === 'archived').length
  const totalProducts = categories.reduce((sum, c) => sum + c.productCount, 0)
  const emptyCategories = categories.filter((c) => c.productCount === 0).length

  const stats = [
    {
      label: 'Total categories',
      value: total,
      subtext: `${archived} archived`,
      icon: Tags,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: 'Active categories',
      value: active,
      subtext: `${active} visible in POS`,
      icon: FolderCheck,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      label: 'Categorized items',
      value: totalProducts,
      subtext: 'Across all departments',
      icon: Package,
      color: 'text-indigo-600 bg-indigo-50',
    },
    {
      label: 'Empty categories',
      value: emptyCategories,
      subtext: emptyCategories === 0 ? 'All categories in use' : 'No products assigned',
      icon: emptyCategories > 0 ? Archive : Boxes,
      color: emptyCategories > 0 ? 'text-amber-600 bg-amber-50' : 'text-slate-600 bg-slate-50',
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map(({ label, value, subtext, icon: Icon, color }) => (
        <Card key={label} className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
            <p className="mt-1 text-[11px] text-slate-400">{subtext}</p>
          </div>
          <span className={`shrink-0 rounded-xl p-2.5 ${color}`}>
            <Icon size={19} />
          </span>
        </Card>
      ))}
    </div>
  )
}


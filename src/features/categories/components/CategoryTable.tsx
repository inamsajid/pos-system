import { Archive, Edit2, ExternalLink, MoreVertical, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../../components/ui/Badge'
import { formatBusinessDate } from '../../../lib/date'
import type { CategoryWithStats } from '../types/category.types'
import { categoryColors, categoryIcons } from '../utils/categoryUtils'

interface CategoryTableProps {
  categories: CategoryWithStats[]
  onEdit: (category: CategoryWithStats) => void
  onViewProducts: (category: CategoryWithStats) => void
  onArchive: (category: CategoryWithStats) => void
  onRestore: (category: CategoryWithStats) => void
}

export function CategoryTable({
  categories,
  onEdit,
  onViewProducts,
  onArchive,
  onRestore,
}: CategoryTableProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)

  return (
    <div className="table-scroll">
      <table className="w-full min-w-[700px] text-left">
        <thead className="border-y border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-6 py-3.5">Category</th>
            <th className="px-6 py-3.5">Description</th>
            <th className="px-6 py-3.5">Products</th>
            <th className="px-6 py-3.5">Stock units</th>
            <th className="px-6 py-3.5">Status</th>
            <th className="px-6 py-3.5">Created</th>
            <th className="px-6 py-3.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs">
          {categories.map((category) => {
            const Icon = categoryIcons[category.icon] || categoryIcons.Tags
            const colorStyle = categoryColors[category.color] || categoryColors.blue
            const isArchived = category.status === 'archived'
            const isMenuOpen = activeMenuId === category.id

            return (
              <tr key={category.id} className="hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${colorStyle.bg} ${colorStyle.text} ${colorStyle.border}`}
                    >
                      <Icon size={16} />
                    </span>
                    <div>
                      <div className="font-semibold text-slate-800">{category.name}</div>
                      <div className="font-mono text-[11px] text-slate-400">/{category.slug}</div>
                    </div>
                  </div>
                </td>

                <td className="max-w-[240px] truncate px-6 py-4 text-slate-500">
                  {category.description || '—'}
                </td>

                <td className="px-6 py-4">
                  <button
                    type="button"
                    onClick={() => onViewProducts(category)}
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {category.productCount} {category.productCount === 1 ? 'item' : 'items'}
                    <ExternalLink size={12} />
                  </button>
                </td>

                <td className="px-6 py-4 font-medium text-slate-700">
                  {category.totalStockQuantity} units
                </td>

                <td className="px-6 py-4">
                  <Badge tone={isArchived ? 'neutral' : 'success'}>
                    {isArchived ? 'Archived' : 'Active'}
                  </Badge>
                </td>

                <td className="px-6 py-4 text-slate-400">
                  {formatBusinessDate(new Date(category.createdAt))}
                </td>

                <td className="relative px-6 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => setActiveMenuId(isMenuOpen ? null : category.id)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Category options"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setActiveMenuId(null)} />
                      <div className="absolute right-6 top-11 z-40 w-44 rounded-xl border border-slate-200 bg-white p-1 text-left text-xs shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null)
                            onEdit(category)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-50"
                        >
                          <Edit2 size={13} />
                          Edit Category
                        </button>
                        {isArchived ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null)
                              onRestore(category)
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-emerald-600 hover:bg-emerald-50"
                          >
                            <RotateCcw size={13} />
                            Restore Category
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null)
                              onArchive(category)
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-amber-600 hover:bg-amber-50"
                          >
                            <Archive size={13} />
                            Archive Category
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


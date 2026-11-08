import { Archive, ArrowUpRight, Edit2, MoreVertical, Package, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../../components/ui/Badge'
import { Card } from '../../../components/ui/Card'
import type { CategoryWithStats } from '../types/category.types'
import { categoryColors, categoryIcons } from '../utils/categoryUtils'

interface CategoryCardProps {
  category: CategoryWithStats
  onEdit: (category: CategoryWithStats) => void
  onViewProducts: (category: CategoryWithStats) => void
  onArchive: (category: CategoryWithStats) => void
  onRestore: (category: CategoryWithStats) => void
}

export function CategoryCard({
  category,
  onEdit,
  onViewProducts,
  onArchive,
  onRestore,
}: CategoryCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = categoryIcons[category.icon] || categoryIcons.Tags
  const colorStyle = categoryColors[category.color] || categoryColors.blue
  const isArchived = category.status === 'archived'

  return (
    <Card className="relative flex flex-col justify-between p-5 transition hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${colorStyle.bg} ${colorStyle.text} ${colorStyle.border}`}
            >
              <Icon size={20} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-800">{category.name}</h3>
              <p className="text-[11px] font-mono text-slate-400">/{category.slug}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Badge tone={isArchived ? 'neutral' : 'success'}>
              {isArchived ? 'Archived' : 'Active'}
            </Badge>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Category options"
              >
                <MoreVertical size={16} />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-7 z-40 w-44 rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
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
                          setMenuOpen(false)
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
                          setMenuOpen(false)
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
            </div>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">
          {category.description || 'No description provided for this category.'}
        </p>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1 font-semibold text-slate-700">
              <Package size={14} className="text-slate-400" />
              {category.productCount} {category.productCount === 1 ? 'item' : 'items'}
            </span>
            <span className="text-slate-300">·</span>
            <span>{category.totalStockQuantity} units</span>
          </div>

          <button
            type="button"
            onClick={() => onViewProducts(category)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            View items <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
    </Card>
  )
}


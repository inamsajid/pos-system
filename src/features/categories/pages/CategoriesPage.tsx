import { useMemo, useState } from 'react'
import { Download, LayoutGrid, List, Plus, Search, Tag, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Modal } from '../../../components/ui/Modal'
import { PageHeader } from '../../../components/common/PageHeader'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { CategoryCard } from '../components/CategoryCard'
import { CategoryFormModal } from '../components/CategoryFormModal'
import { CategoryProductsModal } from '../components/CategoryProductsModal'
import { CategoryStats } from '../components/CategoryStats'
import { CategoryTable } from '../components/CategoryTable'
import { CategoryToast } from '../components/CategoryToast'
import { useCategories } from '../hooks/useCategories'
import { categoryService } from '../services/categoryService'
import type { CategoryDraft, CategorySort, CategoryWithStats } from '../types/category.types'

export function CategoriesPage() {
  const {
    categories,
    loading,
    error,
    createCategory,
    updateCategory,
    archiveCategory,
    restoreCategory,
  } = useCategories()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'archived'>('')
  const [sort, setSort] = useState<CategorySort>('name-asc')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')

  const [formModalOpen, setFormModalOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<CategoryWithStats | undefined>()
  const [productsModalCat, setProductsModalCat] = useState<CategoryWithStats | undefined>()
  const [archiveCat, setArchiveCat] = useState<CategoryWithStats | undefined>()

  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const hasFilters = Boolean(search.trim() || statusFilter)

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('')
  }

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = categories.filter((cat) => {
      if (
        query &&
        !cat.name.toLowerCase().includes(query) &&
        !cat.slug.toLowerCase().includes(query) &&
        !(cat.description && cat.description.toLowerCase().includes(query))
      ) {
        return false
      }
      if (statusFilter && cat.status !== statusFilter) return false
      return true
    })

    return filtered.sort((a, b) => {
      if (sort === 'name-asc') return a.name.localeCompare(b.name)
      if (sort === 'name-desc') return b.name.localeCompare(a.name)
      if (sort === 'products-desc') return b.productCount - a.productCount
      if (sort === 'products-asc') return a.productCount - b.productCount
      if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return 0
    })
  }, [categories, search, statusFilter, sort])

  const handleOpenAdd = () => {
    setSelectedCategory(undefined)
    setFormModalOpen(true)
  }

  const handleOpenEdit = (cat: CategoryWithStats) => {
    setSelectedCategory(cat)
    setFormModalOpen(true)
  }

  const handleFormSubmit = async (draft: CategoryDraft) => {
    if (selectedCategory) {
      await updateCategory(selectedCategory.id, draft)
      setToast({ message: `"${draft.name}" category updated successfully.`, tone: 'success' })
    } else {
      await createCategory(draft)
      setToast({ message: `"${draft.name}" category created successfully.`, tone: 'success' })
    }
  }

  const handleArchive = async () => {
    if (!archiveCat) return
    await archiveCategory(archiveCat.id)
    setToast({ message: `"${archiveCat.name}" category was archived.`, tone: 'success' })
    setArchiveCat(undefined)
  }

  const handleRestore = async (cat: CategoryWithStats) => {
    await restoreCategory(cat.id)
    setToast({ message: `"${cat.name}" category was restored.`, tone: 'success' })
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="Organize products into departments, manage taxonomies, and configure POS categories."
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              onClick={() => categoryService.exportCategoriesCsv(filteredCategories)}
              disabled={filteredCategories.length === 0}
            >
              <Download size={15} />
              Export CSV
            </Button>
            <Button variant="primary" onClick={handleOpenAdd}>
              <Plus size={16} />
              Add Category
            </Button>
          </div>
        }
      />

      <CategoryStats categories={categories} />

      {/* Search, Filter, and View Controls */}
      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search Input */}
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search categories by name, slug or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'archived')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="archived">Archived only</option>
            </select>

            {/* Sort Dropdown */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CategorySort)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="name-asc">Name: A to Z</option>
              <option value="name-desc">Name: Z to A</option>
              <option value="products-desc">Most Products</option>
              <option value="products-asc">Least Products</option>
              <option value="newest">Newest First</option>
            </select>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`rounded-md p-1.5 transition ${
                viewMode === 'grid'
                  ? 'bg-white text-blue-600 shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Grid view"
              aria-label="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`rounded-md p-1.5 transition ${
                viewMode === 'table'
                  ? 'bg-white text-blue-600 shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Table view"
              aria-label="Table view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {hasFilters && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>
              Showing {filteredCategories.length} of {categories.length} categories
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700"
            >
              Clear filters <X size={12} />
            </button>
          </div>
        )}
      </Card>

      {/* Categories Content */}
      {loading ? (
        <div role="status" className="grid min-h-56 place-items-center text-sm text-slate-500">
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Loading categories…
          </span>
        </div>
      ) : error ? (
        <div role="alert" className="p-8 text-center text-sm text-rose-600">
          {error}
        </div>
      ) : filteredCategories.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={hasFilters ? 'No categories matched' : 'No categories yet'}
          description={
            hasFilters
              ? 'Try modifying your search or filters to locate what you are looking for.'
              : 'Create categories to group products and speed up retail POS checkouts.'
          }
          action={
            hasFilters ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Button variant="primary" onClick={handleOpenAdd}>
                <Plus size={15} /> Add first category
              </Button>
            )
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCategories.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              onEdit={handleOpenEdit}
              onViewProducts={setProductsModalCat}
              onArchive={setArchiveCat}
              onRestore={handleRestore}
            />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <CategoryTable
            categories={filteredCategories}
            onEdit={handleOpenEdit}
            onViewProducts={setProductsModalCat}
            onArchive={setArchiveCat}
            onRestore={handleRestore}
          />
        </Card>
      )}

      {/* Modals & Feedback */}
      <CategoryFormModal
        open={formModalOpen}
        category={selectedCategory}
        categories={categories}
        onClose={() => setFormModalOpen(false)}
        onSubmit={handleFormSubmit}
      />

      <CategoryProductsModal
        open={Boolean(productsModalCat)}
        category={productsModalCat}
        onClose={() => setProductsModalCat(undefined)}
      />

      {/* Archive confirmation keeps assigned products linked for historical reference. */}
      <Modal
        open={Boolean(archiveCat)}
        onClose={() => setArchiveCat(undefined)}
        title="Archive Category?"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">Archive <strong className="text-slate-900">{archiveCat?.name}</strong>? It will be unavailable for new product assignments. Existing products keep this category reference for history.</p>
          {archiveCat && archiveCat.productCount > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">This category is assigned to {archiveCat.productCount} product{archiveCat.productCount === 1 ? '' : 's'}. Those products will remain assigned and are not changed by archiving.</p>}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setArchiveCat(undefined)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleArchive()} className="bg-amber-600 hover:bg-amber-700">
              Archive category
            </Button>
          </div>
        </div>
      </Modal>

      <CategoryToast
        message={toast?.message}
        tone={toast?.tone}
        onClose={() => setToast(null)}
      />
    </>
  )
}

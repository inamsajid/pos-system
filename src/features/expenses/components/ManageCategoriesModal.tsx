import { useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { expenseService } from '../services/expenseService'
import type { ExpenseCategory } from '../types/expense.types'

interface Props {
  open: boolean
  onClose: () => void
  categories: ExpenseCategory[]
  onCategoryCreated: () => void
}

export function ManageCategoriesModal({ open, onClose, categories, onCategoryCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Category name is required.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await expenseService.createCategory(name.trim(), description.trim() || undefined)
      setName('')
      setDescription('')
      onCategoryCreated()
    } catch (err: any) {
      setError(err?.message || 'Failed to create category.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Expense Categories">
      <div className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
          <p className="text-xs font-semibold text-slate-700">Add New Expense Category</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <input
                type="text"
                placeholder="Category Name (e.g. Marketing)"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:ring-2 focus:ring-blue-500"
                aria-label="Category name"
              />
            </div>
            <div>
              <input
                type="text"
                placeholder="Description (Optional)"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:ring-2 focus:ring-blue-500"
                aria-label="Category description"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={isSubmitting} className="text-xs py-1.5 px-3">
              {isSubmitting ? 'Adding…' : '+ Add Category'}
            </Button>
          </div>
        </form>

        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">Existing Categories ({categories.length})</p>
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {categories.map(c => (
              <div key={c.id} className="p-2.5 flex justify-between items-center hover:bg-slate-50">
                <div>
                  <div className="text-xs font-semibold text-slate-800">{c.name}</div>
                  {c.description && <div className="text-[11px] text-slate-500">{c.description}</div>}
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {c.expenseCount ?? 0} expenses
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}


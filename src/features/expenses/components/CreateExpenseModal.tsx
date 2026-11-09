import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { useAuth } from '../../auth/context/useAuth'
import type { BranchInfo } from '../../auth/types'
import { apiClient } from '../../../lib/api-client'
import { expenseService } from '../services/expenseService'
import type { ExpenseCategory, ExpenseDraft, ExpensePaymentMethod } from '../types/expense.types'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  categories: ExpenseCategory[]
  onOpenCategories: () => void
}

export function CreateExpenseModal({ open, onClose, onSuccess, categories, onOpenCategories }: Props) {
  const { activeBranch } = useAuth()
  const [branches, setBranches] = useState<BranchInfo[]>([])

  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [branchId, setBranchId] = useState(activeBranch?.id || 'branch-main')
  const [amountStr, setAmountStr] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash')
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (activeBranch) {
      setBranchId(activeBranch.id)
    }
    void apiClient
      .get<BranchInfo[]>('/branches')
      .then(res => {
        if (Array.isArray(res) && res.length > 0) {
          setBranches(res)
          if (!activeBranch) setBranchId(res[0].id)
        }
      })
      .catch(() => {})
  }, [activeBranch])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const numAmount = parseFloat(amountStr)
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid amount greater than zero.')
      return
    }

    if (!title.trim()) {
      setError('Please provide an expense title or description.')
      return
    }

    if (!categoryId) {
      setError('Please select an expense category.')
      return
    }

    const selectedBranch = branchId || activeBranch?.id || 'branch-main'

    try {
      setIsSubmitting(true)
      const draft: ExpenseDraft = {
        branchId: selectedBranch,
        categoryId,
        amount: numAmount,
        paymentMethod,
        title: title.trim(),
        notes: notes.trim() || undefined,
        receiptAttachmentUrl: receiptUrl.trim() || undefined,
        businessDateKey: dateStr || undefined,
      }

      await expenseService.createExpense(draft)
      onSuccess()
      onClose()
      // Reset form
      setTitle('')
      setAmountStr('')
      setNotes('')
      setReceiptUrl('')
    } catch (err: any) {
      setError(err?.message || 'Failed to record expense. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record Business Expense">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Branch</label>
            <select
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
              aria-label="Expense branch"
            >
              {branches.length > 0 ? (
                branches.map((b: BranchInfo) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.branch_code})
                  </option>
                ))
              ) : activeBranch ? (
                <option value={activeBranch.id}>
                  {activeBranch.name} ({activeBranch.branch_code})
                </option>
              ) : (
                <option value="branch-main">Main Store</option>
              )}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-semibold text-slate-700">Category</label>
              <button
                type="button"
                onClick={onOpenCategories}
                className="text-[11px] text-blue-600 hover:underline"
              >
                + New Category
              </button>
            </div>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
              required
              aria-label="Expense category"
            >
              <option value="">Select Category...</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Title / Description</label>
          <input
            type="text"
            placeholder="e.g., Office Stationery & Printing Paper"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
            aria-label="Expense title"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Amount (Rs.)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500 font-semibold"
              aria-label="Expense amount"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
              aria-label="Payment method"
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="card">Card / POS</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Date</label>
            <input
              type="date"
              value={dateStr}
              onChange={e => setDateStr(e.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
              aria-label="Expense date"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Receipt Attachment URL (Optional)</label>
          <input
            type="url"
            placeholder="https://... or uploaded file URL"
            value={receiptUrl}
            onChange={e => setReceiptUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
            aria-label="Receipt URL"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Remarks (Optional)</label>
          <textarea
            rows={2}
            placeholder="Additional transaction or vendor details..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
            aria-label="Expense notes"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Recording…' : 'Record Expense'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

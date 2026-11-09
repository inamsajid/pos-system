import { useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { expenseService } from '../services/expenseService'
import type { Expense } from '../types/expense.types'

interface Props {
  expense: Expense | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function VoidExpenseModal({ expense, open, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!expense) return null

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim() || reason.trim().length < 3) {
      setError('Please provide a valid void reason (at least 3 characters).')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await expenseService.voidExpense(expense.id, reason.trim())
      onSuccess()
      onClose()
      setReason('')
    } catch (err: any) {
      setError(err?.message || 'Failed to void expense. Please check your permissions.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Void Business Expense">
      <form onSubmit={handleVoid} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
            {error}
          </div>
        )}

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
          <p className="font-semibold">Notice: Financial Reversal Process</p>
          <p>
            Voiding an expense will preserve the historical record for audit compliance while marking it as voided.
            Voided expenses are deducted from financial totals.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Expense Number:</span>
            <span className="font-mono font-bold text-slate-800">{expense.expenseNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Title:</span>
            <span className="font-medium text-slate-800">{expense.title}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Amount:</span>
            <span className="font-bold text-rose-600">{formatCurrency(expense.amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Category:</span>
            <span className="text-slate-700">{expense.categoryName || 'General'}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Reason for Voiding <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={3}
            placeholder="e.g., Duplicate entry, incorrect amount recorded, vendor invoice cancelled..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
            aria-label="Void reason"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting} className="bg-rose-600 hover:bg-rose-700">
            {isSubmitting ? 'Voiding…' : 'Confirm Void'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}


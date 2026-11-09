import React, { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import type { ExpenseCategory, ExpenseDraft, ExpensePaymentMethod } from '../types/expense.types'

export interface ExpenseFormProps {
  categories: ExpenseCategory[]
  branches: Array<{ id: string; name: string }>
  initialBranchId?: string
  onSubmit: (draft: ExpenseDraft) => Promise<void> | void
  onCancel: () => void
  isSubmitting?: boolean
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({
  categories,
  branches,
  initialBranchId = '',
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const [branchId, setBranchId] = useState(initialBranchId || branches[0]?.id || '')
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '')
  const [amountStr, setAmountStr] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().split('T')[0])
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!branchId) {
      setError('Please select a branch.')
      return
    }

    if (!categoryId) {
      setError('Please select an expense category.')
      return
    }

    const numAmount = parseFloat(amountStr)
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Amount must be greater than zero.')
      return
    }

    if (!title.trim()) {
      setError('Expense title is required.')
      return
    }

    const amountMinor = Math.round(numAmount * 100)
    const draft: ExpenseDraft = {
      branchId,
      categoryId,
      amount: numAmount,
      amountMinor,
      paymentMethod,
      title: title.trim(),
      notes: notes.trim() || undefined,
      receiptAttachmentUrl: receiptUrl.trim() || undefined,
      businessDateKey: businessDate || undefined,
    }

    try {
      await onSubmit(draft)
    } catch (err: any) {
      setError(err?.message || 'Failed to record expense.')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 border border-rose-200">
          {error}
        </div>
      )}

      {/* Branch & Category */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {branches.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Branch <span className="text-rose-500">*</span>
            </label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={branches.length <= 1 ? 'sm:col-span-2' : ''}>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Category <span className="text-rose-500">*</span>
          </label>
          <ExpenseCategorySelect
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            required
            className="w-full"
          />
        </div>
      </div>

      {/* Amount & Payment Method */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Amount (PKR) <span className="text-rose-500">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Payment Method <span className="text-rose-500">*</span>
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="cash">Cash (Drawer)</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Title & Date */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Expense Title <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Electricity bill, cleaning supplies, repair"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Business Date
          </label>
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">
          Notes / Remarks (Optional)
        </label>
        <textarea
          rows={2}
          placeholder="Additional context, invoice or receipt numbers..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Receipt URL / Attachment */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">
          Receipt Attachment URL (Optional)
        </label>
        <input
          type="url"
          placeholder="https://... receipt image or document URL"
          value={receiptUrl}
          onChange={(e) => setReceiptUrl(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
        <Button variant="secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Recording...' : 'Record Expense'}
        </Button>
      </div>
    </form>
  )
}


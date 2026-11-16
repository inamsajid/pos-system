import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import type { Expense } from '../types/expense.types'

interface Props {
  expense: Expense | null
  open: boolean
  onClose: () => void
  onVoidClick: () => void
}

export function ExpenseDetailsModal({ expense, open, onClose, onVoidClick }: Props) {
  if (!expense) return null

  const isVoided = expense.status === 'voided'

  return (
    <Modal open={open} onClose={onClose} title={`Expense Details: ${expense.expenseNumber}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <span className="text-xs text-slate-500">Status</span>
            <div className="mt-0.5">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                  isVoided ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {isVoided ? 'Voided' : 'Posted'}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs text-slate-500">Amount</span>
            <div className={`text-xl font-bold ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
              {formatCurrency(expense.amount)}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div className="p-2 rounded bg-slate-50">
            <dt className="text-slate-500">Title / Subject</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">{expense.title}</dd>
          </div>

          <div className="p-2 rounded bg-slate-50">
            <dt className="text-slate-500">Category</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">{expense.categoryName || 'General'}</dd>
          </div>

          <div className="p-2 rounded bg-slate-50">
            <dt className="text-slate-500">Payment Method</dt>
            <dd className="font-semibold text-slate-900 mt-0.5 capitalize">
              {expense.paymentMethod.replace('_', ' ')}
            </dd>
          </div>

          <div className="p-2 rounded bg-slate-50">
            <dt className="text-slate-500">Business Date</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">{expense.businessDateKey}</dd>
          </div>

          <div className="p-2 rounded bg-slate-50">
            <dt className="text-slate-500">Branch</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">{expense.branchName || expense.branchId || '—'}</dd>
          </div>

          <div className="p-2 rounded bg-slate-50">
            <dt className="text-slate-500">Recorded By</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">
              {expense.createdByName || expense.createdBy} ({formatBusinessDate(new Date(expense.createdAt))})
            </dd>
          </div>
        </dl>

        {expense.notes && (
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-xs">
            <span className="font-semibold text-slate-700 block mb-1">Notes:</span>
            <p className="text-slate-600 whitespace-pre-wrap">{expense.notes}</p>
          </div>
        )}

        {expense.receiptAttachmentUrl && (
          <div className="p-3 rounded-lg border border-slate-200 bg-blue-50/50 text-xs flex justify-between items-center">
            <span className="font-medium text-slate-700">Receipt Attachment</span>
            <a
              href={expense.receiptAttachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-semibold"
            >
              View Document ↗
            </a>
          </div>
        )}

        {isVoided && (
          <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs space-y-1">
            <div className="flex justify-between font-semibold text-rose-900">
              <span>Voided by: {expense.voidedByName || expense.voidedBy}</span>
              <span>{expense.voidedAt ? formatBusinessDate(new Date(expense.voidedAt)) : ''}</span>
            </div>
            <p className="text-rose-800">
              <span className="font-semibold">Reason: </span>
              {expense.voidReason}
            </p>
          </div>
        )}

        <div className="flex justify-between items-center pt-3 border-t border-slate-100">
          <div>
            {!isVoided && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onClose()
                  onVoidClick()
                }}
                className="text-rose-600 border-rose-200 hover:bg-rose-50 text-xs"
              >
                Void Expense
              </Button>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}


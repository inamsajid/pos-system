import { useState } from 'react'
import { Plus, Download, Tag } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import type { Expense, ExpenseFilterParams } from '../types/expense.types'
import { useExpenses, useExpenseSummary } from '../hooks/useExpenses'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { ExpenseSummary } from '../components/ExpenseSummary'
import { ExpenseFilters } from '../components/ExpenseFilters'
import { ExpenseTable } from '../components/ExpenseTable'
import { LedgerPagination } from '../../ledger/components/LedgerPagination'
import { CreateExpenseModal } from '../components/CreateExpenseModal'
import { VoidExpenseModal } from '../components/VoidExpenseModal'
import { ManageCategoriesModal } from '../components/ManageCategoriesModal'
import { ExpenseDetailsModal } from '../components/ExpenseDetailsModal'

export function ExpensesPage() {
  // Filters state
  const [filters, setFilters] = useState<ExpenseFilterParams>({
    page: 1,
    limit: 25,
  })

  // Modals state
  const [createOpen, setCreateOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)

  // TanStack Query Hooks
  const { expenses, total, totalPages, page, limit, isLoading, refetch } = useExpenses(filters)
  const { data: summary, isLoading: isSummaryLoading, refetch: refetchSummary } = useExpenseSummary()
  const { categories, activeCategories, refetch: refetchCategories } = useExpenseCategories()

  const refreshAll = async () => {
    await Promise.all([refetch(), refetchSummary(), refetchCategories()])
  }

  const handleExportCsv = () => {
    const headers = [
      'Expense Number',
      'Date',
      'Category',
      'Title',
      'Branch',
      'Payment Method',
      'Amount',
      'Status',
      'Created By',
      'Notes',
    ]
    const rows = expenses.map((e) => [
      e.expenseNumber,
      e.businessDateKey,
      e.categoryName || 'General',
      e.title,
      e.branchName || 'Main',
      e.paymentMethod,
      String(e.amount),
      e.status,
      e.createdByName || e.createdBy,
      e.notes || '',
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClearFilters = () => {
    setFilters({
      page: 1,
      limit: 25,
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses Management"
        description="Record, categorize and audit operating expenditures across business branches."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setCategoriesOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Tag size={15} />
              Categories
            </Button>
            <Button
              variant="secondary"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5"
            >
              <Download size={15} />
              Export CSV
            </Button>
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Plus size={15} />
              Record Expense
            </Button>
          </div>
        }
      />

      {/* KPI Metric Cards */}
      <ExpenseSummary summary={summary} isLoading={isSummaryLoading} />

      {/* Filters Toolbar */}
      <ExpenseFilters
        filters={filters}
        categories={categories}
        onChange={setFilters}
        onClear={handleClearFilters}
      />

      {/* Expense Data Table */}
      <ExpenseTable
        expenses={expenses}
        onView={(exp) => {
          setSelectedExpense(exp)
          setDetailsOpen(true)
        }}
        onVoid={(exp) => {
          setSelectedExpense(exp)
          setVoidOpen(true)
        }}
        canVoid={true}
        emptyMessage={isLoading ? 'Loading expenses…' : 'No expenses match the current criteria.'}
      />

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <LedgerPagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={limit}
            onPageChange={(newPage) => setFilters((prev) => ({ ...prev, page: newPage }))}
            onPageSizeChange={(newLimit) =>
              setFilters((prev) => ({ ...prev, limit: newLimit, page: 1 }))
            }
          />
        </div>
      )}

      {/* Modals */}
      <CreateExpenseModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => void refreshAll()}
        categories={activeCategories}
        onOpenCategories={() => {
          setCreateOpen(false)
          setCategoriesOpen(true)
        }}
      />

      <ManageCategoriesModal
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        categories={categories}
        onCategoryCreated={() => void refreshAll()}
      />

      <ExpenseDetailsModal
        expense={selectedExpense}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onVoidClick={() => setVoidOpen(true)}
      />

      <VoidExpenseModal
        expense={selectedExpense}
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onSuccess={() => void refreshAll()}
      />
    </div>
  )
}

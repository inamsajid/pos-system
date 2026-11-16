import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Download, Plus, Search, Users, X } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { ApiError } from '../../../lib/api-client'
import { customerService } from '../services/customerService'
import type { Customer, CustomerFinancialSummary } from '../types/customer.types'
import { fetchCustomerLedgerSummary } from '../services/customerLedgerService'

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [summaries, setSummaries] = useState<Record<string, CustomerFinancialSummary>>({})
  const [advanceBalances, setAdvanceBalances] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [account, setAccount] = useState('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [archive, setArchive] = useState<Customer>()
  const [toast, setToast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await customerService.getCustomers()
      setCustomers(list)

      const nonWalkIn = list.filter((c) => !c.isWalkIn)
      const pairs: Array<readonly [string, CustomerFinancialSummary]> = []
      const batchSize = 6
      for (let i = 0; i < nonWalkIn.length; i += batchSize) {
        const chunk = nonWalkIn.slice(i, i + batchSize)
        const settled = await Promise.allSettled(
          chunk.map(async (c) => [c.id, await fetchCustomerLedgerSummary(c.id)] as const)
        )
        for (const res of settled) {
          if (res.status === 'fulfilled') {
            pairs.push(res.value)
          } else if (!(res.reason instanceof ApiError && res.reason.status === 403)) {
            setError((prev) =>
              prev ||
              (res.reason instanceof Error
                ? res.reason.message
                : 'Unable to load customer financial balances.')
            )
          }
        }
      }

      setBalances(Object.fromEntries(pairs.map(([id, s]) => [id, s.outstandingBalance])))
      setAdvanceBalances(Object.fromEntries(pairs.map(([id, s]) => [id, s.advanceBalance])))
      setSummaries(Object.fromEntries(pairs))
    } catch (err: unknown) {
      setCustomers([])
      setBalances({})
      setAdvanceBalances({})
      setSummaries({})
      setError(err instanceof Error ? err.message : 'Unable to load customers from server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const state = location.state as { notice?: string } | null
    if (state?.notice) {
      setToast(state.notice)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location, navigate])

  const filtered = useMemo(
    () =>
      customers
        .filter(
          (c) =>
            !c.isWalkIn &&
            (!query ||
              [c.name, c.customerCode, c.phone, c.email].some((v) =>
                v?.toLowerCase().includes(query.toLowerCase())
              )) &&
            (!status || c.status === status) &&
            (!type || c.type === type) &&
            (!account ||
              (account === 'outstanding'
                ? (balances[c.id] ?? 0) > 0
                : account === 'advance'
                  ? (advanceBalances[c.id] ?? 0) > 0
                  : (balances[c.id] ?? 0) === 0))
        )
        .sort((a, b) =>
          sort === 'newest'
            ? b.createdAt.localeCompare(a.createdAt)
            : sort === 'purchases'
              ? (summaries[b.id]?.totalPurchases ?? 0) - (summaries[a.id]?.totalPurchases ?? 0)
              : a.name.localeCompare(b.name)
        ),
    [customers, query, status, type, account, balances, advanceBalances, summaries, sort]
  )

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const rows = filtered.slice((page - 1) * size, page * size)
  const outstanding = Object.values(balances).reduce((s, v) => s + v, 0)

  const exportCsv = () => {
    const values = [
      ['Name', 'Customer code', 'Phone', 'Email', 'Type', 'Status', 'Outstanding (PKR)'],
      ...filtered.map((c) => [
        c.name,
        c.customerCode,
        c.phone ?? '',
        c.email ?? '',
        c.type,
        c.status,
        String(balances[c.id] ?? 0),
      ]),
    ]
    const url = URL.createObjectURL(
      new Blob([values.map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n')], {
        type: 'text/csv',
      })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'pos-customers.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const archiveCustomer = async () => {
    if (!archive) return
    setError(null)
    try {
      await customerService.archiveCustomer(archive.id)
      const archivedName = archive.name
      setArchive(undefined)
      setToast(`${archivedName} was archived.`)
      await load()
    } catch (err: unknown) {
      setArchive(undefined)
      setError(err instanceof Error ? err.message : 'Unable to archive customer.')
    }
  }

  const avatar = (c: Customer) =>
    c.name
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase()

  const customerRow = (c: Customer, mobile = false) =>
    mobile ? (
      <article key={c.id} className="border-b border-slate-100 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">
            {avatar(c)}
          </span>
          <div className="min-w-0 flex-1">
            <Link to={`/customers/${c.id}`} className="font-semibold text-slate-800">
              {c.name}
            </Link>
            <p className="text-xs text-slate-500">
              {c.customerCode} · {c.phone ?? 'No phone'}
            </p>
          </div>
          <Link className="text-xs font-semibold text-blue-600" to={`/customers/${c.id}`}>
            View
          </Link>
        </div>
        <div className="mt-3 flex justify-between text-xs">
          <span>{c.type === 'business' ? 'Business' : 'Individual'}</span>
          <span className="font-semibold">{formatCurrency(balances[c.id] ?? 0)}</span>
        </div>
      </article>
    ) : (
      <tr key={c.id} className="border-b border-slate-100 text-xs">
        <td className="p-3">
          <Link to={`/customers/${c.id}`} className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-50 text-[10px] text-blue-700">
              {avatar(c)}
            </span>
            {c.name}
          </Link>
        </td>
        <td>{c.customerCode}</td>
        <td>{c.phone ?? '—'}</td>
        <td>{c.email ?? '—'}</td>
        <td>{c.type}</td>
        <td>{formatCurrency(summaries[c.id]?.totalPurchases ?? 0)}</td>
        <td className="font-semibold">{formatCurrency(balances[c.id] ?? 0)}</td>
        <td>
          {summaries[c.id]?.lastPurchaseDate
            ? formatBusinessDate(new Date(summaries[c.id].lastPurchaseDate!))
            : '—'}
        </td>
        <td>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{c.status}</span>
        </td>
        <td className="space-x-2">
          <Link to={`/customers/${c.id}`} className="text-blue-600">
            View
          </Link>
          <Link to={`/customers/${c.id}/edit`} className="text-blue-600">
            Edit
          </Link>
          <button type="button" onClick={() => setArchive(c)} className="text-rose-600">
            Archive
          </button>
        </td>
      </tr>
    )

  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage customer information, purchase history and outstanding balances."
        action={
          <div className="flex gap-2">
            <Button onClick={exportCsv}>
              <Download size={15} />
              Export
            </Button>
            <Link to="/customers/new">
              <Button variant="primary">
                <Plus size={16} />
                Add customer
              </Button>
            </Link>
          </div>
        }
      />

      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ['Total customers', customers.filter((c) => !c.isWalkIn).length],
          ['Active customers', customers.filter((c) => c.status === 'active' && !c.isWalkIn).length],
          ['Customers with balance', customers.filter((c) => (balances[c.id] ?? 0) > 0).length],
          ['Outstanding receivables', formatCurrency(outstanding)],
        ].map(([label, val]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-bold text-slate-900">{val}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <label className="relative">
          <Search size={15} className="absolute left-3 top-3 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            placeholder="Search name, code, phone, email"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <select
          className="rounded-lg border border-slate-200 p-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
        <select
          className="rounded-lg border border-slate-200 p-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="individual">Individual</option>
          <option value="business">Business</option>
        </select>
        <select
          className="rounded-lg border border-slate-200 p-2 text-sm"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">All account statuses</option>
          <option value="clear">Clear</option>
          <option value="outstanding">Outstanding</option>
          <option value="advance">Advance</option>
        </select>
        <select
          className="rounded-lg border border-slate-200 p-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">Name A–Z</option>
          <option value="newest">Recently added</option>
          <option value="purchases">Purchases</option>
        </select>
      </Card>

      {toast && (
        <div role="status" className="mb-3 flex justify-between rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {toast}
          <button type="button" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <p role="status" className="p-8 text-center text-sm text-slate-500">
          Loading customers…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={error ? 'Unable to load customers' : 'No customers found'}
          description={error ? 'Retry fetching customers from the server.' : 'Change your filters or add a customer.'}
          action={
            error ? (
              <Button onClick={() => void load()}>Retry</Button>
            ) : (
              <Link to="/customers/new">
                <Button variant="primary">Add customer</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    {[
                      'Customer',
                      'Code',
                      'Phone',
                      'Email',
                      'Type',
                      'Purchases',
                      'Balance',
                      'Last purchase',
                      'Status',
                      'Actions',
                    ].map((x) => (
                      <th key={x} className="p-3">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{rows.map((c) => customerRow(c))}</tbody>
              </table>
            </div>
          </Card>

          <Card className="divide-y divide-slate-100 md:hidden">
            {rows.map((c) => customerRow(c, true))}
          </Card>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <span>{filtered.length} customers</span>
            <div className="flex items-center gap-2">
              <select
                className="rounded border border-slate-200 p-1.5"
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value))
                  setPage(1)
                }}
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
              <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span>
                {page}/{pages}
              </span>
              <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <Modal open={Boolean(archive)} onClose={() => setArchive(undefined)} title="Archive customer?">
        <p className="text-sm text-slate-600">
          Archive {archive?.name}? Historical records will remain available.
          {(balances[archive?.id ?? ''] ?? 0) > 0 && (
            <span className="mt-2 block rounded bg-amber-50 p-3 text-amber-800">
              This customer has an outstanding balance of {formatCurrency(balances[archive?.id ?? ''] ?? 0)}.
            </span>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setArchive(undefined)}>Cancel</Button>
          <Button variant="primary" onClick={() => void archiveCustomer()}>
            Archive
          </Button>
        </div>
      </Modal>
    </>
  )
}

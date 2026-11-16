import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Download, Plus, Truck } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { ApiError } from '../../../lib/api-client'
import { supplierService } from '../services/supplierService'
import type { Supplier, SupplierFinancialSummary } from '../types/supplier.types'
import { fetchSupplierLedgerSummary } from '../services/supplierLedgerService'

export function SuppliersPage() {
  const [list, setList] = useState<Supplier[]>([])
  const [summaries, setSummaries] = useState<Record<string, SupplierFinancialSummary>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [city, setCity] = useState('')
  const [account, setAccount] = useState('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [archive, setArchive] = useState<Supplier>()
  const [toast, setToast] = useState('')
  const loc = useLocation()
  const nav = useNavigate()
  const routeNotice = (loc.state as { notice?: string } | null)?.notice
  const visibleToast = toast || routeNotice

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await supplierService.getSuppliers()
      setList(rows)

      const pairs: Array<readonly [string, SupplierFinancialSummary]> = []
      const batchSize = 6
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize)
        const settled = await Promise.allSettled(
          chunk.map(async (s) => [s.id, await fetchSupplierLedgerSummary(s.id)] as const)
        )
        for (const res of settled) {
          if (res.status === 'fulfilled') {
            pairs.push(res.value)
          } else if (!(res.reason instanceof ApiError && res.reason.status === 403)) {
            setError((prev) =>
              prev ||
              (res.reason instanceof Error
                ? res.reason.message
                : 'Unable to load supplier financial balances.')
            )
          }
        }
      }

      setSummaries(Object.fromEntries(pairs))
    } catch (err: unknown) {
      setList([])
      setSummaries({})
      setError(err instanceof Error ? err.message : 'Unable to load suppliers from server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () =>
      list
        .filter(
          (s) =>
            [s.name, s.supplierCode, s.companyName, s.contactPerson, s.phone, s.email, s.taxNumber].some(
              (x) => !q || x?.toLowerCase().includes(q.toLowerCase())
            ) &&
            (!status || s.status === status) &&
            (!type || s.type === type) &&
            (!city || s.city === city) &&
            (!account ||
              (account === 'outstanding'
                ? (summaries[s.id]?.outstandingPayable ?? 0) > 0
                : account === 'advance'
                  ? (summaries[s.id]?.advanceBalance ?? 0) > 0
                  : (summaries[s.id]?.outstandingPayable ?? 0) === 0 &&
                    (summaries[s.id]?.advanceBalance ?? 0) === 0))
        )
        .sort((a, b) =>
          sort === 'newest'
            ? b.createdAt.localeCompare(a.createdAt)
            : sort === 'payable'
              ? (summaries[b.id]?.outstandingPayable ?? 0) -
                (summaries[a.id]?.outstandingPayable ?? 0)
              : a.name.localeCompare(b.name)
        ),
    [list, q, status, type, city, account, summaries, sort]
  )

  const outstanding = Object.values(summaries).reduce((n, s) => n + s.outstandingPayable, 0)
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const rows = filtered.slice((page - 1) * size, page * size)
  const cities = [...new Set(list.map((s) => s.city).filter(Boolean))] as string[]

  const exportCsv = () => {
    const csv = [
      ['Supplier', 'Code', 'Company', 'Contact', 'Phone', 'Email', 'City', 'Status', 'Payable'],
      ...filtered.map((s) => [
        s.name,
        s.supplierCode,
        s.companyName ?? '',
        s.contactPerson ?? '',
        s.phone ?? '',
        s.email ?? '',
        s.city ?? '',
        s.status,
        String(summaries[s.id]?.outstandingPayable ?? 0),
      ]),
    ]
      .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'pos-suppliers.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const confirmArchive = async () => {
    if (!archive) return
    setError(null)
    try {
      await supplierService.archiveSupplier(archive.id)
      const archivedName = archive.name
      setArchive(undefined)
      setToast(`${archivedName} archived.`)
      await load()
    } catch (err: unknown) {
      setArchive(undefined)
      setError(err instanceof Error ? err.message : 'Unable to archive supplier.')
    }
  }

  const toggle = async (s: Supplier) => {
    setError(null)
    try {
      await supplierService.updateSupplierStatus(s.id, s.status === 'active' ? 'inactive' : 'active')
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update supplier status.')
    }
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Manage your suppliers, purchases and outstanding payables."
        action={
          <div className="flex gap-2">
            <Button onClick={exportCsv}>
              <Download size={15} />
              Export
            </Button>
            <Link to="/suppliers/new">
              <Button variant="primary">
                <Plus size={15} />
                Add supplier
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
          ['Total suppliers', list.length],
          ['Active suppliers', list.filter((s) => s.status === 'active').length],
          [
            'With outstanding payable',
            list.filter((s) => (summaries[s.id]?.outstandingPayable ?? 0) > 0).length,
          ],
          ['Outstanding payables', formatCurrency(outstanding)],
        ].map(([x, v]) => (
          <Card key={String(x)} className="p-4">
            <p className="text-xs text-slate-500">{x}</p>
            <p className="mt-2 text-xl font-bold">{v}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <input
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="Search suppliers…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border p-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
        <select
          className="rounded-lg border p-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="individual">Individual</option>
          <option value="business">Business</option>
        </select>
        <select
          className="rounded-lg border p-2 text-sm"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">All accounts</option>
          <option value="clear">Clear</option>
          <option value="outstanding">Outstanding</option>
          <option value="advance">Advance</option>
        </select>
        <select
          className="rounded-lg border p-2 text-sm"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        >
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          className="rounded-lg border p-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">Name A–Z</option>
          <option value="newest">Recently added</option>
          <option value="payable">Highest payable</option>
        </select>
      </Card>

      {visibleToast && (
        <p role="status" className="mb-3 rounded bg-emerald-50 p-3 text-sm text-emerald-700">
          {visibleToast}
          <button
            type="button"
            className="ml-3"
            onClick={() => {
              setToast('')
              if (routeNotice) nav(loc.pathname, { replace: true, state: null })
            }}
          >
            Dismiss
          </button>
        </p>
      )}

      {loading ? (
        <p role="status" className="p-8 text-center text-sm">
          Loading suppliers…
        </p>
      ) : !rows.length ? (
        <EmptyState
          icon={Truck}
          title={error ? 'Unable to load suppliers' : 'No suppliers found'}
          description={
            error ? 'Retry fetching suppliers from the server.' : 'Adjust filters or create a supplier.'
          }
          action={
            error ? (
              <Button onClick={() => void load()}>Retry</Button>
            ) : (
              <Link to="/suppliers/new">
                <Button variant="primary">Add supplier</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    {[
                      'Supplier',
                      'Code',
                      'Contact',
                      'Phone',
                      'Email',
                      'City',
                      'Purchases',
                      'Payable',
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
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-3">
                        <Link to={`/suppliers/${s.id}`} className="font-semibold text-slate-800">
                          {s.name}
                        </Link>
                        <div className="text-slate-400">{s.companyName}</div>
                      </td>
                      <td>{s.supplierCode}</td>
                      <td>{s.contactPerson ?? '—'}</td>
                      <td>{s.phone ?? '—'}</td>
                      <td>{s.email ?? '—'}</td>
                      <td>{s.city ?? '—'}</td>
                      <td>{formatCurrency(summaries[s.id]?.totalPurchases ?? 0)}</td>
                      <td>{formatCurrency(summaries[s.id]?.outstandingPayable ?? 0)}</td>
                      <td>
                        {summaries[s.id]?.lastPurchaseDate
                          ? formatBusinessDate(new Date(summaries[s.id].lastPurchaseDate!))
                          : '—'}
                      </td>
                      <td>{s.status}</td>
                      <td className="space-x-2">
                        <Link to={`/suppliers/${s.id}`} className="text-blue-600">
                          View
                        </Link>
                        <Link to={`/suppliers/${s.id}/edit`} className="text-blue-600">
                          Edit
                        </Link>
                        <button type="button" className="text-blue-600" onClick={() => void toggle(s)}>
                          {s.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                        {s.status !== 'archived' && (
                          <button type="button" className="text-rose-600" onClick={() => setArchive(s)}>
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="divide-y md:hidden">
            {rows.map((s) => (
              <article key={s.id} className="p-4">
                <Link to={`/suppliers/${s.id}`} className="font-semibold">
                  {s.name}
                </Link>
                <p className="text-xs text-slate-500">
                  {s.supplierCode} · {s.phone ?? 'No phone'}
                </p>
                <p className="mt-2 flex justify-between text-xs">
                  <span>
                    {s.city} · {s.status}
                  </span>
                  <span>{formatCurrency(summaries[s.id]?.outstandingPayable ?? 0)} payable</span>
                </p>
                <div className="mt-3 flex gap-4 text-xs">
                  <Link to={`/suppliers/${s.id}/edit`} className="text-blue-600">
                    Edit
                  </Link>
                  <button type="button" onClick={() => void toggle(s)} className="text-blue-600">
                    {s.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  {s.status !== 'archived' && (
                    <button type="button" onClick={() => setArchive(s)} className="text-rose-600">
                      Archive
                    </button>
                  )}
                </div>
              </article>
            ))}
          </Card>

          <div className="mt-4 flex items-center justify-between text-xs">
            <span>{filtered.length} suppliers</span>
            <div className="flex items-center gap-2">
              <select
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value))
                  setPage(1)
                }}
                className="rounded border p-2"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
              <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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

      <Modal open={Boolean(archive)} onClose={() => setArchive(undefined)} title="Archive supplier?">
        <p className="text-sm text-slate-600">
          Archive {archive?.name}? Existing purchase and payment history remains available.
          {(summaries[archive?.id ?? '']?.outstandingPayable ?? 0) > 0 && (
            <span className="mt-3 block rounded bg-amber-50 p-3 text-amber-800">
              Outstanding payable: {formatCurrency(summaries[archive?.id ?? '']?.outstandingPayable ?? 0)}.
            </span>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setArchive(undefined)}>Cancel</Button>
          <Button variant="primary" onClick={() => void confirmArchive()}>
            Archive supplier
          </Button>
        </div>
      </Modal>
    </>
  )
}

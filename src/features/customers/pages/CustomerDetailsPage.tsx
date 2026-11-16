import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Mail, Phone, Pencil } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { Modal } from '../../../components/ui/Modal'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { ApiError } from '../../../lib/api-client'
import { customerService } from '../services/customerService'
import type {
  Customer,
  CustomerFinancialSummary,
  CustomerInvoice,
  CustomerPayment,
} from '../types/customer.types'

export function CustomerDetailsPage() {
  const { id = '' } = useParams()
  const [customer, setCustomer] = useState<Customer>()
  const [summary, setSummary] = useState<CustomerFinancialSummary>()
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([])
  const [payments, setPayments] = useState<CustomerPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [secondaryError, setSecondaryError] = useState<string | null>(null)
  const [archive, setArchive] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSecondaryError(null)
    try {
      const found = await customerService.getCustomerById(id)
      setCustomer(found)
      if (!found) {
        setSummary(undefined)
        setInvoices([])
        setPayments([])
        return
      }

      const [sumRes, invRes, payRes] = await Promise.allSettled([
        customerService.getCustomerFinancialSummary(id),
        customerService.getCustomerPurchaseHistory(id),
        customerService.getCustomerPaymentHistory(id),
      ])

      if (sumRes.status === 'fulfilled') {
        setSummary(sumRes.value)
      } else if (!(sumRes.reason instanceof ApiError && sumRes.reason.status === 403)) {
        setSecondaryError((prev) =>
          prev ||
          (sumRes.reason instanceof Error
            ? sumRes.reason.message
            : 'Unable to load financial summary.')
        )
      }

      if (invRes.status === 'fulfilled') {
        setInvoices([...invRes.value].sort((a, b) => b.date.localeCompare(a.date)))
      } else if (!(invRes.reason instanceof ApiError && invRes.reason.status === 403)) {
        setSecondaryError((prev) =>
          prev ||
          (invRes.reason instanceof Error
            ? invRes.reason.message
            : 'Unable to load purchase history.')
        )
      }

      if (payRes.status === 'fulfilled') {
        setPayments([...payRes.value].sort((a, b) => b.date.localeCompare(a.date)))
      } else if (!(payRes.reason instanceof ApiError && payRes.reason.status === 403)) {
        setSecondaryError((prev) =>
          prev ||
          (payRes.reason instanceof Error
            ? payRes.reason.message
            : 'Unable to load payment history.')
        )
      }
    } catch (err: unknown) {
      setCustomer(undefined)
      setError(err instanceof Error ? err.message : 'Failed to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) {
      void load()
    } else {
      setLoading(false)
    }
  }, [id, load])

  const handleArchive = async () => {
    if (!customer) return
    setSecondaryError(null)
    try {
      await customerService.archiveCustomer(customer.id)
      navigate('/customers', { state: { notice: `${customer.name} archived.` } })
    } catch (err: unknown) {
      setArchive(false)
      setSecondaryError(err instanceof Error ? err.message : 'Unable to archive customer.')
    }
  }

  if (loading) {
    return (
      <p role="status" className="p-8 text-center text-sm text-slate-500">
        Loading customer details…
      </p>
    )
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Unable to load customer"
          description="An error occurred while fetching customer information from the server."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
              <Link to="/customers">
                <Button>Back to customers</Button>
              </Link>
            </div>
          }
        />
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </div>
      </>
    )
  }

  if (!customer) {
    return (
      <PageHeader
        title="Customer not found"
        description="This customer is not available."
        action={
          <Link to="/customers">
            <Button>Back to customers</Button>
          </Link>
        }
      />
    )
  }

  const edit = () => navigate(`/customers/${customer.id}/edit`)

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.customerCode} · ${customer.type === 'business' ? 'Business' : 'Individual'} · ${customer.status}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to={`/customers/${customer.id}/ledger`}>
              <Button>View ledger</Button>
            </Link>
            {!customer.isWalkIn && (
              <Link to={`/payments/new?customerId=${customer.id}`}>
                <Button>Receive payment</Button>
              </Link>
            )}
            <Button variant="primary" onClick={edit}>
              <Pencil size={14} />
              Edit customer
            </Button>
            {!customer.isWalkIn && <Button onClick={() => setArchive(true)}>Archive</Button>}
          </div>
        }
      />

      {secondaryError && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{secondaryError}</span>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ['Total purchases', summary?.totalPurchases ?? 0],
          ['Total paid', summary?.totalPaid ?? 0],
          ['Outstanding', summary?.outstandingBalance ?? 0],
          ['Advance balance', summary?.advanceBalance ?? 0],
        ].map(([n, v]) => (
          <Card key={String(n)} className="p-4">
            <p className="text-xs text-slate-500">{n}</p>
            <p className="mt-2 text-lg font-bold">{formatCurrency(Number(v))}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-bold">Customer information</h2>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {[
              ['Code', customer.customerCode],
              ['Type', customer.type],
              ['Company', customer.companyName],
              ['Phone', customer.phone],
              ['Email', customer.email],
              ['Tax number', customer.taxNumber],
              ['Address', customer.address],
              ['City', customer.city],
              ['Created', formatBusinessDate(new Date(customer.createdAt))],
              ['Updated', formatBusinessDate(new Date(customer.updatedAt))],
            ].map(([k, v]) => (
              <div key={String(k)} className="border-b border-slate-100 py-2">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="mt-1 break-words">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          {customer.notes && <p className="mt-4 text-sm text-slate-600">{customer.notes}</p>}
          <div className="mt-4 flex gap-3">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} aria-label="Call customer" className="text-blue-600">
                <Phone size={15} />
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} aria-label="Email customer" className="text-blue-600">
                <Mail size={15} />
              </a>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden p-5">
          <h2 className="font-bold">Purchase history</h2>
          {invoices.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr>
                    {['Invoice', 'Date', 'Total', 'Paid', 'Due', 'Status'].map((x) => (
                      <th key={x} className="p-2">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const due = Math.max(0, Number((i.totalAmount - i.paidAmount).toFixed(2)))
                    return (
                      <tr key={i.id} className="border-t">
                        <td className="p-2">
                          <Link to={`/invoices/${i.saleId || i.id}`} className="text-blue-600">
                            {i.invoiceNumber}
                          </Link>
                        </td>
                        <td>{i.date ? formatBusinessDate(new Date(i.date)) : '—'}</td>
                        <td>{formatCurrency(i.totalAmount)}</td>
                        <td>{formatCurrency(i.paidAmount)}</td>
                        <td>{formatCurrency(due)}</td>
                        <td className="capitalize">{i.paymentStatus}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No purchase history.</p>
          )}
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden p-5">
        <h2 className="font-bold">Payment history</h2>
        {payments.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-xs">
              <thead>
                <tr>
                  {['Receipt', 'Date', 'Method', 'Amount', 'Invoices', 'Advance'].map((x) => (
                    <th key={x} className="p-2">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">
                      <Link to={`/payments/${p.id}`} className="text-blue-600">
                        {p.reference}
                      </Link>
                    </td>
                    <td>{p.date ? formatBusinessDate(new Date(p.date)) : '—'}</td>
                    <td className="capitalize">{p.method}</td>
                    <td>{formatCurrency(p.amount)}</td>
                    <td>{p.invoiceNumber || '—'}</td>
                    <td>{formatCurrency(p.unallocatedAmount ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No payments yet"
            description="Payments recorded for this customer will appear here."
          />
        )}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="font-bold">Recent activity</h2>
        <p className="mt-3 text-sm text-slate-600">
          Customer created · {formatBusinessDate(new Date(customer.createdAt))}
        </p>
        {summary?.lastPurchaseDate && (
          <p className="mt-2 text-sm text-slate-600">
            Purchase completed · {formatBusinessDate(new Date(summary.lastPurchaseDate))}
          </p>
        )}
      </Card>

      <Modal open={archive} onClose={() => setArchive(false)} title="Archive customer?">
        <p className="text-sm text-slate-600">
          Historical records remain available.
          {(summary?.outstandingBalance ?? 0) > 0 && (
            <span className="mt-2 block rounded bg-amber-50 p-3 text-amber-800">
              Outstanding balance: {formatCurrency(summary?.outstandingBalance ?? 0)}.
            </span>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setArchive(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleArchive()}>
            Archive
          </Button>
        </div>
      </Modal>
    </>
  )
}

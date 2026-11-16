import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { useOptionalAuth } from '../../auth/context/useAuth'
import { fetchPaymentById, getPaymentById, getPayments, paymentSourceLabel } from '../services/paymentService'
import type { CustomerPayment } from '../types/payment.types'
import { getSales } from '../../pos/services/checkoutService'
import './payment.css'

export function PaymentDetailsPage() {
  const { paymentId = '' } = useParams()
  const location = useLocation()
  const auth = useOptionalAuth()
  const businessName = auth?.activeBusiness?.name || 'Store Workspace'
  const [payment, setPayment] = useState<CustomerPayment | null>(() => getPaymentById(paymentId) ?? null)
  const [loading, setLoading] = useState(!payment)

  useEffect(() => {
    let active = true
    if (!payment) {
      setLoading(true)
      void fetchPaymentById(paymentId).then((res) => {
        if (active) {
          setPayment(res)
          setLoading(false)
        }
      })
    }
    return () => { active = false }
  }, [paymentId])

  const notice = (location.state as { notice?: string } | null)?.notice
  if (loading) return <div className="p-8 text-center text-sm text-slate-500" role="status">Loading payment receipt…</div>
  if (!payment) return <PageHeader title="Payment not found" description="This receipt is not available in the payment repository." action={<Link to="/payments"><Button>Back to payments</Button></Link>} />
  return <div className="payment-receipt"><PageHeader title="Payment receipt" description={`${payment.receiptNumber} · ${formatBusinessDate(new Date(payment.receivedAt), { dateStyle: 'long', timeStyle: 'short' })}`} action={<div className="flex gap-2"><Link to="/payments"><Button>Back to payments</Button></Link><Button variant="primary" onClick={() => window.print()}>Print receipt</Button></div>} />
    {notice && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <Card className="payment-receipt-content mx-auto max-w-3xl p-5 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{businessName} · Customer payment</p><p className="mt-1 text-sm text-slate-500">Business contact details</p><h2 className="mt-3 text-2xl font-bold">{payment.receiptNumber}</h2><p className="mt-1 text-sm text-slate-500">{paymentSourceLabel(payment.source)}</p></div><p className="text-2xl font-bold">{formatCurrency(payment.amount)}</p></div>
      <div className="grid gap-5 py-5 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Received from</p><p className="mt-1 font-semibold">{payment.customerSnapshot.name}</p><p className="text-sm text-slate-500">{payment.customerSnapshot.customerCode ?? ''}{payment.customerSnapshot.phone ? ` · ${payment.customerSnapshot.phone}` : ''}</p>{payment.customerSnapshot.address && <p className="text-sm text-slate-500">{payment.customerSnapshot.address}</p>}</div><div><p className="text-xs text-slate-500">Received by</p><p className="mt-1 font-semibold">{payment.receivedBy}</p><p className="text-sm text-slate-500">{formatBusinessDate(new Date(payment.receivedAt), { dateStyle: 'medium', timeStyle: 'short' })}</p></div></div>
      <h3 className="border-t pt-4 font-semibold">Payment methods</h3><div className="mt-2 divide-y">{payment.methodBreakdown.map(m => <div className="flex justify-between py-2 text-sm" key={m.id}><span>{m.method.replace('_', ' ')}{m.reference ? ` · ${m.reference}` : ''}</span><span>{formatCurrency(m.amount)}</span></div>)}</div>
      <h3 className="mt-5 border-t pt-4 font-semibold">Invoice allocations</h3>{payment.allocations.length ? <div className="mt-2 divide-y">{payment.allocations.map(a => { const sale = getSales().find(item => item.id === a.saleId); const applied = getPayments().filter(item => item.receivedAt < payment.receivedAt || (item.receivedAt === payment.receivedAt && item.id <= payment.id)).flatMap(item => item.allocations).filter(item => item.saleId === a.saleId).reduce((sum, item) => sum + item.amount, 0); const remaining = Math.max(0, (sale?.totalAmount ?? 0) - applied); return <div className="grid gap-1 py-2 text-sm sm:grid-cols-[1fr_auto_auto]" key={a.saleId}><Link className="text-blue-600" to={`/invoices/${a.saleId}`}>{a.invoiceNumber}</Link><span>Applied {formatCurrency(a.amount)}</span><span>Balance after: {formatCurrency(remaining)}</span></div> })}</div> : <p className="mt-2 text-sm text-slate-500">No invoice allocation.</p>}
      <div className="mt-4 flex justify-between border-t pt-4 text-sm"><span>Held as customer advance</span><strong>{formatCurrency(payment.unallocatedAmount)}</strong></div>{payment.notes && <p className="mt-4 rounded bg-slate-50 p-3 text-sm"><strong>Notes:</strong> {payment.notes}</p>}
      {payment.customerId && payment.customerId !== 'walk-in' && <Link className="mt-5 inline-block text-sm text-blue-600 print:hidden" to={`/customers/${payment.customerId}/account`}>View customer ledger</Link>}
    </Card>
  </div>
}

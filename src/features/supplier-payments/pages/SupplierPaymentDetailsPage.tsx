import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { getSupplierPaymentById } from '../services/supplierPaymentService'
import './supplierPayment.css'

export function SupplierPaymentDetailsPage() {
  const { paymentId = '' } = useParams()
  const payment = getSupplierPaymentById(paymentId)
  if (!payment) return <PageHeader title="Payment not found" description="This supplier payment does not exist." action={<Link to="/supplier-payments"><Button>Back to payments</Button></Link>} />
  const allocated = payment.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
  return <><PageHeader title={payment.receiptNumber} description="Supplier payment receipt · immutable transaction" action={<div className="no-print flex gap-2"><Button onClick={() => window.print()}>Print receipt</Button><Link to="/supplier-payments"><Button>Back to payments</Button></Link></div>} />
    <Card className="supplier-payment-print mx-auto max-w-3xl p-6 sm:p-10"><div className="flex flex-wrap justify-between gap-4 border-b pb-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Supplier payment receipt</p><h2 className="mt-1 text-2xl font-bold">{payment.receiptNumber}</h2></div><div className="text-sm sm:text-right"><p>{formatBusinessDate(new Date(payment.paidAt), { dateStyle: 'medium', timeStyle: 'short' })}</p><p className="text-xs text-slate-500">Recorded by {payment.paidBy}</p></div></div>
      <div className="grid gap-4 border-b py-5 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Paid by / supplier</p><Link className="font-semibold text-blue-600" to={`/suppliers/${payment.supplierId}`}>{payment.supplierSnapshot.name}</Link><p className="text-xs text-slate-500">{payment.supplierSnapshot.supplierCode}{payment.supplierSnapshot.companyName ? ` · ${payment.supplierSnapshot.companyName}` : ''}</p></div><div className="sm:text-right"><p className="text-xs text-slate-500">Total paid</p><p className="text-2xl font-bold">{formatCurrency(payment.amount)}</p></div></div>
      <section className="border-b py-5"><h3 className="font-semibold">Payment method breakdown</h3><div className="mt-2 divide-y">{payment.methodBreakdown.map(method => <div key={method.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="capitalize">{method.method.replace('_', ' ')}{method.reference && <span className="text-slate-500"> · {method.reference}</span>}</span><strong>{formatCurrency(method.amount)}</strong></div>)}</div></section>
      <section className="border-b py-5"><h3 className="font-semibold">Purchase allocations</h3>{payment.allocations.length ? <div className="mt-2 divide-y">{payment.allocations.map(allocation => <div key={allocation.purchaseId} className="flex justify-between gap-3 py-2 text-sm"><Link className="text-blue-600" to={`/purchases/${allocation.purchaseId}`}>{allocation.purchaseNumber}</Link><strong>{formatCurrency(allocation.amount)}</strong></div>)}</div> : <p className="mt-2 text-sm text-slate-500">No purchase bill allocation.</p>}<div className="mt-3 flex justify-between border-t pt-3 text-sm"><span>Allocated</span><strong>{formatCurrency(allocated)}</strong></div><div className="mt-2 flex justify-between text-sm"><span>Retained as supplier advance</span><strong>{formatCurrency(payment.unallocatedAmount)}</strong></div></section>
      {payment.notes && <section className="py-5"><h3 className="font-semibold">Notes</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{payment.notes}</p></section>}
      <p className="pt-4 text-center text-xs text-slate-400">This receipt records a payment. It does not represent goods received.</p>
    </Card>
  </>
}

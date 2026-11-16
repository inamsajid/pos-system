import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { ApiError } from '../../../lib/api-client'
import { supplierService } from '../services/supplierService'
import type {
  Supplier,
  SupplierFinancialSummary,
  SupplierPayment,
  SupplierPurchase,
} from '../types/supplier.types'

type SuppliedProducts = Awaited<ReturnType<typeof supplierService.getSupplierProducts>>

export function SupplierDetailsPage() {
  const { supplierId = '' } = useParams()
  const [supplier, setSupplier] = useState<Supplier>()
  const [summary, setSummary] = useState<SupplierFinancialSummary>()
  const [products, setProducts] = useState<SuppliedProducts>([])
  const [purchases, setPurchases] = useState<SupplierPurchase[]>([])
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [secondaryError, setSecondaryError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSecondaryError(null)
    try {
      const found = await supplierService.getSupplierById(supplierId)
      setSupplier(found)
      if (!found) {
        setSummary(undefined)
        setProducts([])
        setPurchases([])
        setPayments([])
        return
      }

      const [sumRes, prodRes, purRes, payRes] = await Promise.allSettled([
        supplierService.getSupplierFinancialSummary(supplierId),
        supplierService.getSupplierProducts(supplierId),
        supplierService.getSupplierPurchaseHistory(supplierId),
        supplierService.getSupplierPaymentHistory(supplierId),
      ])

      if (sumRes.status === 'fulfilled') {
        setSummary(sumRes.value)
      } else if (!(sumRes.reason instanceof ApiError && sumRes.reason.status === 403)) {
        setSecondaryError((prev) =>
          prev ||
          (sumRes.reason instanceof Error
            ? sumRes.reason.message
            : 'Unable to load supplier financial summary.')
        )
      }

      if (prodRes.status === 'fulfilled') {
        setProducts(prodRes.value)
      } else if (!(prodRes.reason instanceof ApiError && prodRes.reason.status === 403)) {
        setSecondaryError((prev) =>
          prev ||
          (prodRes.reason instanceof Error
            ? prodRes.reason.message
            : 'Unable to load supplied products.')
        )
      }

      if (purRes.status === 'fulfilled') {
        setPurchases([...purRes.value].sort((a, b) => b.date.localeCompare(a.date)))
      } else if (!(purRes.reason instanceof ApiError && purRes.reason.status === 403)) {
        setSecondaryError((prev) =>
          prev ||
          (purRes.reason instanceof Error
            ? purRes.reason.message
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
            : 'Unable to load supplier payment history.')
        )
      }
    } catch (err: unknown) {
      setSupplier(undefined)
      setError(err instanceof Error ? err.message : 'Failed to load supplier details.')
    } finally {
      setLoading(false)
    }
  }, [supplierId])

  useEffect(() => {
    if (supplierId) {
      void load()
    } else {
      setLoading(false)
    }
  }, [supplierId, load])

  if (loading) {
    return (
      <p role="status" className="p-8 text-center text-sm text-slate-500">
        Loading supplier details…
      </p>
    )
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Unable to load supplier"
          description="An error occurred while fetching supplier information from the server."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
              <Link to="/suppliers">
                <Button>Back to suppliers</Button>
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

  if (!supplier) {
    return (
      <PageHeader
        title="Supplier not found"
        description="This supplier is not in the catalog."
        action={
          <Link to="/suppliers">
            <Button>Back to suppliers</Button>
          </Link>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        title={supplier.name}
        description={`${supplier.supplierCode} · ${supplier.companyName ?? supplier.type} · ${supplier.status}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to={`/suppliers/${supplier.id}/ledger`}>
              <Button>View ledger</Button>
            </Link>
            <Link to={`/supplier-payments/new?supplierId=${supplier.id}`}>
              <Button>Record payment</Button>
            </Link>
            <Link to={`/suppliers/${supplier.id}/edit`}>
              <Button variant="primary">Edit supplier</Button>
            </Link>
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

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[
          ['Purchases', summary?.totalPurchases ?? 0],
          ['Payments', summary?.totalPaid ?? 0],
          ['Outstanding bills', summary?.outstandingPayable ?? 0],
          ['Opening payable', summary?.openingPayable ?? 0],
          ['Advance balance', summary?.advanceBalance ?? 0],
        ].map(([label, value]) => (
          <Card className="p-4" key={String(label)}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 font-bold">{formatCurrency(Number(value))}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-5 p-5">
        <h2 className="font-bold">Supplier information</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Contact person', supplier.contactPerson],
            ['Phone', supplier.phone],
            ['Alternate phone', supplier.alternatePhone],
            ['Email', supplier.email],
            ['Tax number', supplier.taxNumber],
            ['Address', supplier.address],
            ['City', supplier.city],
            ['Country', supplier.country],
            ['Created', formatBusinessDate(new Date(supplier.createdAt))],
            ['Updated', formatBusinessDate(new Date(supplier.updatedAt))],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
        {supplier.phone && (
          <a className="mr-4 inline-block text-xs text-blue-600" href={`tel:${supplier.phone}`}>
            Call supplier
          </a>
        )}
        {supplier.email && (
          <a className="text-xs text-blue-600" href={`mailto:${supplier.email}`}>
            Email supplier
          </a>
        )}
      </Card>

      <Card className="mb-5 min-w-0 overflow-hidden p-5">
        <h2 className="font-bold">
          Supplied products{' '}
          <span className="text-xs font-normal text-slate-400">(supplier catalog associations)</span>
        </h2>
        {products.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead>
                <tr>
                  {['Product', 'SKU', 'Category', 'Purchase price', 'Stock', 'Status'].map((title) => (
                    <th className="p-2" key={title}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(({ association, product, category }) => (
                  <tr className="border-t" key={association.id}>
                    <td className="p-2">
                      <Link className="text-blue-600" to={`/products/${product.id}`}>
                        {product.name}
                      </Link>
                      {association.isPreferred && <span className="ml-2 text-emerald-600">Preferred</span>}
                    </td>
                    <td>{product.sku}</td>
                    <td>{category}</td>
                    <td>{formatCurrency(association.purchasePrice ?? product.purchasePrice)}</td>
                    <td>{product.trackInventory ? product.stockQuantity : 'Not tracked'}</td>
                    <td>{product.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No product associations for this supplier.</p>
        )}
      </Card>

      <Card className="mb-5 min-w-0 overflow-hidden p-5">
        <div className="flex justify-between gap-2">
          <div>
            <h2 className="font-bold">Purchase history</h2>
            <p className="text-xs text-slate-500">Drafts, orders and receipts linked to this supplier.</p>
          </div>
          <Link className="text-sm text-blue-600" to={`/purchases/new?supplierId=${supplier.id}`}>
            New purchase
          </Link>
        </div>
        {purchases.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr>
                  {['Purchase', 'Date', 'Items', 'Total', 'Paid', 'Status', 'Actions'].map((title) => (
                    <th key={title} className="p-2">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr className="border-t" key={purchase.id}>
                    <td className="p-2">{purchase.reference}</td>
                    <td>{purchase.date ? formatBusinessDate(new Date(purchase.date)) : '—'}</td>
                    <td>{purchase.items}</td>
                    <td>{formatCurrency(purchase.totalAmount)}</td>
                    <td>{formatCurrency(purchase.paidAmount)}</td>
                    <td className="capitalize">{purchase.status.replace('_', ' ')}</td>
                    <td>
                      <Link className="text-blue-600" to={`/purchases/${purchase.id}`}>
                        View purchase
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No purchases recorded.</p>
        )}
      </Card>

      <Card className="mb-5 min-w-0 overflow-hidden p-5">
        <div className="flex justify-between gap-2">
          <div>
            <h2 className="font-bold">Payment history</h2>
            <p className="text-xs text-slate-500">Recorded payment receipts and allocations.</p>
          </div>
          <Link className="text-sm text-blue-600" to={`/supplier-payments?supplier=${supplier.id}`}>
            All payments
          </Link>
        </div>
        {payments.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead>
                <tr>
                  {['Receipt', 'Date', 'Method', 'Amount', 'Purchase reference', 'Advance'].map(
                    (title) => (
                      <th key={title} className="p-2">
                        {title}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t">
                    <td className="p-2">
                      <Link className="text-blue-600" to={`/supplier-payments/${payment.id}`}>
                        {payment.reference}
                      </Link>
                    </td>
                    <td>{payment.date ? formatBusinessDate(new Date(payment.date)) : '—'}</td>
                    <td className="capitalize">{payment.method}</td>
                    <td>{formatCurrency(payment.amount)}</td>
                    <td>{payment.purchaseReference || '—'}</td>
                    <td>{formatCurrency(payment.unallocatedAmount ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No supplier payments recorded.</p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-bold">Recent activity</h2>
        <p className="mt-2 text-sm text-slate-600">
          Supplier created · {formatBusinessDate(new Date(supplier.createdAt))}
        </p>
        {summary?.lastPurchaseDate && (
          <p className="mt-2 text-sm text-slate-600">
            Purchase recorded · {formatBusinessDate(new Date(summary.lastPurchaseDate))}
          </p>
        )}
      </Card>
    </>
  )
}

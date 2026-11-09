import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { formatBusinessDate, isWithinBusinessDateRange } from '../../../lib/businessDate'
import { useProducts } from '../../products/hooks/useProducts'
import { categoryService } from '../../categories/services/categoryService'
import { getInventoryMovement, getInventoryMovements, fetchInventoryMovements } from '../services/inventoryService'
import type { StockMovement, StockMovementType } from '../types/inventory.types'

const labels: Record<StockMovementType, string> = { opening_stock: 'Opening stock', purchase_receipt: 'Purchase receipt', sale: 'Sale', adjustment_in: 'Adjustment in', adjustment_out: 'Adjustment out', stock_count_adjustment: 'Stock count' }
const types = Object.entries(labels) as Array<[StockMovementType, string]>
function referenceLink(movement: StockMovement) {
  if (!movement.referenceId) return movement.referenceNumber ?? '—'
  if (movement.referenceType === 'sale') return <Link className="text-blue-600" to={`/sales/${movement.referenceId}`}>{movement.referenceNumber}</Link>
  if (movement.referenceType === 'purchase') return <Link className="text-blue-600" to={`/purchases/${movement.referenceId}`}>{movement.referenceNumber}</Link>
  return movement.referenceNumber ?? '—'
}

export function InventoryMovementsPage() {
  const { movementId } = useParams()
  const [searchParams] = useSearchParams()
  const { products } = useProducts()
  const [all, setAll] = useState<StockMovement[]>(() => getInventoryMovements())
  const detail = movementId ? getInventoryMovement(movementId) : undefined

  useEffect(() => {
    void fetchInventoryMovements().then(setAll)
  }, [])
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [productId, setProductId] = useState(searchParams.get('productId') ?? '')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  useEffect(() => { void categoryService.getCategories().then(items => setCategories(items.map(item => ({ id: item.id, name: item.name })))) }, [])
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products])
  const filtered = useMemo(() => all.filter(movement => {
    const product = productById.get(movement.productId)
    return (!query || [movement.movementNumber, movement.productSnapshot.name, movement.productSnapshot.sku, movement.referenceNumber, movement.reason].some(value => value?.toLowerCase().includes(query.toLowerCase()))) &&
      (!type || movement.type === type) && (!productId || movement.productId === productId) && (!category || product?.categoryId === category) &&
      isWithinBusinessDateRange(movement.createdAt, from, to)
  }).sort((a, b) => sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : sort === 'quantity' ? Math.abs(b.quantityChange) - Math.abs(a.quantityChange) : b.createdAt.localeCompare(a.createdAt)), [all, productById, query, type, productId, category, from, to, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const rows = filtered.slice((page - 1) * size, page * size)
  const clear = () => { setQuery(''); setType(''); setProductId(''); setCategory(''); setFrom(''); setTo(''); setPage(1) }
  const exportCsv = () => {
    const data = [['Movement', 'Date', 'Product', 'SKU', 'Type', 'Change', 'Previous', 'New', 'Reference', 'Created by'], ...filtered.map(m => [m.movementNumber, m.createdAt, m.productSnapshot.name, m.productSnapshot.sku, labels[m.type], String(m.quantityChange), String(m.previousQuantity), String(m.newQuantity), m.referenceNumber ?? '', m.createdBy ?? ''])]
    const csv = data.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'inventory-movements.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  if (movementId) return detail ? <><PageHeader title="Stock movement" description={`${detail.movementNumber} · ${formatBusinessDate(new Date(detail.createdAt), { dateStyle: 'long', timeStyle: 'short' })}`} action={<Link to="/inventory/movements"><Button>Back to movements</Button></Link>} /><Card className="mx-auto max-w-3xl p-5"><div className="grid gap-4 sm:grid-cols-2">{[['Movement type', labels[detail.type]], ['Product', detail.productSnapshot.name], ['SKU', detail.productSnapshot.sku], ['Unit', detail.productSnapshot.unit], ['Quantity change', `${detail.quantityChange > 0 ? '+' : ''}${detail.quantityChange}`], ['Previous stock', detail.previousQuantity], ['New stock', detail.newQuantity], ['Created by', detail.createdBy ?? '—'], ['Reference', referenceLink(detail)], ['Reason', detail.reason ?? '—'], ['Notes', detail.notes ?? '—']].map(([label, value]) => <div key={String(label)}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>)}</div><Link className="mt-5 inline-block text-xs text-blue-600" to={`/products/${detail.productId}`}>View current product</Link></Card></> : <PageHeader title="Movement not found" description="This stock movement is not in the immutable inventory ledger." action={<Link to="/inventory/movements"><Button>Back to movements</Button></Link>} />
  return <><PageHeader title="Inventory movements" description="Immutable history of stock changes across sales, purchases and adjustments." action={<div className="flex gap-2"><Button onClick={exportCsv}>Export CSV</Button><Link to="/inventory"><Button>Back to inventory</Button></Link></div>} />
    <Card className="mb-4 grid min-w-0 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4"><input aria-label="Search movements" placeholder="Movement, product, SKU or reference" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} className="min-w-0 rounded-lg border p-2 text-sm" /><select aria-label="Movement type" value={type} onChange={e => setType(e.target.value)} className="rounded-lg border p-2 text-sm"><option value="">All movement types</option>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Product" value={productId} onChange={e => setProductId(e.target.value)} className="rounded-lg border p-2 text-sm"><option value="">All products</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select><select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border p-2 text-sm"><option value="">All categories</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="From date" type="date" value={from} onChange={e => setFrom(e.target.value)} className="min-w-0 rounded-lg border p-2 text-sm" /><input aria-label="To date" type="date" value={to} onChange={e => setTo(e.target.value)} className="min-w-0 rounded-lg border p-2 text-sm" /><select aria-label="Sort movements" value={sort} onChange={e => setSort(e.target.value)} className="rounded-lg border p-2 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="quantity">Largest change</option></select><Button onClick={clear}>Clear filters</Button></Card>
    {!rows.length ? <EmptyState title="No stock movements" description="Opening stock, sales, receipts and adjustments will appear here." /> : <><Card className="hidden overflow-hidden md:block"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Movement', 'Date and time', 'Product', 'SKU', 'Type', 'Change', 'Previous', 'New', 'Reference', 'Created by'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.map(movement => <tr key={movement.id} className="border-t"><td className="p-3"><Link className="font-semibold text-blue-600" to={`/inventory/movements/${movement.id}`}>{movement.movementNumber}</Link></td><td>{formatBusinessDate(new Date(movement.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</td><td>{movement.productSnapshot.name}</td><td>{movement.productSnapshot.sku}</td><td>{labels[movement.type]}</td><td className={movement.quantityChange > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>{movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange}</td><td>{movement.previousQuantity}</td><td>{movement.newQuantity}</td><td>{referenceLink(movement)}</td><td>{movement.createdBy ?? '—'}</td></tr>)}</tbody></table></div></Card><Card className="divide-y md:hidden">{rows.map(movement => <article key={movement.id} className="p-4"><div className="flex justify-between gap-3"><Link className="break-all font-semibold text-blue-600" to={`/inventory/movements/${movement.id}`}>{movement.movementNumber}</Link><strong className={movement.quantityChange > 0 ? 'text-emerald-700' : 'text-rose-700'}>{movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange} {movement.productSnapshot.unit}</strong></div><p className="mt-1 text-xs text-slate-600">{movement.productSnapshot.name} · {labels[movement.type]}</p><p className="mt-1 text-xs text-slate-500">{formatBusinessDate(new Date(movement.createdAt), { dateStyle: 'medium', timeStyle: 'short' })} · {movement.previousQuantity} → {movement.newQuantity}</p><div className="mt-2 text-xs">{referenceLink(movement)}</div></article>)}</Card><div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span>{filtered.length} movements</span><div className="flex items-center gap-2"><select aria-label="Page size" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }} className="rounded border p-2"><option value={20}>20 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><Button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span>{page}/{pages}</span><Button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button></div></div></>}
  </>
}

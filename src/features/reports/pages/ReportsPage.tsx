import { useState } from 'react'
import { Activity, BarChart3, Boxes, CreditCard, Package, ReceiptText, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { ReportFilterBar } from '../components/ReportFilterBar'
import { ReportStatCard } from '../components/ReportStatCard'
import { ReportPageHeader } from '../components/ReportPageHeader'
import { PaymentDonut, RankingChart, SalesTrendChart } from '../components/ReportCharts'
import { useReportDataset } from '../hooks/useReportDataset'
import { useReportFilters } from '../hooks/useReportFilters'
import { getComparisonMetrics, getReportRows, getSalesSummary, makeMetric } from '../services/reportService'
import { getComparisonRange } from '../utils/reportDateUtils'
import { exportCsv } from '../utils/reportExportUtils'
import './report.css'

const reports = [
  { path: 'sales', label: 'Sales performance', description: 'Completed invoices, discounts, collections and order trends.', icon: TrendingUp },
  { path: 'products', label: 'Product performance', description: 'Product and category sales from historical item snapshots.', icon: Package },
  { path: 'customers', label: 'Customer performance', description: 'Purchasing frequency, sales contribution and customer activity.', icon: Users },
  { path: 'customer-balances', label: 'Customer balances', description: 'Open invoice receivables, advances and aging.', icon: Wallet },
  { path: 'inventory', label: 'Inventory reports', description: 'Current stock levels, receipts, sales and adjustments.', icon: Boxes },
  { path: 'purchases', label: 'Purchase reports', description: 'Purchase orders, receiving status and supplier bills.', icon: ShoppingBag },
  { path: 'suppliers', label: 'Supplier performance', description: 'Purchase value, payments and current supplier payables.', icon: Activity },
  { path: 'payments', label: 'Payment reports', description: 'Posted collections by method and payment source.', icon: CreditCard },
  { path: 'profit', label: 'Profit reports', description: 'Sales and cost coverage with clear data availability.', icon: BarChart3 },
  { path: 'expenses', label: 'Expenses', description: 'Expense analytics are unavailable until expense records are implemented.', icon: ReceiptText },
]

export function ReportsPage() {
  const [revision, setRevision] = useState(0); const { dataset, error, loading } = useReportDataset(revision); const { filters, apply, clear, refresh } = useReportFilters()
  const rows = dataset ? getReportRows(dataset, filters, filters) : undefined
  const summary = rows ? getSalesSummary(rows.sales,rows.salePaid) : undefined
  const comparison = dataset ? getComparisonMetrics(dataset, filters, filters, filters.comparison) : undefined
  const previousRange = getComparisonRange(filters, filters.comparison)
  const previousRows = dataset && previousRange ? getReportRows(dataset, filters, previousRange) : undefined
  const previousOutstanding = previousRows?.customerBalanceRows.reduce((sum, item) => sum + item.outstanding, 0) ?? null
  const outstanding = rows?.customerBalanceRows.reduce((sum, item) => sum + item.outstanding, 0) ?? 0
  const [ranking, setRanking] = useState<'quantity'|'revenue'>('quantity')
  const [generatedAt] = useState(() => new Date())
  const topProducts = rows?.productRows.filter(item => item.quantity > 0).sort((a,b) => ranking === 'quantity' ? b.quantity-a.quantity : b.net-a.net).slice(0,10).map(item => ({ name:item.product.name, value:ranking==='quantity'?item.quantity:item.net })) ?? []
  const topCustomers = rows?.customerRows.filter(item => item.totalSales > 0).sort((a,b)=>b.totalSales-a.totalSales).slice(0,10).map(item=>({name:item.customer.name,value:item.totalSales})) ?? []
  const exportReport = () => { if (!rows) return; exportCsv('reports-overview.csv',['Invoice','Date','Customer','Cashier','Items','Subtotal','Discount','Net sales','Paid','Outstanding'],rows.sales.map(sale=>{const paid=rows.salePaid.get(sale.id)??sale.amountPaid;return[sale.invoiceNumber,sale.createdAt,sale.customerName,sale.cashierName,sale.items.reduce((n,item)=>n+item.quantity,0),sale.subtotal,sale.discountAmount,sale.totalAmount,paid,Math.max(0,sale.totalAmount-paid)]})) }
  if (loading && !dataset) return <div className="p-8 text-center text-sm text-slate-500" role="status">Loading reports…</div>
  if (error && !dataset) return <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
  if (!dataset || !rows || !summary) return null
  const cards = [makeMetric('Total sales',summary.grossSales,comparison?.sales.grossSales??null),makeMetric('Total orders',summary.orders,comparison?.sales.orders??null,'number'),makeMetric('Net sales',summary.netSales,comparison?.sales.netSales??null),makeMetric('Payments received',rows.payments.reduce((sum,payment)=>sum+payment.amount,0),comparison?.collections??null),makeMetric('Gross profit',null,null,'currency','Historical sale costs are not stored.'),makeMetric('Outstanding customer invoices',outstanding,previousOutstanding)]
  return <div className="report-print"><ReportPageHeader title="Reports & Analytics" description="Monitor business performance and understand sales, customers and inventory." onExport={exportReport}/>
    {error&&<p role="status" className="mb-3 rounded bg-amber-50 p-3 text-xs text-amber-900">Some report data could not refresh: {error}</p>}
    <ReportFilterBar key={JSON.stringify(filters)} filters={filters} dataset={dataset} apply={apply} clear={clear} refresh={()=>{setRevision(value=>value+1);refresh()}} />
    <div className="mb-5 grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">{cards.map((metric,index)=><ReportStatCard key={metric.label} metric={metric} icon={[TrendingUp,ReceiptText,BarChart3,CreditCard,Activity,Wallet][index]}/>)}</div>
    <div className="mb-5 grid min-w-0 gap-5 xl:grid-cols-[1.7fr_1fr]"><SalesTrendChart sales={rows.sales} payments={rows.payments} range={filters}/><PaymentDonut payments={rows.payments}/></div>
    <div className="mb-5 grid min-w-0 gap-5 xl:grid-cols-2"><div><div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold">Top-selling products</h2><select aria-label="Product ranking metric" value={ranking} onChange={event=>setRanking(event.target.value as typeof ranking)} className="rounded border p-1.5 text-xs"><option value="quantity">By quantity</option><option value="revenue">By revenue</option></select></div><RankingChart title={ranking==='quantity'?'Quantity sold':'Net revenue'} data={topProducts} dataKey="value" valueLabel={ranking==='quantity'?'Units':'Sales revenue'}/></div><RankingChart title="Top customers by sales" data={topCustomers} dataKey="value" valueLabel="Sales revenue"/></div>
    <Card className="mb-5 overflow-hidden p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Recent transactions</h2><p className="text-xs text-slate-500">Completed sales in the selected report period.</p></div><Link to="/reports/sales"><Button>Open sales report</Button></Link></div>{rows.sales.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Invoice','Date','Customer','Items','Net total','Amount paid','Outstanding','View'].map(label=><th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{[...rows.sales].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,8).map(sale=>{const paid=rows.salePaid.get(sale.id)??sale.amountPaid;return <tr key={sale.id} className="border-t"><td className="p-3"><Link className="text-blue-600" to={`/sales/${sale.id}`}>{sale.invoiceNumber}</Link></td><td>{formatBusinessDate(new Date(sale.createdAt))}</td><td>{sale.customerName}</td><td>{sale.items.reduce((n,item)=>n+item.quantity,0)}</td><td>{formatCurrency(sale.totalAmount)}</td><td>{formatCurrency(paid)}</td><td>{formatCurrency(Math.max(0,sale.totalAmount-paid))}</td><td><Link className="text-blue-600" to={`/invoices/${sale.id}`}>Invoice</Link></td></tr>})}</tbody></table></div>:<p className="py-8 text-center text-sm text-slate-500">No completed sales in this date range.</p>}</Card>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{reports.map(report=><Link to={`/reports/${report.path}${window.location.search}`} key={report.path} className="report-link rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"><div className="flex items-center gap-3"><span className="rounded-lg bg-blue-50 p-2 text-blue-600"><report.icon size={18}/></span><strong className="text-sm">{report.label}</strong></div><p className="mt-3 text-xs text-slate-500">{report.description}</p></Link>)}</div>
    <p className="text-right text-[11px] text-slate-400">Generated {formatBusinessDate(generatedAt,{dateStyle:'medium',timeStyle:'short'})} · Profit and expenses are reported only where source data supports them.</p>
  </div>
}

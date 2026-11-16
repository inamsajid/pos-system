import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleDollarSign, Clock3, Download, Package, ShoppingBag, Users, Wallet, Warehouse } from 'lucide-react'
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Dropdown } from '../../../components/ui/Dropdown'
import { PageHeader } from '../../../components/common/PageHeader'
import { formatCurrency } from '../../../lib/currency'
import { dashboardMetrics, dashboardRanges, lowStockProducts, paymentBreakdown, recentActivities, recentSales, salesByRange, topProducts, type DashboardRange } from '../data/dashboardDemo'
import { fetchDashboardReports } from '../../reports/services/reportService'

const iconMap = { sales: CircleDollarSign, today: Clock3, customers: Users, products: Package, balance: Wallet, stock: Warehouse }

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

function exportDemoSales() {
  const rows = [['Invoice', 'Customer', 'Date', 'Amount (PKR)', 'Status'], ...recentSales.map((sale) => [sale.id, sale.customer, sale.date, String(sale.amount), sale.status])]
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'pos-demo-recent-sales.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('Last 7 months')
  const [liveMetrics, setLiveMetrics] = useState<any>(null)
  const chartData = salesByRange[range]

  useEffect(() => {
    void fetchDashboardReports().then(setLiveMetrics).catch(() => {})
  }, [])

  const metrics = dashboardMetrics.map((m) => {
    if (liveMetrics && !isExplicitDemo()) {
      if (m.icon === 'sales') {
        return { ...m, value: (liveMetrics.sales?.totalCompletedSalesMinor ?? 0) / 100 }
      }
      if (m.icon === 'balance') {
        return { ...m, value: (liveMetrics.collections?.outstandingReceivablesMinor ?? 0) / 100 }
      }
      if (m.icon === 'stock') {
        return { ...m, value: liveMetrics.inventory?.lowStockProductsCount ?? 0 }
      }
      if (m.icon === 'products') {
        return { ...m, value: liveMetrics.inventory?.totalTrackedProducts ?? 0 }
      }
    }
    return m
  })

  return <>
    <PageHeader title="Dashboard" description="Here's what's happening with your business today." action={<Button onClick={exportDemoSales}><Download size={15}/>Export sales</Button>}/>

    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = iconMap[metric.icon]
        const destination = metric.icon === 'stock' ? '/inventory' : undefined
        const content = <><div className="flex items-start justify-between"><div><div className="metric-label">{metric.label}</div><div className="metric-value mt-2">{metric.label.includes('sales') || metric.label.includes('balance') ? formatCurrency(metric.value) : metric.value.toLocaleString('en-PK')}</div></div><span className="rounded-xl bg-slate-50 p-2.5 text-slate-500"><Icon size={19}/></span></div><div className="mt-4 flex items-center gap-1.5 text-[11px]">{metric.tone === 'positive' ? <ArrowUpRight size={14} className="text-emerald-600"/> : metric.tone === 'danger' ? <ArrowDownRight size={14} className="text-rose-600"/> : null}<span className={metric.tone === 'positive' ? 'font-semibold text-emerald-600' : metric.tone === 'danger' ? 'font-semibold text-rose-600' : 'text-slate-500'}>{metric.change}</span><span className="text-slate-400">{metric.tone === 'positive' ? 'vs. last month' : ''}</span></div></>
        return <Card key={metric.label} className="p-5">{destination ? <Link to={destination} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{content}</Link> : content}</Card>
      })}
    </div>

    <div className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
      <Card className="min-w-0 overflow-hidden p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-800">Sales overview</h2><p className="mt-1 text-xs text-slate-400">{range === 'Last 30 days' ? 'Weekly' : 'Monthly'} sales performance · PKR thousands</p></div><Dropdown label={range} options={dashboardRanges} onSelect={(value) => setRange(value as DashboardRange)}/></div><div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{top:8,right:8,left:-20,bottom:0}}><CartesianGrid stroke="#eef2f7" vertical={false}/><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:'#94a3b8',fontSize:11}} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#94a3b8',fontSize:11}}/><Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} /><Line type="monotone" dataKey="sales" stroke="#2563eb" strokeWidth={3} dot={{r:3,fill:'#2563eb',strokeWidth:2,stroke:'#fff'}} activeDot={{r:5}}/></LineChart></ResponsiveContainer></div></Card>

      <Card className="min-w-0 p-5 sm:p-6"><div className="mb-5"><h2 className="text-sm font-bold text-slate-800">Top-selling products</h2><p className="mt-1 text-xs text-slate-400">Best performers this month</p></div><div className="space-y-5">{topProducts.map((product,index)=><div key={product.name} className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><ShoppingBag size={17}/></span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-slate-700">{product.name}</div><div className="mt-1 text-[11px] text-slate-400">{product.units} units sold</div></div><div className="text-right"><div className="text-xs font-semibold text-slate-700">{formatCurrency(product.revenue)}</div><div className="mt-1 text-[10px] text-slate-400">#{index+1}</div></div></div>)}</div><Link to="/products" className="mt-5 flex items-center justify-center gap-1 border-t border-slate-100 pt-4 text-xs font-semibold text-blue-600">View products <ArrowRight size={13}/></Link></Card>
    </div>

    <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="min-w-0 p-5"><div className="mb-3"><h2 className="text-sm font-bold text-slate-800">Payment breakdown</h2><p className="mt-1 text-xs text-slate-400">Sales by payment method</p></div><div className="flex flex-col items-center gap-3 sm:flex-row lg:flex-col xl:flex-row"><div className="h-[170px] w-full min-w-0 sm:w-1/2 lg:w-full xl:w-1/2"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={paymentBreakdown} dataKey="amount" nameKey="method" innerRadius={48} outerRadius={68} paddingAngle={3} stroke="none">{paymentBreakdown.map((entry)=><Cell key={entry.method} fill={entry.color}/>)}</Pie><Tooltip formatter={(value)=>formatCurrency(Number(value))}/></PieChart></ResponsiveContainer></div><div className="w-full space-y-2 sm:w-1/2 lg:w-full xl:w-1/2">{paymentBreakdown.map((entry)=><div key={entry.method} className="flex items-center justify-between gap-2 text-[11px]"><span className="flex min-w-0 items-center gap-2 text-slate-500"><i className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor:entry.color}}/>{entry.method}</span><span className="shrink-0 font-semibold text-slate-700">{entry.share}%</span></div>)}</div></div></Card>

      <Card className="min-w-0 p-5"><div className="mb-4 flex items-start justify-between"><div><h2 className="text-sm font-bold text-slate-800">Low-stock products</h2><p className="mt-1 text-xs text-slate-400">Items below their stock threshold</p></div><Badge tone="warning">12 items</Badge></div><div className="space-y-3">{lowStockProducts.map((product)=><div key={product.sku} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-700">{product.name}</div><div className="mt-1 text-[10px] text-slate-400">SKU {product.sku}</div></div><Badge tone="danger">{product.stock} left</Badge></div>)}</div><Link to="/inventory" className="mt-4 flex items-center justify-center gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-blue-600">Review inventory <ArrowRight size={13}/></Link></Card>

      <Card className="min-w-0 p-5"><div className="mb-4"><h2 className="text-sm font-bold text-slate-800">Recent activity</h2><p className="mt-1 text-xs text-slate-400">Latest updates from your team</p></div><div className="space-y-4">{recentActivities.map((activity)=><div key={activity.id} className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><Users size={14}/></span><div className="min-w-0 flex-1"><p className="text-[11px] leading-5 text-slate-600"><span className="font-semibold text-slate-800">{activity.actor}</span> {activity.action} <span className="font-medium text-slate-700">{activity.detail}</span></p><p className="text-[10px] text-slate-400">{activity.time}</p></div></div>)}</div></Card>
    </div>

    <Card className="min-w-0 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:px-6"><div><h2 className="text-sm font-bold text-slate-800">Recent sales</h2><p className="mt-1 text-xs text-slate-400">Latest transactions · demo data</p></div><Link to="/sales" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700">View sales <ArrowRight size={14}/></Link></div><div className="table-scroll"><table className="w-full min-w-[650px] text-left"><thead className="border-y border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400"><tr><th className="px-6 py-3">Invoice</th><th className="px-6 py-3">Customer</th><th className="px-6 py-3">Date</th><th className="px-6 py-3">Amount</th><th className="px-6 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{recentSales.map((sale)=><tr key={sale.id} className="text-xs"><td className="px-6 py-4 font-semibold text-blue-600">{sale.id}</td><td className="px-6 py-4 font-medium text-slate-700">{sale.customer}</td><td className="px-6 py-4 text-slate-500">{sale.date}</td><td className="px-6 py-4 font-semibold text-slate-700">{formatCurrency(sale.amount)}</td><td className="px-6 py-4"><Badge tone={sale.status==='Completed'?'success':'warning'}>{sale.status}</Badge></td></tr>)}</tbody></table></div></Card>
    <p className="mt-4 text-center text-[10px] text-slate-400">All dashboard figures shown are sample data for visual demonstration.</p>
  </>
}

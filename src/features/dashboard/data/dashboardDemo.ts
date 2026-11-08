export type DashboardRange = 'Last 7 months' | 'Last 30 days' | 'This year'

export const dashboardRanges: DashboardRange[] = ['Last 7 months', 'Last 30 days', 'This year']

export const dashboardMetrics = [
  { label: 'Total sales', value: 2486900, change: '+12.8%', tone: 'positive', icon: 'sales' },
  { label: "Today's sales", value: 84650, change: '+8.2%', tone: 'positive', icon: 'today' },
  { label: 'Total customers', value: 1248, change: '+4.6%', tone: 'positive', icon: 'customers' },
  { label: 'Total products', value: 386, change: '12 low stock', tone: 'warning', icon: 'products' },
  { label: 'Customer balance', value: 186400, change: '34 outstanding', tone: 'neutral', icon: 'balance' },
  { label: 'Low stock products', value: 12, change: 'Needs attention', tone: 'danger', icon: 'stock' },
] as const

export const salesByRange = {
  'Last 7 months': [
    { month: 'May', sales: 320 }, { month: 'Jun', sales: 410 }, { month: 'Jul', sales: 370 },
    { month: 'Aug', sales: 520 }, { month: 'Sep', sales: 460 }, { month: 'Oct', sales: 610 }, { month: 'Nov', sales: 560 },
  ],
  'Last 30 days': [
    { month: 'Week 1', sales: 128 }, { month: 'Week 2', sales: 154 }, { month: 'Week 3', sales: 141 }, { month: 'Week 4', sales: 179 },
  ],
  'This year': [
    { month: 'Jan', sales: 280 }, { month: 'Feb', sales: 305 }, { month: 'Mar', sales: 340 }, { month: 'Apr', sales: 295 },
    { month: 'May', sales: 320 }, { month: 'Jun', sales: 410 }, { month: 'Jul', sales: 370 }, { month: 'Aug', sales: 520 },
    { month: 'Sep', sales: 460 }, { month: 'Oct', sales: 610 }, { month: 'Nov', sales: 560 }, { month: 'Dec', sales: 0 },
  ],
} satisfies Record<DashboardRange, Array<{ month: string; sales: number }>>

export const paymentBreakdown = [
  { method: 'Cash', amount: 1042600, share: 42, color: '#2563eb' },
  { method: 'Card', amount: 795800, share: 32, color: '#14b8a6' },
  { method: 'Bank transfer', amount: 422800, share: 17, color: '#8b5cf6' },
  { method: 'Wallet', amount: 225700, share: 9, color: '#f59e0b' },
]

export const recentSales = [
  { id: 'INV-2048', customer: 'Sara Ahmed', date: 'Today, 2:42 PM', amount: 12450, status: 'Completed' },
  { id: 'INV-2047', customer: 'Hamza Ali', date: 'Today, 1:18 PM', amount: 7800, status: 'Completed' },
  { id: 'INV-2046', customer: 'Noor Fatima', date: 'Today, 11:56 AM', amount: 21900, status: 'Pending' },
  { id: 'INV-2045', customer: 'Usman Raza', date: 'Today, 10:22 AM', amount: 4650, status: 'Completed' },
]

export const topProducts = [
  { name: 'Premium Basmati Rice', units: 248, revenue: 248000 },
  { name: 'Olive Oil 1L', units: 186, revenue: 204600 },
  { name: 'Organic Green Tea', units: 152, revenue: 136800 },
]

export const lowStockProducts = [
  { name: 'Wholegrain Flour 5kg', sku: 'GRN-2041', stock: 3, threshold: 10 },
  { name: 'Almond Milk 1L', sku: 'DRY-1058', stock: 5, threshold: 12 },
  { name: 'Arabica Coffee 250g', sku: 'BEV-3012', stock: 7, threshold: 15 },
]

export const recentActivities = [
  { id: 'activity-1', actor: 'Ayesha Khan', action: 'completed a sale', detail: 'INV-2048', time: '12 min ago' },
  { id: 'activity-2', actor: 'Bilal Ahmed', action: 'added stock to', detail: 'Premium Basmati Rice', time: '38 min ago' },
  { id: 'activity-3', actor: 'Ayesha Khan', action: 'added a new customer', detail: 'Noor Fatima', time: '1 hr ago' },
  { id: 'activity-4', actor: 'Bilal Ahmed', action: 'recorded a payment', detail: 'PKR 18,500', time: '2 hrs ago' },
]

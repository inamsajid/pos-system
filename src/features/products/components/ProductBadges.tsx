import { Badge } from '../../../components/ui/Badge'
import type { Product, ProductStockStatus } from '../types/product.types'
import { getProductStockStatus } from '../utils/productUtils'

const stockLabels: Record<ProductStockStatus, string> = { 'in-stock': 'In stock', 'low-stock': 'Low stock', 'out-of-stock': 'Out of stock', 'not-tracked': 'Not tracked', archived: 'Archived' }
const stockTones: Record<ProductStockStatus, 'neutral' | 'success' | 'warning' | 'danger'> = { 'in-stock': 'success', 'low-stock': 'warning', 'out-of-stock': 'danger', 'not-tracked': 'neutral', archived: 'neutral' }

export function StockStatusBadge({ product }: { product: Product }) {
  const status = getProductStockStatus(product)
  return <Badge tone={stockTones[status]}>{stockLabels[status]}</Badge>
}

export function ProductStatusBadge({ status }: { status: Product['status'] }) {
  return <Badge tone={status === 'active' ? 'success' : 'neutral'}>{status === 'active' ? 'Active' : 'Archived'}</Badge>
}

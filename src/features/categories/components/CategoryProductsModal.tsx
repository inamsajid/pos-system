import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, Package } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Badge } from '../../../components/ui/Badge'
import { formatCurrency } from '../../../lib/currency'
import { productService } from '../../products/services/productService'
import type { Product } from '../../products/types/product.types'
import { getProductStockStatus } from '../../products/utils/productUtils'
import type { CategoryWithStats } from '../types/category.types'

interface CategoryProductsModalProps {
  open: boolean
  category?: CategoryWithStats
  onClose: () => void
}

export function CategoryProductsModal({ open, category, onClose }: CategoryProductsModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open || !category) return
    let active = true

    productService.getProducts().then((allProducts) => {
      if (!active) return
      const matched = allProducts.filter((p) => p.categoryId === category.id)
      setProducts(matched)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [open, category])

  if (!category) return null

  return (
    <Modal open={open} onClose={onClose} title={`${category.name} Products (${category.productCount})`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{products.length} products found in this category</span>
          <Link
            to={`/products`}
            onClick={onClose}
            className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700"
          >
            Go to full catalog <ExternalLink size={12} />
          </Link>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Loading products…</div>
        ) : products.length === 0 ? (
          <div className="py-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Package size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-700">No products in this category</p>
            <p className="mt-1 text-xs text-slate-400">
              Assign products to this category from the Products page.
            </p>
            <Link
              to="/products/new"
              onClick={onClose}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Add a product now <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
            {products.map((product) => {
              const stockStatus = getProductStockStatus(product)
              return (
                <div key={product.id} className="flex items-center justify-between p-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1 pr-3">
                    <Link
                      to={`/products/${product.id}`}
                      onClick={onClose}
                      className="truncate text-xs font-semibold text-slate-800 hover:text-blue-600"
                    >
                      {product.name}
                    </Link>
                    <p className="text-[11px] text-slate-400">SKU: {product.sku}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-800">
                      {formatCurrency(product.sellingPrice)}
                    </span>
                    <Badge
                      tone={
                        stockStatus === 'in-stock'
                          ? 'success'
                          : stockStatus === 'low-stock'
                          ? 'warning'
                          : stockStatus === 'out-of-stock'
                          ? 'danger'
                          : 'neutral'
                      }
                    >
                      {product.trackInventory ? `${product.stockQuantity} ${product.unit}` : 'Untracked'}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

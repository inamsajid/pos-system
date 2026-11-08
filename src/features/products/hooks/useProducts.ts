import { useCallback, useEffect, useState } from 'react'
import { productService } from '../services/productService'
import type { Product } from '../types/product.types'

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setProducts(await productService.getProducts())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load products.')
    } finally {
      setLoading(false)
    }
  }, [])

  // This effect loads the feature repository; updates happen after its async read resolves.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void reload() }, [reload])

  return { products, loading, error, reload }
}

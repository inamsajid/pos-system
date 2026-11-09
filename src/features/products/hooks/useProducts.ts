import { useCallback, useEffect, useState } from 'react'
import { productService } from '../services/productService'
import type { Product, ProductDraft } from '../types/product.types'
import { queryClient } from '../../../app/queryClient'
import { queryKeys } from '../../../api/queryKeys'

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

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  const createProduct = useCallback(
    async (draft: ProductDraft) => {
      const created = await productService.createProduct(draft)
      await reload()
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      return created
    },
    [reload]
  )

  const updateProduct = useCallback(
    async (id: string, draft: ProductDraft) => {
      const updated = await productService.updateProduct(id, draft)
      await reload()
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      return updated
    },
    [reload]
  )

  const archiveProduct = useCallback(
    async (id: string) => {
      const archived = await productService.archiveProduct(id)
      await reload()
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      return archived
    },
    [reload]
  )

  const restoreProduct = useCallback(
    async (id: string) => {
      const restored = await productService.restoreProduct(id)
      await reload()
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      return restored
    },
    [reload]
  )

  return {
    products,
    loading,
    error,
    reload,
    createProduct,
    updateProduct,
    archiveProduct,
    restoreProduct,
  }
}

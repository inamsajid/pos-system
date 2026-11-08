import { useCallback, useEffect, useState } from 'react'
import { categoryService } from '../services/categoryService'
import type { CategoryDraft, CategoryWithStats } from '../types/category.types'

export function useCategories() {
  const [categories, setCategories] = useState<CategoryWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const data = await categoryService.getCategories()
      setCategories(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  const createCategory = useCallback(
    async (draft: CategoryDraft) => {
      const created = await categoryService.createCategory(draft)
      await reload()
      return created
    },
    [reload]
  )

  const updateCategory = useCallback(
    async (id: string, draft: CategoryDraft) => {
      const updated = await categoryService.updateCategory(id, draft)
      await reload()
      return updated
    },
    [reload]
  )

  const archiveCategory = useCallback(
    async (id: string) => {
      const archived = await categoryService.archiveCategory(id)
      await reload()
      return archived
    },
    [reload]
  )

  const restoreCategory = useCallback(
    async (id: string) => {
      const restored = await categoryService.restoreCategory(id)
      await reload()
      return restored
    },
    [reload]
  )

  return {
    categories,
    loading,
    error,
    reload,
    createCategory,
    updateCategory,
    archiveCategory,
    restoreCategory,
  }
}

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useProducts } from '../src/features/products/hooks/useProducts'
import { useCategories } from '../src/features/categories/hooks/useCategories'
import { productService } from '../src/features/products/services/productService'
import { queryClient } from '../src/app/queryClient'
import { queryKeys } from '../src/api/queryKeys'

function ProductsTestComponent() {
  const { products, loading, error, reload, createProduct, archiveProduct } = useProducts()

  if (loading) return <div data-testid="products-loading">Loading products...</div>
  if (error) return <div data-testid="products-error">{error}</div>

  return (
    <div>
      <div data-testid="products-count">{products.length}</div>
      <ul data-testid="products-list">
        {products.map((p) => (
          <li key={p.id} data-testid={`product-${p.id}`}>
            {p.name} - {p.status} - PKR {p.sellingPrice}
            <button
              onClick={() => archiveProduct(p.id)}
              data-testid={`archive-btn-${p.id}`}
            >
              Archive
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() =>
          createProduct({
            name: 'New Test Item',
            sku: 'SKU-HOOK-TEST',
            unit: 'piece',
            sellingPrice: 150,
            purchasePrice: 100,
            stockQuantity: 10,
            lowStockThreshold: 5,
            status: 'active',
            trackInventory: true,
            categoryId: 'cat-test',
          })
        }
        data-testid="create-product-btn"
      >
        Add Product
      </button>
      <button onClick={() => reload()} data-testid="reload-btn">
        Reload
      </button>
    </div>
  )
}

function CategoriesTestComponent() {
  const { categories, loading, error, createCategory } = useCategories()

  if (loading) return <div data-testid="categories-loading">Loading categories...</div>
  if (error) return <div data-testid="categories-error">{error}</div>

  return (
    <div>
      <div data-testid="categories-count">{categories.length}</div>
      <ul data-testid="categories-list">
        {categories.map((c) => (
          <li key={c.id} data-testid={`category-${c.id}`}>
            {c.name} ({c.productCount} items)
          </li>
        ))}
      </ul>
      <button
        onClick={() =>
          createCategory({
            name: 'Special Bakery',
            slug: 'special-bakery',
            color: 'amber',
            icon: 'Utensils',
            status: 'active',
          })
        }
        data-testid="create-category-btn"
      >
        Add Category
      </button>
    </div>
  )
}

describe('Frontend Catalog Integration & Hooks (Products & Categories)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DATA_SOURCE', 'mock')
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('useProducts loads product listing and handles loading and success states', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProductsTestComponent />
      </QueryClientProvider>
    )

    // Initially shows loading or resolves to products
    await waitFor(() => {
      expect(screen.queryByTestId('products-loading')).toBeNull()
      const countEl = screen.getByTestId('products-count')
      expect(Number(countEl.textContent)).toBeGreaterThan(0)
    })
  })

  it('useCategories loads category listing and displays items with stats', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CategoriesTestComponent />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.queryByTestId('categories-loading')).toBeNull()
      const countEl = screen.getByTestId('categories-count')
      expect(Number(countEl.textContent)).toBeGreaterThan(0)
    })
  })

  it('creating a category updates the list and invalidates categories queries', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <CategoriesTestComponent />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('create-category-btn')).toBeDefined()
    })

    const initialCount = Number(screen.getByTestId('categories-count').textContent)
    fireEvent.click(screen.getByTestId('create-category-btn'))

    await waitFor(() => {
      const nextCount = Number(screen.getByTestId('categories-count').textContent)
      expect(nextCount).toBe(initialCount + 1)
      expect(screen.getByText(/Special Bakery/)).toBeDefined()
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.categories.all })
  })

  it('creating a product updates the list and invalidates product queries', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <ProductsTestComponent />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('create-product-btn')).toBeDefined()
    })

    const initialCount = Number(screen.getByTestId('products-count').textContent)
    fireEvent.click(screen.getByTestId('create-product-btn'))

    await waitFor(() => {
      const nextCount = Number(screen.getByTestId('products-count').textContent)
      expect(nextCount).toBe(initialCount + 1)
      expect(screen.getByText(/New Test Item/)).toBeDefined()
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.products.all })
  })

  it('archiving a product updates status and invalidates queries', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <ProductsTestComponent />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('products-list')).toBeDefined()
    })

    const archiveButtons = screen.getAllByText('Archive')
    expect(archiveButtons.length).toBeGreaterThan(0)
    fireEvent.click(archiveButtons[0])

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.products.all })
    })
  })

  it('handles product service error states gracefully in hooks', async () => {
    vi.spyOn(productService, 'getProducts').mockRejectedValueOnce(new Error('Network error loading products'))

    render(
      <QueryClientProvider client={queryClient}>
        <ProductsTestComponent />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('products-error')).toBeDefined()
      expect(screen.getByTestId('products-error').textContent).toContain('Network error loading products')
    })
  })
})

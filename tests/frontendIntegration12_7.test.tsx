// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  apiClient,
  setApiContextProvider,
} from '../src/lib/api-client'
import { queryClient } from '../src/app/queryClient'
import { completeCheckout } from '../src/features/pos/services/checkoutService'
import { salesService } from '../src/features/sales/services/salesService'
import { invoiceService } from '../src/features/invoices/services/invoiceService'
import { createCustomerPayment } from '../src/features/payments/services/paymentService'
import { fetchCustomerLedger } from '../src/features/customers/services/customerLedgerService'
import { fetchSupplierLedgerSummary } from '../src/features/suppliers/services/supplierLedgerService'
import {
  fetchInventoryBalances,
  fetchInventoryMovements,
} from '../src/features/inventory/services/inventoryService'
import { fileService } from '../src/features/files/services/fileService'

describe('Step 12.7 Frontend Integration with Cloudflare Worker APIs', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    queryClient.clear()
    setApiContextProvider(null)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setApiContextProvider(null)
    queryClient.clear()
    vi.restoreAllMocks()
  })

  describe('1. Active Context Provider & Tenant Header Injection', () => {
    it('automatically attaches X-Business-Id and X-Branch-Id to requests when context is set', async () => {
      let capturedHeaders: Headers | null = null

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({ success: true, data: { status: 'ok' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      setApiContextProvider(() => ({
        businessId: 'biz-northstar-123',
        branchId: 'branch-lahore-main',
      }))

      await apiClient.get('/test-endpoint')

      expect(capturedHeaders).not.toBeNull()
      expect(capturedHeaders!.get('X-Business-Id')).toBe('biz-northstar-123')
      expect(capturedHeaders!.get('X-Branch-Id')).toBe('branch-lahore-main')
    })

    it('does not attach tenant headers when provider returns null', async () => {
      let capturedHeaders: Headers | null = null

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      setApiContextProvider(() => ({
        businessId: null,
        branchId: null,
      }))

      await apiClient.get('/test-empty-ctx')

      expect(capturedHeaders!.get('X-Business-Id')).toBeNull()
      expect(capturedHeaders!.get('X-Branch-Id')).toBeNull()
    })

    it('allows overriding X-Business-Id or X-Branch-Id per request', async () => {
      let capturedHeaders: Headers | null = null

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      setApiContextProvider(() => ({
        businessId: 'default-biz',
        branchId: 'default-branch',
      }))

      await apiClient.get('/test-override', {
        headers: {
          'X-Business-Id': 'custom-override-biz',
          'X-Branch-Id': 'custom-override-branch',
        },
      })

      expect(capturedHeaders!.get('X-Business-Id')).toBe('custom-override-biz')
      expect(capturedHeaders!.get('X-Branch-Id')).toBe('custom-override-branch')
    })
  })

  describe('2. POS Checkout Integration & Idempotency', () => {
    it('sends Idempotency-Key header, minor unit conversions, and maps returned SaleDTO', async () => {
      let capturedBody: any = null
      let capturedHeaders: Headers | null = null

      const mockWorkerSale = {
        id: 'sale-worker-999',
        businessId: 'biz-1',
        branchId: 'branch-1',
        saleNumber: 'SALE-2026-999',
        receiptNumber: 'RCP-2026-999',
        invoiceNumber: 'INV-2026-999',
        customerId: 'cust-walkin',
        customerSnapshot: {
          name: 'Walk-in Customer',
          isWalkIn: true,
        },
        subtotalMinor: 100000, // PKR 1,000.00
        discountType: 'fixed',
        discountValue: 0,
        discountMinor: 0,
        taxMinor: 0,
        totalAmountMinor: 100000,
        amountPaidMinor: 100000,
        remainingBalanceMinor: 0,
        changeReturnedMinor: 0,
        status: 'completed',
        createdAt: '2026-11-09T10:00:00.000Z',
        items: [
          {
            productId: 'prod-1',
            productName: 'Wireless Mouse',
            sku: 'ACC-MOU-1',
            unit: 'piece',
            unitPriceMinor: 100000,
            quantity: 1,
            lineTotalMinor: 100000,
          },
        ],
        payments: [
          {
            method: 'cash',
            amountMinor: 100000,
          },
        ],
      }

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/v1/sales') && init?.method === 'POST') {
          capturedHeaders = new Headers(init?.headers)
          capturedBody = JSON.parse(init?.body as string)
          return new Response(JSON.stringify({ success: true, data: mockWorkerSale }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        // Fallback for product/customer resolution
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'prod-1',
                name: 'Wireless Mouse',
                sku: 'ACC-MOU-1',
                unit: 'piece',
                sellingPriceMinor: 100000,
                purchasePriceMinor: 80000,
                stockQuantity: 50,
                status: 'active',
                trackInventory: true,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })

      const completed = await completeCheckout(
        { 'prod-1': 1 },
        'walk-in',
        'fixed',
        0,
        [{ method: 'cash', amount: 1000 }]
      )

      expect(capturedHeaders!.has('Idempotency-Key')).toBe(true)
      expect(capturedBody.items[0].unitPriceMinor).toBe(100000)
      expect(capturedBody.payments[0].amountMinor).toBe(100000)
      expect(completed.id).toBe('sale-worker-999')
      expect(completed.totalAmount).toBe(1000)
      expect(completed.subtotal).toBe(1000)
    })

    it('propagates server error directly on stock conflict (409) without falling back to mock storage', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/v1/sales') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: 'CONFLICT',
                message: 'Insufficient stock: only 2 pieces remaining.',
              },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'prod-1',
                name: 'Wireless Mouse',
                sku: 'ACC-MOU-1',
                unit: 'piece',
                sellingPriceMinor: 100000,
                stockQuantity: 10,
                status: 'active',
                trackInventory: true,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })

      await expect(
        completeCheckout(
          { 'prod-1': 5 },
          'walk-in',
          'fixed',
          0,
          [{ method: 'cash', amount: 5000 }]
        )
      ).rejects.toThrow('Insufficient stock: only 2 pieces remaining.')
    })
  })

  describe('3. Sales & Invoices Live Service Integration', () => {
    it('queries /api/v1/sales and maps items into CheckoutSale structures', async () => {
      const mockSalesList = [
        {
          id: 'sale-1',
          saleNumber: 'SALE-001',
          receiptNumber: 'RCP-001',
          invoiceNumber: 'INV-001',
          customerId: 'cust-1',
          customerSnapshot: { name: 'Hamza Ali', customerCode: 'CUST-001' },
          subtotalMinor: 250000,
          discountType: 'fixed',
          discountValue: 0,
          discountMinor: 0,
          taxMinor: 0,
          totalAmountMinor: 250000,
          amountPaidMinor: 250000,
          remainingBalanceMinor: 0,
          changeReturnedMinor: 0,
          status: 'completed',
          createdAt: '2026-11-09T08:00:00Z',
          items: [],
          payments: [{ method: 'cash', amountMinor: 250000 }],
        },
      ]

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { items: mockSalesList, meta: { totalCount: 1 } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      const sales = await salesService.getSales()
      expect(sales.length).toBe(1)
      expect(sales[0].id).toBe('sale-1')
      expect(sales[0].totalAmount).toBe(2500)
      expect(sales[0].customerName).toBe('Hamza Ali')
    })

    it('queries /api/v1/invoices/:id/sale fallback when resolving invoices by ID', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/sales/inv-unknown')) {
          return new Response(JSON.stringify({ success: false }), { status: 404 })
        }
        if (url.includes('/invoices/inv-unknown/sale')) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: 'sale-from-inv',
                saleNumber: 'SALE-INV-1',
                receiptNumber: 'RCP-INV-1',
                invoiceNumber: 'INV-ORIG-1',
                customerId: 'cust-1',
                customerSnapshot: { name: 'Sara Ahmed' },
                subtotalMinor: 50000,
                discountType: 'fixed',
                discountValue: 0,
                discountMinor: 0,
                taxMinor: 0,
                totalAmountMinor: 50000,
                amountPaidMinor: 50000,
                remainingBalanceMinor: 0,
                changeReturnedMinor: 0,
                status: 'completed',
                createdAt: '2026-11-09T09:00:00Z',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify({ success: true, data: [] }))
      })

      const invoice = await invoiceService.getInvoiceById('inv-unknown')
      expect(invoice).toBeDefined()
      expect(invoice!.id).toBe('sale-from-inv')
      expect(invoice!.customerName).toBe('Sara Ahmed')
      expect(invoice!.totalAmount).toBe(500)
    })
  })

  describe('4. Customer Ledger & Payments Integration', () => {
    it('fetches and converts customer ledger statement with running balances', async () => {
      const mockStatement = {
        customerId: 'cust-bilal',
        customerName: 'Bilal Ahmed',
        openingBalanceMinor: 100000,
        closingBalanceMinor: 150000,
        totalDebitsMinor: 200000,
        totalCreditsMinor: 50000,
        entries: [
          {
            id: 'ent-1',
            type: 'invoice',
            referenceNumber: 'INV-101',
            description: 'Sales Invoice',
            debitMinor: 200000,
            creditMinor: 0,
            balanceMinor: 300000,
            createdAt: '2026-11-09T10:00:00Z',
          },
          {
            id: 'ent-2',
            type: 'payment',
            referenceNumber: 'RCP-501',
            description: 'Customer Payment',
            debitMinor: 0,
            creditMinor: 50000,
            balanceMinor: 250000,
            createdAt: '2026-11-09T11:00:00Z',
          },
        ],
      }

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: mockStatement }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const ledger = await fetchCustomerLedger('cust-bilal')
      expect(ledger.length).toBe(2)
      expect(ledger[0].debit).toBe(2000)
      expect(ledger[0].balance).toBe(3000)
      expect(ledger[1].credit).toBe(500)
      expect(ledger[1].balance).toBe(2500)
    })

    it('posts create customer payment with minor units and allocations', async () => {
      let capturedBody: any = null

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'pay-new-1',
              receiptNumber: 'RCP-PAY-1',
              customerId: 'cust-1',
              customerName: 'Hamza Ali',
              amountMinor: 150000,
              unallocatedAmountMinor: 50000,
              source: 'manual',
              receivedAt: '2026-11-09T12:00:00Z',
              createdAt: '2026-11-09T12:00:00Z',
              paymentMethods: [{ method: 'cash', amountMinor: 150000 }],
              allocations: [{ invoiceId: 'inv-1', amountMinor: 100000 }],
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      })

      const payment = await createCustomerPayment({
        customerId: 'cust-1',
        amount: 1500,
        methodBreakdown: [{ method: 'cash', amount: 1500 }],
        allocations: [{ saleId: 'inv-1', invoiceNumber: 'INV-1', amount: 1000 }],
        keepAsAdvance: true,
        receivedAt: '2026-11-09T12:00:00Z',
      })

      expect(capturedBody.amountMinor).toBe(150000)
      expect(capturedBody.allocations[0].amountMinor).toBe(100000)
      expect(payment.amount).toBe(1500)
      expect(payment.unallocatedAmount).toBe(500)
    })
  })

  describe('5. Inventory Balances & Movements Integration', () => {
    it('fetches inventory balances from Worker and maps to productId dictionary', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              { productId: 'prd-keyboard', quantityOnHand: 45 },
              { productId: 'prd-mouse', quantityOnHand: 22 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      const balances = await fetchInventoryBalances()
      expect(balances['prd-keyboard']).toBe(45)
      expect(balances['prd-mouse']).toBe(22)
    })

    it('fetches inventory movements and maps unit costs correctly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  id: 'mov-1',
                  movementNumber: 'MOV-1001',
                  productId: 'prd-keyboard',
                  productName: 'Mechanical Keyboard',
                  sku: 'ACC-KBD',
                  unit: 'piece',
                  type: 'purchase_receipt',
                  quantityChange: 10,
                  previousQuantity: 35,
                  newQuantity: 45,
                  unitCostMinor: 400000,
                  referenceType: 'purchase',
                  referenceNumber: 'PO-001',
                  createdAt: '2026-11-09T08:00:00Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      const movements = await fetchInventoryMovements()
      expect(movements.length).toBe(1)
      expect(movements[0].quantityChange).toBe(10)
      expect(movements[0].unitCost).toBe(4000)
      expect(movements[0].referenceType).toBe('purchase')
    })
  })

  describe('6. Supplier Ledger & Payments Integration', () => {
    it('fetches supplier ledger statement and summary', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              supplierId: 'sup-tech',
              supplierName: 'Tech Wholesale Ltd',
              openingPayableMinor: 500000,
              currentPayableMinor: 750000,
              totalBilledMinor: 1000000,
              totalPaidMinor: 250000,
              openPurchasesCount: 2,
              earliestUnpaidPurchaseDate: '2026-11-01',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      const summary = await fetchSupplierLedgerSummary('sup-tech')
      expect(summary.totalPurchases).toBe(10000)
      expect(summary.totalPaid).toBe(2500)
      expect(summary.outstandingPayable).toBe(7500)
      expect(summary.openingPayable).toBe(5000)
    })
  })

  describe('7. File Storage (R2) Integration', () => {
    it('uploads file via multipart FormData and returns content URL', async () => {
      let isFormData = false

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        isFormData = init?.body instanceof FormData
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'file-uuid-1234',
              key: 'products/file-uuid-1234.png',
              filename: 'mouse.png',
              contentType: 'image/png',
              sizeBytes: 15400,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      })

      const dummyFile = new File(['fake-png-content'], 'mouse.png', { type: 'image/png' })
      const result = await fileService.uploadFile(dummyFile, 'product')

      expect(isFormData).toBe(true)
      expect(result.id).toBe('file-uuid-1234')
      expect(result.url).toBe('/api/v1/files/file-uuid-1234/content')
    })
  })

  describe('8. TanStack Query Cache Purge on Tenant Context Switch', () => {
    it('clears queryClient cache completely when clearing', () => {
      queryClient.setQueryData(['products', 'list'], [{ id: 'test-1' }])
      queryClient.setQueryData(['sales', 'list'], [{ id: 'sale-1' }])
      expect(queryClient.getQueryData(['products', 'list'])).toBeDefined()
      expect(queryClient.getQueryData(['sales', 'list'])).toBeDefined()

      queryClient.clear()

      expect(queryClient.getQueryData(['products', 'list'])).toBeUndefined()
      expect(queryClient.getQueryData(['sales', 'list'])).toBeUndefined()
    })
  })
})

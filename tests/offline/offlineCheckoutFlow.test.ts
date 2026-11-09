import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../../src/lib/offline/database'
import { offlineSalesService } from '../../src/lib/offline/sales/offlineSales.service'
import { offlineSalesRepository } from '../../src/lib/offline/sales/offlineSales.repository'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { OutboxValidationError } from '../../src/lib/offline/outbox/outbox.errors'

describe('Step 13.6: Local Offline Checkout & Provisional Sales (tests/offline/offlineCheckoutFlow.test.ts)', () => {
  const userId = 'usr_offline_checkout'
  const businessId = 'biz_offline_checkout'
  const branchId = 'branch_checkout_main'
  const deviceId = 'dev_checkout_01'
  const authorizationId = 'auth_valid_package_100'

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()

    // Cache an active offline authorization package with 10 units of Tea and 5 kg of Flour
    await offlineSalesService.cacheAuthorizationPackage({
      authorizationId,
      businessId,
      branchId,
      userId,
      deviceId,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 50,
      maxTotalAmountMinor: 1_000_000,
      allowDiscounts: false,
      status: 'active',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
      allowedPaymentMethods: ['cash'],
      signature: 'dummy_valid_sig_hex_64chars',
      productAllocations: [
        {
          allocationId: 'alloc_tea',
          productId: 'prod_tea',
          sku: 'TEA-01',
          name: 'Black Tea',
          unit: 'box',
          sellingPriceMinor: 45000, // PKR 450.00
          allocatedQuantity: 10,
          consumedQuantity: 0,
          remainingQuantity: 10,
        },
        {
          allocationId: 'alloc_flour',
          productId: 'prod_flour',
          sku: 'FLOUR-01',
          name: 'Wheat Flour',
          unit: 'kg',
          sellingPriceMinor: 12000, // PKR 120.00
          allocatedQuantity: 5,
          consumedQuantity: 0,
          remainingQuantity: 5,
        },
      ],
    })
  })

  afterEach(async () => {
    await offlineDb.clearAllOfflineData()
  })

  it('3.1: eligible cash sale is saved provisionally in Dexie and outbox command is created', async () => {
    const result = await offlineSalesService.recordOfflineSale({
      userId,
      businessId,
      branchId,
      deviceId,
      authorizationId,
      items: [
        {
          productId: 'prod_tea',
          name: 'Black Tea',
          sku: 'TEA-01',
          unit: 'box',
          quantity: 2,
          unitPriceMinor: 45000,
          subtotalMinor: 90000,
          lineTotalMinor: 90000,
          allocationId: 'alloc_tea',
        },
      ],
      cashTenderedMinor: 100000, // PKR 1000.00 tendered for PKR 900.00 sale
    })

    expect(result.status).toBe('provisional')
    expect(result.provisionalReceiptNumber).toMatch(/^OFF-[A-Z0-9]+-[A-Z0-9]+$/)
    expect(result.totalAmountMinor).toBe(90000)
    expect(result.cashTenderedMinor).toBe(100000)
    expect(result.changeReturnedMinor).toBe(10000)
    expect(result.warning).toBe('PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE')

    // Stored provisional sale
    const stored = await offlineSalesRepository.findSaleById(result.provisionalSaleId)
    expect(stored).toBeDefined()
    expect(stored?.status).toBe('provisional')
    expect(stored?.totalAmountMinor).toBe(90000)

    // Stored outbox command
    const command = await outboxRepository.findById(result.outboxCommandId)
    expect(command).toBeDefined()
    expect(command?.commandType).toBe('create_offline_sale')
    expect(command?.status).toBe('pending')

    // Local allocation quota was decremented (10 - 2 = 8 remaining)
    const alloc = await offlineSalesRepository.getAllocationForProduct(businessId, branchId, deviceId, 'prod_tea')
    expect(alloc?.remainingQuantity).toBe(8)
    expect(alloc?.consumedQuantity).toBe(2)
  })

  it('3.2: sale requesting unallocated product is rejected', async () => {
    await expect(
      offlineSalesService.recordOfflineSale({
        userId,
        businessId,
        branchId,
        deviceId,
        authorizationId,
        items: [
          {
            productId: 'prod_unallocated_coffee',
            name: 'Coffee',
            sku: 'COF-01',
            unit: 'box',
            quantity: 1,
            unitPriceMinor: 50000,
            subtotalMinor: 50000,
            lineTotalMinor: 50000,
            allocationId: 'alloc_nonexistent',
          },
        ],
        cashTenderedMinor: 60000,
      })
    ).rejects.toThrow(OutboxValidationError)
  })

  it('3.3: sale requesting quantity beyond remaining local quota is rejected', async () => {
    // Only 5 kg flour available; requesting 6 kg
    await expect(
      offlineSalesService.recordOfflineSale({
        userId,
        businessId,
        branchId,
        deviceId,
        authorizationId,
        items: [
          {
            productId: 'prod_flour',
            name: 'Wheat Flour',
            sku: 'FLOUR-01',
            unit: 'kg',
            quantity: 6,
            unitPriceMinor: 12000,
            subtotalMinor: 72000,
            lineTotalMinor: 72000,
            allocationId: 'alloc_flour',
          },
        ],
        cashTenderedMinor: 80000,
      })
    ).rejects.toThrow(/quota exceeded/i)
  })

  it('3.4: cash tendered below total sale amount is rejected', async () => {
    // Total is 45,000 paise (PKR 450.00), customer gives 40,000 paise (PKR 400.00)
    await expect(
      offlineSalesService.recordOfflineSale({
        userId,
        businessId,
        branchId,
        deviceId,
        authorizationId,
        items: [
          {
            productId: 'prod_tea',
            name: 'Black Tea',
            sku: 'TEA-01',
            unit: 'box',
            quantity: 1,
            unitPriceMinor: 45000,
            subtotalMinor: 45000,
            lineTotalMinor: 45000,
            allocationId: 'alloc_tea',
          },
        ],
        cashTenderedMinor: 40000,
      })
    ).rejects.toThrow(/Cash tendered .* is less than total sale amount/)
  })

  it('3.5: formats provisional receipt with explicit pending notice and no official invoice claims', async () => {
    const result = await offlineSalesService.recordOfflineSale({
      userId,
      businessId,
      branchId,
      deviceId,
      authorizationId,
      items: [
        {
          productId: 'prod_tea',
          name: 'Black Tea',
          sku: 'TEA-01',
          unit: 'box',
          quantity: 1,
          unitPriceMinor: 45000,
          subtotalMinor: 45000,
          lineTotalMinor: 45000,
          allocationId: 'alloc_tea',
        },
      ],
      cashTenderedMinor: 50000,
    })

    const stored = (await offlineSalesRepository.findSaleById(result.provisionalSaleId))!
    const receiptData = offlineSalesService.formatProvisionalReceipt(stored)

    expect(receiptData.notice).toBe('PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE')
    expect(receiptData.provisionalReceiptNumber).toBe(result.provisionalReceiptNumber)
    expect(receiptData.totalAmountMinor).toBe(45000)
    expect(receiptData.cashTenderedMinor).toBe(50000)
    expect(receiptData.changeReturnedMinor).toBe(5000)
    expect(receiptData.items[0].name).toBe('Black Tea')
  })
})


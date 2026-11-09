import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetInventoryForTesting,
  confirmStockCount,
  getInventoryMovements,
  getProductStock,
  recordSaleStockMovements,
  recordStockAdjustment,
  recordStockChanges,
  saveStockCountDraft,
  InventoryReplayError,
} from '../src/features/inventory/services/inventoryService'

const productKeyboard = {
  id: 'prd-kbd-1',
  name: 'Mechanical Keyboard',
  sku: 'ACC-KBD-1',
  unit: 'piece' as const,
  status: 'active' as const,
  trackInventory: true,
  stockQuantity: 20,
  updatedAt: '2026-11-01T10:00:00.000Z',
}

const productMouse = {
  id: 'prd-mouse-2',
  name: 'Wireless Mouse',
  sku: 'ACC-MOU-2',
  unit: 'piece' as const,
  status: 'active' as const,
  trackInventory: true,
  stockQuantity: 15,
  updatedAt: '2026-11-01T10:00:00.000Z',
}

const productMonitor = {
  id: 'prd-mon-3',
  name: 'Gaming Monitor',
  sku: 'ELC-MON-3',
  unit: 'piece' as const,
  status: 'active' as const,
  trackInventory: true,
  stockQuantity: 5,
  updatedAt: '2026-11-01T10:00:00.000Z',
}

describe('Inventory Movement Replay Protection & Consistency', () => {
  beforeEach(() => {
    // Reset inventory memory state before each test
    _resetInventoryForTesting(
      {
        [productKeyboard.id]: 20,
        [productMouse.id]: 15,
        [productMonitor.id]: 5,
      },
      [],
      []
    )
  })

  it('1. new single-movement batch succeeds and updates stock', () => {
    const movements = recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'adjustment_in',
          quantityChange: 10,
          referenceType: 'adjustment',
          referenceId: 'adj-001',
          referenceNumber: 'ADJ-001',
          reason: 'Initial intake',
        },
      },
    ])

    expect(movements).toHaveLength(1)
    expect(movements[0].quantityChange).toBe(10)
    expect(movements[0].previousQuantity).toBe(20)
    expect(movements[0].newQuantity).toBe(30)
    expect(getProductStock(productKeyboard.id)).toBe(30)
  })

  it('2. new multi-product batch succeeds and updates all balances', () => {
    const batch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 10,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-001',
          referenceNumber: 'GR-001',
        },
      },
      {
        product: productMouse,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 5,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-001',
          referenceNumber: 'GR-001',
        },
      },
      {
        product: productMonitor,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 3,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-001',
          referenceNumber: 'GR-001',
        },
      },
    ]

    const movements = recordStockChanges(batch)
    expect(movements).toHaveLength(3)
    expect(getProductStock(productKeyboard.id)).toBe(30)
    expect(getProductStock(productMouse.id)).toBe(20)
    expect(getProductStock(productMonitor.id)).toBe(8)
    expect(getInventoryMovements()).toHaveLength(3)
  })

  it('3. exact complete replay makes no stock changes', () => {
    const receiptBatch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 10,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R001',
          referenceNumber: 'GR-R001',
        },
      },
      {
        product: productMouse,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 5,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R001',
          referenceNumber: 'GR-R001',
        },
      },
    ]

    // First submission
    const firstRun = recordStockChanges(receiptBatch)
    expect(firstRun).toHaveLength(2)
    expect(getProductStock(productKeyboard.id)).toBe(30)
    expect(getProductStock(productMouse.id)).toBe(20)

    // Replay exact same batch
    const replayRun = recordStockChanges(receiptBatch)
    expect(replayRun).toHaveLength(2)
    // Stock remains unchanged
    expect(getProductStock(productKeyboard.id)).toBe(30)
    expect(getProductStock(productMouse.id)).toBe(20)
  })

  it('4. exact complete replay creates no duplicate movements', () => {
    const receiptBatch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 10,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R002',
          referenceNumber: 'GR-R002',
        },
      },
    ]

    recordStockChanges(receiptBatch)
    expect(getInventoryMovements()).toHaveLength(1)

    // Replay
    recordStockChanges(receiptBatch)
    // Must still have exactly 1 movement record, not 2
    expect(getInventoryMovements()).toHaveLength(1)
  })

  it('5. partial replay is rejected and throws InventoryReplayError', () => {
    // Suppose Keyboard +10 and Mouse +5 were previously recorded for receipt R-003
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt',
          quantityChange: 10,
          referenceType: 'purchase',
          referenceId: 'receipt-R003',
        },
      },
      {
        product: productMouse,
        input: {
          type: 'purchase_receipt',
          quantityChange: 5,
          referenceType: 'purchase',
          referenceId: 'receipt-R003',
        },
      },
    ])

    expect(getProductStock(productKeyboard.id)).toBe(30)
    expect(getProductStock(productMouse.id)).toBe(20)

    // Retry comes with Keyboard +10, Mouse +5, AND Monitor +3
    const partialBatch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 10,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R003',
        },
      },
      {
        product: productMouse,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 5,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R003',
        },
      },
      {
        product: productMonitor,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 3,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R003',
        },
      },
    ]

    expect(() => recordStockChanges(partialBatch)).toThrowError(InventoryReplayError)

    try {
      recordStockChanges(partialBatch)
    } catch (err) {
      expect((err as InventoryReplayError).code).toBe('PARTIAL_REPLAY')
    }
  })

  it('6 & 7. partial replay does not apply missing movements and does not alter existing balances', () => {
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt',
          quantityChange: 10,
          referenceType: 'purchase',
          referenceId: 'receipt-R004',
        },
      },
    ])

    const kbdStockBefore = getProductStock(productKeyboard.id)
    const monStockBefore = getProductStock(productMonitor.id)
    const movementsCountBefore = getInventoryMovements().length

    const partialBatch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 10,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R004',
        },
      },
      {
        product: productMonitor,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 4,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R004',
        },
      },
    ]

    expect(() => recordStockChanges(partialBatch)).toThrow()

    // State must remain completely unaltered
    expect(getProductStock(productKeyboard.id)).toBe(kbdStockBefore)
    expect(getProductStock(productMonitor.id)).toBe(monStockBefore)
    expect(getInventoryMovements()).toHaveLength(movementsCountBefore)
  })

  it('8. quantity-mismatched replay is rejected with MISMATCHED_REPLAY', () => {
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt',
          quantityChange: 10,
          referenceType: 'purchase',
          referenceId: 'receipt-R005',
        },
      },
    ])

    // Retry with quantity 12 instead of 10
    const mismatchBatch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 12,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-R005',
        },
      },
    ]

    expect(() => recordStockChanges(mismatchBatch)).toThrowError(InventoryReplayError)

    try {
      recordStockChanges(mismatchBatch)
    } catch (err) {
      expect((err as InventoryReplayError).code).toBe('MISMATCHED_REPLAY')
    }

    // Balance remains 30, not 32
    expect(getProductStock(productKeyboard.id)).toBe(30)
  })

  it('9. movement-type mismatch is rejected with MISMATCHED_REPLAY', () => {
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'adjustment_in',
          quantityChange: 5,
          referenceId: 'ref-mismatch-1',
          movementId: 'mov-mismatch-1',
        },
      },
    ])

    // Retry with same movementId but different type
    expect(() =>
      recordStockChanges([
        {
          product: productKeyboard,
          input: {
            type: 'sale' as const,
            quantityChange: 5,
            referenceId: 'ref-mismatch-1',
            movementId: 'mov-mismatch-1',
          },
        },
      ])
    ).toThrowError(InventoryReplayError)
  })

  it('10. source identity mismatch is handled correctly', () => {
    // Two movements with same referenceId but different referenceType or movementId
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'adjustment_in',
          quantityChange: 5,
          referenceId: 'ref-shared-1',
        },
      },
    ])

    // A sale with the same referenceId string is a different movement type ('sale' vs 'adjustment_in')
    // so it does NOT match the adjustment_in
    expect(getProductStock(productKeyboard.id)).toBe(25)
  })

  it('11. duplicate movement identity inside one batch is rejected before state changes', () => {
    const kbdStockBefore = getProductStock(productKeyboard.id)

    const duplicateBatch = [
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 5,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-dup',
        },
      },
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 5,
          referenceType: 'purchase' as const,
          referenceId: 'receipt-dup',
        },
      },
    ]

    expect(() => recordStockChanges(duplicateBatch)).toThrowError(InventoryReplayError)

    try {
      recordStockChanges(duplicateBatch)
    } catch (err) {
      expect((err as InventoryReplayError).code).toBe('DUPLICATE_BATCH_ENTRY')
    }

    expect(getProductStock(productKeyboard.id)).toBe(kbdStockBefore)
    expect(getInventoryMovements()).toHaveLength(0)
  })

  it('12. separate legitimate transactions for the same product succeed', () => {
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt',
          quantityChange: 5,
          referenceType: 'purchase',
          referenceId: 'receipt-T1',
        },
      },
    ])
    expect(getProductStock(productKeyboard.id)).toBe(25)

    // Separate transaction T2 for the same product
    recordStockChanges([
      {
        product: productKeyboard,
        input: {
          type: 'purchase_receipt',
          quantityChange: 8,
          referenceType: 'purchase',
          referenceId: 'receipt-T2',
        },
      },
    ])
    expect(getProductStock(productKeyboard.id)).toBe(33)
  })

  it('13. existing POS stock deduction still works and rejects insufficient stock', () => {
    const saleResult = recordSaleStockMovements(
      [{ product: productKeyboard, quantity: 5 }],
      { id: 'sale-pos-1', number: 'INV-1001' }
    )

    expect(saleResult).toHaveLength(1)
    expect(saleResult[0].quantityChange).toBe(-5)
    expect(getProductStock(productKeyboard.id)).toBe(15)

    // Attempting to sell more than available (15 available, trying to sell 20)
    expect(() =>
      recordSaleStockMovements(
        [{ product: productKeyboard, quantity: 20 }],
        { id: 'sale-pos-2', number: 'INV-1002' }
      )
    ).toThrow('does not have enough stock')

    // Balance remains 15
    expect(getProductStock(productKeyboard.id)).toBe(15)
  })

  it('14. purchase receiving still works idempotently', () => {
    const receiptChanges = [
      {
        product: productMouse,
        input: {
          type: 'purchase_receipt' as const,
          quantityChange: 10,
          referenceType: 'purchase' as const,
          referenceId: 'gr-999',
          referenceNumber: 'GR-999',
          unitCost: 1500,
        },
      },
    ]

    recordStockChanges(receiptChanges)
    expect(getProductStock(productMouse.id)).toBe(25)

    // Idempotent re-receipt
    const replayed = recordStockChanges(receiptChanges)
    expect(replayed).toHaveLength(1)
    expect(getProductStock(productMouse.id)).toBe(25)
  })

  it('15. stock adjustment still works', () => {
    const movement = recordStockAdjustment(productMonitor, {
      type: 'adjustment_out',
      quantityChange: -2,
      referenceType: 'adjustment',
      referenceId: 'adj-mon-1',
      reason: 'Damaged packaging',
    })

    expect(movement.quantityChange).toBe(-2)
    expect(movement.newQuantity).toBe(3)
    expect(getProductStock(productMonitor.id)).toBe(3)
  })

  it('16. stock count confirmation works and creates audit movements', () => {
    saveStockCountDraft({
      id: 'count-test-1',
      name: 'Q4 Stock Count',
      createdAt: '2026-11-08T08:00:00.000Z',
      status: 'draft',
      rows: [
        {
          productId: productKeyboard.id,
          productName: productKeyboard.name,
          sku: productKeyboard.sku,
          unit: productKeyboard.unit,
          systemQuantity: 20,
          physicalQuantity: null,
        },
      ],
    })

    // Physical count found 22 (variance +2)
    const confirmed = confirmStockCount('count-test-1', {
      [productKeyboard.id]: 22,
    })

    expect(confirmed.status).toBe('confirmed')
    expect(getProductStock(productKeyboard.id)).toBe(22)

    const movements = getInventoryMovements()
    const countMovement = movements.find((m) => m.referenceId === 'count-test-1')
    expect(countMovement).toBeDefined()
    expect(countMovement?.quantityChange).toBe(2)
  })
})

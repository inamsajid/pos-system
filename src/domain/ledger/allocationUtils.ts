/**
 * Pure ledger balance and payment allocation utilities for Customer and Supplier accounts.
 * Operates in integer minor units (paise).
 */

export interface LedgerEntryDelta {
  debitMinor: number
  creditMinor: number
}

export interface CustomerBalanceResult {
  totalDebitsMinor: number
  totalCreditsMinor: number
  outstandingReceivableMinor: number
  advanceBalanceMinor: number
  netBalanceMinor: number
}

export interface SupplierBalanceResult {
  totalDebitsMinor: number
  totalCreditsMinor: number
  outstandingPayableMinor: number
  advanceBalanceMinor: number
  netBalanceMinor: number
}

export interface AllocatableTarget {
  id: string
  outstandingMinor: number
}

export interface AllocationItemResult {
  targetId: string
  allocatedMinor: number
}

export interface PaymentAllocationResult {
  allocations: AllocationItemResult[]
  unallocatedMinor: number
  totalAllocatedMinor: number
}

/**
 * Calculates customer financial position from opening balance and ledger entries.
 *
 * In Customer Accounting:
 * - Debits represent invoices/charges (increases receivable).
 * - Credits represent collections/refunds (decreases receivable).
 *
 * Formula:
 * Net = OpeningReceivable + TotalDebits - TotalCredits
 */
export function calculateCustomerBalances(
  openingBalanceMinor: number,
  entries: LedgerEntryDelta[]
): CustomerBalanceResult {
  const safeOpening = Number.isFinite(openingBalanceMinor) ? Math.round(openingBalanceMinor) : 0

  let totalDebits = 0
  let totalCredits = 0

  for (const entry of entries) {
    if (Number.isFinite(entry.debitMinor) && entry.debitMinor > 0) {
      totalDebits += Math.round(entry.debitMinor)
    }
    if (Number.isFinite(entry.creditMinor) && entry.creditMinor > 0) {
      totalCredits += Math.round(entry.creditMinor)
    }
  }

  const netBalance = safeOpening + totalDebits - totalCredits

  return {
    totalDebitsMinor: totalDebits,
    totalCreditsMinor: totalCredits,
    outstandingReceivableMinor: netBalance > 0 ? netBalance : 0,
    advanceBalanceMinor: netBalance < 0 ? Math.abs(netBalance) : 0,
    netBalanceMinor: netBalance,
  }
}

/**
 * Calculates supplier financial position from opening payable and ledger entries.
 *
 * In Supplier Accounting:
 * - Credits represent purchases/bills (increases payable).
 * - Debits represent disbursements/returns (decreases payable).
 *
 * Formula:
 * Net = OpeningPayable + TotalCredits - TotalDebits
 */
export function calculateSupplierBalances(
  openingPayableMinor: number,
  entries: LedgerEntryDelta[]
): SupplierBalanceResult {
  const safeOpening = Number.isFinite(openingPayableMinor) ? Math.round(openingPayableMinor) : 0

  let totalDebits = 0
  let totalCredits = 0

  for (const entry of entries) {
    if (Number.isFinite(entry.debitMinor) && entry.debitMinor > 0) {
      totalDebits += Math.round(entry.debitMinor)
    }
    if (Number.isFinite(entry.creditMinor) && entry.creditMinor > 0) {
      totalCredits += Math.round(entry.creditMinor)
    }
  }

  const netBalance = safeOpening + totalCredits - totalDebits

  return {
    totalDebitsMinor: totalDebits,
    totalCreditsMinor: totalCredits,
    outstandingPayableMinor: netBalance > 0 ? netBalance : 0,
    advanceBalanceMinor: netBalance < 0 ? Math.abs(netBalance) : 0,
    netBalanceMinor: netBalance,
  }
}

/**
 * Proportionally or sequentially allocates a payment against a list of outstanding targets (invoices/purchases).
 *
 * @param paymentAmountMinor Total incoming payment or disbursement in paise.
 * @param targetItems List of invoices/bills with their current outstanding balances in paise.
 * @returns Breakdown of allocations per target item and any remaining unallocated advance.
 */
export function allocatePayment(
  paymentAmountMinor: number,
  targetItems: AllocatableTarget[]
): PaymentAllocationResult {
  const safePayment = Number.isFinite(paymentAmountMinor) ? Math.max(0, Math.round(paymentAmountMinor)) : 0

  if (safePayment === 0 || targetItems.length === 0) {
    return {
      allocations: [],
      unallocatedMinor: safePayment,
      totalAllocatedMinor: 0,
    }
  }

  let remainingToAllocate = safePayment
  const allocations: AllocationItemResult[] = []

  for (const target of targetItems) {
    if (remainingToAllocate <= 0) break

    const safeOutstanding = Math.max(0, Math.round(target.outstandingMinor))
    if (safeOutstanding === 0) continue

    const amountToApply = Math.min(remainingToAllocate, safeOutstanding)
    allocations.push({
      targetId: target.id,
      allocatedMinor: amountToApply,
    })

    remainingToAllocate -= amountToApply
  }

  return {
    allocations,
    unallocatedMinor: remainingToAllocate,
    totalAllocatedMinor: safePayment - remainingToAllocate,
  }
}


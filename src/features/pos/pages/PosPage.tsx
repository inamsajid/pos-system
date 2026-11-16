import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Barcode,
  Check,
  CheckCircle2,
  Clock,
  Layers,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { formatCurrency } from '../../../lib/currency'
import { getApiContext } from '../../../lib/api-client'
import { AuthContext } from '../../auth/context/authContextInstance'
import { useProducts } from '../../products/hooks/useProducts'
import { getProductStockStatus } from '../../products/utils/productUtils'
import { categoryService } from '../../categories/services/categoryService'
import { customerService } from '../../customers/services/customerService'
import { settingsService } from '../../settings/services/settingsService'
import { offlineDb } from '../../../lib/offline/database'
import { offlineSalesRepository } from '../../../lib/offline/sales/offlineSales.repository'
import { offlineSalesService } from '../../../lib/offline/sales/offlineSales.service'
import { outboxService } from '../../../lib/offline/outbox/outbox.service'
import type {
  LocalDeviceAllocationRecord,
  LocalOfflineAuthorizationRecord,
  OutboxCommandRecord,
  ProvisionalOfflineSaleRecord,
} from '../../../lib/offline/database.types'
import type { Customer } from '../../customers/types/customer.types'
import type { Product, ProductCategory } from '../../products/types/product.types'
import type { CheckoutMethod, CheckoutSale, SalePayment } from '../types/checkout.types'
import { completeCheckout, completeOfflineCheckout } from '../services/checkoutService'
import { discountAmount, money, orderTotal, subtotal, taxAmount } from '../utils/checkoutCalculations'
import './pos.css'

type UnitCategory = ProductCategory

const WALK_IN_FALLBACK: Customer = {
  id: 'walk-in',
  customerCode: 'WALK-IN',
  name: 'Walk-in Customer',
  type: 'individual',
  isWalkIn: true,
  status: 'active',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

function getScopedCartKey(
  userId?: string | null,
  businessId?: string | null,
  branchId?: string | null
): string {
  return `pos-cart:${userId || 'anon'}:${businessId || 'none'}:${branchId || 'none'}`
}

function readCartFromStorage(storageKey: string): Record<string, number> {
  try {
    if (typeof sessionStorage === 'undefined') return {}
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export type UnifiedTransactionUiState =
  | 'Draft'
  | 'Pending offline sync'
  | 'Syncing'
  | 'Synchronized'
  | 'Failed'
  | 'Conflict / review required'

function deriveCommandUiState(
  cmd?: OutboxCommandRecord,
  sale?: ProvisionalOfflineSaleRecord
): UnifiedTransactionUiState {
  const cmdStatus = cmd?.status
  const saleStatus = sale?.status

  if (cmdStatus === 'leased' || cmdStatus === 'sending') return 'Syncing'
  if (cmdStatus === 'acknowledged' || saleStatus === 'synchronized') return 'Synchronized'
  if (
    cmdStatus === 'conflict' ||
    cmdStatus === 'reconciliation_required' ||
    saleStatus === 'conflict' ||
    saleStatus === 'reconciliation_required'
  ) {
    return 'Conflict / review required'
  }
  if (cmdStatus === 'rejected' || cmdStatus === 'cancelled' || saleStatus === 'rejected') {
    return 'Failed'
  }
  if (
    cmdStatus === 'pending' ||
    cmdStatus === 'retryable' ||
    cmdStatus === 'blocked_auth' ||
    saleStatus === 'provisional'
  ) {
    return 'Pending offline sync'
  }
  return 'Draft'
}

export function PosPage() {
  const authCtx = useContext(AuthContext)
  const apiCtx = getApiContext()
  const activeUserId = authCtx?.user?.id || apiCtx.userId || null
  const activeBusinessId = authCtx?.activeBusiness?.id || apiCtx.businessId || null
  const activeBranchId = authCtx?.activeBranch?.id || apiCtx.branchId || null

  const demoMode = isExplicitDemo()
  const businessDisplayName =
    authCtx?.activeBusiness?.name || (demoMode ? 'Northstar Market' : 'Store Workspace')
  const cashierDisplayName =
    authCtx?.user?.name || authCtx?.user?.email || (demoMode ? 'Demo Cashier' : 'Cashier')
  const branchDisplayName = authCtx?.activeBranch?.name || ''

  const cartStorageKey = getScopedCartKey(activeUserId, activeBusinessId, activeBranchId)

  const { products, reload } = useProducts()
  const [customers, setCustomers] = useState<Customer[]>([WALK_IN_FALLBACK])
  const [categories, setCategories] = useState<UnitCategory[]>([])
  const [cart, setCart] = useState<Record<string, number>>(() => readCartFromStorage(cartStorageKey))
  const [search, setSearch] = useState('')
  const [barcode, setBarcode] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerId, setCustomerId] = useState('walk-in')
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed')
  const [discountValue, setDiscountValue] = useState(0)
  const [method, setMethod] = useState<CheckoutMethod>('cash')
  const [amountInput, setAmountInput] = useState('')
  const [reference, setReference] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [receipt, setReceipt] = useState<CheckoutSale>()
  const [draftPayments, setDraftPayments] = useState<SalePayment[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  )
  const [taxSettings, setTaxSettings] = useState<{ taxRatePercent: number; taxInclusive: boolean }>({
    taxRatePercent: 0,
    taxInclusive: false,
  })

  // Offline quota & outbox queue state
  const [offlineAuth, setOfflineAuth] = useState<LocalOfflineAuthorizationRecord | null>(null)
  const [offlineAllocMap, setOfflineAllocMap] = useState<Map<string, LocalDeviceAllocationRecord>>(
    () => new Map()
  )
  const [outboxCommands, setOutboxCommands] = useState<OutboxCommandRecord[]>([])
  const [offlineSales, setOfflineSales] = useState<ProvisionalOfflineSaleRecord[]>([])
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [preparingOffline, setPreparingOffline] = useState(false)
  const [conflictModalCmd, setConflictModalCmd] = useState<OutboxCommandRecord | null>(null)
  const [conflictReason, setConflictReason] = useState('')
  const [conflictMode, setConflictMode] = useState<'apply_current_price' | 'accept_offline_price'>(
    'apply_current_price'
  )

  const searchRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const cartRef = useRef<HTMLDivElement>(null)

  const methodLabels: Record<CheckoutMethod, string> = useMemo(
    () =>
      demoMode
        ? {
            cash: 'Cash',
            card: 'Card (simulated)',
            'bank-transfer': 'Bank transfer (simulated)',
            credit: 'Credit / Udhaar',
          }
        : {
            cash: 'Cash',
            card: 'Card',
            'bank-transfer': 'Bank transfer',
            credit: 'Credit / Udhaar',
          },
    [demoMode]
  )

  // Reset/reload cart whenever user/business/branch scope changes or session clears
  useEffect(() => {
    setCart(readCartFromStorage(cartStorageKey))
    setCustomerId('walk-in')
    setDiscountValue(0)
    setError('')
    setReceipt(undefined)
  }, [cartStorageKey])

  useEffect(() => {
    const onSessionCleared = () => {
      setCart({})
      setDraftPayments([])
      setReceipt(undefined)
      setOutboxCommands([])
      setOfflineSales([])
      setOfflineAuth(null)
      setOfflineAllocMap(new Map())
    }
    window.addEventListener('northstar:session-cleared', onSessionCleared)
    return () => window.removeEventListener('northstar:session-cleared', onSessionCleared)
  }, [])

  // Persist scoped cart
  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (Object.keys(cart).length === 0) {
          sessionStorage.removeItem(cartStorageKey)
        } else {
          sessionStorage.setItem(cartStorageKey, JSON.stringify(cart))
        }
      }
    } catch {
      // Ignore storage quota exceptions
    }
  }, [cart, cartStorageKey])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const loadOfflineTerminalState = useCallback(async () => {
    if (!activeUserId || !activeBusinessId || typeof indexedDB === 'undefined') {
      setOfflineAuth(null)
      setOfflineAllocMap(new Map())
      setOutboxCommands([])
      setOfflineSales([])
      return
    }

    try {
      const deviceId = await offlineDb.getDeviceId()
      const branchScope = activeBranchId || 'default'
      const [auth, cmds, salesList] = await Promise.all([
        offlineSalesRepository.getActiveAuthorization(
          activeUserId,
          activeBusinessId,
          branchScope,
          deviceId
        ),
        outboxService.listCommands(activeUserId, activeBusinessId),
        offlineSalesRepository.listSalesByTenant(activeUserId, activeBusinessId, activeBranchId || undefined),
      ])

      const allocs = auth
        ? await offlineSalesRepository.getAllocationsForAuth(auth.id)
        : []
      const map = new Map<string, LocalDeviceAllocationRecord>()
      for (const a of allocs) {
        map.set(a.productId, a)
      }

      setOfflineAuth(auth)
      setOfflineAllocMap(map)
      setOutboxCommands(cmds)
      setOfflineSales(salesList)
    } catch {
      // Safe guard in constrained environments
    }
  }, [activeUserId, activeBusinessId, activeBranchId])

  useEffect(() => {
    void loadOfflineTerminalState()
    const unsubscribe = outboxService.subscribe(() => {
      void loadOfflineTerminalState()
    })
    return () => unsubscribe()
  }, [loadOfflineTerminalState])

  // Load customers, categories, and settings safely even when offline
  useEffect(() => {
    let active = true
    void Promise.allSettled([
      customerService.getCustomers(),
      categoryService.getCategories(),
    ]).then(([custRes, catRes]) => {
      if (!active) return
      if (custRes.status === 'fulfilled' && Array.isArray(custRes.value) && custRes.value.length > 0) {
        const activeCustomers = custRes.value.filter((x) => x.isWalkIn || x.status === 'active')
        setCustomers(activeCustomers.some((c) => c.isWalkIn) ? activeCustomers : [WALK_IN_FALLBACK, ...activeCustomers])
      } else {
        setCustomers([WALK_IN_FALLBACK])
      }

      if (catRes.status === 'fulfilled' && Array.isArray(catRes.value)) {
        setCategories(
          catRes.value
            .filter((x) => x.status === 'active')
            .map(({ id, name }) => ({ id, name }))
        )
      }
    })

    void settingsService
      .getSettings()
      .then((s) => {
        if (!active) return
        if (s && typeof s.defaultTaxRate === 'number') {
          setTaxSettings({
            taxRatePercent: s.defaultTaxRate,
            taxInclusive: Boolean((s.settingsJson as Record<string, unknown> | undefined)?.taxInclusive),
          })
        }
      })
      .catch(() => {
        // Fallback to signed offline authorization tax settings if offline
      })

    return () => {
      active = false
    }
  }, [activeBusinessId, activeBranchId, isOnline])

  // Enforce offline constraints cleanly when operating offline without demo mode
  const effectiveOfflineMode = !isOnline && !demoMode
  const activeTaxSettings = useMemo(() => {
    if (effectiveOfflineMode && offlineAuth && typeof offlineAuth.taxRatePercent === 'number') {
      return {
        taxRatePercent: offlineAuth.taxRatePercent,
        taxInclusive: Boolean(offlineAuth.taxInclusive),
      }
    }
    return taxSettings
  }, [effectiveOfflineMode, offlineAuth, taxSettings])

  useEffect(() => {
    if (effectiveOfflineMode) {
      setCustomerId('walk-in')
      setMethod('cash')
      if (!offlineAuth?.allowDiscounts) {
        setDiscountValue(0)
      }
    }
  }, [effectiveOfflineMode, offlineAuth])

  const selectedCustomer =
    customers.find((c) => c.id === customerId) ??
    customers.find((c) => c.isWalkIn) ??
    WALK_IN_FALLBACK
  const activeProducts = products.filter((p) => p.status === 'active')
  const visible = useMemo(
    () =>
      activeProducts.filter(
        (p) =>
          (!categoryId || p.categoryId === categoryId) &&
          (!search || [p.name, p.sku, p.barcode].some((x) => x?.toLowerCase().includes(search.toLowerCase())))
      ),
    [activeProducts, categoryId, search]
  )

  const cartProducts = Object.keys(cart)
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p))
  const sub = subtotal(cartProducts, cart)
  let disc = 0
  let discError = ''
  try {
    disc = effectiveOfflineMode && !offlineAuth?.allowDiscounts ? 0 : discountAmount(sub, discountType, discountValue)
  } catch (e) {
    discError = e instanceof Error ? e.message : 'Invalid discount'
  }
  const tax = taxAmount(
    money(Math.max(0, sub - disc)),
    activeTaxSettings.taxRatePercent,
    activeTaxSettings.taxInclusive
  )
  const total = orderTotal(sub, disc, tax, activeTaxSettings.taxInclusive)
  const lineCount = Object.values(cart).reduce((a, b) => a + b, 0)
  const cashReceived = Number(amountInput) || 0
  const cashChange = method === 'cash' ? money(Math.max(0, cashReceived - total)) : 0
  const customerMatches = customers.filter(
    (c) =>
      (c.isWalkIn || c.status === 'active') &&
      (!customerQuery ||
        [c.name, c.customerCode, c.phone].some((x) =>
          x?.toLowerCase().includes(customerQuery.toLowerCase())
        ))
  )

  const getAvailableQtyForTerminal = useCallback(
    (p: Product): number => {
      if (effectiveOfflineMode) {
        return offlineAllocMap.get(p.id)?.remainingQuantity ?? 0
      }
      return p.trackInventory ? p.stockQuantity : Number.POSITIVE_INFINITY
    },
    [effectiveOfflineMode, offlineAllocMap]
  )

  const addProduct = useCallback(
    (p: Product) => {
      if (p.status !== 'active') {
        setError('Archived products cannot be sold.')
        return
      }
      const q = cart[p.id] ?? 0
      if (effectiveOfflineMode) {
        if (!offlineAuth) {
          setError('Offline checkout requires a pre-authorized terminal package.')
          return
        }
        const remainingAlloc = offlineAllocMap.get(p.id)?.remainingQuantity ?? 0
        if (remainingAlloc <= 0 || q + 1 > remainingAlloc) {
          setError(
            remainingAlloc <= 0
              ? `${p.name} has no remaining offline allocation quota.`
              : `Offline quota for ${p.name} is ${remainingAlloc} ${p.unit}.`
          )
          return
        }
      } else if (p.trackInventory && (p.stockQuantity <= 0 || q + 1 > p.stockQuantity)) {
        setError(p.stockQuantity <= 0 ? `${p.name} is out of stock.` : `Only ${p.stockQuantity} ${p.unit} available.`)
        return
      }
      setError('')
      setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))
    },
    [cart, effectiveOfflineMode, offlineAuth, offlineAllocMap]
  )

  const scanBarcode = (value: string) => {
    const found = products.find((p) => p.barcode?.trim().toLowerCase() === value.trim().toLowerCase())
    if (!found) {
      setError(`No product found for barcode "${value}".`)
      return
    }
    addProduct(found)
    setBarcode('')
    barcodeRef.current?.focus()
  }

  const updateQty = (p: Product, raw: string) => {
    const q = Number(raw)
    if (!Number.isFinite(q) || q <= 0) {
      setError('Quantity must be greater than zero.')
      return
    }
    const maxAllowed = getAvailableQtyForTerminal(p)
    if (Number.isFinite(maxAllowed) && q > maxAllowed) {
      setError(
        effectiveOfflineMode
          ? `Only ${maxAllowed} ${p.unit} allocated for offline sale.`
          : `Only ${maxAllowed} ${p.unit} available.`
      )
      return
    }
    setError('')
    setCart((c) => ({ ...c, [p.id]: q }))
  }

  const decreaseQty = (p: Product) => {
    const q = cart[p.id] ?? 0
    if (q <= 1) {
      setCart((c) => {
        const next = { ...c }
        delete next[p.id]
        return next
      })
    } else {
      updateQty(p, String(q - 1))
    }
  }

  const clearCart = () => {
    if (lineCount && !window.confirm('Clear all items from this cart?')) return
    setCart({})
    setError('')
  }

  const buildValidatedDraftPayments = useCallback((): SalePayment[] | null => {
    if (discError) {
      setError(discError)
      return null
    }
    if (effectiveOfflineMode) {
      if (!offlineAuth) {
        setError('Offline POS authorization package is missing or expired.')
        return null
      }
      if (method !== 'cash') {
        setError('Offline mode only permits Cash Walk-in checkout.')
        return null
      }
      if (cashReceived < total) {
        setError('Cash received is below the sale total.')
        return null
      }
      return [{ method: 'cash', amount: cashReceived }]
    }

    if (method === 'cash') {
      if (cashReceived < total) {
        setError('Cash received is below the sale total.')
        return null
      }
      return [{ method: 'cash', amount: cashReceived }]
    }
    if (method === 'credit') {
      if (selectedCustomer?.isWalkIn) {
        setError('Walk-in Customer cannot use credit.')
        return null
      }
      const paidNow = Number(amountInput) || 0
      if (paidNow < 0 || paidNow > total) {
        setError('Invalid partial cash amount for credit sale.')
        return null
      }
      const due = Math.max(0, money(total - paidNow))
      return [
        ...(paidNow > 0 ? [{ method: 'cash' as const, amount: paidNow }] : []),
        { method: 'credit' as const, amount: due },
      ]
    }
    return [{ method, amount: total, reference }]
  }, [
    discError,
    effectiveOfflineMode,
    offlineAuth,
    method,
    cashReceived,
    total,
    selectedCustomer,
    amountInput,
    reference,
  ])

  const openPayment = useCallback(() => {
    if (!lineCount) {
      setError('Add products before checkout.')
      return
    }
    if (discError) {
      setError(discError)
      return
    }
    if (effectiveOfflineMode && !offlineAuth) {
      setError('No active offline authorization on this terminal. Prepare offline quota while online.')
      return
    }
    setError('')
    if (effectiveOfflineMode) {
      setMethod('cash')
      setAmountInput('')
    } else {
      setAmountInput(method === 'cash' ? total.toFixed(2) : '')
    }
    setPaymentOpen(true)
  }, [lineCount, discError, effectiveOfflineMode, offlineAuth, method, total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (e.key === 'Escape') {
        setPaymentOpen(false)
        setConfirmOpen(false)
        setReceipt(undefined)
        setSyncDrawerOpen(false)
      }
      if (!typing && e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (!typing && e.key === 'F4') {
        e.preventDefault()
        barcodeRef.current?.focus()
      }
      if (!typing && e.key === 'F8') {
        e.preventDefault()
        openPayment()
      }
      if (e.ctrlKey && e.key === 'Enter' && paymentOpen) {
        e.preventDefault()
        const validDraft = buildValidatedDraftPayments()
        if (validDraft) {
          setDraftPayments(validDraft)
          setConfirmOpen(true)
          setPaymentOpen(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paymentOpen, openPayment, buildValidatedDraftPayments])

  const handlePrepareOfflineQuota = async () => {
    if (!activeUserId || !activeBusinessId) {
      setNotice('Sign in and select a business before preparing offline quota.')
      return
    }
    setPreparingOffline(true)
    setError('')
    try {
      const branchScope = activeBranchId || 'default'
      await offlineSalesService.prepareTerminalAuthorization({
        userId: activeUserId,
        businessId: activeBusinessId,
        branchId: branchScope,
        products,
      })
      await loadOfflineTerminalState()
      setNotice('Offline quota authorized & cached securely on this terminal.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authorize offline quota.')
    } finally {
      setPreparingOffline(false)
    }
  }

  const handleSyncQueueNow = async () => {
    if (!activeUserId || !activeBusinessId) return
    setSyncBusy(true)
    setError('')
    try {
      await outboxService.dispatchPending(activeUserId, activeBusinessId, activeBranchId || undefined)
      await loadOfflineTerminalState()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to synchronize offline queue.')
    } finally {
      setSyncBusy(false)
    }
  }

  const handleResolveConflictSubmit = async () => {
    if (!conflictModalCmd || conflictReason.trim().length < 3) return
    setSyncBusy(true)
    try {
      await outboxService.retryConflict(conflictModalCmd.id, {
        ...conflictModalCmd.payload,
        priceConflictResolution: {
          mode: conflictMode,
          reason: conflictReason.trim(),
        },
      })
      setConflictModalCmd(null)
      setConflictReason('')
      await handleSyncQueueNow()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve offline price conflict.')
    } finally {
      setSyncBusy(false)
    }
  }

  async function completeWith(p: SalePayment[]) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let sale: CheckoutSale
      if (effectiveOfflineMode) {
        if (!activeUserId || !activeBusinessId || !offlineAuth) {
          throw new Error('Missing offline terminal authorization context.')
        }
        const cashPaid = p
          .filter((entry) => entry.method === 'cash')
          .reduce((sum, entry) => sum + entry.amount, 0)
        sale = await completeOfflineCheckout({
          quantities: cart,
          cashTendered: cashPaid,
          userId: activeUserId,
          businessId: activeBusinessId,
          branchId: activeBranchId || 'default',
          deviceId: offlineAuth.deviceId,
          authorizationId: offlineAuth.id,
          cashierName: cashierDisplayName,
          businessName: businessDisplayName,
        })
        await loadOfflineTerminalState()
      } else {
        sale = await completeCheckout(cart, customerId, discountType, discountValue, p, {
          ...activeTaxSettings,
          cashierName: cashierDisplayName,
          businessName: businessDisplayName,
        })
        await reload()
      }

      setReceipt(sale)
      setCart({})
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(cartStorageKey)
      }
      setDiscountValue(0)
      setAmountInput('')
      setReference('')
      setConfirmOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete checkout.')
      setConfirmOpen(false)
      setPaymentOpen(true)
      void reload()
    } finally {
      setBusy(false)
    }
  }

  const queueCounts = useMemo(() => {
    let pending = 0
    let syncing = 0
    let synchronized = 0
    let failed = 0
    let conflict = 0

    const cmdById = new Map(outboxCommands.map((c) => [c.id, c]))
    const handledCmdIds = new Set<string>()

    for (const s of offlineSales) {
      const cmd = cmdById.get(s.outboxCommandId)
      if (cmd) handledCmdIds.add(cmd.id)
      const uiState = deriveCommandUiState(cmd, s)
      if (uiState === 'Pending offline sync') pending++
      else if (uiState === 'Syncing') syncing++
      else if (uiState === 'Synchronized') synchronized++
      else if (uiState === 'Failed') failed++
      else if (uiState === 'Conflict / review required') conflict++
    }

    for (const cmd of outboxCommands) {
      if (handledCmdIds.has(cmd.id)) continue
      const uiState = deriveCommandUiState(cmd, undefined)
      if (uiState === 'Pending offline sync') pending++
      else if (uiState === 'Syncing') syncing++
      else if (uiState === 'Synchronized') synchronized++
      else if (uiState === 'Failed') failed++
      else if (uiState === 'Conflict / review required') conflict++
    }

    return {
      draft: lineCount > 0 ? 1 : 0,
      pending,
      syncing,
      synchronized,
      failed,
      conflict,
      attentionCount: pending + syncing + failed + conflict,
    }
  }, [outboxCommands, offlineSales, lineCount])

  const offlineQueueRows = useMemo(() => {
    const cmdById = new Map(outboxCommands.map((c) => [c.id, c]))
    const rows = offlineSales.map((sale) => {
      const cmd = cmdById.get(sale.outboxCommandId)
      return {
        sale,
        cmd,
        uiState: deriveCommandUiState(cmd, sale),
      }
    })
    rows.sort((a, b) => b.sale.createdAt.localeCompare(a.sale.createdAt))
    return rows
  }, [offlineSales, outboxCommands])

  return (
    <div className="pos-shell">
      <header className="pos-header flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Point of Sale</h1>
          <p className="text-xs text-slate-500">
            {businessDisplayName}
            {branchDisplayName ? ` · ${branchDisplayName}` : ''} · Cashier: {cashierDisplayName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">
            {new Intl.DateTimeFormat('en-PK', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Karachi',
            }).format(now)}
          </span>

          {demoMode ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800 border border-amber-200">
              Demo mode
            </span>
          ) : effectiveOfflineMode ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
              <WifiOff size={12} />
              <span>
                {offlineAuth
                  ? `Offline POS (${Math.max(0, offlineAuth.maxTransactions - (offlineAuth.usedTransactions ?? 0))} tx left)`
                  : 'Offline (Not Authorized)'}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Online · Live API</span>
            </span>
          )}

          {!demoMode && isOnline && activeUserId && activeBusinessId && (
            <button
              type="button"
              onClick={() => void handlePrepareOfflineQuota()}
              disabled={preparingOffline || products.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Pre-authorize stock quota on this terminal for offline checkout"
            >
              {preparingOffline
                ? 'Authorizing…'
                : offlineAuth
                  ? `Offline Ready (${offlineAllocMap.size} items)`
                  : 'Prepare Offline Quota'}
            </button>
          )}

          {!demoMode && (
            <button
              type="button"
              onClick={() => setSyncDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              <Layers size={13} />
              <span>Offline Queue</span>
              {queueCounts.attentionCount > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {queueCounts.attentionCount}
                </span>
              )}
            </button>
          )}

          <button onClick={clearCart} className="rounded-lg border px-3 py-1.5">
            Reset cart
          </button>
        </div>
      </header>

      {effectiveOfflineMode && (
        <div
          role="status"
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            offlineAuth
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              {offlineAuth
                ? 'Offline Mode: Cash Walk-in checkout only. Receipts are provisional (NOT official tax invoices) until synchronized.'
                : 'Offline Mode: This terminal has no active offline quota authorization. Reconnect to authorize or restore online checkout.'}
            </span>
          </div>
          {queueCounts.attentionCount > 0 && (
            <button
              type="button"
              onClick={() => setSyncDrawerOpen(true)}
              className="font-semibold underline"
            >
              View {queueCounts.attentionCount} pending/queued
            </button>
          )}
        </div>
      )}

      <div className="pos-columns">
        <section className={`pos-products ${showCart ? 'hidden md:block' : ''}`}>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <label className="relative">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input
                ref={searchRef}
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm"
                placeholder="Search product name, SKU or barcode (F2)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (barcode) scanBarcode(barcode)
              }}
            >
              <label className="relative flex-1 sm:w-56">
                <Barcode size={16} className="absolute left-3 top-3 text-emerald-600" />
                <input
                  ref={barcodeRef}
                  className="w-full rounded-lg border border-emerald-300 bg-white py-2.5 pl-9 pr-3 text-sm"
                  placeholder="Scan barcode (F4)"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      scanBarcode(barcode)
                    }
                  }}
                />
              </label>
              <Button type="submit" variant="primary">
                Scan
              </Button>
            </form>
          </div>

          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategoryId('')}
              className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                !categoryId ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border'
              }`}
            >
              All categories
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                  categoryId === c.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="pos-grid">
            {visible.map((p) => {
              const state = getProductStockStatus(p)
              const offlineAlloc = effectiveOfflineMode ? offlineAllocMap.get(p.id) : undefined
              const effectiveRemaining = effectiveOfflineMode
                ? (offlineAlloc?.remainingQuantity ?? 0) - (cart[p.id] ?? 0)
                : p.trackInventory
                  ? p.stockQuantity - (cart[p.id] ?? 0)
                  : Number.POSITIVE_INFINITY
              const blocked = effectiveOfflineMode
                ? !offlineAuth || effectiveRemaining <= 0
                : p.trackInventory && effectiveRemaining <= 0

              const badgeText = effectiveOfflineMode
                ? offlineAlloc
                  ? `Quota ${offlineAlloc.remainingQuantity} ${p.unit}`
                  : 'No offline quota'
                : blocked
                  ? 'Out of stock'
                  : state === 'low-stock'
                    ? 'Low stock'
                    : p.trackInventory
                      ? `${p.stockQuantity} ${p.unit}`
                      : 'Not tracked'

              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={blocked}
                  onClick={() => addProduct(p)}
                  className="pos-product-card text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] ${
                        blocked
                          ? 'bg-rose-50 text-rose-700'
                          : state === 'low-stock'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {badgeText}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{p.sku}</p>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-sm font-bold">{formatCurrency(p.sellingPrice)}</span>
                    <span className="text-[10px] text-slate-500">/{p.unit}</span>
                  </div>
                </button>
              )
            })}
          </div>
          {!visible.length && (
            <EmptyState title="No products found" description="Try another search or category." />
          )}
        </section>

        <aside ref={cartRef} className={`pos-cart ${showCart ? '' : 'hidden md:block'}`}>
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <span>Current order</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{lineCount}</span>
              {lineCount > 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  Draft
                </span>
              )}
            </h2>
            <button className="text-xs text-rose-600" onClick={clearCart}>
              Clear cart
            </button>
          </div>

          <label className="mt-3 block text-xs font-semibold text-slate-600">
            Customer
            <select
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm disabled:bg-slate-50"
              value={customerId}
              disabled={effectiveOfflineMode}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customerMatches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isWalkIn ? ' (Walk-in)' : ` · ${c.customerCode}`}
                </option>
              ))}
            </select>
          </label>
          <input
            value={customerQuery}
            disabled={effectiveOfflineMode}
            onChange={(e) => setCustomerQuery(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50"
            placeholder={
              effectiveOfflineMode
                ? 'Offline: Walk-in Customer only'
                : 'Find customer by name, code or phone'
            }
          />
          <div className="mt-1 text-[11px] text-slate-500">
            {selectedCustomer?.phone ?? selectedCustomer?.type ?? 'No contact details'}
          </div>

          <div className="pos-cart-lines mt-3">
            {cartProducts.length ? (
              cartProducts.map((p) => (
                <div key={p.id} className="border-t border-slate-100 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {p.sku} · {formatCurrency(p.sellingPrice)}/{p.unit}
                      </p>
                    </div>
                    <button
                      aria-label={`Remove ${p.name}`}
                      onClick={() =>
                        setCart((c) => {
                          const n = { ...c }
                          delete n[p.id]
                          return n
                        })
                      }
                      className="p-2 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        aria-label={`Decrease ${p.name}`}
                        className="rounded border p-1.5"
                        onClick={() => decreaseQty(p)}
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        aria-label={`${p.name} quantity`}
                        type="number"
                        min="0.01"
                        step={['kg', 'gram', 'liter', 'meter'].includes(p.unit) ? '0.01' : '1'}
                        value={cart[p.id]}
                        onChange={(e) => updateQty(p, e.target.value)}
                        className="w-16 rounded border px-2 py-1 text-center text-sm"
                      />
                      <button
                        aria-label={`Increase ${p.name}`}
                        className="rounded border p-1.5"
                        onClick={() => addProduct(p)}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <strong className="text-sm">{formatCurrency(money(p.sellingPrice * cart[p.id]))}</strong>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="Cart is empty" description="Select a product to add it to this order." />
            )}
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between text-sm">
              <span>Subtotal</span>
              <span>{formatCurrency(sub)}</span>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
              <select
                className="rounded-lg border px-2 py-2 text-xs disabled:bg-slate-50"
                value={discountType}
                disabled={effectiveOfflineMode && !offlineAuth?.allowDiscounts}
                onChange={(e) => setDiscountType(e.target.value as 'fixed' | 'percent')}
              >
                <option value="fixed">Fixed discount</option>
                <option value="percent">Percent discount</option>
              </select>
              <input
                type="number"
                min="0"
                max={discountType === 'percent' ? 100 : sub}
                step="0.01"
                disabled={effectiveOfflineMode && !offlineAuth?.allowDiscounts}
                value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value))}
                className="min-w-0 rounded-lg border px-2 py-2 text-sm disabled:bg-slate-50"
              />
            </div>
            {discError && <p className="mt-1 text-xs text-rose-600">{discError}</p>}
            {tax > 0 && (
              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Tax ({activeTaxSettings.taxRatePercent}%{activeTaxSettings.taxInclusive ? ' incl.' : ''})
                </span>
                <span>{formatCurrency(tax)}</span>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-lg font-bold">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
            {error && (
              <p role="alert" className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">
                {error}
              </p>
            )}
            <Button
              variant="primary"
              className="mt-3 w-full py-3"
              disabled={!cartProducts.length || (effectiveOfflineMode && !offlineAuth)}
              onClick={openPayment}
            >
              {effectiveOfflineMode
                ? `Provisional Offline Cash · ${formatCurrency(total)}`
                : `Proceed to payment · ${formatCurrency(total)}`}
            </Button>
            <button
              className="mt-2 w-full text-center text-[11px] text-slate-400"
              onClick={() =>
                setNotice('Shortcuts: F2 search · F4 barcode · F8 payment · Ctrl+Enter confirm')
              }
            >
              Keyboard shortcuts
            </button>
          </div>
        </aside>
      </div>

      <button className="pos-mobile-cart md:hidden" onClick={() => setShowCart((v) => !v)}>
        {showCart ? 'Back to products' : 'Cart'} · {lineCount} · {formatCurrency(total)}
      </button>

      {/* Payment Modal */}
      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Payment">
        <div className="space-y-3">
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span>Total payable</span>
            <strong>{formatCurrency(total)}</strong>
          </div>

          <label className="block text-xs font-semibold">
            Payment method
            <select
              className="mt-1 w-full rounded-lg border p-2.5 disabled:bg-slate-50"
              value={method}
              disabled={effectiveOfflineMode}
              onChange={(e) => {
                const m = e.target.value as CheckoutMethod
                setMethod(m)
                setAmountInput(m === 'cash' || m === 'credit' ? '' : total.toFixed(2))
              }}
            >
              {Object.entries(methodLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          {method === 'cash' ? (
            <>
              <label className="block text-xs font-semibold">
                Amount received
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <p className="flex justify-between text-sm">
                Change to return <strong>{formatCurrency(cashChange)}</strong>
              </p>
              {cashReceived < total && (
                <p className="text-xs text-rose-600">Received amount is below the total.</p>
              )}
            </>
          ) : method === 'credit' ? (
            <>
              <p className="text-sm">
                Customer: <strong>{selectedCustomer?.name}</strong>
              </p>
              <label className="block text-xs font-semibold">
                Amount paid now
                <input
                  type="number"
                  min="0"
                  max={total}
                  step="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <p className="text-sm">
                Remaining credit <strong>{formatCurrency(Math.max(0, total - (Number(amountInput) || 0)))}</strong>
              </p>
              {selectedCustomer?.isWalkIn && (
                <p className="text-xs text-rose-600">Walk-in Customer cannot use credit.</p>
              )}
            </>
          ) : (
            <>
              {demoMode && (
                <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                  {methodLabels[method]}. Demo mode active.
                </p>
              )}
              {method === 'bank-transfer' && (
                <label className="block text-xs">
                  Transaction reference (optional)
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
              )}
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                discError !== '' ||
                (method === 'cash' && cashReceived < total) ||
                (method === 'credit' && selectedCustomer?.isWalkIn)
              }
              onClick={() => {
                const validated = buildValidatedDraftPayments()
                if (validated) {
                  setDraftPayments(validated)
                  setConfirmOpen(true)
                  setPaymentOpen(false)
                }
              }}
            >
              Review sale
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Sale Modal */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={effectiveOfflineMode ? 'Confirm provisional offline sale' : 'Confirm sale'}
      >
        <p className="text-sm text-slate-600">
          {effectiveOfflineMode
            ? `Record this PROVISIONAL OFFLINE CASH sale for ${formatCurrency(total)}? It will remain queued locally until synchronized with the central server.`
            : demoMode
              ? `Complete this demo sale for ${formatCurrency(total)}? Stock will be updated in local demo memory.`
              : `Submit this sale for ${formatCurrency(total)} to the server? Inventory, invoice, and payment records will be updated upon confirmation.`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmOpen(false)}>Go back</Button>
          <Button variant="primary" disabled={busy} onClick={() => void completeWith(draftPayments)}>
            {busy ? 'Completing…' : effectiveOfflineMode ? 'Save Provisional Sale' : 'Complete sale'}
          </Button>
        </div>
      </Modal>

      {/* Receipt Modal (Provisional vs Server-Synchronized) */}
      <Modal
        open={Boolean(receipt)}
        onClose={() => setReceipt(undefined)}
        title={receipt?.isProvisional ? 'Provisional Offline Receipt' : 'Sale completed'}
      >
        {receipt && (
          <div id="pos-receipt" className="receipt">
            {receipt.isProvisional ? (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-center text-xs font-semibold text-amber-900">
                <div>Pending offline sync</div>
                <div className="mt-0.5 text-[11px] font-bold">
                  {receipt.provisionalNotice || 'PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE'}
                </div>
              </div>
            ) : (
              <div className="mb-3 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={14} />
                <span>Synchronized · Server Confirmed</span>
              </div>
            )}

            <div className="text-center">
              <h2 className="text-lg font-bold">{receipt.businessSnapshot.name}</h2>
              <p className="mt-2 font-semibold">{receipt.receiptNumber}</p>
              <p className="text-xs">
                {receipt.isProvisional ? 'Status: ' : 'Invoice: '}
                {receipt.invoiceNumber}
              </p>
              <p className="text-xs">
                {new Intl.DateTimeFormat('en-PK', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Karachi',
                }).format(new Date(receipt.createdAt))}
              </p>
            </div>
            <p className="mt-3 text-sm">
              Customer: {receipt.customerName} {receipt.customerCode && `(${receipt.customerCode})`}
            </p>
            <div className="mt-3 border-y py-2">
              {receipt.items.map((i) => (
                <div key={i.productId} className="flex justify-between gap-3 py-1 text-xs">
                  <span>
                    {i.productName} · {i.sku}
                    <br />
                    {i.quantity} {i.unit} × {formatCurrency(i.unitPrice)}
                  </span>
                  <strong>{formatCurrency(i.lineTotal)}</strong>
                </div>
              ))}
            </div>
            <div className="space-y-1 py-2 text-sm">
              <p className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(receipt.subtotal)}</span>
              </p>
              <p className="flex justify-between">
                <span>Discount</span>
                <span>-{formatCurrency(receipt.discountAmount)}</span>
              </p>
              {(receipt.taxAmount ?? 0) > 0 && (
                <p className="flex justify-between">
                  <span>Tax</span>
                  <span>{formatCurrency(receipt.taxAmount ?? 0)}</span>
                </p>
              )}
              <p className="flex justify-between font-bold">
                <span>Total</span>
                <span>{formatCurrency(receipt.totalAmount)}</span>
              </p>
              <p className="flex justify-between">
                <span>Paid</span>
                <span>{formatCurrency(receipt.amountPaid)}</span>
              </p>
              <p className="flex justify-between">
                <span>Change</span>
                <span>{formatCurrency(receipt.changeReturned)}</span>
              </p>
              {receipt.remainingBalance > 0 && (
                <p className="flex justify-between">
                  <span>Credit remaining</span>
                  <span>{formatCurrency(receipt.remainingBalance)}</span>
                </p>
              )}
            </div>
            <p className="text-xs">Payment: {receipt.payments.map((p) => methodLabels[p.method]).join(', ')}</p>
            <p className="mt-4 text-center text-xs">Thank you for shopping with us!</p>
            <Button className="mt-4 w-full" onClick={() => window.print()}>
              <Printer size={15} />
              Print receipt
            </Button>
            <Button variant="primary" className="mt-2 w-full" onClick={() => setReceipt(undefined)}>
              <Check size={15} />
              Start new sale
            </Button>
          </div>
        )}
      </Modal>

      {/* Offline Queue & Sync Status Drawer */}
      <Modal
        open={syncDrawerOpen}
        onClose={() => setSyncDrawerOpen(false)}
        title="Offline Transactions & Sync Queue"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border bg-slate-50 p-2">
              <div className="text-slate-500">Draft</div>
              <div className="font-bold text-slate-800">{queueCounts.draft}</div>
            </div>
            <div className="rounded-lg border bg-amber-50 p-2">
              <div className="text-amber-700">Pending sync</div>
              <div className="font-bold text-amber-900">{queueCounts.pending}</div>
            </div>
            <div className="rounded-lg border bg-sky-50 p-2">
              <div className="text-sky-700">Syncing</div>
              <div className="font-bold text-sky-900">{queueCounts.syncing}</div>
            </div>
            <div className="rounded-lg border bg-emerald-50 p-2">
              <div className="text-emerald-700">Synchronized</div>
              <div className="font-bold text-emerald-900">{queueCounts.synchronized}</div>
            </div>
            <div className="rounded-lg border bg-rose-50 p-2">
              <div className="text-rose-700">Failed</div>
              <div className="font-bold text-rose-900">{queueCounts.failed}</div>
            </div>
            <div className="rounded-lg border bg-purple-50 p-2">
              <div className="text-purple-700">Conflict / review</div>
              <div className="font-bold text-purple-900">{queueCounts.conflict}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              Scoped strictly to current user & business.
            </span>
            <Button
              variant="primary"
              disabled={!isOnline || syncBusy}
              onClick={() => void handleSyncQueueNow()}
            >
              <RefreshCw size={14} className={syncBusy ? 'animate-spin' : ''} />
              <span>{syncBusy ? 'Syncing…' : 'Sync Pending Now'}</span>
            </Button>
          </div>

          {offlineQueueRows.length === 0 ? (
            <EmptyState
              title="No offline transactions recorded"
              description="Provisional offline sales created while disconnected appear here with live synchronization state."
            />
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {offlineQueueRows.map(({ sale, cmd, uiState }) => (
                <div
                  key={sale.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-slate-900">{sale.provisionalReceiptNumber}</strong>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        uiState === 'Synchronized'
                          ? 'bg-emerald-50 text-emerald-700'
                          : uiState === 'Syncing'
                            ? 'bg-sky-50 text-sky-700'
                            : uiState === 'Conflict / review required'
                              ? 'bg-purple-50 text-purple-700'
                              : uiState === 'Failed'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {uiState === 'Pending offline sync' && <Clock size={10} />}
                      {uiState === 'Conflict / review required' && <ShieldAlert size={10} />}
                      {uiState === 'Failed' && <AlertCircle size={10} />}
                      {uiState === 'Synchronized' && <CheckCircle2 size={10} />}
                      <span>{uiState}</span>
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>{new Date(sale.createdAt).toLocaleString()}</span>
                    <strong>{formatCurrency(sale.totalAmountMinor / 100)}</strong>
                  </div>
                  {sale.officialInvoiceNumber && (
                    <div className="text-[11px] text-emerald-700">
                      Official Invoice: <strong>{sale.officialInvoiceNumber}</strong>
                    </div>
                  )}
                  {sale.rejectionReason && (
                    <div className="rounded bg-rose-50 p-1.5 text-[11px] text-rose-700">
                      {sale.rejectionReason}
                    </div>
                  )}
                  {cmd && uiState === 'Conflict / review required' && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setConflictModalCmd(cmd)
                          setConflictReason('')
                        }}
                        className="rounded border border-purple-200 bg-purple-50 px-2 py-1 font-medium text-purple-700 hover:bg-purple-100"
                      >
                        Resolve Conflict
                      </button>
                      <button
                        type="button"
                        onClick={() => void outboxService.cancelCommand(cmd.id).then(loadOfflineTerminalState)}
                        className="rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Price Conflict Resolution Modal */}
      <Modal
        open={Boolean(conflictModalCmd)}
        onClose={() => setConflictModalCmd(null)}
        title="Resolve Offline Conflict"
      >
        <div className="space-y-3 text-xs">
          <p className="text-slate-600">
            Select how to resolve the server catalog price conflict for this queued sale (requires{' '}
            <code>price_override</code> permission to accept the older offline price).
          </p>
          <label className="block font-semibold text-slate-700">
            Resolution Mode
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={conflictMode}
              onChange={(e) =>
                setConflictMode(e.target.value as 'apply_current_price' | 'accept_offline_price')
              }
            >
              <option value="apply_current_price">Apply current server catalog price</option>
              <option value="accept_offline_price">Accept offline price snapshot (manager override)</option>
            </select>
          </label>
          <label className="block font-semibold text-slate-700">
            Audit Reason (min 3 chars)
            <input
              value={conflictReason}
              onChange={(e) => setConflictReason(e.target.value)}
              placeholder="e.g. Verified offline receipt price against shelf tag"
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConflictModalCmd(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={syncBusy || conflictReason.trim().length < 3}
              onClick={() => void handleResolveConflictSubmit()}
            >
              {syncBusy ? 'Resolving…' : 'Resolve & Retry Sync'}
            </Button>
          </div>
        </div>
      </Modal>

      {notice && (
        <div
          className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white"
          role="status"
        >
          {notice}
          <button onClick={() => setNotice('')} className="ml-3">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

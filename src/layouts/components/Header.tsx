import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Check, ChevronDown, Menu, RefreshCw, Search, Store } from 'lucide-react'
import { navigationGroups } from '../navigation'
import { useAuth } from '../../features/auth/context/useAuth'
import { OfflineStatusPill } from '../../components/common/OfflineStatusIndicator'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { hasPermission } from '../../lib/permissions'
import { productService } from '../../features/products/services/productService'
import { apiClient } from '../../lib/api-client'
import {
  attemptPreLogoutSync,
  getPendingOfflineSummary,
  type PendingOfflineSummary,
} from '../../lib/offline/sessionCleanup'
import type { BranchInfo, UserRole } from '../../features/auth/types'

export function Header({ onMenu }: { onMenu: () => void }) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [lowStockCount, setLowStockCount] = useState<number | null>(null)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [logoutModalOpen, setLogoutModalOpen] = useState(false)
  const [pendingSummary, setPendingSummary] = useState<PendingOfflineSummary | null>(null)
  const [syncingLogout, setSyncingLogout] = useState(false)
  const navigate = useNavigate()
  const { user, businesses, activeBusiness, activeBranch, setActiveBusiness, setActiveBranch, signOut } = useAuth()
  const searchInput = useRef<HTMLInputElement>(null)

  const userRole: UserRole | null = (activeBusiness?.role as UserRole | undefined) ?? null
  const canInspectAlerts =
    Boolean(activeBusiness?.id) &&
    (hasPermission(userRole, 'inventory_read') || hasPermission(userRole, 'catalog_read'))

  const matches = useMemo(
    () =>
      navigationGroups
        .flatMap((group) => group.items)
        .filter((item) => {
          if (item.requiredPermission && !hasPermission(userRole, item.requiredPermission)) return false
          if (item.requiredRoles && (!userRole || !item.requiredRoles.includes(userRole))) return false
          return item.label.toLowerCase().includes(search.trim().toLowerCase())
        })
        .slice(0, 6),
    [search, userRole]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      }
      if (event.key === 'Escape') {
        setSearch('')
        setProfileOpen(false)
        setNotificationsOpen(false)
        setBranchSwitcherOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    let ignore = false
    if (!activeBusiness?.id) {
      setBranches([])
      return
    }
    apiClient
      .get<BranchInfo[]>('/branches')
      .then((data) => {
        if (!ignore && Array.isArray(data)) {
          setBranches(data)
        }
      })
      .catch(() => {
        // Safe fallback if offline or restricted
      })
    return () => {
      ignore = true
    }
  }, [activeBusiness?.id])

  useEffect(() => {
    setLowStockCount(null)
    setNotificationsError(null)
  }, [activeBusiness?.id])

  const loadLowStockAlertCount = async () => {
    if (!canInspectAlerts) {
      setLowStockCount(null)
      setNotificationsError(null)
      return
    }
    setNotificationsLoading(true)
    setNotificationsError(null)
    try {
      const products = await productService.getProducts()
      const count = products.filter(
        (p) => p.status === 'active' && p.trackInventory && p.stockQuantity <= p.lowStockThreshold
      ).length
      setLowStockCount(count)
    } catch (err) {
      setLowStockCount(null)
      setNotificationsError(
        err instanceof Error ? err.message : 'Unable to check inventory alerts right now.'
      )
    } finally {
      setNotificationsLoading(false)
    }
  }

  const displayName = user?.name || user?.email || 'Account'
  const initials =
    displayName
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'AC'
  const roleLabel = activeBusiness?.role ? activeBusiness.role.toUpperCase() : 'UNASSIGNED'

  const finalizeSignOut = async () => {
    setLogoutModalOpen(false)
    setPendingSummary(null)
    await signOut()
    navigate('/login')
  }

  const handleSignOut = async () => {
    setProfileOpen(false)
    if (!user?.id) {
      await finalizeSignOut()
      return
    }

    const summary = await getPendingOfflineSummary(user.id)
    if (!summary.hasUnsynced) {
      await finalizeSignOut()
      return
    }

    // Prefer completing synchronization before logout when connectivity is available
    setSyncingLogout(true)
    try {
      const bizIds = (businesses || []).map((b) => b.id)
      const afterSync = await attemptPreLogoutSync(user.id, bizIds)
      if (!afterSync.hasUnsynced) {
        await finalizeSignOut()
        return
      }
      setPendingSummary(afterSync)
      setLogoutModalOpen(true)
    } finally {
      setSyncingLogout(false)
    }
  }

  const handleRetrySyncBeforeLogout = async () => {
    if (!user?.id) return
    setSyncingLogout(true)
    try {
      const bizIds = (businesses || []).map((b) => b.id)
      const afterSync = await attemptPreLogoutSync(user.id, bizIds)
      if (!afterSync.hasUnsynced) {
        await finalizeSignOut()
        return
      }
      setPendingSummary(afterSync)
    } finally {
      setSyncingLogout(false)
    }
  }

  return (
    <header className="relative flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenu}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <div className="relative hidden w-64 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-400 sm:flex">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Search navigation"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search modules..."
            className="min-w-0 flex-1 bg-transparent py-2 text-xs text-slate-700 outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border bg-white px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
          {search.trim() && (
            <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              {matches.length ? (
                matches.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSearch('')}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <item.icon size={15} />
                    {item.label}
                  </Link>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-slate-500">No matching pages</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Branch / Business Switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setBranchSwitcherOpen(!branchSwitcherOpen)
              setProfileOpen(false)
              setNotificationsOpen(false)
            }}
            aria-label="Switch branch or business"
            aria-expanded={branchSwitcherOpen}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
          >
            <Store size={14} className="text-blue-600 shrink-0" />
            <span className="max-w-[110px] truncate sm:max-w-[160px]">
              {activeBranch?.name || activeBusiness?.name || 'Main Branch'}
            </span>
            <ChevronDown size={13} className="text-slate-400 shrink-0" />
          </button>

          {branchSwitcherOpen && (
            <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="px-2 py-1.5 border-b border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Business</p>
                <p className="text-xs font-semibold text-slate-800 truncate">{activeBusiness?.name || 'Store'}</p>
              </div>

              {/* Branches section */}
              <div className="py-1">
                <p className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Branches</p>
                {branches.length > 0 ? (
                  branches.map((b) => {
                    const isSelected = activeBranch?.id === b.id
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setActiveBranch(b)
                          setBranchSwitcherOpen(false)
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left transition ${
                          isSelected ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate">{b.name}</p>
                          <p className="text-[10px] text-slate-400">{b.branch_code}</p>
                        </div>
                        {isSelected && <Check size={14} className="text-blue-600 shrink-0" />}
                      </button>
                    )
                  })
                ) : (
                  <p className="px-2 py-1 text-xs text-slate-400">No additional branches</p>
                )}
              </div>

              {/* Businesses section if user belongs to more than 1 business */}
              {businesses && businesses.length > 1 && (
                <div className="border-t border-slate-100 pt-1 mt-1">
                  <p className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Switch Business</p>
                  {businesses.map((biz) => {
                    const isSelected = activeBusiness?.id === biz.id
                    return (
                      <button
                        key={biz.id}
                        type="button"
                        onClick={() => {
                          setActiveBusiness(biz)
                          setBranchSwitcherOpen(false)
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left transition ${
                          isSelected ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate">{biz.name}</p>
                          <p className="text-[10px] text-slate-400 capitalize">{biz.role}</p>
                        </div>
                        {isSelected && <Check size={14} className="text-indigo-600 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <OfflineStatusPill />
        <div className="relative">
          <button
            onClick={() => {
              const nextOpen = !notificationsOpen
              setNotificationsOpen(nextOpen)
              setProfileOpen(false)
              if (nextOpen) {
                void loadLowStockAlertCount()
              }
            }}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <Bell size={19} />
            {lowStockCount !== null && lowStockCount > 0 && (
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-white bg-rose-500"
                data-testid="low-stock-indicator"
              />
            )}
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 top-12 z-40 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
              <h2 className="text-sm font-semibold text-slate-800">Notifications</h2>
              {notificationsLoading ? (
                <p className="mt-2 text-xs leading-5 text-slate-500" role="status">
                  Checking stock alerts…
                </p>
              ) : notificationsError ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs leading-5 text-rose-600" role="alert">
                    {notificationsError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadLowStockAlertCount()}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Retry check
                  </button>
                </div>
              ) : !canInspectAlerts ? (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  No urgent workspace notifications.
                </p>
              ) : lowStockCount !== null && lowStockCount > 0 ? (
                <>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {lowStockCount} product{lowStockCount === 1 ? ' is' : 's are'} at or below the reorder threshold.
                  </p>
                  {hasPermission(userRole, 'inventory_read') && (
                    <Link
                      to="/inventory"
                      onClick={() => setNotificationsOpen(false)}
                      className="mt-3 inline-block text-xs font-semibold text-blue-600"
                    >
                      Review inventory
                    </Link>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  All tracked inventory items are above their reorder threshold.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="mx-1 h-8 border-l border-slate-200" />
        <div className="relative">
          <button
            onClick={() => {
              setProfileOpen(!profileOpen)
              setNotificationsOpen(false)
            }}
            aria-expanded={profileOpen}
            className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-50"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
              {initials}
            </div>
            <div className="hidden text-left sm:block">
              <div className="text-xs font-semibold text-slate-800">{displayName}</div>
              <div className="text-[10px] text-slate-400">{roleLabel}</div>
            </div>
            <ChevronDown size={14} className="hidden text-slate-400 sm:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-12 z-40 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              {hasPermission(userRole, 'manage_settings') && (
                <Link
                  to="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Profile settings
                </Link>
              )}
              <button
                onClick={handleSignOut}
                disabled={syncingLogout}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {syncingLogout ? 'Checking pending sync...' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={logoutModalOpen}
        onClose={() => setLogoutModalOpen(false)}
        title="Unsynchronized Offline Transactions"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-1 text-xs leading-5">
              <p className="font-semibold">
                {pendingSummary?.totalUnsyncedCount || 0} unsynchronized offline transaction(s) remain on this terminal.
              </p>
              <p>
                Pending transactions stay securely locked to <strong>{user?.email || user?.name}</strong> and
                cannot be viewed or edited by the next cashier. The original operator or an authorized
                manager must sign back in to complete synchronization or reconciliation.
              </p>
            </div>
          </div>

          {pendingSummary && (
            <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <li>Queued for sync: <strong>{pendingSummary.pendingOutboxCount}</strong></li>
              <li>Auth-paused / conflict / review required: <strong>{pendingSummary.blockedOrConflictCount}</strong></li>
              <li>Provisional local sales awaiting invoice: <strong>{pendingSummary.provisionalSalesCount}</strong></li>
            </ul>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button onClick={() => setLogoutModalOpen(false)}>Cancel</Button>
            <Button
              onClick={handleRetrySyncBeforeLogout}
              disabled={syncingLogout}
            >
              <RefreshCw size={14} className={syncingLogout ? 'animate-spin' : ''} />
              <span>{syncingLogout ? 'Syncing…' : 'Sync & Sign Out'}</span>
            </Button>
            <Button variant="primary" onClick={finalizeSignOut} disabled={syncingLogout}>
              Sign Out (Keep Pending Locked)
            </Button>
          </div>
        </div>
      </Modal>
    </header>
  )
}

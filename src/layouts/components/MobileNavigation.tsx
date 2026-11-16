import { useEffect, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { Boxes, X } from 'lucide-react'
import { navigationGroups } from '../navigation'
import { useAuth } from '../../features/auth/context/useAuth'
import { hasPermission } from '../../lib/permissions'
import type { UserRole } from '../../features/auth/types'

export function MobileNavigation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeBusiness } = useAuth()
  const userRole: UserRole | null = (activeBusiness?.role as UserRole | undefined) ?? null

  const accessibleGroups = useMemo(() => {
    return navigationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.requiredPermission && !hasPermission(userRole, item.requiredPermission)) {
            return false
          }
          if (item.requiredRoles && (!userRole || !item.requiredRoles.includes(userRole))) {
            return false
          }
          return true
        }),
      }))
      .filter((group) => group.items.length > 0)
  }, [userRole])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/35"
        aria-label="Close navigation"
      />
      <aside className="absolute inset-y-0 left-0 flex w-[290px] flex-col bg-white shadow-xl">
        <div className="flex h-[72px] items-center justify-between border-b border-slate-100 px-5">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-600 p-2 text-white">
              <Boxes size={18} />
            </span>
            <div>
              <strong className="text-sm">{activeBusiness?.name || 'Store Workspace'}</strong>
              <div className="text-[11px] text-slate-400">Retail workspace</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-2 text-slate-500"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" data-testid="mobile-nav">
          {accessibleGroups.map((group) => (
            <div key={group.label} className="mb-5">
              <div className="mb-2 px-2 text-[10px] font-bold tracking-[.12em] text-slate-400">
                {group.label}
              </div>
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={({ isActive }) => `nav-link mb-1 ${isActive ? 'active' : ''}`}
                >
                  <item.icon size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  )
}

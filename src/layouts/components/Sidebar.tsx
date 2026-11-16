import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { Boxes, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { navigationGroups } from '../navigation'
import { useAuth } from '../../features/auth/context/useAuth'
import { hasPermission } from '../../lib/permissions'
import type { UserRole } from '../../features/auth/types'

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
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

  return (
    <aside
      className={`hidden shrink-0 border-r border-slate-200 bg-white transition-all lg:flex lg:flex-col ${
        sidebarCollapsed ? 'w-[76px]' : 'w-[250px]'
      }`}
    >
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-white">
          <Boxes size={20} />
        </div>
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-900">
              {activeBusiness?.name || 'Store Workspace'}
            </div>
            <div className="text-[11px] text-slate-400">Retail workspace</div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5" data-testid="sidebar-nav">
        {accessibleGroups.map((group) => (
          <div key={group.label} className="mb-6">
            <div className="mb-2 px-2 text-[10px] font-bold tracking-[.12em] text-slate-400">
              {!sidebarCollapsed && group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={sidebarCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `nav-link mb-1 ${isActive ? 'active' : ''} ${
                    sidebarCollapsed ? 'justify-center px-0' : ''
                  }`
                }
              >
                <item.icon size={17} />
                {!sidebarCollapsed && item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>

      <button
        onClick={toggleSidebar}
        className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
      >
        {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        {!sidebarCollapsed && 'Collapse sidebar'}
      </button>
    </aside>
  )
}

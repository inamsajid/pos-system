import type { LucideIcon } from 'lucide-react'
import type { Permission } from '../lib/permissions'
import type { UserRole } from '../features/auth/types'

export interface NavigationItem {
  label: string
  path: string
  icon: LucideIcon
  requiredPermission?: Permission
  requiredRoles?: UserRole[]
}

export interface NavigationGroup {
  label: string
  items: NavigationItem[]
}

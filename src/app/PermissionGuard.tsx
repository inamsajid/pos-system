import React from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../features/auth/context/useAuth'
import { hasPermission, type Permission } from '../lib/permissions'
import type { UserRole } from '../features/auth/types'

export interface PermissionGuardProps {
  permission?: Permission
  roles?: UserRole[]
  children: React.ReactNode
}

export function PermissionGuard({ permission, roles, children }: PermissionGuardProps) {
  const { activeBusiness } = useAuth()
  const role = (activeBusiness?.role as UserRole) || 'cashier'

  let allowed = true
  if (permission && !hasPermission(role, permission)) {
    allowed = false
  }
  if (roles && !roles.includes(role)) {
    allowed = false
  }

  if (!allowed) {
    return (
      <div
        className="grid min-h-[60vh] place-items-center p-6 text-center"
        role="alert"
        data-testid="permission-denied"
      >
        <div className="max-w-md space-y-3">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-rose-600">
            <ShieldAlert size={24} />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-600">
            Your current workspace role (<strong className="capitalize">{role.replace('_', ' ')}</strong>) does not have authorization to view this module.
          </p>
          <div className="pt-2">
            <Link
              to="/dashboard"
              className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}


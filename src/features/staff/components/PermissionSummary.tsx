import React from 'react'
import type { StaffRole } from '../types/staff.types'
import { Check, X } from 'lucide-react'

export interface PermissionSummaryProps {
  role: StaffRole
  className?: string
}

interface PermissionItem {
  id: string
  label: string
  description: string
  roles: StaffRole[]
}

const PERMISSION_DEFINITIONS: PermissionItem[] = [
  {
    id: 'manage_settings',
    label: 'Business Settings & Backup',
    description: 'Configure taxes, receipts, negative stock, and data backups.',
    roles: ['owner'],
  },
  {
    id: 'manage_staff',
    label: 'Staff & Team Management',
    description: 'Invite members, modify roles, assign branches, and manage access.',
    roles: ['owner', 'admin'],
  },
  {
    id: 'pos_sale',
    label: 'POS Sales & Checkout',
    description: 'Process checkout cart, create sales orders, print receipts.',
    roles: ['owner', 'admin', 'manager', 'cashier'],
  },
  {
    id: 'collect_payments',
    label: 'Customer Payments & AR',
    description: 'Receive customer payments, allocate to invoices, track receivables.',
    roles: ['owner', 'admin', 'manager', 'cashier', 'accountant'],
  },
  {
    id: 'catalog_write',
    label: 'Catalog & Products Management',
    description: 'Add and edit products, categories, pricing, and barcodes.',
    roles: ['owner', 'admin', 'manager', 'inventory_manager'],
  },
  {
    id: 'stock_adjustment',
    label: 'Inventory & Stocktakes',
    description: 'Adjust branch inventory balances, perform batch stock counts.',
    roles: ['owner', 'admin', 'manager', 'inventory_manager'],
  },
  {
    id: 'purchase_order',
    label: 'Purchases & Goods Receipts',
    description: 'Create purchase orders, receive supplier shipments, update costs.',
    roles: ['owner', 'admin', 'manager', 'inventory_manager'],
  },
  {
    id: 'disburse_payments',
    label: 'Supplier Payments & AP',
    description: 'Record payments made to suppliers, allocate bills, track payables.',
    roles: ['owner', 'admin', 'manager', 'accountant'],
  },
  {
    id: 'expenses_write',
    label: 'Operating Expenses & Voids',
    description: 'Record operational expenditures, categorize costs, void postings.',
    roles: ['owner', 'admin', 'manager', 'accountant'],
  },
  {
    id: 'reports_view',
    label: 'Financial & Business Reports',
    description: 'Inspect P&L, sales reports, inventory valuation, and customer balances.',
    roles: ['owner', 'admin', 'manager', 'accountant'],
  },
]

export const PermissionSummary: React.FC<PermissionSummaryProps> = ({ role, className = '' }) => {
  return (
    <div className={`space-y-2.5 ${className}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Permissions for Role: <span className="text-slate-900 capitalize">{role.replace('_', ' ')}</span>
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PERMISSION_DEFINITIONS.map((perm) => {
          const isAllowed = perm.roles.includes(role)
          return (
            <div
              key={perm.id}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors ${
                isAllowed
                  ? 'border-emerald-200 bg-emerald-50/40 text-slate-800'
                  : 'border-slate-100 bg-slate-50/50 text-slate-400'
              }`}
            >
              <div
                className={`mt-0.5 rounded p-0.5 ${
                  isAllowed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-400'
                }`}
              >
                {isAllowed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </div>
              <div>
                <p className={`font-semibold ${isAllowed ? 'text-slate-900' : 'text-slate-500'}`}>
                  {perm.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  {perm.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


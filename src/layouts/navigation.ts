import {
  Activity,
  BookOpen,
  CircleDollarSign,
  CreditCard,
  FileBarChart2,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Truck,
  UserRoundCog,
  Users,
  Warehouse,
} from 'lucide-react'
import type { NavigationGroup } from '../types/navigation'

export const navigationGroups: NavigationGroup[] = [
  {
    label: 'OVERVIEW',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { label: 'Point of sale', path: '/pos', icon: ShoppingCart, requiredPermission: 'pos_sale' },
    ],
  },
  {
    label: 'CATALOG & INVENTORY',
    items: [
      { label: 'Products', path: '/products', icon: Package, requiredPermission: 'catalog_read' },
      { label: 'Categories', path: '/categories', icon: Tags, requiredPermission: 'catalog_read' },
      { label: 'Inventory', path: '/inventory', icon: Warehouse, requiredPermission: 'stock_adjustment' },
    ],
  },
  {
    label: 'CONTACTS & LEDGERS',
    items: [
      { label: 'Customers', path: '/customers', icon: Users, requiredPermission: 'catalog_read' },
      { label: 'Customer Ledger', path: '/ledger?tab=customers', icon: BookOpen, requiredPermission: 'reports_view' },
      { label: 'Suppliers', path: '/suppliers', icon: Truck, requiredPermission: 'catalog_read' },
      { label: 'Supplier Ledger', path: '/ledger?tab=suppliers', icon: BookOpen, requiredPermission: 'reports_view' },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { label: 'Sales', path: '/sales', icon: CircleDollarSign, requiredPermission: 'pos_sale' },
      { label: 'Invoices', path: '/invoices', icon: Receipt, requiredPermission: 'pos_sale' },
      { label: 'Purchases', path: '/purchases', icon: ShoppingBag, requiredPermission: 'purchase_order' },
    ],
  },
  {
    label: 'FINANCIAL MANAGEMENT',
    items: [
      { label: 'Customer Payments', path: '/payments', icon: CreditCard, requiredPermission: 'collect_payments' },
      { label: 'Supplier Payments', path: '/supplier-payments', icon: CreditCard, requiredPermission: 'disburse_payments' },
      { label: 'Ledger Hub', path: '/ledger', icon: BookOpen, requiredPermission: 'reports_view' },
      { label: 'Expenses', path: '/expenses', icon: Activity, requiredPermission: 'expenses_read' },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { label: 'Reports', path: '/reports', icon: FileBarChart2, requiredPermission: 'reports_view' },
      { label: 'Staff Management', path: '/staff', icon: UserRoundCog, requiredPermission: 'manage_staff' },
      { label: 'Settings', path: '/settings', icon: Settings, requiredPermission: 'manage_settings' },
    ],
  },
]

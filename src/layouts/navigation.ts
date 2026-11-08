import { Activity, BookOpen, CircleDollarSign, CreditCard, FileBarChart2, LayoutDashboard, Package, Receipt, Settings, ShoppingBag, ShoppingCart, Tags, Truck, UserRoundCog, Users, Warehouse } from 'lucide-react'
import type { NavigationGroup } from '../types/navigation'

export const navigationGroups: NavigationGroup[] = [
  {label:'OVERVIEW',items:[{label:'Dashboard',path:'/dashboard',icon:LayoutDashboard},{label:'Point of sale',path:'/pos',icon:ShoppingCart}]},
  {label:'MANAGE',items:[{label:'Products',path:'/products',icon:Package},{label:'Categories',path:'/categories',icon:Tags},{label:'Inventory',path:'/inventory',icon:Warehouse},{label:'Customers',path:'/customers',icon:Users},{label:'Suppliers',path:'/suppliers',icon:Truck}]},
  {label:'OPERATIONS',items:[{label:'Sales',path:'/sales',icon:CircleDollarSign},{label:'Invoices',path:'/invoices',icon:Receipt},{label:'Purchases',path:'/purchases',icon:ShoppingBag},{label:'Payments',path:'/payments',icon:CreditCard},{label:'Supplier payments',path:'/supplier-payments',icon:CreditCard},{label:'Ledger',path:'/ledger',icon:BookOpen},{label:'Expenses',path:'/expenses',icon:Activity}]},
  {label:'WORKSPACE',items:[{label:'Reports',path:'/reports',icon:FileBarChart2},{label:'Staff',path:'/staff',icon:UserRoundCog},{label:'Settings',path:'/settings',icon:Settings}]},
]

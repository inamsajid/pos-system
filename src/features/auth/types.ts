export type UserRole = 'owner' | 'admin' | 'manager' | 'cashier' | 'accountant' | 'inventory_manager'

export interface UserProfile {
  id: string
  email: string
  name: string
  phone: string | null
  emailVerified: boolean
  status: string
}

export interface BusinessMembershipInfo {
  id: string
  business_code: string
  name: string
  currency: string
  status: string
  role: UserRole
}

export interface BranchInfo {
  id: string
  business_id: string
  branch_code: string
  name: string
  is_main_branch: boolean
  status: string
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: UserProfile | null
  businesses: BusinessMembershipInfo[]
  activeBusiness: BusinessMembershipInfo | null
  activeBranch: BranchInfo | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
  setActiveBusiness: (business: BusinessMembershipInfo) => void
  setActiveBranch: (branch: BranchInfo) => void
}


import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { AuthContext } from './authContextInstance'
import { apiClient, ApiError, setApiContextProvider } from '../../../lib/api-client'
import { queryClient } from '../../../app/queryClient'
import type {
  AuthStatus,
  UserProfile,
  BusinessMembershipInfo,
  BranchInfo,
} from '../types'

interface MeResponsePayload {
  user: UserProfile
  businesses: BusinessMembershipInfo[]
  activeBusiness: BusinessMembershipInfo | null
  activeBranch: BranchInfo | null
}

interface SignInResponsePayload {
  user: UserProfile
  businesses: BusinessMembershipInfo[]
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [businesses, setBusinesses] = useState<BusinessMembershipInfo[]>([])
  const [activeBusiness, setActiveBusinessState] = useState<BusinessMembershipInfo | null>(null)
  const [activeBranch, setActiveBranchState] = useState<BranchInfo | null>(null)

  const activeContextRef = useRef<{ userId?: string | null; businessId?: string | null; branchId?: string | null }>({
    userId: null,
    businessId: null,
    branchId: null,
  })

  // Synchronize ref and API context provider whenever activeBusiness, activeBranch or user changes
  useEffect(() => {
    activeContextRef.current = {
      userId: user?.id || null,
      businessId: activeBusiness?.id || null,
      branchId: activeBranch?.id || null,
    }
  }, [user, activeBusiness, activeBranch])

  useEffect(() => {
    setApiContextProvider(() => activeContextRef.current)
    return () => {
      setApiContextProvider(null)
    }
  }, [])

  const setActiveBusiness = useCallback((biz: BusinessMembershipInfo | null) => {
    setActiveBusinessState(biz)
    activeContextRef.current.businessId = biz?.id || null
    queryClient.clear()
  }, [])

  const setActiveBranch = useCallback((branch: BranchInfo | null) => {
    setActiveBranchState(branch)
    activeContextRef.current.branchId = branch?.id || null
    queryClient.clear()
  }, [])

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiClient.get<MeResponsePayload>('/auth/me')
      setUser(data.user)
      setBusinesses(data.businesses || [])
      const biz = data.activeBusiness || data.businesses?.[0] || null
      setActiveBusinessState(biz)
      setActiveBranchState(data.activeBranch || null)
      activeContextRef.current = {
        businessId: biz?.id || null,
        branchId: data.activeBranch?.id || null,
      }
      setStatus('authenticated')
    } catch {
      setUser(null)
      setBusinesses([])
      setActiveBusinessState(null)
      setActiveBranchState(null)
      activeContextRef.current = { businessId: null, branchId: null }
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    let ignore = false
    apiClient
      .get<MeResponsePayload>('/auth/me')
      .then((data) => {
        if (!ignore) {
          setUser(data.user)
          setBusinesses(data.businesses || [])
          const biz = data.activeBusiness || data.businesses?.[0] || null
          setActiveBusinessState(biz)
          setActiveBranchState(data.activeBranch || null)
          activeContextRef.current = {
            businessId: biz?.id || null,
            branchId: data.activeBranch?.id || null,
          }
          setStatus('authenticated')
        }
      })
      .catch(() => {
        if (!ignore) {
          setUser(null)
          setBusinesses([])
          setActiveBusinessState(null)
          setActiveBranchState(null)
          activeContextRef.current = { businessId: null, branchId: null }
          setStatus('unauthenticated')
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  const signIn = async (email: string, password: string): Promise<void> => {
    try {
      const data = await apiClient.post<SignInResponsePayload>('/auth/sign-in', {
        email,
        password,
      })

      queryClient.clear()
      setUser(data.user)
      setBusinesses(data.businesses || [])
      const initialBiz = data.businesses?.[0] || null
      setActiveBusinessState(initialBiz)
      activeContextRef.current.businessId = initialBiz?.id || null
      setStatus('authenticated')

      // Fetch active branch if available
      try {
        const branches = await apiClient.get<BranchInfo[]>('/branches')
        if (branches.length > 0) {
          const selectedBranch = branches.find((b) => b.is_main_branch) || branches[0]
          setActiveBranchState(selectedBranch)
          activeContextRef.current.branchId = selectedBranch.id
        }
      } catch {
        // Non-blocking branch resolution
      }
    } catch (err) {
      if (err instanceof ApiError) {
        throw err
      }
      throw new Error('Sign in failed. Please check your network connection.')
    }
  }

  const signOut = async (): Promise<void> => {
    try {
      await apiClient.post('/auth/sign-out')
    } catch {
      // Ignore network errors on signout
    } finally {
      queryClient.clear()
      setUser(null)
      setBusinesses([])
      setActiveBusinessState(null)
      setActiveBranchState(null)
      activeContextRef.current = { businessId: null, branchId: null }
      setStatus('unauthenticated')
    }
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        businesses,
        activeBusiness,
        activeBranch,
        signIn,
        signOut,
        refreshSession,
        setActiveBusiness: (b) => setActiveBusiness(b),
        setActiveBranch: (br) => setActiveBranch(br),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

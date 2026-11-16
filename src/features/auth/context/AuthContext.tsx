import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { AuthContext } from './authContextInstance'
import { apiClient, ApiError, setApiContextProvider } from '../../../lib/api-client'
import { queryClient } from '../../../app/queryClient'
import {
  clearTransientBrowserStores,
  performLogoutCleanup,
} from '../../../lib/offline/sessionCleanup'
import { outboxService } from '../../../lib/offline/outbox/outbox.service'
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

  const resumeUserBlockedCommands = useCallback(async (userId?: string | null, businessId?: string | null) => {
    if (!userId || typeof indexedDB === 'undefined') return
    try {
      const resumed = await outboxService.resumeAuthBlocked(userId, businessId || undefined)
      if (resumed > 0 && businessId && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        void outboxService.dispatchPending(userId, businessId, activeContextRef.current.branchId)
      }
    } catch {
      // Safe resume guard for uninitialized offline stores
    }
  }, [])

  const setActiveBusiness = useCallback((biz: BusinessMembershipInfo | null) => {
    const previousBizId = activeContextRef.current.businessId
    if (previousBizId && biz?.id === previousBizId) {
      return
    }

    setActiveBusinessState(biz)
    setActiveBranchState(null)
    activeContextRef.current = {
      userId: activeContextRef.current.userId,
      businessId: biz?.id || null,
      branchId: null,
    }
    queryClient.clear()

    if (biz?.id) {
      void apiClient
        .get<BranchInfo[]>('/branches')
        .then((branches) => {
          if (activeContextRef.current.businessId !== biz.id) return
          if (Array.isArray(branches) && branches.length > 0) {
            const selectedBranch = branches.find((b) => b.is_main_branch) || branches[0]
            setActiveBranchState(selectedBranch)
            activeContextRef.current = {
              userId: activeContextRef.current.userId,
              businessId: biz.id,
              branchId: selectedBranch.id,
            }
            queryClient.clear()
          }
        })
        .catch(() => {
          // Non-blocking branch reload when offline or restricted
        })
    }
  }, [])

  const setActiveBranch = useCallback((branch: BranchInfo | null) => {
    setActiveBranchState(branch)
    activeContextRef.current = {
      userId: activeContextRef.current.userId,
      businessId: activeContextRef.current.businessId,
      branchId: branch?.id || null,
    }
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
        userId: data.user?.id || null,
        businessId: biz?.id || null,
        branchId: data.activeBranch?.id || null,
      }
      setStatus('authenticated')
      void resumeUserBlockedCommands(data.user?.id, biz?.id)
    } catch {
      const prevUserId = activeContextRef.current.userId
      await performLogoutCleanup(prevUserId)
      setUser(null)
      setBusinesses([])
      setActiveBusinessState(null)
      setActiveBranchState(null)
      activeContextRef.current = { userId: null, businessId: null, branchId: null }
      setStatus('unauthenticated')
    }
  }, [resumeUserBlockedCommands])

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
            userId: data.user?.id || null,
            businessId: biz?.id || null,
            branchId: data.activeBranch?.id || null,
          }
          setStatus('authenticated')
          void resumeUserBlockedCommands(data.user?.id, biz?.id)
        }
      })
      .catch(() => {
        if (!ignore) {
          setUser(null)
          setBusinesses([])
          setActiveBusinessState(null)
          setActiveBranchState(null)
          activeContextRef.current = { userId: null, businessId: null, branchId: null }
          setStatus('unauthenticated')
        }
      })

    return () => {
      ignore = true
    }
  }, [resumeUserBlockedCommands])

  const signIn = async (email: string, password: string): Promise<void> => {
    try {
      const previousUserId = activeContextRef.current.userId
      const data = await apiClient.post<SignInResponsePayload>('/auth/sign-in', {
        email,
        password,
      })

      if (previousUserId && previousUserId !== data.user.id) {
        await performLogoutCleanup(previousUserId)
      } else {
        await clearTransientBrowserStores()
      }

      const initialBiz = data.businesses?.[0] || null
      setUser(data.user)
      setBusinesses(data.businesses || [])
      setActiveBusinessState(initialBiz)
      setActiveBranchState(null)
      activeContextRef.current = {
        userId: data.user.id,
        businessId: initialBiz?.id || null,
        branchId: null,
      }
      setStatus('authenticated')

      // Fetch active branch if available
      try {
        const branches = await apiClient.get<BranchInfo[]>('/branches')
        if (branches.length > 0) {
          const selectedBranch = branches.find((b) => b.is_main_branch) || branches[0]
          setActiveBranchState(selectedBranch)
          activeContextRef.current = {
            userId: data.user.id,
            businessId: initialBiz?.id || null,
            branchId: selectedBranch.id,
          }
        }
      } catch {
        // Non-blocking branch resolution
      }

      void resumeUserBlockedCommands(data.user.id, initialBiz?.id)
    } catch (err) {
      if (err instanceof ApiError) {
        throw err
      }
      throw new Error('Sign in failed. Please check your network connection.')
    }
  }

  const signOut = async (): Promise<void> => {
    const outgoingUserId = activeContextRef.current.userId || user?.id || null
    try {
      await apiClient.post('/auth/sign-out')
    } catch {
      // Ignore network errors on signout
    } finally {
      await performLogoutCleanup(outgoingUserId)
      setUser(null)
      setBusinesses([])
      setActiveBusinessState(null)
      setActiveBranchState(null)
      activeContextRef.current = { userId: null, businessId: null, branchId: null }
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

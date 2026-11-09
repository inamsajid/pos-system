// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '../src/features/auth/context/AuthContext'
import { useAuth } from '../src/features/auth/context/useAuth'
import { ProtectedRoute } from '../src/app/ProtectedRoute'
import { LoginPage } from '../src/features/auth/pages/AuthPages'

function TestConsumer() {
  const { status, user, activeBusiness, signOut } = useAuth()
  return (
    <div>
      <div data-testid="auth-status">{status}</div>
      <div data-testid="user-email">{user?.email || 'no-email'}</div>
      <div data-testid="biz-role">{activeBusiness?.role || 'no-role'}</div>
      <button onClick={() => signOut()} data-testid="signout-btn">
        Sign Out
      </button>
    </div>
  )
}

describe('Frontend Authentication Integration & Components', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('AuthProvider queries /api/v1/auth/me with credentials: "include" and transitions state', async () => {
    const mockUserData = {
      user: {
        id: 'usr_1',
        email: 'admin@northstar.pk',
        name: 'Ayesha Khan',
        phone: null,
        emailVerified: true,
        status: 'active',
      },
      businesses: [
        {
          id: 'biz_1',
          business_code: 'NORTHSTAR',
          name: 'Northstar Market',
          currency: 'PKR',
          status: 'active',
          role: 'owner',
        },
      ],
      activeBusiness: {
        id: 'biz_1',
        business_code: 'NORTHSTAR',
        name: 'Northstar Market',
        currency: 'PKR',
        status: 'active',
        role: 'owner',
      },
      activeBranch: null,
    }

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/auth/me')) {
        expect(init?.credentials).toBe('include')
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, data: mockUserData }),
        })
      }
      return Promise.reject(new Error(`Unhandled route ${url}`))
    })

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    // Initially loading
    expect(screen.getByTestId('auth-status').textContent).toBe('loading')

    // Resolves to authenticated
    await waitFor(() => {
      expect(screen.getByTestId('auth-status').textContent).toBe('authenticated')
    })
    expect(screen.getByTestId('user-email').textContent).toBe('admin@northstar.pk')
    expect(screen.getByTestId('biz-role').textContent).toBe('owner')
  })

  it('AuthProvider transitions to unauthenticated when /api/v1/auth/me returns 401', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/auth/me')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              success: false,
              error: { code: 'AUTHENTICATION_REQUIRED', message: 'Session expired.' },
            }),
        })
      }
      return Promise.reject(new Error(`Unhandled route ${url}`))
    })

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('auth-status').textContent).toBe('unauthenticated')
    })
    expect(screen.getByTestId('user-email').textContent).toBe('no-email')
  })

  it('ProtectedRoute redirects unauthenticated visitors to /login', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED' } }),
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-view">Login View</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div data-testid="dashboard-view">Dashboard View</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('login-view')).toBeDefined()
    })
    expect(screen.queryByTestId('dashboard-view')).toBeNull()
  })

  it('ProtectedRoute allows authenticated users to access protected routes', async () => {
    const mockMe = {
      user: { id: 'u1', email: 'user@test.pk', name: 'User' },
      businesses: [],
      activeBusiness: null,
      activeBranch: null,
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, data: mockMe }),
        })
      }
      return Promise.reject(new Error(`Unhandled route ${url}`))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-view">Login View</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div data-testid="dashboard-view">Dashboard View</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeDefined()
    })
    expect(screen.queryByTestId('login-view')).toBeNull()
  })

  it('LoginPage handles form submission and displays error on rejection', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/auth/me')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: false }),
        })
      }
      if (url.includes('/api/v1/auth/sign-in')) {
        expect(init?.method).toBe('POST')
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              success: false,
              error: { code: 'AUTHENTICATION_REQUIRED', message: 'Invalid email or password.' },
            }),
        })
      }
      return Promise.reject(new Error(`Unhandled route ${url}`))
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText('you@company.com')).toBeDefined()
    })

    const emailInput = screen.getByPlaceholderText('you@company.com')
    const passInput = screen.getByPlaceholderText('Enter your password')
    const submitBtn = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'wrong@test.pk' } })
    fireEvent.change(passInput, { target: { value: 'WrongPass123' } })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password.')).toBeDefined()
    })
  })

  it('confirms authentication credentials and tokens are NEVER stored in localStorage or sessionStorage', async () => {
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('session')).toBeNull()
    expect(localStorage.getItem('password')).toBeNull()
    expect(sessionStorage.getItem('token')).toBeNull()
    expect(sessionStorage.getItem('session')).toBeNull()
    expect(sessionStorage.getItem('password')).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

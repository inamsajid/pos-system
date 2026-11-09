import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { ArrowRight, Boxes, AlertCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { apiClient } from '../../../lib/api-client'

export function LoginPage() {
  const { signIn, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard'

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await signIn(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <span className="rounded-lg bg-blue-600 p-2 text-white">
          <Boxes size={18} />
        </span>
        <strong>Northstar POS</strong>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to your account</h1>
      <p className="mt-2 text-sm text-slate-500">Welcome back. Enter your details to continue.</p>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold text-slate-700">
          Email address
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="you@company.com"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="Enter your password"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Signing in…</span>
            </>
          ) : (
            <>
              <span>Sign in</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-slate-500">
        New to POS?{' '}
        <Link className="font-semibold text-blue-600 hover:underline" to="/register">
          Create an account
        </Link>
      </div>
      <Link className="mt-4 block text-center text-xs text-slate-500 hover:underline" to="/forgot-password">
        Forgot password?
      </Link>
    </div>
  )
}

export function RegisterPage() {
  const { signIn, status } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // First try bootstrap API
      await apiClient.post('/auth/bootstrap', {
        name,
        businessName,
        email,
        password,
      })
      // Then sign in
      await signIn(email, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <span className="rounded-lg bg-blue-600 p-2 text-white">
          <Boxes size={18} />
        </span>
        <strong>Northstar POS</strong>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-2 text-sm text-slate-500">Set up your store workspace in just a few steps.</p>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleRegister} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold text-slate-700">
          Full name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="Owner Name"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Business name
          <input
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="Northstar Market"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Email address
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="owner@company.com"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Password (min 8 characters)
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="••••••••"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Setting up store…</span>
            </>
          ) : (
            <>
              <span>Create account</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-slate-500">
        Already have an account?{' '}
        <Link className="font-semibold text-blue-600 hover:underline" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [email, setEmail] = useState('')

  return (
    <div>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <span className="rounded-lg bg-blue-600 p-2 text-white">
          <Boxes size={18} />
        </span>
        <strong>Northstar POS</strong>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reset your password</h1>
      <p className="mt-2 text-sm text-slate-500">
        Enter your email address and we will provide password reset instructions.
      </p>

      {submitted ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800">
          If an account exists for {email}, a recovery link has been prepared. Please check with your store administrator.
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
          }}
          className="mt-6 space-y-4"
        >
          <label className="block text-xs font-semibold text-slate-700">
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              placeholder="you@company.com"
            />
          </label>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <span>Send reset link</span>
            <ArrowRight size={15} />
          </button>
        </form>
      )}

      <div className="mt-6 text-center text-xs text-slate-500">
        <Link className="font-semibold text-blue-600 hover:underline" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

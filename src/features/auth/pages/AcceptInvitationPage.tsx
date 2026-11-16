import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Boxes, AlertCircle, Loader2, CheckCircle2, ArrowRight, UserCheck } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { staffService } from '../../staff/services/staffService'

interface InvitationInfo {
  id: string
  email: string
  role: string
  businessId: string
  businessName: string
  invitedByName: string | null
  isExpired: boolean
  isUsed: boolean
}

export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || searchParams.get('invitation') || ''
  const navigate = useNavigate()
  const { user, status, refreshSession } = useAuth()

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Registration fields for unauthenticated users
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!token) {
      setError('No invitation token was provided in the link.')
      setLoadingInfo(false)
      return
    }

    let isMounted = true
    setLoadingInfo(true)
    setError(null)

    staffService
      .getInvitationInfo(token)
      .then((info) => {
        if (!isMounted) return
        setInvitation(info)
        if (info.isUsed) {
          setError('This invitation has already been accepted.')
        } else if (info.isExpired) {
          setError('This invitation has expired. Please request a new invitation from your administrator.')
        }
      })
      .catch((err) => {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Invalid or expired invitation token.')
      })
      .finally(() => {
        if (isMounted) setLoadingInfo(false)
      })

    return () => {
      isMounted = false
    }
  }, [token])

  const handleAccept = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) return
    setError(null)
    setSubmitting(true)

    try {
      const payload: { token: string; name?: string; password?: string } = { token }
      if (status !== 'authenticated') {
        if (!name.trim()) {
          throw new Error('Full name is required.')
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters.')
        }
        payload.name = name.trim()
        payload.password = password
      }

      await staffService.acceptInvitation(payload)
      await refreshSession()
      setSuccess(true)
      setTimeout(() => {
        navigate('/dashboard', { replace: true })
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to accept invitation.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center" role="status">
        <Loader2 size={32} className="animate-spin text-blue-600" />
        <p className="mt-3 text-sm text-slate-500">Validating invitation link...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <span className="rounded-lg bg-blue-600 p-2 text-white">
          <Boxes size={18} />
        </span>
        <strong>Northstar POS</strong>
      </div>

      {success ? (
        <div className="py-6 text-center" role="status">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={24} />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Welcome to the team!</h1>
          <p className="mt-2 text-sm text-slate-500">
            You have successfully joined <strong>{invitation?.businessName}</strong>. Redirecting to workspace...
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Join Store Workspace</h1>
          <p className="mt-2 text-sm text-slate-500">
            {invitation ? (
              <>
                You have been invited to join <strong>{invitation.businessName}</strong> as a{' '}
                <span className="font-semibold text-blue-600 capitalize">{invitation.role}</span>.
              </>
            ) : (
              'Accept staff invitation to access store operations.'
            )}
          </p>

          {error && (
            <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {invitation && !invitation.isExpired && !invitation.isUsed && (
            <form onSubmit={handleAccept} className="mt-6 space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Email address
                <input
                  type="email"
                  disabled
                  value={invitation.email}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 outline-none"
                />
              </label>

              {status === 'authenticated' ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <UserCheck size={16} />
                    <span>Signed in as {user?.email || user?.name}</span>
                  </div>
                  <p className="mt-1">
                    Click the button below to join <strong>{invitation.businessName}</strong> with your existing account.
                  </p>
                </div>
              ) : (
                <>
                  <label className="block text-xs font-semibold text-slate-700">
                    Full name
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                      placeholder="Your full name"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Create password (min 8 characters)
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
                </>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Joining store...</span>
                  </>
                ) : (
                  <>
                    <span>Accept & Join {invitation.businessName}</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link className="font-semibold text-blue-600 hover:underline" to="/login">
              Sign in first
            </Link>
          </div>
        </>
      )}
    </div>
  )
}


import { Navigate, Outlet } from 'react-router-dom'

/** Development placeholder: replace with the real session check when auth is added. */
export function ProtectedRoute() {
  const isAuthenticated = true
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}

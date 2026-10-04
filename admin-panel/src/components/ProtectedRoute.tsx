import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

function ProtectedRoute() {
  const { status, error, retryRestore } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <div className="auth-check-state">Verifying administrator session…</div>
  }

  if (status === 'error') {
    return (
      <main className="auth-check-state">
        <p>Unable to verify your administrator session.</p>
        {error && <p className="auth-check-error">{error}</p>}
        <button className="auth-secondary-button" type="button" onClick={retryRestore}>
          Try again
        </button>
      </main>
    )
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

export default ProtectedRoute

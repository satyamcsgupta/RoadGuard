import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import type { AdminUser } from '../auth/session'
import {
  API_ENDPOINTS,
  ApiResponseError,
  fetchAdminApi,
} from '../lib/api'

type BackendStatus = 'checking' | 'connected' | 'error'

function Settings() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [admin, setAdmin] = useState<AdminUser | null>(user)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')
  const [backendError, setBackendError] = useState<string | null>(null)
  const [statusRetry, setStatusRetry] = useState(0)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const handleAuthorizationError = useCallback((requestError: unknown) => {
    if (
      requestError instanceof ApiResponseError &&
      (requestError.status === 401 || requestError.status === 403)
    ) {
      logout()
      navigate('/login', { replace: true })
      return true
    }
    return false
  }, [logout, navigate])

  useEffect(() => {
    const controller = new AbortController()
    void fetchAdminApi<AdminUser>(API_ENDPOINTS.adminMe, {
      signal: controller.signal,
    })
      .then((profile) => {
        setAdmin(profile)
        setBackendStatus('connected')
      })
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        if (handleAuthorizationError(requestError)) return
        setBackendStatus('error')
        setBackendError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to connect to the backend.',
        )
      })

    return () => controller.abort()
  }, [handleAuthorizationError, statusRetry])

  const clearPasswordFields = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handlePasswordChange = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()
    setPasswordError(null)

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      await fetchAdminApi<{ message: string }>(API_ENDPOINTS.adminPassword, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      })
      clearPasswordFields()
      logout()
      navigate('/login', {
        replace: true,
        state: { message: 'Password changed. Please log in with your new password.' },
      })
    } catch (requestError) {
      if (handleAuthorizationError(requestError)) return
      clearPasswordFields()
      setPasswordError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to change password.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page-shell settings-page">
      <h1 className="page-heading">Settings</h1>
      <p className="page-subtitle">
        Manage your administrator account and session security.
      </p>

      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="admin-account-heading">
          <header className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">A</span>
            <div>
              <h2 id="admin-account-heading">Admin Account</h2>
              <p>Your signed-in administrator profile.</p>
            </div>
          </header>
          {admin ? (
            <dl className="settings-profile-list">
              <div>
                <dt>Name</dt>
                <dd>{admin.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{admin.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd><span className="user-role-badge user-role-admin">Admin</span></dd>
              </div>
            </dl>
          ) : (
            <p className="settings-inline-state" role="status">
              Loading administrator profile…
            </p>
          )}
        </section>

        <section className="settings-card" aria-labelledby="change-password-heading">
          <header className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">S</span>
            <div>
              <h2 id="change-password-heading">Security</h2>
              <p>Change the password for your administrator account.</p>
            </div>
          </header>
          <form className="settings-password-form" onSubmit={handlePasswordChange}>
            <label htmlFor="settings-current-password">Current password</label>
            <input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              disabled={isSubmitting}
            />

            <label htmlFor="settings-new-password">New password</label>
            <input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
              disabled={isSubmitting}
            />
            <span className="settings-field-hint">Use at least 8 characters.</span>

            <label htmlFor="settings-confirm-password">Confirm new password</label>
            <input
              id="settings-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
              disabled={isSubmitting}
            />

            {passwordError && (
              <p className="settings-feedback settings-feedback-error" role="alert">
                {passwordError}
              </p>
            )}
            <button
              className="settings-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Updating password…' : 'Change password'}
            </button>
          </form>
        </section>

        <section className="settings-card" aria-labelledby="session-heading">
          <header className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">↪</span>
            <div>
              <h2 id="session-heading">Session</h2>
              <p>You are currently signed in as an administrator.</p>
            </div>
          </header>
        </section>

        <section className="settings-card" aria-labelledby="system-status-heading">
          <header className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">●</span>
            <div>
              <h2 id="system-status-heading">System Status</h2>
              <p>Authenticated connection to the RoadGuard backend.</p>
            </div>
          </header>
          <div className="settings-backend-status" role="status" aria-live="polite">
            <span
              className={`settings-status-indicator settings-status-${backendStatus}`}
              aria-hidden="true"
            />
            <strong>
              {backendStatus === 'checking'
                ? 'Checking connection…'
                : backendStatus === 'connected'
                  ? 'Backend connection: Connected'
                  : 'Backend connection: Connection error'}
            </strong>
          </div>
          {backendError && (
            <p className="settings-connection-error">{backendError}</p>
          )}
          {backendStatus === 'error' && (
            <button
              className="settings-secondary-button"
              type="button"
              onClick={() => {
                setBackendStatus('checking')
                setBackendError(null)
                setStatusRetry((retry) => retry + 1)
              }}
            >
              Retry connection
            </button>
          )}
        </section>

      </div>
    </section>
  )
}

export default Settings

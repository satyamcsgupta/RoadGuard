import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  API_ENDPOINTS,
  ApiResponseError,
  fetchAdminApi,
} from '../lib/api'
import { formatApiDateTime } from '../lib/date-time'
import {
  REPORT_STATUS_LABELS,
  type AdminReport,
} from '../types/admin-report'

type AdminUser = {
  id: number
  name: string
  email: string
  role: string
  created_at: string
  report_count: number
}

type AdminUserDetails = AdminUser & {
  recent_reports: Pick<
    AdminReport,
    'id' | 'potholes_detected' | 'latitude' | 'longitude' | 'status' | 'created_at'
  >[]
}

type UserTypeFilter = 'user' | 'admin' | 'all'

function formatLocation(
  latitude: number | null,
  longitude: number | null,
): string {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return 'Coordinates unavailable'
  }
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

function Users() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [search, setSearch] = useState('')
  const [userType, setUserType] = useState<UserTypeFilter>('user')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminUserDetails | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

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
    void fetchAdminApi<AdminUser[]>(API_ENDPOINTS.adminUsers, {
      signal: controller.signal,
    })
      .then(setUsers)
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        if (handleAuthorizationError(requestError)) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load users.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })

    return () => controller.abort()
  }, [handleAuthorizationError, retryKey])

  useEffect(() => {
    if (selectedUserId === null) return

    const controller = new AbortController()
    void fetchAdminApi<AdminUserDetails>(
      API_ENDPOINTS.adminUser(selectedUserId),
      { signal: controller.signal },
    )
      .then(setSelectedUser)
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        if (handleAuthorizationError(requestError)) return
        setDetailError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load user details.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })

    return () => controller.abort()
  }, [handleAuthorizationError, selectedUserId])

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return users.filter((user) => {
      if (userType !== 'all' && user.role !== userType) return false
      if (
        query &&
        !user.name.toLocaleLowerCase().includes(query) &&
        !user.email.toLocaleLowerCase().includes(query)
      ) {
        return false
      }
      return true
    })
  }, [search, userType, users])

  const resultCountLabel =
    userType === 'all'
      ? `${filteredUsers.length} ${filteredUsers.length === 1 ? 'account' : 'accounts'}`
      : userType === 'admin'
        ? `${filteredUsers.length} ${filteredUsers.length === 1 ? 'admin' : 'admins'}`
        : `${filteredUsers.length} ${filteredUsers.length === 1 ? 'user' : 'users'}`

  const retryLoading = () => {
    setError(null)
    setIsLoading(true)
    setRetryKey((key) => key + 1)
  }

  const openUserDetails = (userId: number) => {
    setDetailLoading(true)
    setDetailError(null)
    setSelectedUser(null)
    setSelectedUserId(userId)
  }

  return (
    <section className="page-shell users-page">
      <h1 className="page-heading">Users</h1>
      <p className="page-subtitle">
        View registered RoadGuard accounts and their report activity.
      </p>

      {!isLoading && !error && (
        <div className="users-toolbar">
          <div className="users-search-field">
            <label htmlFor="users-search">Search users</label>
            <input
              id="users-search"
              type="search"
              placeholder="Search by name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="users-type-field">
            <label htmlFor="users-type-filter">User Type</label>
            <select
              id="users-type-filter"
              value={userType}
              onChange={(event) =>
                setUserType(event.target.value as UserTypeFilter)
              }
            >
              <option value="user">Users</option>
              <option value="admin">Admins</option>
              <option value="all">All</option>
            </select>
          </div>
          <span className="users-total-count" aria-live="polite">
            {resultCountLabel}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="users-state" role="status">Loading users…</div>
      ) : error ? (
        <div className="users-error" role="alert">
          <strong>Users could not be loaded.</strong>
          <span>{error}</span>
          <button
            className="dashboard-retry"
            type="button"
            onClick={retryLoading}
          >
            Try again
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="users-state">No registered users were found.</div>
      ) : filteredUsers.length === 0 ? (
        <div className="users-state">
          No {userType === 'admin' ? 'admins' : userType === 'all' ? 'accounts' : 'users'} match your search.
        </div>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Reports</th>
                <th scope="col">Joined</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td className="users-id">#{user.id}</td>
                  <td className="users-name">{user.name}</td>
                  <td className="users-email">{user.email}</td>
                  <td>
                    <span
                      className={`user-role-badge ${user.role === 'admin' ? 'user-role-admin' : 'user-role-normal'}`}
                    >
                      {user.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td>{user.report_count}</td>
                  <td className="users-joined">{formatApiDateTime(user.created_at)}</td>
                  <td>
                    <button
                      className="report-view-button"
                      type="button"
                      onClick={() => openUserDetails(user.id)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedUserId !== null && (
        <div
          className="report-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedUserId(null)
          }}
        >
          <section
            className="report-details-modal user-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-details-heading"
          >
            <header className="report-modal-header">
              <div>
                <h2 id="user-details-heading">User Details</h2>
                <p>Account information and recent report activity.</p>
              </div>
              <button
                className="report-modal-close"
                type="button"
                aria-label="Close user details"
                onClick={() => setSelectedUserId(null)}
              >
                ×
              </button>
            </header>
            {detailLoading ? (
              <div className="users-state" role="status">Loading user details…</div>
            ) : detailError ? (
              <div className="users-error" role="alert">{detailError}</div>
            ) : selectedUser ? (
              <div className="user-detail-content">
                <div className="user-detail-grid">
                  <div className="report-detail-field">
                    <span>Name</span>
                    <strong>{selectedUser.name}</strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Email</span>
                    <strong>{selectedUser.email}</strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Role</span>
                    <strong>
                      <span
                        className={`user-role-badge ${selectedUser.role === 'admin' ? 'user-role-admin' : 'user-role-normal'}`}
                      >
                        {selectedUser.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Joined</span>
                    <strong>{formatApiDateTime(selectedUser.created_at)}</strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Total reports</span>
                    <strong>{selectedUser.report_count}</strong>
                  </div>
                </div>
                <section className="user-recent-reports">
                  <h3>Recent reports</h3>
                  {selectedUser.recent_reports.length === 0 ? (
                    <p className="user-recent-empty">
                      This user has not submitted any reports.
                    </p>
                  ) : (
                    <div className="user-recent-list">
                      {selectedUser.recent_reports.map((report) => (
                        <article className="user-recent-report" key={report.id}>
                          <div>
                            <strong>Report #{report.id}</strong>
                            <span>
                              {report.potholes_detected} pothole
                              {report.potholes_detected === 1 ? '' : 's'} ·{' '}
                              {REPORT_STATUS_LABELS[report.status] ?? report.status}
                            </span>
                            <span className="user-recent-location">
                              {formatLocation(report.latitude, report.longitude)}
                            </span>
                            <time dateTime={report.created_at}>
                              {formatApiDateTime(report.created_at)}
                            </time>
                          </div>
                          <button
                            className="report-view-button"
                            type="button"
                            onClick={() =>
                              navigate(`/reports?reportId=${report.id}`)
                            }
                          >
                            View report
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </section>
  )
}

export default Users

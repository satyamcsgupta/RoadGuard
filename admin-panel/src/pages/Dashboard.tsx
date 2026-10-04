import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ApiResponseError, fetchAdminDashboard } from '../lib/api'
import { formatApiDateTime } from '../lib/date-time'

type DashboardReport = {
  id: number
  pothole_count: number
  latitude: number
  longitude: number
  status: string
  created_at: string
}

type DashboardData = {
  total_reports: number
  submitted_reports: number
  under_review_reports: number
  resolved_reports: number
  rejected_reports: number
  total_users: number
  recent_reports: DashboardReport[]
}

const statistics: Array<{
  label: string
  key: keyof Pick<
    DashboardData,
    | 'total_reports'
    | 'submitted_reports'
    | 'under_review_reports'
    | 'resolved_reports'
    | 'rejected_reports'
    | 'total_users'
  >
  tone: string
}> = [
  { label: 'Total Reports', key: 'total_reports', tone: 'green' },
  { label: 'Submitted', key: 'submitted_reports', tone: 'amber' },
  { label: 'Under Review', key: 'under_review_reports', tone: 'blue' },
  { label: 'Resolved', key: 'resolved_reports', tone: 'green' },
  { label: 'Rejected', key: 'rejected_reports', tone: 'red' },
  { label: 'Total Users', key: 'total_users', tone: 'slate' },
]

const statusLabels: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  resolved: 'Resolved',
  rejected: 'Rejected',
}

function formatLocation(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

function Dashboard() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void fetchAdminDashboard<DashboardData>(controller.signal)
      .then((response) => setData(response))
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return
        }
        if (
          requestError instanceof ApiResponseError &&
          (requestError.status === 401 || requestError.status === 403)
        ) {
          logout()
          navigate('/login', { replace: true })
          return
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load dashboard data.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [logout, navigate, reloadKey])

  const retryLoading = () => {
    setData(null)
    setError(null)
    setIsLoading(true)
    setReloadKey((key) => key + 1)
  }

  return (
    <section className="page-shell">
      <h1 className="page-heading">Dashboard</h1>
      <p className="page-subtitle">
        Overview of RoadGuard reports and road conditions.
      </p>

      {isLoading ? (
        <div className="dashboard-state" role="status">
          Loading dashboard data…
        </div>
      ) : error ? (
        <div className="dashboard-error" role="alert">
          <p>Dashboard data could not be loaded.</p>
          <span>{error}</span>
          <button
            className="dashboard-retry"
            type="button"
            onClick={retryLoading}
          >
            Try again
          </button>
        </div>
      ) : data ? (
        <>
          <div className="dashboard-stat-grid" aria-label="RoadGuard statistics">
            {statistics.map(({ label, key, tone }) => (
              <article className="dashboard-stat-card" key={key}>
                <span className={`dashboard-stat-indicator tone-${tone}`} />
                <span className="dashboard-stat-label">{label}</span>
                <strong className="dashboard-stat-value">{data[key]}</strong>
              </article>
            ))}
          </div>

          <section className="recent-reports" aria-labelledby="recent-reports-title">
            <div className="recent-reports-heading">
              <div>
                <h2 id="recent-reports-title">Recent Reports</h2>
                <p>The latest road issues submitted to RoadGuard.</p>
              </div>
            </div>

            {data.recent_reports.length === 0 ? (
              <div className="dashboard-empty">
                No reports have been submitted yet.
              </div>
            ) : (
              <div className="recent-reports-table-wrap">
                <table className="recent-reports-table">
                  <thead>
                    <tr>
                      <th scope="col">Report</th>
                      <th scope="col">Potholes</th>
                      <th scope="col">Location</th>
                      <th scope="col">Status</th>
                      <th scope="col">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_reports.map((report) => (
                      <tr key={report.id}>
                        <td className="report-id">#{report.id}</td>
                        <td>{report.pothole_count}</td>
                        <td className="report-location">
                          {formatLocation(report.latitude, report.longitude)}
                        </td>
                        <td>
                          <span className={`report-status status-${report.status}`}>
                            {statusLabels[report.status] ?? report.status}
                          </span>
                        </td>
                        <td className="report-date">{formatApiDateTime(report.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}

export default Dashboard

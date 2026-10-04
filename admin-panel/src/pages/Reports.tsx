import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  API_ENDPOINTS,
  ApiResponseError,
  fetchAdminApi,
  fetchAdminBlob,
} from '../lib/api'
import { formatApiDateTime, parseApiDateTime } from '../lib/date-time'
import {
  REPORT_STATUS_LABELS,
  REPORT_STATUS_OPTIONS,
  type AdminReport,
} from '../types/admin-report'

type DateFilter = 'all' | 'today' | '7days' | '30days'
type PotholeFilter = 'all' | 'one' | '2to5' | '6plus'
type ReportSort = 'newest' | 'oldest' | 'most' | 'fewest'

const DEFAULT_SORT: ReportSort = 'newest'

function formatLocation(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

function formatReportLocation(report: AdminReport): string {
  if (report.latitude === null || report.longitude === null) {
    return 'Coordinates unavailable'
  }
  return formatLocation(report.latitude, report.longitude)
}

function Reports() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { logout } = useAuth()
  const [reports, setReports] = useState<AdminReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [selectedReportId, setSelectedReportId] = useState<number | null>(() => {
    const reportId = Number(searchParams.get('reportId'))
    return Number.isSafeInteger(reportId) && reportId > 0 ? reportId : null
  })
  const [detail, setDetail] = useState<AdminReport | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(selectedReportId !== null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState('')
  const [draftAdminNote, setDraftAdminNote] = useState('')
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeletingReport, setIsDeletingReport] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [potholeFilter, setPotholeFilter] = useState<PotholeFilter>('all')
  const [sortOrder, setSortOrder] = useState<ReportSort>(DEFAULT_SORT)
  const detailControllerRef = useRef<AbortController | null>(null)
  const imageUrlRef = useRef<string | null>(null)

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
    void fetchAdminApi<AdminReport[]>(API_ENDPOINTS.adminReports, {
      signal: controller.signal,
    })
      .then(setReports)
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
            : 'Unable to load reports.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [handleAuthorizationError, retryKey])

  useEffect(() => {
    if (selectedReportId === null) return

    const controller = new AbortController()
    detailControllerRef.current = controller

    void fetchAdminApi<AdminReport>(
      API_ENDPOINTS.adminReport(selectedReportId),
      { signal: controller.signal },
    )
      .then(async (report) => {
        if (controller.signal.aborted) return
        setDetail(report)
      setDraftStatus(report.status)
      setDraftAdminNote(report.admin_note ?? '')
      setDetailLoading(false)
        if (!report.image_available) return

        setImageLoading(true)
        try {
          const image = await fetchAdminBlob(
            API_ENDPOINTS.adminReportImage(selectedReportId),
            controller.signal,
          )
          if (!controller.signal.aborted) {
            const nextImageUrl = URL.createObjectURL(image)
            imageUrlRef.current = nextImageUrl
            setImageUrl(nextImageUrl)
          }
        } catch (imageRequestError) {
          if (
            imageRequestError instanceof DOMException &&
            imageRequestError.name === 'AbortError'
          ) {
            return
          }
          if (handleAuthorizationError(imageRequestError)) return
          setImageError(
            imageRequestError instanceof Error
              ? imageRequestError.message
              : 'Unable to load report image.',
          )
        } finally {
          if (!controller.signal.aborted) setImageLoading(false)
        }
      })
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
            : 'Unable to load report details.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })

    return () => {
      controller.abort()
      if (detailControllerRef.current === controller) {
        detailControllerRef.current = null
      }
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
    }
  }, [handleAuthorizationError, selectedReportId])

  const filteredReports = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dateThreshold =
      dateFilter === '7days'
        ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        : dateFilter === '30days'
          ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          : null

    return reports
      .filter((report) => {
        const normalizedIdQuery = normalizedSearch.replace(/^#/, '')
        if (
          normalizedSearch &&
          !String(report.id).includes(normalizedIdQuery) &&
          !report.user_name.toLocaleLowerCase().includes(normalizedSearch) &&
          !report.user_email.toLocaleLowerCase().includes(normalizedSearch)
        ) {
          return false
        }
        if (statusFilter !== 'all' && report.status !== statusFilter) {
          return false
        }

        if (dateFilter !== 'all') {
          const reportDate = parseApiDateTime(report.created_at)
          if (Number.isNaN(reportDate.getTime())) return false
          if (dateFilter === 'today' && reportDate < todayStart) return false
          if (dateThreshold && reportDate < dateThreshold) return false
        }

        if (potholeFilter === 'one' && report.potholes_detected !== 1) {
          return false
        }
        if (
          potholeFilter === '2to5' &&
          (report.potholes_detected < 2 || report.potholes_detected > 5)
        ) {
          return false
        }
        if (potholeFilter === '6plus' && report.potholes_detected < 6) {
          return false
        }
        return true
      })
      .sort((left, right) => {
        if (sortOrder === 'most' || sortOrder === 'fewest') {
          const countDifference =
            left.potholes_detected - right.potholes_detected
          if (countDifference !== 0) {
            return sortOrder === 'most' ? -countDifference : countDifference
          }
        } else {
          const dateDifference =
            parseApiDateTime(left.created_at).getTime() -
            parseApiDateTime(right.created_at).getTime()
          if (dateDifference !== 0) {
            return sortOrder === 'newest' ? -dateDifference : dateDifference
          }
        }
        return sortOrder === 'oldest' || sortOrder === 'fewest'
          ? left.id - right.id
          : right.id - left.id
      })
  }, [dateFilter, potholeFilter, reports, search, sortOrder, statusFilter])

  const hasActiveFilters =
    search !== '' ||
    statusFilter !== 'all' ||
    dateFilter !== 'all' ||
    potholeFilter !== 'all' ||
    sortOrder !== DEFAULT_SORT

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setDateFilter('all')
    setPotholeFilter('all')
    setSortOrder(DEFAULT_SORT)
  }

  const clearImageUrl = () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    imageUrlRef.current = null
    setImageUrl(null)
  }

  const openReportDetails = (reportId: number) => {
    detailControllerRef.current?.abort()
    clearImageUrl()
    setSelectedReportId(reportId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setImageLoading(false)
    setImageError(null)
    setStatusError(null)
    setStatusSuccess(null)
    setDeleteError(null)
    setIsDeleteConfirmOpen(false)
  }

  const retryLoading = () => {
    setError(null)
    setIsLoading(true)
    setRetryKey((key) => key + 1)
  }

  const closeDetails = () => {
    detailControllerRef.current?.abort()
    detailControllerRef.current = null
    clearImageUrl()
    setSelectedReportId(null)
    setDetail(null)
    setDetailError(null)
    setStatusError(null)
    setStatusSuccess(null)
    setDeleteError(null)
    setIsDeleteConfirmOpen(false)
    if (searchParams.has('reportId')) {
      setSearchParams({}, { replace: true })
    }
  }

  const updateStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || isUpdatingStatus || isDeletingReport) return
    const trimmedNote = draftAdminNote.trim()
    if (draftStatus === 'rejected' && !trimmedNote) {
      setStatusError('A reason is required when rejecting a report.')
      setStatusSuccess(null)
      return
    }
    if (
      draftStatus === detail.status &&
      trimmedNote === (detail.admin_note ?? '')
    ) {
      return
    }

    setIsUpdatingStatus(true)
    setStatusError(null)
    setStatusSuccess(null)
    try {
      const updatedReport = await fetchAdminApi<AdminReport>(
        API_ENDPOINTS.adminReportStatus(detail.id),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: draftStatus,
            admin_note: trimmedNote || null,
          }),
        },
      )
      setDetail(updatedReport)
      setDraftStatus(updatedReport.status)
      setDraftAdminNote(updatedReport.admin_note ?? '')
      setStatusSuccess('Report status and admin note updated.')
      setReports((currentReports) =>
        currentReports.map((report) =>
          report.id === updatedReport.id ? updatedReport : report,
        ),
      )
    } catch (requestError) {
      if (handleAuthorizationError(requestError)) return
      setStatusError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to update report status.',
      )
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const deleteReport = async () => {
    if (!detail || isDeletingReport || isUpdatingStatus) return

    setIsDeletingReport(true)
    setDeleteError(null)
    try {
      await fetchAdminApi<{ message: string }>(
        API_ENDPOINTS.deleteAdminReport(detail.id),
        { method: 'DELETE' },
      )
      setReports((currentReports) =>
        currentReports.filter((report) => report.id !== detail.id),
      )
      setSuccessMessage(`Report #${detail.id} was permanently deleted.`)
      closeDetails()
    } catch (requestError) {
      if (handleAuthorizationError(requestError)) return
      setDeleteError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to delete this report.',
      )
    } finally {
      setIsDeletingReport(false)
      setIsDeleteConfirmOpen(false)
    }
  }

  return (
    <section className="page-shell reports-page">
      <h1 className="page-heading">Reports</h1>
      <p className="page-subtitle">
        Review and manage reported road issues.
      </p>
      {successMessage && (
        <p className="reports-success-message" role="status">
          {successMessage}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setSuccessMessage(null)}
          >
            ×
          </button>
        </p>
      )}

      {!isLoading && !error && (
        <div className="reports-toolbar" aria-label="Filter and search reports">
          <div className="reports-search-field">
            <label htmlFor="reports-search">Search reports</label>
            <input
              id="reports-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Report ID, user name, or email"
            />
          </div>
          <div className="reports-filter-field">
            <label htmlFor="reports-status-filter">Status</label>
            <select
              id="reports-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {REPORT_STATUS_OPTIONS.map(({ value, label }) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="reports-filter-field">
            <label htmlFor="reports-date-filter">Date</label>
            <select
              id="reports-date-filter"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value as DateFilter)}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
            </select>
          </div>
          <div className="reports-filter-field">
            <label htmlFor="reports-pothole-filter">Pothole count</label>
            <select
              id="reports-pothole-filter"
              value={potholeFilter}
              onChange={(event) =>
                setPotholeFilter(event.target.value as PotholeFilter)
              }
            >
              <option value="all">All counts</option>
              <option value="one">1 pothole</option>
              <option value="2to5">2–5 potholes</option>
              <option value="6plus">6+ potholes</option>
            </select>
          </div>
          <div className="reports-filter-field reports-sort-field">
            <label htmlFor="reports-sort">Sort by</label>
            <select
              id="reports-sort"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as ReportSort)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most">Most potholes</option>
              <option value="fewest">Fewest potholes</option>
            </select>
          </div>
          <button
            className="reports-clear-filters"
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Clear filters
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="reports-state" role="status">
          Loading reports…
        </div>
      ) : error ? (
        <div className="reports-error" role="alert">
          <strong>Reports could not be loaded.</strong>
          <span>{error}</span>
          <button className="dashboard-retry" type="button" onClick={retryLoading}>
            Try again
          </button>
        </div>
      ) : reports.length === 0 ? (
        <div className="reports-empty">No reports have been submitted yet.</div>
      ) : filteredReports.length === 0 ? (
        <div className="reports-empty reports-no-matches">
          <p className="reports-result-count">
            Showing 0 of {reports.length} reports
          </p>
          <p>No reports match your current filters.</p>
          <button
            className="reports-clear-filters"
            type="button"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <p className="reports-result-count" aria-live="polite">
            Showing {filteredReports.length} of {reports.length} reports
          </p>
          <div className="admin-reports-table-wrap">
            <table className="admin-reports-table">
              <thead>
                <tr>
                  <th scope="col">Report ID</th>
                  <th scope="col">User</th>
                  <th scope="col">Potholes</th>
                  <th scope="col">Location</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr key={report.id}>
                    <td className="report-id">#{report.id}</td>
                    <td>
                      <span className="reports-user-name">{report.user_name}</span>
                      <span className="reports-user-email">{report.user_email}</span>
                    </td>
                    <td>{report.potholes_detected}</td>
                    <td className="report-location">
                      {formatReportLocation(report)}
                    </td>
                    <td>
                      <span className={`report-status status-${report.status}`}>
                        {REPORT_STATUS_LABELS[report.status] ?? report.status}
                      </span>
                      {report.admin_note?.trim() && (
                        <span className="report-note-indicator">📝 Note</span>
                      )}
                    </td>
                    <td className="report-date">{formatApiDateTime(report.created_at)}</td>
                    <td>
                      <div className="reports-row-actions">
                        <button
                          className="report-view-button"
                          type="button"
                          onClick={() => openReportDetails(report.id)}
                        >
                          View
                        </button>
                        <button
                          className="report-view-button report-map-button"
                          type="button"
                          onClick={() => navigate(`/map?reportId=${report.id}`)}
                        >
                          📍 View on Map
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedReportId !== null && (
        <div
          className="report-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetails()
          }}
        >
          <section
            className="report-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-details-heading"
          >
            <header className="report-modal-header">
              <div>
                <h2 id="report-details-heading">Report Details</h2>
                <p>Review the submission and update its status.</p>
              </div>
              <button
                className="report-modal-close"
                type="button"
                aria-label="Close report details"
                onClick={closeDetails}
              >
                ×
              </button>
            </header>

            {detailLoading ? (
              <div className="reports-state" role="status">
                Loading report details…
              </div>
            ) : detailError ? (
              <div className="reports-error" role="alert">{detailError}</div>
            ) : detail ? (
              <div className="report-detail-content">
                {imageUrl ? (
                  <img
                    className="report-detail-image"
                    src={imageUrl}
                    alt={`Image submitted with report ${detail.id}`}
                  />
                ) : (
                  <div className="report-image-unavailable">
                    {!detail.image_available
                      ? 'No report image is available.'
                      : imageLoading
                        ? 'Loading report image…'
                        : imageError || 'Report image could not be loaded.'}
                  </div>
                )}

                <div className="report-detail-grid">
                  <div className="report-detail-field">
                    <span>Report ID</span>
                    <strong>#{detail.id}</strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Submitting user</span>
                    <strong>{detail.user_name}</strong>
                    <small>{detail.user_email}</small>
                  </div>
                  <div className="report-detail-field">
                    <span>Potholes detected</span>
                    <strong>{detail.potholes_detected}</strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Coordinates</span>
                    <strong>
                      {formatReportLocation(detail)}
                    </strong>
                    {detail.latitude !== null && detail.longitude !== null && (
                      <button
                        className="report-view-button report-detail-map-button"
                        type="button"
                        onClick={() => navigate(`/map?reportId=${detail.id}`)}
                      >
                        📍 View on Map
                      </button>
                    )}
                  </div>
                  <div className="report-detail-field">
                    <span>Date and time</span>
                    <strong>{formatApiDateTime(detail.created_at)}</strong>
                  </div>
                  <div className="report-detail-field">
                    <span>Current status</span>
                    <strong>
                      <span className={`report-status status-${detail.status}`}>
                        {REPORT_STATUS_LABELS[detail.status] ?? detail.status}
                      </span>
                    </strong>
                  </div>
                  <div className="report-detail-field report-description-field">
                    <span>Description</span>
                    <p>{detail.description?.trim() || 'No description provided.'}</p>
                  </div>
                  <div className="report-detail-field report-description-field">
                    <span>Admin Note</span>
                    <p>{detail.admin_note?.trim() || 'No admin note.'}</p>
                  </div>
                </div>

                <form className="report-status-editor" onSubmit={updateStatus}>
                  <label htmlFor="report-status-select">Status</label>
                  <select
                    id="report-status-select"
                    value={draftStatus}
                    disabled={isUpdatingStatus || isDeletingReport}
                    onChange={(event) => setDraftStatus(event.target.value)}
                  >
                    {REPORT_STATUS_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <label htmlFor="report-admin-note">Admin note</label>
                  <textarea
                    id="report-admin-note"
                    value={draftAdminNote}
                    disabled={isUpdatingStatus || isDeletingReport}
                    onChange={(event) => setDraftAdminNote(event.target.value)}
                    rows={3}
                    placeholder="Add an optional note for this report"
                  />
                  {draftStatus === 'rejected' && (
                    <p className="report-rejection-hint">
                      A reason is required when rejecting a report.
                    </p>
                  )}
                  {isUpdatingStatus && (
                    <span className="status-update-pending" role="status">
                      Saving report…
                    </span>
                  )}
                  {statusError && (
                    <p className="status-update-error" role="alert">
                      {statusError}
                    </p>
                  )}
                  {statusSuccess && (
                    <p className="status-update-success" role="status">
                      {statusSuccess}
                    </p>
                  )}
                  <button
                    className="report-view-button report-update-button"
                    type="submit"
                    disabled={isUpdatingStatus || isDeletingReport}
                  >
                    {isUpdatingStatus ? 'Saving…' : 'Update Report'}
                  </button>
                </form>

                <div className="report-delete-section">
                  <div>
                    <strong>Delete report</strong>
                    <p>Permanently remove this report and its uploaded image.</p>
                  </div>
                  <button
                    className="report-delete-button"
                    type="button"
                    disabled={isUpdatingStatus || isDeletingReport}
                    onClick={() => {
                      setDeleteError(null)
                      setIsDeleteConfirmOpen(true)
                    }}
                  >
                    Delete Report
                  </button>
                  {deleteError && (
                    <p className="report-delete-error" role="alert">
                      {deleteError}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      )}
      {isDeleteConfirmOpen && detail && (
        <div className="report-confirm-backdrop" role="presentation">
          <section
            className="report-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-report-heading"
          >
            <h2 id="delete-report-heading">Delete Report #{detail.id}?</h2>
            <p>
              This permanently removes the report and its uploaded image. This
              action cannot be undone.
            </p>
            {deleteError && (
              <p className="report-delete-error" role="alert">{deleteError}</p>
            )}
            <div className="report-confirm-actions">
              <button
                className="report-confirm-cancel"
                type="button"
                disabled={isDeletingReport}
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="report-confirm-delete"
                type="button"
                disabled={isDeletingReport}
                onClick={() => void deleteReport()}
              >
                {isDeletingReport ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default Reports

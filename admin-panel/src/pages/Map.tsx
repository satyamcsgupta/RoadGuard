import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../auth/useAuth'
import {
  API_ENDPOINTS,
  ApiResponseError,
  fetchAdminApi,
} from '../lib/api'
import { formatApiDateTime, parseApiDateTime } from '../lib/date-time'
import {
  REPORT_STATUS_COLORS,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_OPTIONS,
  type AdminReport,
} from '../types/admin-report'

type MappableReport = AdminReport & {
  latitude: number
  longitude: number
}

type MapDateFilter = 'all' | 'today' | '7days' | '30days'
type MapPotholeFilter = 'all' | 'one' | '2to5' | '6plus'
type MapTileStyle = 'road' | 'satellite'

const legendStatuses = [
  { status: 'submitted', label: 'Submitted' },
  { status: 'under_review', label: 'Under Review' },
  { status: 'resolved', label: 'Resolved' },
  { status: 'rejected', label: 'Rejected' },
]

function hasValidCoordinates(report: AdminReport): report is MappableReport {
  return (
    typeof report.latitude === 'number' &&
    Number.isFinite(report.latitude) &&
    report.latitude >= -90 &&
    report.latitude <= 90 &&
    typeof report.longitude === 'number' &&
    Number.isFinite(report.longitude) &&
    report.longitude >= -180 &&
    report.longitude <= 180
  )
}

function markerIcon(
  status: string,
  offset: { x: number; y: number } = { x: 0, y: 0 },
  selected = false,
): L.DivIcon {
  const markerClass =
    status in REPORT_STATUS_COLORS ? `marker-${status}` : 'marker-unknown'
  return L.divIcon({
    className: 'report-marker-icon',
    html: `<span class="report-marker-dot ${markerClass}${selected ? ' report-marker-selected' : ''}" aria-hidden="true"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14 - offset.x, 14 - offset.y],
    popupAnchor: [offset.x, offset.y - 18],
  })
}

function FitReportBounds({
  reports,
  fitKey,
  selectedReportId,
}: {
  reports: MappableReport[]
  fitKey: number
  selectedReportId: number | null
}) {
  const map = useMap()

  useEffect(() => {
    const selectedReport = reports.find(
      (report) => report.id === selectedReportId,
    )
    if (selectedReport && fitKey === 0) {
      map.setView([selectedReport.latitude, selectedReport.longitude], 16)
      return
    }
    if (reports.length === 1) {
      map.setView([reports[0].latitude, reports[0].longitude], 12)
      return
    }
    if (reports.length > 1) {
      const bounds = L.latLngBounds(
        reports.map((report) => [report.latitude, report.longitude]),
      )
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 })
    }
  }, [fitKey, map, reports, selectedReportId])

  return null
}

function ReportMarkers({
  reports,
  selectedReportId,
  onViewReport,
}: {
  reports: MappableReport[]
  selectedReportId: number | null
  onViewReport: (reportId: number) => void
}) {
  const map = useMap()
  const markerRefs = useRef(new globalThis.Map<number, L.Marker>())
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  })

  useEffect(() => {
    const selectedReport = reports.find(
      (report) => report.id === selectedReportId,
    )
    const marker = selectedReportId === null
      ? undefined
      : markerRefs.current.get(selectedReportId)
    if (!selectedReport || !marker) return
    map.setView([selectedReport.latitude, selectedReport.longitude], 16)
    marker.openPopup()
  }, [map, reports, selectedReportId])

  const markers = useMemo(() => {
    const points = reports.map((report) =>
      map.latLngToContainerPoint([report.latitude, report.longitude]),
    )
    const parent = reports.map((_report, index) => index)
    const find = (index: number): number => {
      if (parent[index] !== index) parent[index] = find(parent[index])
      return parent[index]
    }
    const join = (left: number, right: number) => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
    }
    const buckets = new globalThis.Map<string, number[]>()
    const cellSize = zoom >= 16 ? 28 : 34

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const cellX = Math.floor(point.x / cellSize)
      const cellY = Math.floor(point.y / cellSize)
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const nearby = buckets.get(`${cellX + offsetX}:${cellY + offsetY}`)
          nearby?.forEach((otherIndex) => {
            if (point.distanceTo(points[otherIndex]) < cellSize) {
              join(index, otherIndex)
            }
          })
        }
      }
      const key = `${cellX}:${cellY}`
      const cell = buckets.get(key) ?? []
      cell.push(index)
      buckets.set(key, cell)
    }

    const groups = new globalThis.Map<number, number[]>()
    reports.forEach((_report, index) => {
      const root = find(index)
      const group = groups.get(root) ?? []
      group.push(index)
      groups.set(root, group)
    })

    const offsets = new globalThis.Map<number, { x: number; y: number }>()
    groups.forEach((group) => {
      if (group.length < 2) return
      const center = group.reduce(
        (sum, index) => ({
          x: sum.x + points[index].x / group.length,
          y: sum.y + points[index].y / group.length,
        }),
        { x: 0, y: 0 },
      )
      const radius = Math.min(48, Math.max(28, group.length * 4))
      group.forEach((index, groupIndex) => {
        const angle = (2 * Math.PI * groupIndex) / group.length
        const targetX = center.x + Math.cos(angle) * radius
        const targetY = center.y + Math.sin(angle) * radius
        offsets.set(index, {
          x: targetX - points[index].x,
          y: targetY - points[index].y,
        })
      })
    })

    return reports.map((report, index) => {
      const offset = offsets.get(index) ?? { x: 0, y: 0 }
      const markerPoint = points[index].add(L.point(offset.x, offset.y))
      return {
        report,
        offset,
        connector: offset.x || offset.y
          ? map.containerPointToLatLng(markerPoint)
          : null,
      }
    })
  }, [map, reports, zoom])

  return (
    <>
      {markers.map(({ report, offset, connector }) => (
        <Fragment key={`report-marker-${report.id}`}>
          {connector && (
            <Polyline
              positions={[
                [report.latitude, report.longitude],
                connector,
              ]}
              pathOptions={{
                color: '#66736a',
                weight: 1,
                opacity: 0.6,
                dashArray: '2 4',
                interactive: false,
              }}
            />
          )}
          <Marker
            position={[report.latitude, report.longitude]}
            icon={markerIcon(report.status, offset, report.id === selectedReportId)}
            title={`Report ${report.id}: ${REPORT_STATUS_LABELS[report.status] ?? report.status}`}
            ref={(marker) => {
              if (marker) markerRefs.current.set(report.id, marker)
              else markerRefs.current.delete(report.id)
            }}
          >
            <Popup>
              <div className="map-popup">
                <strong>Report #{report.id}</strong>
                <span>
                  {report.potholes_detected} pothole
                  {report.potholes_detected === 1 ? '' : 's'}
                </span>
                <span>
                  Status: {REPORT_STATUS_LABELS[report.status] ?? report.status}
                </span>
                {report.user_name && (
                  <span>Submitted by: {report.user_name}</span>
                )}
                <span>{formatApiDateTime(report.created_at)}</span>
                <span className="map-popup-coordinates">
                  Latitude {report.latitude.toFixed(5)} / Longitude{' '}
                  {report.longitude.toFixed(5)}
                </span>
                <button
                  className="map-popup-action"
                  type="button"
                  onClick={() => onViewReport(report.id)}
                >
                  View Report
                </button>
                <a
                  className="map-popup-action map-popup-directions"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${report.latitude},${report.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🧭 Get Directions
                </a>
              </div>
            </Popup>
          </Marker>
        </Fragment>
      ))}
    </>
  )
}

function Map() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { logout } = useAuth()
  const [reports, setReports] = useState<AdminReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<MapDateFilter>('all')
  const [potholeFilter, setPotholeFilter] = useState<MapPotholeFilter>('all')
  const [tileStyle, setTileStyle] = useState<MapTileStyle>('road')
  const [fitKey, setFitKey] = useState(0)
  const selectedReportParam = searchParams.get('reportId')
  const selectedReportId =
    selectedReportParam && /^[1-9]\d*$/.test(selectedReportParam)
      ? Number(selectedReportParam)
      : null
  const hasInvalidReportId = selectedReportParam !== null &&
    (selectedReportId === null || !Number.isSafeInteger(selectedReportId))

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
            : 'Unable to load report locations.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [handleAuthorizationError, retryKey])

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

    return reports.filter((report) => {
      const normalizedIdQuery = normalizedSearch.replace(/^#/, '')
      if (
        normalizedSearch &&
        !String(report.id).includes(normalizedIdQuery) &&
        !report.user_name.toLocaleLowerCase().includes(normalizedSearch) &&
        !report.user_email.toLocaleLowerCase().includes(normalizedSearch)
      ) {
        return false
      }
      if (statusFilter !== 'all' && report.status !== statusFilter) return false
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
  }, [dateFilter, potholeFilter, reports, search, statusFilter])

  const selectedReport = reports.find(
    (report) => report.id === selectedReportId,
  )
  const selectedReportExcluded =
    selectedReport !== undefined && !filteredReports.includes(selectedReport)
  const visibleReports = useMemo(
    () => (
      selectedReportExcluded && selectedReport
        ? [...filteredReports, selectedReport]
        : filteredReports
    ),
    [filteredReports, selectedReport, selectedReportExcluded],
  )
  const mappableReports = useMemo(
    () => visibleReports.filter(hasValidCoordinates),
    [visibleReports],
  )

  const hasActiveFilters =
    search !== '' ||
    statusFilter !== 'all' ||
    dateFilter !== 'all' ||
    potholeFilter !== 'all'

  const retryLoading = () => {
    setError(null)
    setIsLoading(true)
    setRetryKey((key) => key + 1)
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setDateFilter('all')
    setPotholeFilter('all')
  }

  return (
    <section className="page-shell map-page">
      <h1 className="page-heading">Map</h1>
      <p className="page-subtitle">
        View reported potholes geographically.
      </p>

      {!isLoading && selectedReportParam !== null && (
        <div className="map-selection-message" role={hasInvalidReportId || !selectedReport ? 'alert' : 'status'}>
          {hasInvalidReportId ? (
            <>The report ID in this map link is invalid.</>
          ) : !selectedReport ? (
            <>Report #{selectedReportId} could not be found.</>
          ) : !hasValidCoordinates(selectedReport) ? (
            <>Report #{selectedReport.id} has no valid GPS coordinates to display.</>
          ) : (
            <>
              Focusing on Report #{selectedReport.id}.
              {selectedReportExcluded && (
                <>
                  {' '}It is excluded by the current map filters, but is shown on the map.
                  <button
                    className="map-control-button"
                    type="button"
                    onClick={clearFilters}
                  >
                    Show all reports
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="map-legend" aria-label="Report status legend">
        {legendStatuses.map(({ status, label }) => (
          <span className="map-legend-item" key={status}>
            <span
              className="map-legend-dot"
              style={{ backgroundColor: REPORT_STATUS_COLORS[status] }}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </div>

      {!isLoading && !error && reports.length > 0 && (
        <div className="map-toolbar" aria-label="Map controls">
          <div className="map-filter-field map-search-field">
            <label htmlFor="map-search">Search reports</label>
            <input
              id="map-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Report ID, user name, or email"
            />
          </div>
          <div className="map-filter-field">
            <label htmlFor="map-status-filter">Status</label>
            <select
              id="map-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {REPORT_STATUS_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="map-filter-field">
            <label htmlFor="map-date-filter">Date</label>
            <select
              id="map-date-filter"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value as MapDateFilter)}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
            </select>
          </div>
          <div className="map-filter-field">
            <label htmlFor="map-potholes-filter">Pothole count</label>
            <select
              id="map-potholes-filter"
              value={potholeFilter}
              onChange={(event) =>
                setPotholeFilter(event.target.value as MapPotholeFilter)
              }
            >
              <option value="all">All counts</option>
              <option value="one">1 pothole</option>
              <option value="2to5">2–5 potholes</option>
              <option value="6plus">6+ potholes</option>
            </select>
          </div>
          <div className="map-tile-switcher" role="group" aria-label="Map style">
            <button
              className={tileStyle === 'road' ? 'map-tile-active' : ''}
              type="button"
              aria-pressed={tileStyle === 'road'}
              onClick={() => setTileStyle('road')}
            >
              🗺️ Road
            </button>
            <button
              className={tileStyle === 'satellite' ? 'map-tile-active' : ''}
              type="button"
              aria-pressed={tileStyle === 'satellite'}
              onClick={() => setTileStyle('satellite')}
            >
              🛰️ Satellite
            </button>
          </div>
          <button
            className="map-control-button"
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Show all
          </button>
          <button
            className="map-control-button"
            type="button"
            onClick={() => setFitKey((key) => key + 1)}
            disabled={mappableReports.length === 0}
          >
            Fit visible reports
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="map-state" role="status">
          Loading report locations…
        </div>
      ) : error ? (
        <div className="map-error" role="alert">
          <strong>Report locations could not be loaded.</strong>
          <span>{error}</span>
          <button className="dashboard-retry" type="button" onClick={retryLoading}>
            Try again
          </button>
        </div>
      ) : reports.length === 0 ? (
        <div className="map-state">
          No reports have been submitted yet.
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="map-state">
          No reports match the current map filters.
          <button
            className="map-control-button"
            type="button"
            onClick={clearFilters}
          >
            Show all reports
          </button>
        </div>
      ) : mappableReports.length === 0 ? (
        <div className="map-state">
          Matching reports are available, but none have valid GPS coordinates to display.
        </div>
      ) : (
        <div className="admin-map-frame">
          <MapContainer
            className="admin-leaflet-map"
            center={[
              (selectedReport && hasValidCoordinates(selectedReport)
                ? selectedReport
                : mappableReports[0]).latitude,
              (selectedReport && hasValidCoordinates(selectedReport)
                ? selectedReport
                : mappableReports[0]).longitude,
            ]}
            zoom={selectedReport && hasValidCoordinates(selectedReport) ? 16 : 12}
            scrollWheelZoom
          >
            {tileStyle === 'road' ? (
              <TileLayer
                key="road"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            ) : (
              <TileLayer
                key="satellite"
                attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            )}
            <FitReportBounds
              reports={mappableReports}
              fitKey={fitKey}
              selectedReportId={selectedReportId}
            />
            <ReportMarkers
              reports={mappableReports}
              selectedReportId={selectedReportId}
              onViewReport={(reportId) =>
                navigate(`/reports?reportId=${reportId}`)
              }
            />
          </MapContainer>
        </div>
      )}
      {!isLoading && !error && visibleReports.length > mappableReports.length && (
        <p className="map-coordinate-note">
          {visibleReports.length - mappableReports.length} matching report
          {visibleReports.length - mappableReports.length === 1 ? '' : 's'} omitted
          because GPS coordinates are missing or invalid.
        </p>
      )}
      {!isLoading && !error && reports.length > 0 && (
        <p className="map-coordinate-note" aria-live="polite">
          Showing {mappableReports.length} of {reports.length} reports on the map.
        </p>
      )}
    </section>
  )
}

export default Map

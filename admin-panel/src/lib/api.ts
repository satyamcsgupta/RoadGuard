import { readAdminSession } from '../auth/session'

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const defaultApiBaseUrl = 'https://roadguard-api-zs99.onrender.com'

export const API_BASE_URL = (
  configuredApiBaseUrl || defaultApiBaseUrl
).replace(/\/+$/, '')

export const API_ENDPOINTS = {
  login: `${API_BASE_URL}/login`,
  adminMe: `${API_BASE_URL}/admin/me`,
  adminPassword: `${API_BASE_URL}/admin/me/password`,
  adminDashboard: `${API_BASE_URL}/admin/dashboard`,
  adminUsers: `${API_BASE_URL}/admin/users`,
  adminUser: (userId: number) => `${API_BASE_URL}/admin/users/${userId}`,
  adminReports: `${API_BASE_URL}/admin/reports`,
  adminReport: (reportId: number) =>
    `${API_BASE_URL}/admin/reports/${reportId}`,
  adminReportStatus: (reportId: number) =>
    `${API_BASE_URL}/admin/reports/${reportId}/status`,
  deleteAdminReport: (reportId: number) =>
    `${API_BASE_URL}/admin/reports/${reportId}`,
  adminReportImage: (reportId: number) =>
    `${API_BASE_URL}/admin/reports/${reportId}/image`,
} as const

export class ApiResponseError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = status
  }
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const excerpt = responseText.slice(0, 300)

  if (!response.ok) {
    let detail = excerpt || response.statusText || 'Empty response'
    try {
      const body: unknown = JSON.parse(responseText)
      if (
        typeof body === 'object' &&
        body !== null &&
        'detail' in body &&
        typeof body.detail === 'string'
      ) {
        detail = body.detail
      }
    } catch {
      // Keep the bounded response excerpt for non-JSON error pages.
    }
    throw new ApiResponseError(`HTTP ${response.status}: ${detail}`, response.status)
  }

  if (
    !contentType.toLowerCase().includes('application/json') &&
    !contentType.toLowerCase().includes('+json')
  ) {
    throw new Error(
      `Expected JSON from the API but received ${contentType || 'an unknown content type'}.`,
    )
  }

  try {
    return JSON.parse(responseText) as T
  } catch {
    throw new Error('The API returned invalid JSON.')
  }
}

async function fetchWithAdminSession(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const session = readAdminSession()
  if (!session) {
    throw new ApiResponseError('Administrator session is missing.', 401)
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.accessToken}`)
  return fetch(input, {
    ...init,
    headers,
  })
}

export async function fetchAdminApi<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithAdminSession(input, init)
  return readJsonResponse<T>(response)
}

export async function fetchAdminBlob(
  input: RequestInfo | URL,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchWithAdminSession(input, { signal })
  if (!response.ok) {
    const responseText = await response.text()
    const excerpt = responseText.slice(0, 300)
    throw new ApiResponseError(
      `HTTP ${response.status}: ${excerpt || response.statusText || 'Empty response'}`,
      response.status,
    )
  }
  return response.blob()
}

export async function fetchAdminDashboard<T>(signal?: AbortSignal): Promise<T> {
  return fetchAdminApi<T>(API_ENDPOINTS.adminDashboard, { signal })
}

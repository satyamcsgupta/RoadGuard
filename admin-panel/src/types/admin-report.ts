export type AdminReport = {
  id: number
  user_id: number
  user_name: string
  user_email: string
  potholes_detected: number
  latitude: number | null
  longitude: number | null
  description: string | null
  status: string
  admin_note: string | null
  image_filename: string
  image_available: boolean
  created_at: string
}

export const REPORT_STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
] as const

export const REPORT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  REPORT_STATUS_OPTIONS.map(({ value, label }) => [value, label]),
)

export const REPORT_STATUS_COLORS: Record<string, string> = {
  submitted: '#d99b24',
  under_review: '#4383bb',
  resolved: '#278453',
  rejected: '#c55450',
}

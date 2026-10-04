const SESSION_STORAGE_KEY = 'roadguard_admin_session'

export type AdminUser = {
  id: number
  name: string
  email: string
  role: 'admin'
}

export type AdminSession = {
  accessToken: string
  user: AdminUser
}

export function isAdminUser(value: unknown): value is AdminUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'email' in value &&
    typeof value.email === 'string' &&
    'role' in value &&
    value.role === 'admin'
  )
}

export function readAdminSession(): AdminSession | null {
  const serializedSession = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!serializedSession) return null

  try {
    const parsed: unknown = JSON.parse(serializedSession)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('accessToken' in parsed) ||
      typeof parsed.accessToken !== 'string' ||
      !parsed.accessToken ||
      !('user' in parsed) ||
      !isAdminUser(parsed.user)
    ) {
      clearAdminSession()
      return null
    }

    return { accessToken: parsed.accessToken, user: parsed.user }
  } catch (error) {
    if (error instanceof SyntaxError) {
      clearAdminSession()
      return null
    }
    throw error
  }
}

export function saveAdminSession(session: AdminSession): void {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearAdminSession(): void {
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

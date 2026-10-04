import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  API_ENDPOINTS,
  ApiResponseError,
  readJsonResponse,
} from '../lib/api'
import {
  clearAdminSession,
  readAdminSession,
  saveAdminSession,
  isAdminUser,
  type AdminSession,
  type AdminUser,
} from './session'
import { AuthContext, type AuthContextValue } from './AuthContext'

type LoginResponse = {
  access_token: string
  token_type: string
  user: {
    id: number
    name: string
    email: string
    role: string
  }
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (typeof value !== 'object' || value === null || !('user' in value)) {
    return false
  }
  const user = value.user
  return (
    'access_token' in value &&
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    'token_type' in value &&
    typeof value.token_type === 'string' &&
    typeof user === 'object' &&
    user !== null &&
    'id' in user &&
    typeof user.id === 'number' &&
    'name' in user &&
    typeof user.name === 'string' &&
    'email' in user &&
    typeof user.email === 'string' &&
    'role' in user &&
    typeof user.role === 'string'
  )
}

type AuthStatus = AuthContextValue['status']

async function verifyAdminSession(session: AdminSession): Promise<AdminUser> {
  const response = await fetch(API_ENDPOINTS.adminMe, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
  const responseBody: unknown = await readJsonResponse<unknown>(response)

  if (!isAdminUser(responseBody)) {
    throw new Error('The API returned an invalid administrator profile.')
  }
  if (responseBody.role !== 'admin') {
    throw new Error('This account does not have administrator access.')
  }
  return responseBody
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Authentication failed.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AdminUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoreAttempt, setRestoreAttempt] = useState(0)

  useEffect(() => {
    let isActive = true

    const restoreSession = async () => {
      setStatus('loading')
      setError(null)

      try {
        const session = readAdminSession()
        if (!session) {
          if (isActive) {
            setUser(null)
            setStatus('unauthenticated')
          }
          return
        }

        const verifiedUser = await verifyAdminSession(session)
        if (!isActive) return

        const verifiedSession = { accessToken: session.accessToken, user: verifiedUser }
        saveAdminSession(verifiedSession)
        setUser(verifiedUser)
        setStatus('authenticated')
      } catch (restoreError) {
        if (!isActive) return
        setUser(null)
        if (
          restoreError instanceof ApiResponseError &&
          (restoreError.status === 401 || restoreError.status === 403)
        ) {
          clearAdminSession()
          setStatus('unauthenticated')
          return
        }
        setError(getErrorMessage(restoreError))
        setStatus('error')
      }
    }

    void restoreSession()
    return () => {
      isActive = false
    }
  }, [restoreAttempt])

  const login = useCallback(async (email: string, password: string) => {
    setError(null)
    const response = await fetch(API_ENDPOINTS.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const responseBody: unknown = await readJsonResponse<unknown>(response)

    if (!isLoginResponse(responseBody)) {
      throw new Error('The API returned an incomplete login response.')
    }
    if (responseBody.token_type.toLowerCase() !== 'bearer') {
      throw new Error('The API returned an unsupported authentication scheme.')
    }
    if (responseBody.user.role !== 'admin') {
      throw new Error('This account does not have administrator access.')
    }

    const unverifiedSession: AdminSession = {
      accessToken: responseBody.access_token,
      user: {
        id: responseBody.user.id,
        name: responseBody.user.name,
        email: responseBody.user.email,
        role: 'admin',
      },
    }
    const verifiedUser = await verifyAdminSession(unverifiedSession)
    const verifiedSession = {
      accessToken: responseBody.access_token,
      user: verifiedUser,
    }

    saveAdminSession(verifiedSession)
    setUser(verifiedUser)
    setStatus('authenticated')
    setError(null)
  }, [])

  const logout = useCallback(() => {
    clearAdminSession()
    setUser(null)
    setError(null)
    setStatus('unauthenticated')
  }, [])

  const retryRestore = useCallback(() => {
    setRestoreAttempt((attempt) => attempt + 1)
  }, [])

  const value = useMemo(
    () => ({ status, user, error, login, logout, retryRestore }),
    [status, user, error, login, logout, retryRestore],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

import { createContext } from 'react'
import type { AdminUser } from './session'

export type AuthContextValue = {
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'error'
  user: AdminUser | null
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  retryRestore: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

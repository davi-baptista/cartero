'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  api,
  refreshAccessToken,
  TOKEN_REFRESHED_EVENT,
} from '@/lib/api'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (token: string, user: User) => void
  logout: () => Promise<void>
  updateUser: (user: User) => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    async function initializeSession() {
      const storedToken = localStorage.getItem('cartero-token')
      const storedUser = localStorage.getItem('cartero-user')

      if (!storedToken || !storedUser) {
        if (!cancelled) setIsLoading(false)
        return
      }

      try {
        const parsed = JSON.parse(storedUser)
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Usuário armazenado inválido')
        }

        const { data: currentUser } = await api.get<User>('/users/me')
        if (cancelled) return

        const currentToken = localStorage.getItem('cartero-token')
        if (!currentToken) {
          throw new Error('Sessão sem access token')
        }

        localStorage.setItem('cartero-user', JSON.stringify(currentUser))
        setToken(currentToken)
        setUser(currentUser)
      } catch {
        localStorage.removeItem('cartero-token')
        localStorage.removeItem('cartero-user')
        if (!cancelled) {
          setToken(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void initializeSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function handleTokenRefreshed(event: Event) {
      setToken((event as CustomEvent<string>).detail)
    }

    window.addEventListener(TOKEN_REFRESHED_EVENT, handleTokenRefreshed)
    return () => {
      window.removeEventListener(TOKEN_REFRESHED_EVENT, handleTokenRefreshed)
    }
  }, [])

  useEffect(() => {
    if (!token) return

    const expiresAt = getTokenExpiration(token)
    if (!expiresAt) return

    const refreshIn = Math.max(expiresAt - Date.now() - 60_000, 0)
    const timer = window.setTimeout(async () => {
      try {
        const newToken = await refreshAccessToken()
        setToken(newToken)
      } catch {
        localStorage.removeItem('cartero-token')
        localStorage.removeItem('cartero-user')
        setToken(null)
        setUser(null)
        router.replace('/login')
      }
    }, refreshIn)

    return () => window.clearTimeout(timer)
  }, [token, router])

  function login(newToken: string, newUser: User) {
    localStorage.setItem('cartero-token', newToken)
    localStorage.setItem('cartero-user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  function updateUser(updated: User) {
    localStorage.setItem('cartero-user', JSON.stringify(updated))
    setUser(updated)
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // ignore errors — clear client state regardless
    }
    localStorage.removeItem('cartero-token')
    localStorage.removeItem('cartero-user')
    setToken(null)
    setUser(null)
    router.replace('/login')
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function getTokenExpiration(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const decoded = JSON.parse(window.atob(padded)) as { exp?: number }

    return decoded.exp ? decoded.exp * 1000 : null
  } catch {
    return null
  }
}

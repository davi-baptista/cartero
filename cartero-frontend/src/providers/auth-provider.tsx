'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (token: string, user: User) => void
  logout: () => Promise<void>
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const storedToken = localStorage.getItem('cartero-token')
    const storedUser = localStorage.getItem('cartero-user')
    if (storedToken && storedUser) {
      try {
        const parsed = JSON.parse(storedUser)
        if (parsed && typeof parsed === 'object') {
          setToken(storedToken)
          setUser(parsed)
        } else {
          localStorage.removeItem('cartero-token')
          localStorage.removeItem('cartero-user')
        }
      } catch {
        localStorage.removeItem('cartero-token')
        localStorage.removeItem('cartero-user')
      }
    }
    setIsLoading(false)
  }, [])

  function login(newToken: string, newUser: User) {
    localStorage.setItem('cartero-token', newToken)
    localStorage.setItem('cartero-user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
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
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

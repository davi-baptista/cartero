import { api } from '@/lib/api'
import type { AuthResponse } from '@/types'

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password })
  return data
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', { name, email, password })
  return data
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

import { api } from '@/lib/api'
import type { AuthResponse } from '@/types'

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password })
  return data
}

/**
 * Timezone financeira do navegador, best-effort (TZ1).
 *
 * `undefined` quando o runtime não souber informar — o backend trata a
 * ausência do campo exatamente como uma conta legada (`timeZone: null`).
 * Nunca geolocalização, nunca IP: só o que `Intl` já expõe localmente.
 */
function detectBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', {
    name,
    email,
    password,
    timeZone: detectBrowserTimeZone(),
  })
  return data
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

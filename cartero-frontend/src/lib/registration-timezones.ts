import { supportedTimeZones } from './timezone-settings'

// Fallback estatico para browsers sem Intl.supportedValuesOf. Todos os itens
// sao identificadores IANA aceitos pelo backend; nenhum offset e usado.
const STATIC_TIME_ZONES = [
  'America/Fortaleza', 'America/Sao_Paulo', 'America/Recife',
  'America/Manaus', 'America/Rio_Branco', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'America/Argentina/Buenos_Aires', 'America/Santiago', 'America/Lima',
  'America/Bogota', 'America/Montevideo', 'Europe/Lisbon', 'Europe/London',
  'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Zurich', 'Europe/Moscow', 'Africa/Cairo',
  'Africa/Johannesburg', 'Africa/Lagos', 'Asia/Tokyo', 'Asia/Shanghai',
  'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
  'Asia/Seoul', 'Asia/Bangkok', 'Australia/Sydney', 'Australia/Perth',
  'Pacific/Auckland', 'Pacific/Honolulu',
] as const

export function registrationTimeZones(): string[] {
  const detected = supportedTimeZones()
  return detected.length > 0 ? detected : [...STATIC_TIME_ZONES]
}

export function detectedRegistrationTimeZone(): string | null {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone
    return value && registrationTimeZones().includes(value) ? value : null
  } catch {
    return null
  }
}

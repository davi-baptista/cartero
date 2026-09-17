export function supportedTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

export function resolveDeviceTimeZone(): string | null {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone
    return value && supportedTimeZones().includes(value) ? value : null
  } catch {
    return null
  }
}

export function isSupportedTimeZone(value: string): boolean {
  return supportedTimeZones().includes(value)
}

export function mismatchKey(userId: string, account: string, device: string) {
  return `cartero.timezone-mismatch.v1:${userId}:${account}->${device}`
}

export function hasAcknowledgedMismatch(userId: string, account: string, device: string) {
  try {
    return localStorage.getItem(mismatchKey(userId, account, device)) === '1'
  } catch {
    return false
  }
}

export function acknowledgeMismatch(userId: string, account: string, device: string) {
  try {
    localStorage.setItem(mismatchKey(userId, account, device), '1')
  } catch {
    // Local storage is an optimization; it must not change financial state.
  }
}

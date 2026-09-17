export type TimezoneMismatch = { account: string; device: string }

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

export interface TimezoneAcknowledgementStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export function mismatchKey(userId: string, account: string, device: string) {
  return `cartero.timezone-mismatch.v1:${userId}:${account}->${device}`
}

export async function acknowledgeOnce(
  store: TimezoneAcknowledgementStore,
  userId: string,
  account: string,
  device: string,
): Promise<boolean> {
  const key = mismatchKey(userId, account, device)
  if ((await store.get(key)) === '1') return false
  await store.set(key, '1')
  return true
}

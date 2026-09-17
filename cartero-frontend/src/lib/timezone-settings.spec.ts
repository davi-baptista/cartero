import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeMismatch,
  hasAcknowledgedMismatch,
  mismatchKey,
  resolveDeviceTimeZone,
} from './timezone-settings'

afterEach(() => vi.unstubAllGlobals())

describe('timezone settings', () => {
  it('uses canonical IANA device timezone only', () => {
    vi.stubGlobal('Intl', {
      supportedValuesOf: () => ['Europe/Lisbon'],
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Europe/Lisbon' }) }),
    })
    expect(resolveDeviceTimeZone()).toBe('Europe/Lisbon')
  })

  it('acknowledgement is scoped by user and exact account/device pair', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    acknowledgeMismatch('user-a', 'America/Fortaleza', 'Europe/Lisbon')
    expect(hasAcknowledgedMismatch('user-a', 'America/Fortaleza', 'Europe/Lisbon')).toBe(true)
    expect(hasAcknowledgedMismatch('user-b', 'America/Fortaleza', 'Europe/Lisbon')).toBe(false)
    expect(hasAcknowledgedMismatch('user-a', 'America/Fortaleza', 'Asia/Tokyo')).toBe(false)
    expect(mismatchKey('user-a', 'America/Fortaleza', 'Europe/Lisbon')).toContain('user-a')
  })
})

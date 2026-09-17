import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeMismatch,
  hasAcknowledgedMismatch,
  mismatchKey,
  resolveDeviceTimeZone,
  resolveMismatchDecision,
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

describe('resolveMismatchDecision', () => {
  function withLocalStorage() {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    return values
  }

  it('shows nothing when device could not be resolved', () => {
    withLocalStorage()
    expect(resolveMismatchDecision('user-a', 'America/Fortaleza', null, null)).toEqual({
      show: false,
    })
  })

  it('shows nothing when account and device match', () => {
    withLocalStorage()
    expect(
      resolveMismatchDecision('user-a', 'America/Fortaleza', 'America/Fortaleza', null),
    ).toEqual({ show: false })
  })

  it('shows and acknowledges a genuine new mismatch', () => {
    const values = withLocalStorage()
    const decision = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null)
    expect(decision).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'Asia/Tokyo' },
    })
    expect(values.get(mismatchKey('user-a', 'America/Fortaleza', 'Asia/Tokyo'))).toBe('1')
  })

  it('does not show an already-acknowledged mismatch on a later independent call', () => {
    withLocalStorage()
    resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null)
    // Segunda chamada, sem `alreadyShownPairKey` (simula um novo useEffect
    // completamente independente, ex: outra navegação) — já reconhecido.
    const second = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null)
    expect(second).toEqual({ show: false })
  })

  it(
    'React Strict Mode safety: a second call for the SAME pair with alreadyShownPairKey set ' +
      'still shows — the decision made in this logical mount is not undone by a StrictMode replay',
    () => {
      withLocalStorage()
      const first = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null)
      expect(first.show).toBe(true)
      if (!first.show) throw new Error('unreachable')

      const pairKey = `${first.mismatch.account}->${first.mismatch.device}`
      const replay = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', pairKey)
      expect(replay).toEqual(first)
    },
  )

  it('a genuinely new/distinct mismatch is eligible once, independent of a prior acknowledged pair', () => {
    withLocalStorage()
    resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null)
    const distinct = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Europe/Lisbon', null)
    expect(distinct).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'Europe/Lisbon' },
    })
  })

  it('account isolation: acknowledgement by one user never suppresses another user\'s identical pair', () => {
    withLocalStorage()
    resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null)
    const otherUser = resolveMismatchDecision('user-b', 'America/Fortaleza', 'Asia/Tokyo', null)
    expect(otherUser).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'Asia/Tokyo' },
    })
  })
})

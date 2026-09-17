import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeOnce,
  areTimeZonesOperationallyEquivalent,
  isSupportedTimeZone,
  mismatchKey,
  resolveDeviceTimeZone,
  supportedTimeZones,
} from './settings'

const FIXED_NOW = new Date('2026-09-17T12:00:00.000Z')

describe('mobile timezone acknowledgement', () => {
  it('acknowledges one exact mismatch and allows a new pair', async () => {
    const values = new Map<string, string>()
    const store = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => { values.set(key, value) },
    }
    expect(await acknowledgeOnce(store, 'a', 'America/Fortaleza', 'Europe/Lisbon')).toBe(true)
    expect(await acknowledgeOnce(store, 'a', 'America/Fortaleza', 'Europe/Lisbon')).toBe(false)
    expect(await acknowledgeOnce(store, 'b', 'America/Fortaleza', 'Europe/Lisbon')).toBe(true)
    expect(values.has(mismatchKey('a', 'America/Fortaleza', 'Europe/Lisbon'))).toBe(true)
  })

  /**
   * TZ V1.1 — achado de runtime real (AVD `Cartero_API_36`):
   * `SecureStore.getItemAsync` lança `Error: Invalid key provided to
   * SecureStore` para qualquer chave fora de `[A-Za-z0-9._-]`. A versão
   * anterior de `mismatchKey` usava `:`, `/` e `>` — nunca detectado antes
   * porque o bug separado do `Intl.supportedValuesOf` fazia
   * `resolveDeviceTimeZone()` sempre devolver `null`, o que impedia o
   * código de chegar a chamar `store.get(key)`.
   */
  it('mismatchKey() only uses SecureStore-safe characters ([A-Za-z0-9._-])', () => {
    const key = mismatchKey('user-uuid-1234', 'America/Fortaleza', 'Asia/Tokyo')
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('mismatchKey() stays distinct across different zone pairs after sanitization', () => {
    const a = mismatchKey('user-1', 'America/Fortaleza', 'Asia/Tokyo')
    const b = mismatchKey('user-1', 'America/Fortaleza', 'Europe/Lisbon')
    const c = mismatchKey('user-1', 'Asia/Tokyo', 'America/Fortaleza')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

/**
 * TZ V1.1 §18 — mutação obrigatória: com `Intl.supportedValuesOf`
 * indisponível (reproduzindo o Hermes/Android real, onde
 * `typeof Intl.supportedValuesOf === 'undefined'`), estes testes precisam
 * CONTINUAR passando pelo caminho Hermes-safe (lista estática + detecção via
 * `resolvedOptions().timeZone`). Nenhum destes testes pode depender de
 * `Intl.supportedValuesOf` existir.
 */
describe('Hermes-safe timezone path (Intl.supportedValuesOf unavailable)', () => {
  const originalSupportedValuesOf = Intl.supportedValuesOf

  afterEach(() => {
    Intl.supportedValuesOf = originalSupportedValuesOf
    vi.restoreAllMocks()
  })

  function makeIntlSupportedValuesOfUnavailable() {
    // @ts-expect-error simula o runtime real: a função nem existe no objeto
    delete Intl.supportedValuesOf
  }

  it('supportedTimeZones() is non-empty via the static list, never via Intl.supportedValuesOf', () => {
    makeIntlSupportedValuesOfUnavailable()
    const zones = supportedTimeZones()
    expect(zones.length).toBeGreaterThan(400)
    expect(zones).toContain('America/Fortaleza')
    expect(zones).toContain('Asia/Tokyo')
  })

  it('isSupportedTimeZone() still validates correctly', () => {
    makeIntlSupportedValuesOfUnavailable()
    expect(isSupportedTimeZone('America/Fortaleza')).toBe(true)
    expect(isSupportedTimeZone('Not/A_Real_Zone')).toBe(false)
  })

  it('resolveDeviceTimeZone() still resolves the device timezone via resolvedOptions()', () => {
    makeIntlSupportedValuesOfUnavailable()
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'America/Fortaleza' }),
    } as unknown as Intl.DateTimeFormat)

    expect(resolveDeviceTimeZone()).toBe('America/Fortaleza')
  })

  it('resolveDeviceTimeZone() rejects a value outside the known canonical set', () => {
    makeIntlSupportedValuesOfUnavailable()
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Not/A_Real_Zone' }),
    } as unknown as Intl.DateTimeFormat)

    expect(resolveDeviceTimeZone()).toBeNull()
  })
})

/**
 * TZ V1.1 §9 — paridade de contrato com o backend
 * (`resolveIanaTimeZone`/`isValidIanaTimeZone`, gerados a partir do MESMO
 * `Intl.supportedValuesOf('timeZone')` em Node — a lista estática precisa
 * concordar byte a byte com o que o backend aceita).
 */
describe('backend contract parity — canonical IANA identifiers only', () => {
  const mustAccept = [
    'America/Fortaleza',
    'America/Sao_Paulo',
    'America/Manaus',
    'Europe/Lisbon',
    'Asia/Tokyo',
    'Asia/Calcutta', // forma canônica de "Asia/Kolkata" (alias) — :30
    'Pacific/Chatham', // :45
  ]

  it.each(mustAccept)('accepts canonical zone %s', (zone) => {
    expect(isSupportedTimeZone(zone)).toBe(true)
  })

  it('rejects known aliases the backend also rejects', () => {
    expect(isSupportedTimeZone('Asia/Kolkata')).toBe(false)
    expect(isSupportedTimeZone('Brazil/East')).toBe(false)
  })

  it('rejects raw UTC offsets', () => {
    expect(isSupportedTimeZone('-03:00')).toBe(false)
    expect(isSupportedTimeZone('UTC-3')).toBe(false)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ V1.2 — areTimeZonesOperationallyEquivalent (Mobile)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Mesmos testes e mesma regra do Web (`cartero-frontend/src/lib/
 * timezone-settings.spec.ts`) — não pode haver um app mais permissivo que
 * o outro para o mesmo par de timezones.
 */
describe('areTimeZonesOperationallyEquivalent', () => {
  it('E1: identical timezone is equivalent (fast path)', () => {
    expect(
      areTimeZonesOperationallyEquivalent('America/Fortaleza', 'America/Fortaleza', FIXED_NOW),
    ).toBe(true)
  })

  it('E2: America/Fortaleza vs America/Sao_Paulo — equivalent (no DST since 2019, same offset always)', () => {
    expect(
      areTimeZonesOperationallyEquivalent('America/Fortaleza', 'America/Sao_Paulo', FIXED_NOW),
    ).toBe(true)
  })

  it('E3: America/Fortaleza vs America/Manaus — NOT equivalent (Manaus is UTC-4, Fortaleza is UTC-3)', () => {
    expect(
      areTimeZonesOperationallyEquivalent('America/Fortaleza', 'America/Manaus', FIXED_NOW),
    ).toBe(false)
  })

  it('E4: America/Fortaleza vs Europe/Lisbon — NOT equivalent', () => {
    expect(
      areTimeZonesOperationallyEquivalent('America/Fortaleza', 'Europe/Lisbon', FIXED_NOW),
    ).toBe(false)
  })

  it('E5: Africa/Abidjan vs Atlantic/Azores — same offset NOW, diverge seasonally — NOT equivalent', () => {
    const offsetNow = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Abidjan',
      timeZoneName: 'longOffset',
    })
      .formatToParts(FIXED_NOW)
      .find((p) => p.type === 'timeZoneName')?.value
    const offsetNowAzores = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Atlantic/Azores',
      timeZoneName: 'longOffset',
    })
      .formatToParts(FIXED_NOW)
      .find((p) => p.type === 'timeZoneName')?.value
    expect(offsetNow).toBe(offsetNowAzores)

    expect(
      areTimeZonesOperationallyEquivalent('Africa/Abidjan', 'Atlantic/Azores', FIXED_NOW),
    ).toBe(false)
  })

  it('E6: Asia/Calcutta (forma canônica de Kolkata) vs timezone de offset diferente — NOT equivalent', () => {
    expect(
      areTimeZonesOperationallyEquivalent('Asia/Calcutta', 'America/Fortaleza', FIXED_NOW),
    ).toBe(false)
  })

  it('P3: America/Fortaleza vs America/Recife — also equivalent (proves the rule is general, not hardcoded)', () => {
    expect(
      areTimeZonesOperationallyEquivalent('America/Fortaleza', 'America/Recife', FIXED_NOW),
    ).toBe(true)
  })

  it('E7: timezone :45 (Pacific/Chatham) continua suportada pela comparação', () => {
    expect(
      areTimeZonesOperationallyEquivalent('Pacific/Chatham', 'Pacific/Chatham', FIXED_NOW),
    ).toBe(true)
    expect(
      areTimeZonesOperationallyEquivalent('Pacific/Chatham', 'America/Fortaleza', FIXED_NOW),
    ).toBe(false)
  })
})

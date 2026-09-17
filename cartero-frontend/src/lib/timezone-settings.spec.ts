import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeMismatch,
  areTimeZonesOperationallyEquivalent,
  hasAcknowledgedMismatch,
  mismatchKey,
  resolveDeviceTimeZone,
  resolveMismatchDecision,
} from './timezone-settings'

const FIXED_NOW = new Date('2026-09-17T12:00:00.000Z')

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
    expect(resolveMismatchDecision('user-a', 'America/Fortaleza', null, null, FIXED_NOW)).toEqual({
      show: false,
    })
  })

  it('shows nothing when account and device match', () => {
    withLocalStorage()
    expect(
      resolveMismatchDecision('user-a', 'America/Fortaleza', 'America/Fortaleza', null, FIXED_NOW),
    ).toEqual({ show: false })
  })

  it('shows and acknowledges a genuine new mismatch', () => {
    const values = withLocalStorage()
    const decision = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
    expect(decision).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'Asia/Tokyo' },
    })
    expect(values.get(mismatchKey('user-a', 'America/Fortaleza', 'Asia/Tokyo'))).toBe('1')
  })

  it('does not show an already-acknowledged mismatch on a later independent call', () => {
    withLocalStorage()
    resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
    // Segunda chamada, sem `alreadyShownPairKey` (simula um novo useEffect
    // completamente independente, ex: outra navegação) — já reconhecido.
    const second = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
    expect(second).toEqual({ show: false })
  })

  it(
    'React Strict Mode safety: a second call for the SAME pair with alreadyShownPairKey set ' +
      'still shows — the decision made in this logical mount is not undone by a StrictMode replay',
    () => {
      withLocalStorage()
      const first = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
      expect(first.show).toBe(true)
      if (!first.show) throw new Error('unreachable')

      const pairKey = `${first.mismatch.account}->${first.mismatch.device}`
      const replay = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', pairKey, FIXED_NOW)
      expect(replay).toEqual(first)
    },
  )

  it('a genuinely new/distinct mismatch is eligible once, independent of a prior acknowledged pair', () => {
    withLocalStorage()
    resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
    const distinct = resolveMismatchDecision('user-a', 'America/Fortaleza', 'Europe/Lisbon', null, FIXED_NOW)
    expect(distinct).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'Europe/Lisbon' },
    })
  })

  it('account isolation: acknowledgement by one user never suppresses another user\'s identical pair', () => {
    withLocalStorage()
    resolveMismatchDecision('user-a', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
    const otherUser = resolveMismatchDecision('user-b', 'America/Fortaleza', 'Asia/Tokyo', null, FIXED_NOW)
    expect(otherUser).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'Asia/Tokyo' },
    })
  })

  /**
   * TZ V1.2 — problema real observado: conta America/Fortaleza, device
   * America/Sao_Paulo. Os dois são operacionalmente equivalentes (nunca
   * observam DST no tzdata atual), então NÃO deve gerar sugestão nem
   * gravar ack — ao contrário do comportamento antigo (comparação de
   * string pura), que mostrava um aviso inútil.
   */
  it('TZ V1.2: Fortaleza vs Sao_Paulo (operationally equivalent) never shows and never acknowledges', () => {
    const values = withLocalStorage()
    const decision = resolveMismatchDecision(
      'user-a',
      'America/Fortaleza',
      'America/Sao_Paulo',
      null,
      FIXED_NOW,
    )
    expect(decision).toEqual({ show: false })
    expect(values.size).toBe(0)
  })

  it('TZ V1.2: Fortaleza vs Manaus (genuinely different offset) still shows normally', () => {
    withLocalStorage()
    const decision = resolveMismatchDecision(
      'user-a',
      'America/Fortaleza',
      'America/Manaus',
      null,
      FIXED_NOW,
    )
    expect(decision).toEqual({
      show: true,
      mismatch: { account: 'America/Fortaleza', device: 'America/Manaus' },
    })
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ V1.2 — areTimeZonesOperationallyEquivalent
 * ══════════════════════════════════════════════════════════════════════════
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

  /**
   * E5: par factual com MESMO offset em `FIXED_NOW` (setembro, ambos GMT+0),
   * mas que diverge sazonalmente: `Atlantic/Azores` observa DST (verão
   * europeu = GMT+0, inverno europeu = GMT-1), `Africa/Abidjan` nunca
   * observa DST (sempre GMT+0). Confirmado por script Node contra os 417
   * timezones do runtime: 5 dos 14 pontos de probe divergem.
   */
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
    // Precondição do teste: os dois têm o MESMO offset em FIXED_NOW — se
    // isso deixar de ser verdade (mudança de regra tzdata), o teste não
    // estaria mais provando o que E5 exige provar.
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

  /**
   * TZ V1.2 §9/P3 — prova de generalidade: a regra não pode estar
   * hardcoded para o par Fortaleza/Sao_Paulo especificamente. Recife é
   * outro par genuinamente equivalente a Fortaleza (mesma ausência de DST
   * no Brasil desde 2019, mesmo offset -03:00 sempre) — se a implementação
   * checasse só `(Fortaleza, Sao_Paulo)` como caso especial, este teste
   * pegaria a fragilidade enquanto o teste de Sao_Paulo continuaria verde.
   */
  it('P3: America/Fortaleza vs America/Recife — also equivalent (proves the rule is general, not hardcoded)', () => {
    expect(
      areTimeZonesOperationallyEquivalent('America/Fortaleza', 'America/Recife', FIXED_NOW),
    ).toBe(true)
  })

  it('E7: timezone :45 (Pacific/Chatham) continua suportada pela comparação', () => {
    // Chatham comparado consigo mesma (fast path) — só confirma que a
    // função não lança para uma zona de offset :45.
    expect(
      areTimeZonesOperationallyEquivalent('Pacific/Chatham', 'Pacific/Chatham', FIXED_NOW),
    ).toBe(true)
    // E contra uma zona claramente diferente.
    expect(
      areTimeZonesOperationallyEquivalent('Pacific/Chatham', 'America/Fortaleza', FIXED_NOW),
    ).toBe(false)
  })
})

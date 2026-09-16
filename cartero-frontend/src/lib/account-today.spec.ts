import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accountCivilDayOf, accountToday, accountTodayDate, civilDayOf, formatDateValue } from './date'

const DATE_SRC = readFileSync(new URL('./date.ts', import.meta.url), 'utf-8')

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ3 — accountToday/accountTodayDate/accountCivilDayOf
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `timeZone === null` precisa reproduzir EXATAMENTE o comportamento legado
 * (fuso do navegador para `accountToday`/`accountTodayDate`, -3h fixo para
 * `accountCivilDayOf`). Só contas com `User.timeZone` configurado passam a
 * usar essa timezone via `Intl`, nunca offset fixo, nunca fallback oculto.
 */

// 16/09/2026, 15:30 UTC — mesmo instante usado nos testes equivalentes do backend (TZ2).
const AGORA = new Date('2026-09-16T15:30:00.000Z')
// 20:30 em Fortaleza (16/09), 08:30 do dia seguinte em Tóquio (17/09).
const BOUNDARY_TOKYO = new Date('2026-09-16T15:30:00.000Z')
// Virada de mês: 20:30 em Fortaleza ainda é 30/09; já é 01/10 em Tóquio.
const MONTH_BOUNDARY = new Date('2026-09-30T23:30:00.000Z')
// Virada de ano.
const YEAR_BOUNDARY = new Date('2026-12-31T23:30:00.000Z')

describe('accountToday — W1/W2/W3/W4/W5/W6/W14', () => {
  it('W1: Fortaleza', () => {
    expect(accountToday('America/Fortaleza', AGORA)).toBe('2026-09-16')
  })

  it('W2: Tóquio, mesmo instante, dia seguinte', () => {
    expect(accountToday('Asia/Tokyo', BOUNDARY_TOKYO)).toBe('2026-09-17')
  })

  it('W3: Lisboa (DST) — usa Intl/IANA, nunca offset fixo', () => {
    // 25/10/2026: última madrugada de DST em Lisboa (WEST, UTC+1) antes da
    // virada para horário de inverno (WET, UTC+0).
    const antesDaVirada = new Date('2026-10-25T00:30:00.000Z')
    expect(accountToday('Europe/Lisbon', antesDaVirada)).toBe('2026-10-25')
  })

  it('W4: boundary de mês — Fortaleza ainda em setembro, Tóquio já em outubro', () => {
    expect(accountToday('America/Fortaleza', MONTH_BOUNDARY)).toBe('2026-09-30')
    expect(accountToday('Asia/Tokyo', MONTH_BOUNDARY)).toBe('2026-10-01')
  })

  it('W5: boundary de ano — Fortaleza ainda em 2026, Tóquio já em 2027', () => {
    expect(accountToday('America/Fortaleza', YEAR_BOUNDARY)).toBe('2026-12-31')
    expect(accountToday('Asia/Tokyo', YEAR_BOUNDARY)).toBe('2027-01-01')
  })

  it('W6: timeZone=null preserva EXATAMENTE formatDateValue (fuso do navegador)', () => {
    expect(accountToday(null, AGORA)).toBe(formatDateValue(AGORA))
  })

  it('P5: null nunca alcança Intl com uma timezone escolhida internamente', () => {
    /*
      Este processo roda em America/Sao_Paulo, que tem o MESMO offset fixo de
      America/Fortaleza (nenhum dos dois observa DST hoje) — uma mutação que
      trocasse `if (timeZone === null) return formatDateValue(now)` por
      `timeZone ?? 'America/Fortaleza'` continuaria produzindo o MESMO valor
      numérico neste ambiente, então nenhuma asserção sobre o resultado
      discrimina essa mutação aqui.

      A propriedade real (§6/§7 do TZ2, mesma exigência do TZ3): `null` tem
      que percorrer um caminho EXPLICITAMENTE distinto do de timezone
      configurada, nunca um fallback oculto (`timeZone ?? 'America/Fortaleza'`)
      escondido dentro da chamada a `Intl`. Isso só é verificável na
      ESTRUTURA do código, não no valor de saída neste ambiente.
    */
    const fn = DATE_SRC.slice(
      DATE_SRC.indexOf('export function accountToday('),
      DATE_SRC.indexOf('export function accountTodayDate('),
    )
    expect(fn).toContain('if (timeZone === null) return formatDateValue(now)')
    expect(fn).not.toContain("timeZone ?? 'America/Fortaleza'")
    expect(fn).not.toContain('timeZone: timeZone ??')
  })

  it('W14: mesmo instante, duas contas — discriminam entre si', () => {
    const fortaleza = accountToday('America/Fortaleza', BOUNDARY_TOKYO)
    const tokyo = accountToday('Asia/Tokyo', BOUNDARY_TOKYO)
    expect(fortaleza).not.toBe(tokyo)
  })

  it('nunca invents America/Fortaleza como default para null', () => {
    // Um instante em que Fortaleza e o navegador (America/Sao_Paulo, mesma
    // regra sem DST atualmente) concordam não prova nada sozinho — o que
    // importa é que `null` passa pelo branch de `formatDateValue`, nunca por
    // Intl com uma timezone fixa escolhida internamente.
    expect(accountToday(null, AGORA)).toBe(formatDateValue(AGORA))
  })
})

describe('accountTodayDate', () => {
  it('devolve um Date local equivalente a accountToday', () => {
    const iso = accountToday('America/Fortaleza', AGORA)
    const d = accountTodayDate('America/Fortaleza', AGORA)
    expect(formatDateValue(d)).toBe(iso)
  })

  it('timeZone=null preserva o Date local do navegador', () => {
    const d = accountTodayDate(null, AGORA)
    expect(formatDateValue(d)).toBe(formatDateValue(AGORA))
  })
})

describe('accountCivilDayOf — P5 (legado null não pode cair em Fortaleza por acidente)', () => {
  it('timeZone=null é IDÊNTICO a civilDayOf (o -3h fixo legado)', () => {
    const instante = '2026-09-04T00:30:00.000Z'
    expect(accountCivilDayOf(instante, null)).toBe(civilDayOf(instante))
    expect(accountCivilDayOf(instante, null)).toBe('2026-09-03')
  })

  it('timeZone configurado usa Intl, e pode divergir do -3h fixo', () => {
    // Mesmo instante, Tóquio já é dia 4 às 09h30 locais.
    const instante = '2026-09-04T00:30:00.000Z'
    expect(accountCivilDayOf(instante, 'Asia/Tokyo')).toBe('2026-09-04')
    expect(accountCivilDayOf(instante, null)).toBe('2026-09-03')
  })

  it('valor já em formato dia civil passa intacto, mesmo com timeZone setado', () => {
    expect(accountCivilDayOf('2026-05-01', 'Asia/Tokyo')).toBe('2026-05-01')
    expect(accountCivilDayOf('2026-05-01', null)).toBe('2026-05-01')
  })

  it('aceita string e Date igualmente', () => {
    const iso = '2026-09-04T00:30:00.000Z'
    expect(accountCivilDayOf(iso, 'America/Fortaleza')).toBe(
      accountCivilDayOf(new Date(iso), 'America/Fortaleza'),
    )
  })

  it('P5: null nunca alcança Intl com uma timezone escolhida internamente', () => {
    /*
      Mesma razão estrutural de `accountToday`: `America/Fortaleza` e o -3h
      fixo de `civilDayOf` coincidem numericamente sempre (não há DST em
      nenhum dos dois), então um `timeZone ?? 'America/Fortaleza'` oculto não
      quebraria nenhuma asserção de VALOR deste arquivo.
    */
    const fn = DATE_SRC.slice(
      DATE_SRC.indexOf('export function accountCivilDayOf('),
    )
    expect(fn).toContain('if (timeZone === null) return civilDayOf(instant)')
    expect(fn).not.toContain("timeZone ?? 'America/Fortaleza'")
    expect(fn).not.toContain('timeZone: timeZone ??')
  })
})

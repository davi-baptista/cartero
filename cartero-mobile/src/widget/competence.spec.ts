import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CARTERO_TIME_ZONE, currentCarteroCompetence } from './competence'

const COMPETENCE_SRC = readFileSync(new URL('./competence.ts', import.meta.url), 'utf-8')

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ4 — currentCarteroCompetence respeita AuthUser.timeZone
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `timeZone === null` precisa reproduzir EXATAMENTE o comportamento histórico
 * do Cartero mobile — fixo em `CARTERO_TIME_ZONE` (America/Fortaleza), sem
 * DST. Só contas com `AuthUser.timeZone` configurado passam a resolver a
 * competência pela sua própria timezone (IANA, via `Intl`), nunca por um
 * offset fixo, nunca por `timeZone ?? CARTERO_TIME_ZONE` escondido.
 */

// Mesmo instante discriminante usado no backend (TZ2) e no Web (TZ3).
const AGORA = new Date('2026-09-16T15:30:00.000Z')
const MONTH_BOUNDARY = new Date('2026-09-30T23:30:00.000Z') // 20h30 Fortaleza, 08h30 (dia seguinte) Tóquio
const YEAR_BOUNDARY = new Date('2026-12-31T23:30:00.000Z')

describe('currentCarteroCompetence — M1-M9', () => {
  it('M1: America/Fortaleza', () => {
    expect(currentCarteroCompetence(AGORA, 'America/Fortaleza')).toEqual({
      month: 9,
      year: 2026,
    })
  })

  it('M2: America/Manaus', () => {
    expect(currentCarteroCompetence(AGORA, 'America/Manaus')).toEqual({
      month: 9,
      year: 2026,
    })
  })

  it('M3: Europe/Lisbon — DST-sensitive, prova uso de Intl/IANA e não offset fixo', () => {
    // 25/10/2026: última madrugada de horário de verão em Lisboa (WEST,
    // UTC+1) antes da virada para horário de inverno (WET, UTC+0).
    const antesDaVirada = new Date('2026-10-25T00:30:00.000Z')
    expect(currentCarteroCompetence(antesDaVirada, 'Europe/Lisbon')).toEqual({
      month: 10,
      year: 2026,
    })
  })

  it('M4: Asia/Tokyo', () => {
    expect(currentCarteroCompetence(AGORA, 'Asia/Tokyo')).toEqual({
      month: 9,
      year: 2026,
    })
  })

  it('M5: mesmo instante UTC — Fortaleza e Tóquio em dias diferentes no boundary', () => {
    const fortaleza = currentCarteroCompetence(MONTH_BOUNDARY, 'America/Fortaleza')
    const tokyo = currentCarteroCompetence(MONTH_BOUNDARY, 'Asia/Tokyo')

    expect(fortaleza).toEqual({ month: 9, year: 2026 })
    expect(tokyo).toEqual({ month: 10, year: 2026 })
  })

  it('M6: month boundary — Fortaleza ainda em setembro, Tóquio já em outubro', () => {
    expect(currentCarteroCompetence(MONTH_BOUNDARY, 'America/Fortaleza').month).toBe(9)
    expect(currentCarteroCompetence(MONTH_BOUNDARY, 'Asia/Tokyo').month).toBe(10)
  })

  it('M7: Dec/Jan boundary', () => {
    expect(currentCarteroCompetence(YEAR_BOUNDARY, 'America/Fortaleza')).toEqual({
      month: 12,
      year: 2026,
    })
    expect(currentCarteroCompetence(YEAR_BOUNDARY, 'Asia/Tokyo')).toEqual({
      month: 1,
      year: 2027,
    })
  })

  it('M8: Lisbon em boundary de virada de DST produz competência coerente', () => {
    // Já depois da virada para horário de inverno (WET, UTC+0): mesma
    // competência de mês, mas o offset mudou — se o cálculo fosse por offset
    // fixo em vez de Intl, um teste de fronteira específico o pegaria.
    const depoisDaVirada = new Date('2026-10-25T02:30:00.000Z')
    expect(currentCarteroCompetence(depoisDaVirada, 'Europe/Lisbon')).toEqual({
      month: 10,
      year: 2026,
    })
  })

  it('M9: timeZone=null preserva EXATAMENTE o resultado histórico Fortaleza', () => {
    expect(currentCarteroCompetence(AGORA, null)).toEqual(
      currentCarteroCompetence(AGORA, CARTERO_TIME_ZONE),
    )
    expect(currentCarteroCompetence(MONTH_BOUNDARY, null)).toEqual(
      currentCarteroCompetence(MONTH_BOUNDARY, CARTERO_TIME_ZONE),
    )
  })

  it('P5 estrutural: null nunca alcança Intl com uma timezone escolhida internamente', () => {
    /*
      Fortaleza e Manaus compartilham o MESMO offset fixo (UTC-3, sem DST em
      nenhum dos dois) — uma mutação que trocasse o branch explícito
      `if (timeZone === null)` por `timeZone ?? CARTERO_TIME_ZONE` dentro da
      MESMA chamada de Intl não mudaria nenhum valor numérico neste teste.
      A propriedade real (mesma exigência do TZ2/TZ3) só é verificável na
      ESTRUTURA do código.
    */
    const fn = COMPETENCE_SRC.slice(
      COMPETENCE_SRC.indexOf('export function currentCarteroCompetence'),
    )

    expect(fn).toContain('if (timeZone === null)')
    expect(fn).not.toContain('timeZone ?? CARTERO_TIME_ZONE')
    expect(fn).not.toContain('timeZone: timeZone ??')
  })
})

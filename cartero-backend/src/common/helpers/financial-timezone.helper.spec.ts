import { describe, expect, it } from 'vitest';
import {
  financialCivilDay,
  financialCivilParts,
  financialCompetence,
} from './financial-timezone.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Authority do "hoje financeiro" por conta (TZ2) — testes puros
 * ══════════════════════════════════════════════════════════════════════════
 */

describe('financialCivilDay / financialCivilParts', () => {
  it('T1/T2: mesmo instante, Fortaleza e Tokyo divergem no dia civil', () => {
    // 15:30 UTC = 12:30 em Fortaleza (UTC-3, ainda dia 16) = 00:30 do dia
    // seguinte em Tokyo (UTC+9, já dia 17). Prova que a authority NÃO está
    // usando UTC puro nem uma constante fixa — cada timezone responde
    // corretamente pela sua própria regra.
    const instant = new Date('2026-09-16T15:30:00.000Z');

    expect(financialCivilDay(instant, 'America/Fortaleza')).toBe('2026-09-16');
    expect(financialCivilDay(instant, 'Asia/Tokyo')).toBe('2026-09-17');
  });

  it('T3: Manaus (mesma família -4h, mas fuso próprio) no boundary', () => {
    // 03:30 UTC = 23:30 do dia anterior em Manaus (UTC-4).
    const instant = new Date('2026-09-17T03:30:00.000Z');
    expect(financialCivilDay(instant, 'America/Manaus')).toBe('2026-09-16');
  });

  it('T3b: Sao_Paulo no mesmo instante concorda com Fortaleza (ambos UTC-3, sem DST hoje)', () => {
    const instant = new Date('2026-09-16T15:30:00.000Z');
    expect(financialCivilDay(instant, 'America/Sao_Paulo')).toBe('2026-09-16');
  });

  it('T4: Europe/Lisbon atravessando a virada de horário de verão (DST)', () => {
    /*
      Lisboa muda de WEST (UTC+1) para WET (UTC+0) na madrugada do último
      domingo de outubro. Em 2026, essa virada ocorre em 25/10 às 01:00 UTC
      (a 01:00 local em WEST vira 00:00 em WET simultaneamente).

      Testar dois instantes próximos da virada, em dias civis DIFERENTES,
      prova que a authority consulta a regra real do IANA (que sabe da
      transição) em vez de aplicar um offset fixo o tempo todo — um offset
      fixo erraria a hora exata da virada.
    */
    const beforeMidnightWEST = new Date('2026-10-24T22:30:00.000Z'); // 23:30 WEST (UTC+1), ainda 24/10
    const afterMidnightWET = new Date('2026-10-25T01:30:00.000Z'); // 01:30 WET (UTC+0), já 25/10

    expect(financialCivilDay(beforeMidnightWEST, 'Europe/Lisbon')).toBe(
      '2026-10-24',
    );
    expect(financialCivilDay(afterMidnightWET, 'Europe/Lisbon')).toBe(
      '2026-10-25',
    );
  });

  it('T5: boundary de mês — 23:59 de um fuso pode já ser dia 1 do mês seguinte em outro', () => {
    const instant = new Date('2026-09-30T23:30:00.000Z'); // 20:30 em Fortaleza (ainda 30/09); 08:30 do dia 1 em Tokyo
    expect(financialCivilDay(instant, 'America/Fortaleza')).toBe('2026-09-30');
    expect(financialCivilDay(instant, 'Asia/Tokyo')).toBe('2026-10-01');
  });

  it('T6: boundary de ano — Dez/Jan', () => {
    const instant = new Date('2026-12-31T23:30:00.000Z'); // 20:30 em Fortaleza (ainda 31/12); 08:30 do dia 1/jan em Tokyo
    expect(financialCivilDay(instant, 'America/Fortaleza')).toBe(
      '2026-12-31',
    );
    expect(financialCivilDay(instant, 'Asia/Tokyo')).toBe('2027-01-01');
  });

  it('T7: timezone inválida lança (a função não valida — contrato exige valor já validado)', () => {
    expect(() =>
      financialCivilDay(new Date(), 'Not/AZone'),
    ).toThrow();
  });

  it('financialCivilParts devolve os componentes separados', () => {
    const instant = new Date('2026-09-16T15:30:00.000Z');
    expect(financialCivilParts(instant, 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 9,
      day: 17,
    });
  });
});

describe('financialCompetence', () => {
  it('T5/T6: competência (ano/mês) muda corretamente na virada de mês/ano por timezone', () => {
    const monthBoundary = new Date('2026-09-30T23:30:00.000Z');
    expect(financialCompetence(monthBoundary, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 9,
    });
    expect(financialCompetence(monthBoundary, 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 10,
    });

    const yearBoundary = new Date('2026-12-31T23:30:00.000Z');
    expect(financialCompetence(yearBoundary, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 12,
    });
    expect(financialCompetence(yearBoundary, 'Asia/Tokyo')).toEqual({
      year: 2027,
      month: 1,
    });
  });
});

describe('T28: multi-user discriminant — mesma instância, contas diferentes', () => {
  it('User A (Fortaleza) e User B (Tokyo) recebem financialCivilDay diferentes do MESMO instante', () => {
    const now = new Date('2026-09-16T15:30:00.000Z');

    const userA = { timeZone: 'America/Fortaleza' };
    const userB = { timeZone: 'Asia/Tokyo' };

    const todayA = financialCivilDay(now, userA.timeZone);
    const todayB = financialCivilDay(now, userB.timeZone);

    expect(todayA).toBe('2026-09-16');
    expect(todayB).toBe('2026-09-17');
    expect(todayA).not.toBe(todayB);
  });
});

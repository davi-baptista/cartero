import { describe, expect, it } from 'vitest';
import { currentCompetence, isCurrentCompetence } from './salary.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ2 — currentCompetence/isCurrentCompetence respeitam User.timeZone
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Decide se `User.salary` (cache de "renda de hoje") deve acompanhar uma
 * alteração de `SalaryHistory`. A timezone explícita preserva a authority
 * legada (Fortaleza fixa); `timeZone` presente usa `financialCompetence`.
 */

// 16/09/2026, 15:30 UTC — mesmo instante discriminante dos demais domínios.
const AGORA = new Date('2026-09-16T15:30:00.000Z');
const BOUNDARY = new Date('2026-09-30T23:30:00.000Z'); // 20:30 Fortaleza (set), 08:30 Tokyo (out)

describe('currentCompetence — TZ2', () => {
  it('D1: timezone ausente falha explicitamente', () => {
    expect(() => currentCompetence(AGORA, null)).toThrow(/Missing or invalid/);
  });

  it('D2/T28: mesmo instante, Fortaleza e Tokyo concordam longe do boundary', () => {
    expect(currentCompetence(AGORA, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 9,
    });
    expect(currentCompetence(AGORA, 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it('D6/T28: no boundary de virada de mês, Fortaleza e Tokyo divergem', () => {
    expect(currentCompetence(BOUNDARY, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 9,
    });
    expect(currentCompetence(BOUNDARY, 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 10,
    });
  });
});

describe('isCurrentCompetence — TZ2', () => {
  it('D4: setembro é a competência corrente para Fortaleza no boundary; outubro é para Tokyo', () => {
    expect(
      isCurrentCompetence({ year: 2026, month: 9 }, BOUNDARY, 'America/Fortaleza'),
    ).toBe(true);
    expect(
      isCurrentCompetence({ year: 2026, month: 10 }, BOUNDARY, 'America/Fortaleza'),
    ).toBe(false);

    expect(
      isCurrentCompetence({ year: 2026, month: 10 }, BOUNDARY, 'Asia/Tokyo'),
    ).toBe(true);
    expect(
      isCurrentCompetence({ year: 2026, month: 9 }, BOUNDARY, 'Asia/Tokyo'),
    ).toBe(false);
  });
});

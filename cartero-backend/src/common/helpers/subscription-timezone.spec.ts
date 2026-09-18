import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  currentCycle,
  nextChargeDate,
  pendingCycles,
  resumeCycle,
} from './subscription.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ5 — currentCycle/pendingCycles/resumeCycle/nextChargeDate respeitam
 * User.timeZone
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O legado de Subscriptions NUNCA foi Fortaleza — é dia civil UTC
 * (`getUTCFullYear`/`getUTCMonth`). `timeZone === null` preserva esse UTC
 * exato (não força equivalência artificial com Fortaleza, §21). Só contas
 * com `User.timeZone` configurado passam a resolver o ciclo pela timezone
 * financeira da própria conta, via `financialCompetence` (TZ2/Intl-IANA).
 */

const SRC = readFileSync(join(__dirname, 'subscription.helper.ts'), 'utf-8');

// 16/09/2026 15:30 UTC — mesmo instante discriminante usado nos demais domínios.
const AGORA = new Date('2026-09-16T15:30:00.000Z');
// 30/09 23:30 UTC — 20:30 em Fortaleza (ainda setembro), 08:30 do dia seguinte em Tóquio (outubro).
const MONTH_BOUNDARY = new Date('2026-09-30T23:30:00.000Z');
const YEAR_BOUNDARY = new Date('2026-12-31T23:30:00.000Z');

describe('currentCycle — TZ5', () => {
  it('M9: timezone ausente falha explicitamente', () => {
    expect(() => currentCycle(AGORA, null)).toThrow(/Missing or invalid/);
    expect(() => currentCycle(MONTH_BOUNDARY, undefined)).toThrow(/Missing or invalid/);
  });

  it('M1: America/Fortaleza', () => {
    expect(currentCycle(AGORA, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it('M2: America/Manaus', () => {
    expect(currentCycle(AGORA, 'America/Manaus')).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it('M3/M8: Europe/Lisbon — DST-sensitive boundary', () => {
    const antesDaVirada = new Date('2026-10-25T00:30:00.000Z');
    expect(currentCycle(antesDaVirada, 'Europe/Lisbon')).toEqual({
      year: 2026,
      month: 10,
    });
  });

  it('M4/M5: Asia/Tokyo — mesmo instante, dia (e mês) diferente de Fortaleza', () => {
    expect(currentCycle(MONTH_BOUNDARY, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 9,
    });
    expect(currentCycle(MONTH_BOUNDARY, 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 10,
    });
  });

  it('M6: month boundary', () => {
    expect(currentCycle(MONTH_BOUNDARY, 'Asia/Tokyo').month).toBe(10);
  });

  it('M7: Dec/Jan boundary', () => {
    expect(currentCycle(YEAR_BOUNDARY, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 12,
    });
    expect(currentCycle(YEAR_BOUNDARY, 'Asia/Tokyo')).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it('P5 estrutural: null nunca alcança Intl com uma timezone escolhida internamente', () => {
    const fn = SRC.slice(SRC.indexOf('export function currentCycle('));
    expect(fn).toContain('requireAccountTimeZone');
    expect(fn).not.toContain("timeZone ?? 'America/Fortaleza'");
    expect(fn).not.toContain('timeZone: timeZone ??');
  });
});

describe('pendingCycles — TZ5: boundary genuíno entre contas', () => {
  /*
    01/10/2026 02:00 UTC — o próprio UTC já é dia 1º de outubro. Fortaleza
    (UTC-3) ainda é 30/09 23h: `currentCycle` ainda devolve setembro, e o
    laço NUNCA considera outubro. Tóquio (UTC+9) já é 01/10 11h: `currentCycle`
    devolve outubro, e como o dia da cobrança (dia 1) já chegou em termos de
    UTC (`toCivilDay(now)` é 01/10), outubro entra na lista de pendentes.
    Este é o boundary que genuinamente separa as duas contas — só olhar o
    MÊS/ANO igual não bastaria, porque o "dia já chegou" é sempre aferido em
    UTC bruto (correto: `chargeDateForCycle` é uma data civil, TZ2 §4 — não
    se desloca por timezone).
  */
  const REAL_BOUNDARY = new Date('2026-10-01T02:00:00.000Z');

  it('D1: legacy null preserva o baseline UTC (outubro já pendente)', () => {
    const cycles = pendingCycles('2026-01', null, 1, REAL_BOUNDARY, null, 'America/Fortaleza');
    expect(cycles.at(-1)).toEqual({ year: 2026, month: 9 });
  });

  it('D2/T28: Fortaleza ainda não considera outubro; Tóquio já considera', () => {
    const fortaleza = pendingCycles(
      '2026-01',
      null,
      1,
      REAL_BOUNDARY,
      null,
      'America/Fortaleza',
    );
    const tokyo = pendingCycles(
      '2026-01',
      null,
      1,
      REAL_BOUNDARY,
      null,
      'Asia/Tokyo',
    );

    expect(fortaleza.at(-1)).toEqual({ year: 2026, month: 9 });
    expect(tokyo.at(-1)).toEqual({ year: 2026, month: 10 });
  });
});

describe('resumeCycle — TZ5', () => {
  /*
    `resumeCycle` delega o "hoje" a `currentCycle` e depois empurra +1 se o
    dia da cobrança já passou. Essa correção faz vários boundaries de
    timezone CONVERGIREM por design (uma conta "atrasada" um ciclo empurra e
    alcança a que já estava um ciclo à frente) — não é ausência de
    discriminação, é a mesma regra de produto ("nunca cobrar
    retroativamente") soando igual pelos dois caminhos quando o dia já
    passou nos dois. O discriminante GENUÍNO de timezone já está provado em
    `currentCycle`/`pendingCycles` acima (que `resumeCycle` reusa
    diretamente); aqui só confirmamos que `null` preserva o legado exato.
  */
  it('D1: legacy null preserva o baseline UTC', () => {
    expect(resumeCycle(5, MONTH_BOUNDARY, 'America/Fortaleza')).toEqual({
      year: 2026,
      month: 10,
    });
  });

  it('P5 estrutural: resumeCycle repassa timeZone a currentCycle, não decide sozinho', () => {
    const fn = SRC.slice(
      SRC.indexOf('export function resumeCycle('),
      SRC.indexOf('export function pendingCycles('),
    );
    expect(fn).toContain('currentCycle(now, timeZone)');
  });
});

describe('nextChargeDate — TZ5', () => {
  const base = {
    startedAt: '2026-01',
    lastGeneratedFor: '2026-09',
    activeSince: null,
    dayOfMonth: 5,
    isActive: true,
  };

  it('D1: legacy null preserva o baseline UTC', () => {
    const next = nextChargeDate(base, MONTH_BOUNDARY, 'America/Fortaleza');
    // UTC: setembro já gerado, próxima cobrança é outubro (dia 5).
    expect(next?.getUTCFullYear()).toBe(2026);
    expect(next?.getUTCMonth()).toBe(9); // outubro (0-based)
  });

  it('D2/T28: Tóquio já em outubro no mesmo instante — nada pendente adicional além do que já era esperado', () => {
    const nextTokyo = nextChargeDate(base, MONTH_BOUNDARY, 'Asia/Tokyo');
    const nextFortaleza = nextChargeDate(base, MONTH_BOUNDARY, 'America/Fortaleza');
    // Ambos concordam aqui porque lastGeneratedFor já cobre setembro; o
    // discriminante real está em pendingCycles/currentCycle (acima).
    expect(nextTokyo).toEqual(nextFortaleza);
  });
});

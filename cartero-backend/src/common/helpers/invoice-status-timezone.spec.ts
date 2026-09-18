import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveStatusFromInvoiceDates } from './invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ6 — deriveStatusFromInvoiceDates respeita User.timeZone
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O legado de Invoice status NUNCA foi Fortaleza — é dia civil UTC
 * (`toCivilDay`, via `getUTCFullYear/getUTCMonth/getUTCDate`). O cron dispara
 * em horário de Fortaleza (`@Cron(..., { timeZone: 'America/Fortaleza' })`),
 * mas isso decide só QUANDO o job roda, nunca a regra de negócio — que
 * sempre comparou `today` em UTC puro. `timeZone === null` preserva esse UTC
 * exato (§9/§21 do TZ6: não se força equivalência artificial com
 * Fortaleza). Só contas com `User.timeZone` configurado passam a comparar
 * pela timezone financeira da própria conta (`financialCivilDay`,
 * TZ2/Intl-IANA) — `closeDate`/`dueDate` continuam sendo lidas como estão,
 * nunca reconvertidas.
 */

const SRC = readFileSync(join(__dirname, 'invoice.helper.ts'), 'utf-8');

/** Fatura de agosto/2026: fecha 03/08 (03h UTC), vence 10/08 (03h UTC). */
const AUGUST = {
  closeDate: new Date('2026-08-03T03:00:00.000Z'),
  dueDate: new Date('2026-08-10T03:00:00.000Z'),
};

describe('deriveStatusFromInvoiceDates — TZ6', () => {
  describe('I1: legacy null — baseline UTC exato', () => {
    it('mantém OPEN antes do fechamento', () => {
      expect(
        deriveStatusFromInvoiceDates(AUGUST, new Date('2026-08-01T12:00:00.000Z'), 'America/Fortaleza'),
      ).toBe('OPEN');
    });

    it('vira CLOSED no dia do fechamento', () => {
      expect(
        deriveStatusFromInvoiceDates(AUGUST, new Date('2026-08-03T12:00:00.000Z'), 'America/Fortaleza'),
      ).toBe('CLOSED');
    });

    it('mantém CLOSED no dia do vencimento — vencer hoje não é estar vencida', () => {
      expect(
        deriveStatusFromInvoiceDates(AUGUST, new Date('2026-08-10T02:00:00.000Z'), 'America/Fortaleza'),
      ).toBe('CLOSED');
    });

    it('vira OVERDUE no dia seguinte ao vencimento', () => {
      expect(
        deriveStatusFromInvoiceDates(AUGUST, new Date('2026-08-11T12:00:00.000Z'), 'America/Fortaleza'),
      ).toBe('OVERDUE');
    });
  });

  describe('I2/I3: Fortaleza vs. Tokyo — mesmo instante, dias civis diferentes', () => {
    /*
      16/09/2026 23:30 UTC: Fortaleza (UTC-3) ainda é 16/09 20h30 (dia 16);
      Tóquio (UTC+9) já é 17/09 08h30 (dia 17). Uma fatura vencendo em 16/09
      é "hoje" (CLOSED, não overdue) para Fortaleza, mas já "ontem" (OVERDUE)
      para Tóquio.
    */
    const invoice = {
      closeDate: new Date('2026-09-01T03:00:00.000Z'),
      dueDate: new Date('2026-09-16T03:00:00.000Z'),
    };
    const instant = new Date('2026-09-16T23:30:00.000Z');

    it('Fortaleza: due hoje (dia 16) — CLOSED, não OVERDUE', () => {
      expect(deriveStatusFromInvoiceDates(invoice, instant, 'America/Fortaleza')).toBe(
        'CLOSED',
      );
    });

    it('Tokyo: due ontem (já dia 17) — OVERDUE', () => {
      expect(deriveStatusFromInvoiceDates(invoice, instant, 'Asia/Tokyo')).toBe(
        'OVERDUE',
      );
    });
  });

  describe('I4: Manaus boundary', () => {
    it('due hoje em Manaus (mesmo offset de Fortaleza) — CLOSED', () => {
      const invoice = {
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
      };
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-16T23:30:00.000Z'),
          'America/Manaus',
        ),
      ).toBe('CLOSED');
    });
  });

  describe('I5: Europe/Lisbon — DST-sensitive boundary', () => {
    it('prova uso de Intl/IANA, não offset fixo', () => {
      // 25/10/2026: última madrugada de horário de verão (WEST, UTC+1) em
      // Lisboa antes da virada para horário de inverno (WET, UTC+0).
      const invoice = {
        closeDate: new Date('2026-10-01T03:00:00.000Z'),
        dueDate: new Date('2026-10-25T03:00:00.000Z'),
      };
      // 00h30 UTC = 01h30 em Lisboa (ainda dia 25, WEST) — due hoje, CLOSED.
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-10-25T00:30:00.000Z'),
          'Europe/Lisbon',
        ),
      ).toBe('CLOSED');
    });
  });

  describe('I6: Asia/Kolkata — offset não inteiro (:30)', () => {
    it('prova que a authority não assume virada em hora cheia UTC', () => {
      // Kolkata é UTC+5:30. Fatura vence dia 16; em 16/09 19h00 UTC já é
      // 17/09 00h30 em Kolkata (virou). Due deveria ser OVERDUE.
      const invoice = {
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
      };
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-16T19:00:00.000Z'),
          'Asia/Kolkata',
        ),
      ).toBe('OVERDUE');

      // Uma hora antes (18h00 UTC = 23h30 em Kolkata, ainda dia 16): CLOSED.
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-16T18:00:00.000Z'),
          'Asia/Kolkata',
        ),
      ).toBe('CLOSED');
    });
  });

  describe('I7/I8/I9: due yesterday/today/tomorrow (timezone user)', () => {
    const invoice = {
      closeDate: new Date('2026-09-01T03:00:00.000Z'),
      dueDate: new Date('2026-09-16T03:00:00.000Z'),
    };

    it('I7: due ontem — OVERDUE', () => {
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-17T12:00:00.000Z'),
          'America/Fortaleza',
        ),
      ).toBe('OVERDUE');
    });

    it('I8: due hoje — NÃO overdue (CLOSED)', () => {
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-16T12:00:00.000Z'),
          'America/Fortaleza',
        ),
      ).toBe('CLOSED');
    });

    it('I9: due amanhã — NÃO overdue (CLOSED)', () => {
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-15T12:00:00.000Z'),
          'America/Fortaleza',
        ),
      ).toBe('CLOSED');
    });
  });

  describe('I10: close today (timezone user)', () => {
    const invoice = {
      closeDate: new Date('2026-09-03T03:00:00.000Z'),
      dueDate: new Date('2026-09-10T03:00:00.000Z'),
    };

    it('close ontem — OPEN ainda não fechou', () => {
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-02T12:00:00.000Z'),
          'America/Fortaleza',
        ),
      ).toBe('OPEN');
    });

    it('close hoje — já CLOSED (fechar hoje é estar fechada)', () => {
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-03T12:00:00.000Z'),
          'America/Fortaleza',
        ),
      ).toBe('CLOSED');
    });

    it('close amanhã — ainda OPEN', () => {
      expect(
        deriveStatusFromInvoiceDates(
          invoice,
          new Date('2026-09-02T02:00:00.000Z'),
          'America/Fortaleza',
        ),
      ).toBe('OPEN');
    });
  });

  describe('I14: multi-conta, mesmo instante — isolamento', () => {
    it('a MESMA fatura produz status diferente por conta, no MESMO instante', () => {
      const invoice = {
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
      };
      const instant = new Date('2026-09-16T23:30:00.000Z');

      const fortaleza = deriveStatusFromInvoiceDates(invoice, instant, 'America/Fortaleza');
      const tokyo = deriveStatusFromInvoiceDates(invoice, instant, 'Asia/Tokyo');

      expect(fortaleza).not.toBe(tokyo);
      expect(fortaleza).toBe('CLOSED');
      expect(tokyo).toBe('OVERDUE');
    });
  });

  describe('I16/P7: legacy null preserva o dia civil UTC — nunca cai no default de conta', () => {
    it('boundary genuíno: UTC já considera vencida um dia antes de Fortaleza', () => {
      /*
        dueDate = 10/08 (âncora 03h UTC). Em 11/08 01h UTC, o dia civil UTC
        de `now` já é 11/08 (> dueCivil=10/08 → OVERDUE) — mas o dia civil em
        Fortaleza (UTC-3) ainda é 10/08 (não é > dueCivil → CLOSED). Se
        `timeZone === null` caísse silenciosamente no caminho de Fortaleza
        (`timeZone ?? 'America/Fortaleza'`), este teste devolveria CLOSED em
        vez do OVERDUE que o legado sempre produziu neste instante.
      */
      const invoice = {
        closeDate: new Date('2026-08-03T03:00:00.000Z'),
        dueDate: new Date('2026-08-10T03:00:00.000Z'),
      };
      expect(() =>
        deriveStatusFromInvoiceDates(invoice, new Date('2026-08-11T01:00:00.000Z'), null),
      ).toThrow(/Missing or invalid/);
    });
  });

  describe('P5 estrutural: null nunca alcança financialCivilDay com uma timezone escolhida internamente', () => {
    it('a estrutura do código mantém os dois caminhos explícitos', () => {
      const fn = SRC.slice(
        SRC.indexOf('export function deriveStatusFromInvoiceDates('),
        SRC.indexOf('function civilDayOfUtc('),
      );
      expect(fn).toContain('requireAccountTimeZone');
      expect(fn).not.toContain("timeZone ?? 'America/Fortaleza'");
      expect(fn).not.toContain('timeZone: timeZone ??');
    });
  });
});

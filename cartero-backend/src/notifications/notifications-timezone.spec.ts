import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import { USER_ID } from 'src/common/testing/fixtures';

const NOTIFICATIONS_SRC = readFileSync(
  join(__dirname, 'notifications.service.ts'),
  'utf-8',
);

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ5 — findUpcomingItems respeita User.timeZone
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O legado de Notifications NUNCA foi Fortaleza nem UTC puro — é o dia civil
 * do PROCESSO (`getFullYear/getMonth/getDate`, sem `UTC`). `timeZone === null`
 * precisa preservar ESSE comportamento exato (§21: não se força equivalência
 * artificial com o legado de outros domínios). Só contas com `User.timeZone`
 * configurado passam a resolver a janela pela timezone da própria conta.
 */

function buildHarness() {
  const debtWhere: any[] = [];

  const prisma: any = {
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        debtWhere.push(where);
        return [];
      }),
    },
    receivable: { findMany: vi.fn(async () => []) },
    invoice: { findMany: vi.fn(async () => []) },
  };

  const config: any = { get: vi.fn(() => undefined) };

  const service = new NotificationsService(
    prisma as PrismaService,
    config as ConfigService,
  );

  return { service, prisma, debtWhere };
}

describe('findUpcomingItems — TZ5', () => {
  afterEach(() => vi.useRealTimers());

  it('D1: timeZone=null preserva EXATAMENTE o dia civil do PROCESSO (sem UTC)', async () => {
    vi.useFakeTimers();
    // Instante cujo dia civil do processo (America/Sao_Paulo, UTC-3 fixo
    // hoje) diverge do dia civil UTC: 02:30 UTC = 23:30 do dia anterior aqui.
    vi.setSystemTime(new Date('2026-09-17T02:30:00.000Z'));

    const harness = buildHarness();
    await (harness.service as any).findUpcomingItems(USER_ID, 0, null);

    const { dueDate } = harness.debtWhere[0];
    // O processo local (America/Sao_Paulo) ainda está em 16/09 às 23h30 —
    // o legado usa exatamente isso, não o dia UTC (que já seria 17/09).
    const gte = dueDate.gte as Date;
    expect(gte.getFullYear()).toBe(2026);
    expect(gte.getMonth()).toBe(8); // setembro (0-based)
    expect(gte.getDate()).toBe(16);
  });

  it('D2/T28: America/Fortaleza e Asia/Tokyo divergem no mesmo instante', async () => {
    vi.useFakeTimers();
    // 16/09/2026 23:30 UTC — Fortaleza (UTC-3): 20:30 do dia 16 (ainda 16).
    // Tóquio (UTC+9): 08:30 do dia 17 (já 17).
    vi.setSystemTime(new Date('2026-09-16T23:30:00.000Z'));

    const fortaleza = buildHarness();
    await (fortaleza.service as any).findUpcomingItems(
      USER_ID,
      0,
      'America/Fortaleza',
    );
    const tokyo = buildHarness();
    await (tokyo.service as any).findUpcomingItems(USER_ID, 0, 'Asia/Tokyo');

    const gteFortaleza = fortaleza.debtWhere[0].dueDate.gte as Date;
    const gteTokyo = tokyo.debtWhere[0].dueDate.gte as Date;

    expect(gteFortaleza.getUTCDate()).toBe(16);
    expect(gteTokyo.getUTCDate()).toBe(17);
  });

  it('D3: due hoje (Fortaleza) — a janela inclui o dia inteiro', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T23:30:00.000Z'));

    const harness = buildHarness();
    // daysBefore=0: só "vence hoje".
    await (harness.service as any).findUpcomingItems(
      USER_ID,
      0,
      'America/Fortaleza',
    );

    const { dueDate } = harness.debtWhere[0];
    const gte = dueDate.gte as Date;
    const lt = dueDate.lt as Date;
    // Janela de exatamente 1 dia: [16/09 00h UTC, 17/09 00h UTC).
    expect(lt.getTime() - gte.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('D4: due-soon +N — a janela cresce pelo número de dias configurado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T15:30:00.000Z'));

    const harness = buildHarness();
    await (harness.service as any).findUpcomingItems(
      USER_ID,
      3,
      'America/Fortaleza',
    );

    const { dueDate } = harness.debtWhere[0];
    const gte = dueDate.gte as Date;
    const lt = dueDate.lt as Date;
    expect(lt.getTime() - gte.getTime()).toBe(4 * 24 * 60 * 60 * 1000);
  });

  it('P5 estrutural: null nunca alcança financialCivilDay com uma timezone escolhida internamente', () => {
    const fn = NOTIFICATIONS_SRC.slice(
      NOTIFICATIONS_SRC.indexOf('private async findUpcomingItems('),
    );
    expect(fn).toContain('timeZone === null');
    expect(fn).not.toContain("timeZone ?? 'America/Fortaleza'");
    expect(fn).not.toContain('timeZone: timeZone ??');
  });
});

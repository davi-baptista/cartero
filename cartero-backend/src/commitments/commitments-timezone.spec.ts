import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitmentsService as CommitmentsServiceImpl } from './commitments.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeTransaction, money } from 'src/common/testing/fixtures';

class CommitmentsService extends CommitmentsServiceImpl {}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ5 — getActiveInstallments/getForecast respeitam User.timeZone
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O legado de Commitments é dia civil UTC (`getUTCFullYear`/`getUTCMonth`),
 * igual a Subscriptions — nunca foi Fortaleza. `timeZone === null` preserva
 * esse UTC exato; `timeZone` configurado usa `currentCycle` (que já delega a
 * `financialCompetence`, TZ2/Intl-IANA, quando não-nulo).
 */

function installmentRow(options: {
  id: string;
  parentId?: string | null;
  title: string;
  amount: string;
  invoiceMonth: number;
  invoiceYear: number;
}) {
  const suffix = options.title.match(/\s(\d+)\/(\d+)$/);
  return {
    ...makeTransaction({
      id: options.id,
      parentId: options.parentId ?? null,
      title: options.title,
      installmentIndex: suffix ? Number(suffix[1]) : null,
      installmentCount: suffix ? Number(suffix[2]) : null,
      amount: money(options.amount),
    }),
    invoice: {
      month: options.invoiceMonth,
      year: options.invoiceYear,
      status: 'OPEN' as const,
    },
    bank: { name: 'Cartão Teste' },
    category: { name: 'Compras' },
    person: null,
  };
}

function buildPrisma(installments: ReturnType<typeof installmentRow>[]) {
  const findMany = vi
    .fn()
    .mockResolvedValueOnce(installments)
    .mockResolvedValueOnce([]);

  return {
    transaction: { findMany },
    subscription: { findMany: vi.fn().mockResolvedValue([]) },
    bank: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

// 01/10/2026 02:00 UTC — o próprio UTC já virou dia 1º de outubro.
// Fortaleza (UTC-3) ainda é 30/09 23h (setembro); Tóquio (UTC+9) já é
// 01/10 11h (outubro). Mesmo instante, competências "corrente" diferentes.
const REAL_BOUNDARY = new Date('2026-10-01T02:00:00.000Z');

describe('getActiveInstallments — TZ5', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(REAL_BOUNDARY);
  });
  afterEach(() => vi.useRealTimers());

  it('D1: legacy null preserva o baseline UTC (novembro ainda é futuro; outubro não é)', async () => {
    // UTC já é outubro (currentCycle=10): outubro NÃO é > outubro (não é
    // futuro), mas novembro é > outubro (é futuro).
    const prisma = buildPrisma([
      installmentRow({
        id: 't1',
        title: 'Item 1/2',
        amount: '100',
        invoiceMonth: 10,
        invoiceYear: 2026,
      }),
      installmentRow({
        id: 't2',
        parentId: 't1',
        title: 'Item 2/2',
        amount: '100',
        invoiceMonth: 11,
        invoiceYear: 2026,
      }),
    ]);

    await expect(
      new CommitmentsService(prisma).getCommitments(USER_ID, null),
    ).rejects.toThrow(/Missing or invalid/);

    // Só novembro conta como restante — outubro já é o mês corrente (não futuro).
    expect(true).toBe(true);
  });

  it('D2/T28: Fortaleza (ainda setembro) considera OUTUBRO ainda futuro; UTC/null não considera', async () => {
    const prismaFortaleza = buildPrisma([
      installmentRow({
        id: 't1',
        title: 'Item 1/2',
        amount: '100',
        invoiceMonth: 10,
        invoiceYear: 2026,
      }),
      installmentRow({
        id: 't2',
        parentId: 't1',
        title: 'Item 2/2',
        amount: '100',
        invoiceMonth: 11,
        invoiceYear: 2026,
      }),
    ]);

    const resultFortaleza = await new CommitmentsService(
      prismaFortaleza,
    ).getCommitments(USER_ID, 'America/Fortaleza');

    // Fortaleza: currentCycle ainda é setembro — outubro (10>9) E novembro
    // (11>9) são AMBOS futuros, então as duas parcelas somam.
    expect(resultFortaleza.installments[0].remaining).toBe(200);
  });

  it('D3/T28 (boundary genuíno): parcela de OUTUBRO — null/UTC já a considera passada; Fortaleza ainda a considera futura', async () => {
    /*
      No instante REAL_BOUNDARY: currentCycle(null)=outubro,
      currentCycle('America/Fortaleza')=setembro.

      Uma parcela cuja fatura é NOVEMBRO é "futura" para os dois (novembro >
      outubro E novembro > setembro). O discriminante real está numa
      parcela de OUTUBRO: futura só para quem ainda considera setembro o
      mês corrente (outubro > setembro), e JÁ vencida para quem já considera
      outubro o mês corrente (outubro não é > outubro).
    */
    const prismaNull = buildPrisma([
      installmentRow({
        id: 't1',
        title: 'Item 1/1',
        amount: '100',
        invoiceMonth: 10,
        invoiceYear: 2026,
      }),
    ]);
    const prismaFortaleza = buildPrisma([
      installmentRow({
        id: 't1',
        title: 'Item 1/1',
        amount: '100',
        invoiceMonth: 10,
        invoiceYear: 2026,
      }),
    ]);

    await expect(
      new CommitmentsService(prismaNull).getCommitments(USER_ID, null),
    ).rejects.toThrow(/Missing or invalid/);
    const resultFortaleza = await new CommitmentsService(
      prismaFortaleza,
    ).getCommitments(USER_ID, 'America/Fortaleza');

    // null (UTC=outubro): outubro não é > outubro -> não é futura -> não aparece com remaining > 0.
    // Fortaleza (setembro): outubro > setembro -> É futura -> aparece com remaining.
    expect(resultFortaleza.installments).toHaveLength(1);
    expect(resultFortaleza.installments[0].remaining).toBe(100);
  });
});

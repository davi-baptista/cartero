import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { makeBank } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ5 — runForAll: cada assinatura resolve sua PRÓPRIA competência, pela
 * timezone da SUA conta — nunca a de outra (owner isolation), nunca a do
 * primeiro usuário do lote (P7).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Exercita o caminho REAL (`runForSubscription`/`pendingCycles`/
 * `currentCycle`), sem mockar `runForSubscription` — é o único jeito de
 * provar que o `include: { user: { select: { timeZone } } }` chega até a
 * decisão de gerar ou não.
 */

const BANK_ID = 'bank-shared';

// 01/10/2026 02:00 UTC — Fortaleza (UTC-3) ainda é 30/09 23h (setembro);
// Tóquio (UTC+9) já é 01/10 11h (outubro). Mesmo instante, contas diferentes.
const REAL_BOUNDARY = new Date('2026-10-01T02:00:00.000Z');

function buildHarness() {
  const bank = makeBank({ id: BANK_ID });
  const writes: { transactions: any[]; subscriptionUpdates: any[] } = {
    transactions: [],
    subscriptionUpdates: [],
  };

  const subscriptions = [
    {
      id: 'sub-fortaleza',
      userId: 'user-fortaleza',
      user: { timeZone: 'America/Fortaleza' },
      bank,
      bankId: BANK_ID,
      categoryId: 'cat-1',
      title: 'Fortaleza sub',
      type: 'PIX',
      amount: 10,
      description: null,
      dayOfMonth: 1,
      startedAt: '2026-01',
      activeSince: null,
      lastGeneratedFor: null,
      isActive: true,
    },
    {
      id: 'sub-tokyo',
      userId: 'user-tokyo',
      user: { timeZone: 'Asia/Tokyo' },
      bank,
      bankId: BANK_ID,
      categoryId: 'cat-1',
      title: 'Tokyo sub',
      type: 'PIX',
      amount: 10,
      description: null,
      dayOfMonth: 1,
      startedAt: '2026-01',
      activeSince: null,
      lastGeneratedFor: null,
      isActive: true,
    },
  ];

  const prisma: any = {
    subscription: {
      findMany: vi.fn(async () => subscriptions),
      update: vi.fn(async ({ data }: any) => {
        writes.subscriptionUpdates.push(data);
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const target = subscriptions.find((s) => s.id === where.id);
        if (!target || target.lastGeneratedFor !== where.lastGeneratedFor) {
          return { count: 0 };
        }
        writes.subscriptionUpdates.push({ id: where.id, ...data });
        target.lastGeneratedFor = data.lastGeneratedFor;
        return { count: 1 };
      }),
    },
    bank: {
      findFirst: vi.fn(async () => bank),
    },
    invoice: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'inv-new', ...data })),
      update: vi.fn(async () => ({})),
    },
    transaction: {
      create: vi.fn(async ({ data }: any) => {
        writes.transactions.push(data);
        return { id: `tx-${writes.transactions.length}`, ...data };
      }),
    },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = new EntityValidationService(prisma as PrismaService);
  const service = new SubscriptionsService(prisma as PrismaService, validation);

  return { service, prisma, writes, subscriptions };
}

describe('runForAll — TZ5: isolamento de timezone entre contas no mesmo lote', () => {
  it('B4/P7: mesma execução, mesmo instante — Fortaleza NÃO gera outubro ainda; Tóquio já gera', async () => {
    const { service, writes, prisma } = buildHarness();

    const summary = await service.runForAll(REAL_BOUNDARY);

    expect(summary.failed).toBe(0);
    /*
      Ambas assinaturas: startedAt=2026-01, dayOfMonth=1, sem lastGeneratedFor.
      No instante REAL_BOUNDARY, Fortaleza está em setembro — pendingCycles
      gera até setembro (9 ciclos: jan..set). Tóquio já está em outubro E o
      dia 1 já chegou em termos de UTC bruto — gera até outubro (10 ciclos).
      A DIFERENÇA de 1 lançamento entre as duas é o discriminante: se o lote
      usasse a timezone de uma conta para a outra (P7), as duas gerariam a
      MESMA quantidade.
    */
    const porAssinatura = new Map<string, number>();
    for (const tx of writes.transactions) {
      porAssinatura.set(tx.title, (porAssinatura.get(tx.title) ?? 0) + 1);
    }

    expect(porAssinatura.get('Fortaleza sub')).toBe(9);
    expect(porAssinatura.get('Tokyo sub')).toBe(10);
    expect(prisma.bank.findFirst).not.toHaveBeenCalled();
  });

  it('B5: cada Transaction criada carrega o userId da PRÓPRIA assinatura, nunca da outra', async () => {
    const { service, writes } = buildHarness();
    await service.runForAll(REAL_BOUNDARY);

    for (const tx of writes.transactions) {
      if (tx.title === 'Fortaleza sub') {
        expect(tx.userId).toBe('user-fortaleza');
      }
      if (tx.title === 'Tokyo sub') {
        expect(tx.userId).toBe('user-tokyo');
      }
    }
  });

});

import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, makeInvoice } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Ciclo de vida da assinatura (Fase 7A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Três políticas se cruzam aqui:
 *
 * 1. Histórico gerado é IMUTÁVEL. Editar a assinatura muda os próximos
 *    lançamentos, nunca os que já existem — cada Transaction é um fato.
 * 2. Pausar significa "esteve inativa", não "cron desligado": os meses da
 *    pausa não são recuperados na reativação.
 * 3. Falha de uma assinatura não derruba as outras, e não desaparece.
 */

interface Setup {
  subscription?: Record<string, unknown>;
  subscriptions?: Record<string, unknown>[];
  bank?: ReturnType<typeof makeBank>;
  invoice?: ReturnType<typeof makeInvoice> | null;
  category?: { id: string; userId: string };
  /** Ids que `runForSubscription` deve fazer falhar. */
  failFor?: string[];
}

function buildHarness(setup: Setup = {}) {
  const bank = setup.bank ?? makeBank();
  const writes = {
    transactions: [] as any[],
    subscriptionUpdates: [] as any[],
    invoiceUpdates: [] as any[],
  };

  const subscription = setup.subscription ?? {
    id: 'sub-1',
    userId: USER_ID,
    bankId: bank.id,
    categoryId: 'cat-1',
    title: 'Netflix',
    type: 'CREDIT_CARD',
    amount: 39.9,
    description: null,
    dayOfMonth: 12,
    startedAt: '2026-08',
    activeSince: null,
    lastGeneratedFor: null,
    isActive: true,
  };

  const prisma: any = {
    subscription: {
      findFirst: vi.fn(async () => ({
        ...subscription,
        bank,
        category: setup.category ?? { id: 'cat-1', name: 'Assinatura' },
      })),
      findMany: vi.fn(async () => setup.subscriptions ?? [subscription]),
      create: vi.fn(async ({ data }: any) => ({ id: 'sub-new', ...data })),
      update: vi.fn(async ({ data }: any) => {
        writes.subscriptionUpdates.push(data);
        return { ...subscription, ...data };
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        writes.subscriptionUpdates.push(data);
        return { count: 1 };
      }),
      delete: vi.fn(async () => subscription),
    },
    bank: {
      findFirst: vi.fn(async () => bank),
      findUnique: vi.fn(async () => bank),
    },
    invoice: {
      findFirst: vi.fn(async () => setup.invoice ?? null),
      create: vi.fn(async ({ data }: any) =>
        makeInvoice({ ...data, id: 'inv-new' }),
      ),
      update: vi.fn(async (args: any) => {
        writes.invoiceUpdates.push(args);
        return args.data;
      }),
    },
    transaction: {
      create: vi.fn(async ({ data }: any) => {
        writes.transactions.push(data);
        return { id: `tx-${writes.transactions.length}`, ...data };
      }),
    },
    category: {
      findUnique: vi.fn(
        async () =>
          setup.category ?? { id: 'cat-1', userId: USER_ID, name: 'Streaming' },
      ),
      findFirst: vi.fn(async () => ({
        id: 'cat-sys',
        userId: USER_ID,
        name: 'Assinatura',
        isSystem: true,
      })),
      create: vi.fn(async ({ data }: any) => ({ id: 'cat-sys', ...data })),
      update: vi.fn(async ({ data }: any) => ({ id: 'cat-sys', ...data })),
    },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = new EntityValidationService(prisma as PrismaService);
  const service = new SubscriptionsService(prisma as PrismaService, validation);

  // Injeta falha controlada, para testar isolamento sem depender de erro real.
  if (setup.failFor?.length) {
    const ids = new Set(setup.failFor);
    (service as any).runForSubscription = vi.fn(async (sub: any) => {
      if (ids.has(sub.id)) throw new Error('boom');
      return [{ cycle: '2026-08', date: new Date(), skipped: false }];
    });
  }

  return { service, prisma, writes, bank, subscription };
}

describe('Categoria configurável', () => {
  it('usa a categoria escolhida quando informada', async () => {
    const harness = buildHarness({
      category: { id: 'cat-streaming', userId: USER_ID },
    });

    await harness.service.create(USER_ID, {
      title: 'Netflix',
      bankId: 'bank-1',
      categoryId: 'cat-streaming',
      type: 'PIX',
      amount: 39.9,
      dayOfMonth: 12,
      startedAt: '2026-08',
    } as any);

    const data = harness.prisma.subscription.create.mock.calls[0][0].data;
    expect(data.categoryId).toBe('cat-streaming');
  });

  it('sem escolha, cai na categoria de sistema — cadastro rápido', async () => {
    const harness = buildHarness();

    await harness.service.create(USER_ID, {
      title: 'Spotify',
      bankId: 'bank-1',
      type: 'PIX',
      amount: 21.9,
      dayOfMonth: 5,
      startedAt: '2026-08',
    } as any);

    const data = harness.prisma.subscription.create.mock.calls[0][0].data;
    expect(data.categoryId).toBe('cat-sys');
    expect(harness.prisma.category.findFirst).toHaveBeenCalled();
  });

  it('recusa categoria de outro usuário', async () => {
    // O frontend não é fonte de segurança: o id vem do corpo da requisição.
    const harness = buildHarness();
    harness.prisma.category.findUnique = vi.fn(async () => null);

    await expect(
      harness.service.create(USER_ID, {
        title: 'Netflix',
        bankId: 'bank-1',
        categoryId: 'cat-de-outro',
        type: 'PIX',
        amount: 39.9,
        dayOfMonth: 12,
        startedAt: '2026-08',
      } as any),
    ).rejects.toThrow(/[Cc]ategoria/);

    expect(harness.prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('trocar a categoria não reescreve lançamentos já gerados', async () => {
    const harness = buildHarness({
      category: { id: 'cat-nova', userId: USER_ID },
    });

    await harness.service.update('sub-1', USER_ID, {
      categoryId: 'cat-nova',
    } as any);

    // Só a assinatura é atualizada; nenhuma transação é tocada.
    expect(harness.writes.subscriptionUpdates[0].categoryId).toBe('cat-nova');
    expect(harness.prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('recusa categoria de terceiro também na edição', async () => {
    const harness = buildHarness();
    harness.prisma.category.findUnique = vi.fn(async () => null);

    await expect(
      harness.service.update('sub-1', USER_ID, {
        categoryId: 'cat-de-outro',
      } as any),
    ).rejects.toThrow(/[Cc]ategoria/);
  });
});

describe('Reativação — marco de ativação', () => {
  const paused = {
    id: 'sub-1',
    userId: USER_ID,
    bankId: 'bank-1',
    categoryId: 'cat-1',
    title: 'Netflix',
    type: 'PIX',
    amount: 39.9,
    dayOfMonth: 12,
    startedAt: '2026-01',
    activeSince: null,
    lastGeneratedFor: '2026-05',
    isActive: false,
  };

  it('grava activeSince ao reativar', async () => {
    const harness = buildHarness({ subscription: paused });

    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    await harness.service.update('sub-1', USER_ID, { isActive: true } as any);
    vi.useRealTimers();

    // Dia 12 já passou em 20/08 → primeiro ciclo elegível é setembro.
    expect(harness.writes.subscriptionUpdates[0].activeSince).toBe('2026-09');
  });

  it('activeSince é o mês corrente quando o dia ainda não passou', async () => {
    const harness = buildHarness({
      subscription: { ...paused, dayOfMonth: 25 },
    });

    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    await harness.service.update('sub-1', USER_ID, { isActive: true } as any);
    vi.useRealTimers();

    expect(harness.writes.subscriptionUpdates[0].activeSince).toBe('2026-08');
  });

  it('NÃO sobrescreve startedAt', async () => {
    // `startedAt` significa "assinando desde"; usá-lo como marco de geração
    // apagaria a origem da assinatura.
    const harness = buildHarness({ subscription: paused });

    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    await harness.service.update('sub-1', USER_ID, { isActive: true } as any);
    vi.useRealTimers();

    expect(harness.writes.subscriptionUpdates[0].startedAt).toBeUndefined();
  });

  it('pausar não grava marco algum', async () => {
    const harness = buildHarness({
      subscription: { ...paused, isActive: true },
    });

    await harness.service.update('sub-1', USER_ID, { isActive: false } as any);

    expect(harness.writes.subscriptionUpdates[0].activeSince).toBeUndefined();
    expect(harness.writes.subscriptionUpdates[0].isActive).toBe(false);
  });

  it('editar outro campo não mexe no marco', async () => {
    const harness = buildHarness({
      subscription: { ...paused, isActive: true, activeSince: '2026-03' },
    });

    await harness.service.update('sub-1', USER_ID, { amount: 49.9 } as any);

    // `undefined` = "não alterar" para o Prisma, preservando a ativação atual.
    expect(harness.writes.subscriptionUpdates[0].activeSince).toBeUndefined();
  });

  it('reenviar isActive: true numa já ativa não regrava o marco', async () => {
    const harness = buildHarness({
      subscription: { ...paused, isActive: true, activeSince: '2026-03' },
    });

    await harness.service.update('sub-1', USER_ID, { isActive: true } as any);

    expect(harness.writes.subscriptionUpdates[0].activeSince).toBeUndefined();
  });
});

describe('Edição não reescreve histórico', () => {
  it.each([
    ['valor', { amount: 49.9 }],
    ['título', { title: 'Netflix Premium' }],
    ['forma', { type: 'PIX' }],
    ['dia', { dayOfMonth: 20 }],
  ])('alterar %s não toca em transação alguma', async (_label, dto) => {
    const harness = buildHarness();

    await harness.service.update('sub-1', USER_ID, dto as any);

    expect(harness.prisma.transaction.create).not.toHaveBeenCalled();
    expect(harness.writes.transactions).toHaveLength(0);
  });

  it('startedAt não é alterável pelo payload', async () => {
    const harness = buildHarness();

    await harness.service.update('sub-1', USER_ID, {
      startedAt: '2020-01',
    } as any);

    expect(harness.writes.subscriptionUpdates[0].startedAt).toBeUndefined();
  });

  it('lastGeneratedFor não é alterável pelo payload', async () => {
    // Mexer no marcador de idempotência duplicaria cobranças.
    const harness = buildHarness();

    await harness.service.update('sub-1', USER_ID, {
      lastGeneratedFor: '2020-01',
    } as any);

    expect(
      harness.writes.subscriptionUpdates[0].lastGeneratedFor,
    ).toBeUndefined();
  });
});

describe('Exclusão preserva o histórico', () => {
  it('remove a assinatura sem apagar transações', async () => {
    const harness = buildHarness();

    await harness.service.remove('sub-1', USER_ID);

    expect(harness.prisma.subscription.delete).toHaveBeenCalled();
    // O FK é ON DELETE SET NULL: os lançamentos perdem o vínculo, não a vida.
    expect(harness.writes.transactions).toHaveLength(0);
  });
});

describe('runForUser — uma falha não derruba as outras', () => {
  const make = (id: string, title: string) => ({
    id,
    userId: USER_ID,
    bankId: 'bank-1',
    categoryId: 'cat-1',
    title,
    type: 'PIX',
    amount: 10,
    dayOfMonth: 5,
    startedAt: '2026-08',
    activeSince: null,
    lastGeneratedFor: null,
    isActive: true,
  });

  it('as demais continuam quando uma falha', async () => {
    /**
     * Antes o `await` estava nu dentro do laço: uma assinatura com dado
     * corrompido abortava o lote inteiro, sempre no mesmo registro.
     */
    const harness = buildHarness({
      subscriptions: [
        make('a', 'Boa 1'),
        make('ruim', 'Ruim'),
        make('b', 'Boa 2'),
      ],
      failFor: ['ruim'],
    });

    const results = await harness.service.runForUser(USER_ID);

    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.failure)).toHaveLength(1);
    expect(results.filter((r) => !r.failure)).toHaveLength(2);
  });

  it('a falha é reportada, não engolida', async () => {
    const harness = buildHarness({
      subscriptions: [make('ruim', 'Ruim')],
      failFor: ['ruim'],
    });

    const results = await harness.service.runForUser(USER_ID);

    expect(results[0].failure?.reason).toBeTruthy();
    expect(results[0].title).toBe('Ruim');
  });

  it('não vaza erro interno na mensagem', async () => {
    // Erro cru do Prisma ou stack não ajudam quem lê e expõem estrutura.
    const harness = buildHarness({
      subscriptions: [make('ruim', 'Ruim')],
      failFor: ['ruim'],
    });

    const results = await harness.service.runForUser(USER_ID);

    expect(results[0].failure?.reason).not.toContain('boom');
  });
});

describe('runForAll — resumo observável', () => {
  const make = (id: string, title: string) => ({
    id,
    userId: USER_ID,
    bankId: 'bank-1',
    categoryId: 'cat-1',
    title,
    type: 'PIX',
    amount: 10,
    dayOfMonth: 5,
    startedAt: '2026-08',
    activeSince: null,
    lastGeneratedFor: null,
    isActive: true,
  });

  it('conta gerados e falhas separadamente', async () => {
    const harness = buildHarness({
      subscriptions: [make('a', 'A'), make('ruim', 'Ruim'), make('b', 'B')],
      failFor: ['ruim'],
    });

    const summary = await harness.service.runForAll();

    expect(summary.subscriptions).toBe(3);
    expect(summary.generated).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it('identifica qual assinatura falhou', async () => {
    // Sem isso, `runForAll` só devolvia agregados e não havia por onde
    // começar a investigar — nem log existia.
    const harness = buildHarness({
      subscriptions: [make('ruim', 'Netflix')],
      failFor: ['ruim'],
    });

    const summary = await harness.service.runForAll();

    expect(summary.failures).toEqual([
      {
        subscriptionId: 'ruim',
        title: 'Netflix',
        reason: expect.any(String),
      },
    ]);
  });

  it('lote sem falhas reporta zero', async () => {
    const harness = buildHarness({
      subscriptions: [make('a', 'A')],
      failFor: [],
    });

    const summary = await harness.service.runForAll();

    expect(summary.failed).toBe(0);
    expect(summary.failures).toEqual([]);
  });
});

describe('Próxima cobrança na listagem', () => {
  it('assinatura ativa expõe nextCharge', async () => {
    const harness = buildHarness();

    vi.setSystemTime(new Date('2026-08-05T12:00:00Z'));
    const [row] = await harness.service.findAll(USER_ID);
    vi.useRealTimers();

    expect(row.nextCharge?.toISOString().slice(0, 10)).toBe('2026-08-12');
  });

  it('pausada não expõe próxima cobrança falsa', async () => {
    const harness = buildHarness({
      subscriptions: [
        {
          id: 'sub-1',
          userId: USER_ID,
          bankId: 'bank-1',
          categoryId: 'cat-1',
          title: 'Netflix',
          type: 'PIX',
          amount: 39.9,
          dayOfMonth: 12,
          startedAt: '2026-01',
          activeSince: null,
          lastGeneratedFor: '2026-05',
          isActive: false,
        },
      ],
    });

    const [row] = await harness.service.findAll(USER_ID);

    expect(row.nextCharge).toBeNull();
  });
});

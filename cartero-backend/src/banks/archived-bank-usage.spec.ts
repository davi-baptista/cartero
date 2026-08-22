import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Uso de banco arquivado (Fase 6A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A proteção vive no backend, não nos selects: esconder a opção da interface
 * evita o erro comum, mas não impede uma requisição direta nem cobre o cron.
 *
 * `validateBank` é o ponto único, e por isso o padrão dela é o caso perigoso
 * — recusar. Um fluxo novo que esqueça de pensar em arquivamento falha
 * fechado. Os caminhos que só LEEM configuração pedem `allowArchived`
 * explicitamente, e a exceção fica visível na chamada.
 */

function buildValidation(bank: ReturnType<typeof makeBank>) {
  const prisma = {
    bank: { findUnique: vi.fn().mockResolvedValue(bank) },
  } as unknown as PrismaService;

  return new EntityValidationService(prisma);
}

describe('validateBank — guarda central de banco arquivado', () => {
  it('recusa banco arquivado por padrão', async () => {
    const validation = buildValidation(makeBank({ isArchived: true }));

    await expect(
      validation.validateBank('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });
  });

  it('a recusa orienta a restaurar o banco', async () => {
    const validation = buildValidation(
      makeBank({ isArchived: true, name: 'Mercado Pago' }),
    );

    await expect(
      validation.validateBank('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/Mercado Pago.*arquivado/i),
      }),
    });
  });

  it('aceita banco arquivado com allowArchived — caminhos de leitura', async () => {
    const validation = buildValidation(makeBank({ isArchived: true }));

    const bank = await validation.validateBank('bank-1', USER_ID, {
      allowArchived: true,
    });

    expect(bank.isArchived).toBe(true);
  });

  it('banco ativo passa normalmente', async () => {
    const validation = buildValidation(makeBank());

    const bank = await validation.validateBank('bank-1', USER_ID);

    expect(bank.isArchived).toBe(false);
  });

  it('banco inexistente continua 404, não conflito', async () => {
    const prisma = {
      bank: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    await expect(
      new EntityValidationService(prisma).validateBank('x', USER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('a recusa é conflito (409), não requisição inválida', async () => {
    // O pedido está bem formado; o estado do banco é que impede. A distinção
    // importa para o cliente diferenciar erro de validação de erro de regra.
    const validation = buildValidation(makeBank({ isArchived: true }));

    await expect(validation.validateBank('bank-1', USER_ID)).rejects.toThrow(
      ConflictException,
    );
  });
});

/**
 * Assinaturas são o único fluxo que cria movimentação sozinho, sem uma ação
 * do usuário por trás — daí a atenção extra.
 */
function buildSubscriptions(options: {
  bank: ReturnType<typeof makeBank>;
  subscription: Record<string, unknown>;
}) {
  const updates: any[] = [];

  const prisma = {
    subscription: {
      findFirst: vi.fn().mockResolvedValue({
        ...options.subscription,
        bank: options.bank,
        category: { id: 'cat-1', name: 'Assinaturas' },
      }),
      update: vi.fn(async (args: any) => {
        updates.push(args.data);
        return { ...options.subscription, ...args.data };
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    bank: { findUnique: vi.fn().mockResolvedValue(options.bank) },
    transaction: { create: vi.fn(), findFirst: vi.fn() },
    invoice: { findFirst: vi.fn(), update: vi.fn() },
  } as unknown as PrismaService;

  const validation = new EntityValidationService(prisma);

  return {
    service: new SubscriptionsService(prisma, validation),
    updates,
    prisma,
  };
}

describe('Subscription — reativação com banco arquivado', () => {
  // `startedAt`, `dayOfMonth` e `activeSince` são obrigatórios desde que
  // `findOne` passou a calcular a próxima cobrança pelo mesmo helper da
  // geração — sem eles o cálculo não tem base.
  const paused = {
    id: 'sub-1',
    userId: USER_ID,
    bankId: 'bank-1',
    isActive: false,
    title: 'Streaming',
    startedAt: '2026-01',
    dayOfMonth: 10,
    activeSince: null,
    lastGeneratedFor: null,
  };

  it('recusa reativar quando o banco está arquivado', async () => {
    /**
     * Este era o buraco: `{ isActive: true }` sem `bankId` não passava por
     * nenhuma validação de banco, e a assinatura voltava a gerar lançamentos
     * numa conta encerrada — provavelmente arquivada justamente porque a
     * assinatura estava pausada.
     */
    const harness = buildSubscriptions({
      bank: makeBank({ isArchived: true }),
      subscription: paused,
    });

    await expect(
      harness.service.update('sub-1', USER_ID, { isActive: true } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });

    expect(harness.updates).toHaveLength(0);
  });

  it('permite reativar quando o banco está ativo', async () => {
    const harness = buildSubscriptions({
      bank: makeBank(),
      subscription: paused,
    });

    await harness.service.update('sub-1', USER_ID, { isActive: true } as any);

    expect(harness.updates[0].isActive).toBe(true);
  });

  it('permite pausar uma assinatura em banco arquivado', async () => {
    // Pausar não cria movimento — e é exatamente o que a mensagem de
    // arquivamento pede que o usuário faça.
    const harness = buildSubscriptions({
      bank: makeBank({ isArchived: true }),
      subscription: { ...paused, isActive: true },
    });

    await harness.service.update('sub-1', USER_ID, { isActive: false } as any);

    expect(harness.updates[0].isActive).toBe(false);
  });

  it('recusa mover uma assinatura PARA banco arquivado', async () => {
    const harness = buildSubscriptions({
      bank: makeBank({ isArchived: true }),
      subscription: { ...paused, isActive: true },
    });

    await expect(
      harness.service.update('sub-1', USER_ID, { bankId: 'bank-1' } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });
  });

  it('editar só o valor de assinatura ativa em banco arquivado não é barrado pelo archive', async () => {
    // Arquivar não congela o registro: sem `bankId` no payload e sem
    // reativação, não há movimento novo sendo criado.
    const harness = buildSubscriptions({
      bank: makeBank({ isArchived: true }),
      subscription: { ...paused, isActive: true },
    });

    await harness.service.update('sub-1', USER_ID, { amount: 42 } as any);

    expect(harness.updates[0].amount).toBe(42);
  });

  it('assinatura já ativa que reenvia isActive: true não é recusada', async () => {
    // `reactivating` compara com o estado atual — um PATCH idempotente não
    // deve virar erro só porque o banco foi arquivado depois.
    const harness = buildSubscriptions({
      bank: makeBank({ isArchived: true }),
      subscription: { ...paused, isActive: true },
    });

    await harness.service.update('sub-1', USER_ID, { isActive: true } as any);

    expect(harness.updates[0].isActive).toBe(true);
  });
});

describe('Subscription — geração não roda em banco arquivado', () => {
  it('o cron não gera lançamentos quando o banco está arquivado', async () => {
    /**
     * Defesa em profundidade: arquivar já exige que nenhuma assinatura esteja
     * ativa, então chegar aqui significa que algum caminho escapou. Melhor
     * não gerar nada do que lançar numa conta encerrada.
     */
    const transactionCreate = vi.fn();
    const prisma = {
      subscription: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sub-1',
            userId: USER_ID,
            bankId: 'bank-1',
            isActive: true,
            title: 'Streaming',
            type: 'CREDIT_CARD',
            amount: 30,
            dayOfMonth: 10,
            startedAt: '2026-01',
            lastGeneratedFor: null,
            categoryId: 'cat-1',
          },
        ]),
        update: vi.fn(),
      },
      bank: {
        findFirst: vi.fn().mockResolvedValue(makeBank({ isArchived: true })),
        findUnique: vi.fn().mockResolvedValue(makeBank({ isArchived: true })),
      },
      transaction: { create: transactionCreate, findFirst: vi.fn() },
      invoice: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaService;

    const service = new SubscriptionsService(
      prisma,
      new EntityValidationService(prisma),
    );

    const result = await service.runForUser(USER_ID, new Date('2026-08-20'));

    // Nada é lançado — essa é a garantia principal.
    expect(transactionCreate).not.toHaveBeenCalled();

    /**
     * E o motivo agora é REPORTADO, não engolido.
     *
     * Antes isto devolvia `[]`: a supressão não deixava rastro, e a
     * assinatura parecia saudável enquanto deixava de gerar. O ciclo volta
     * como `skipped` com o motivo, e o serviço registra um warn.
     */
    expect(result).toHaveLength(1);
    expect(result[0].generated.every((item) => item.skipped)).toBe(true);
    expect(result[0].generated[0].skipReason).toBe('bank-archived');
    expect(result[0].failure).toBeUndefined();
  });
});

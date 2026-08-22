import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BanksService } from './banks.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Arquivamento de banco (Fase 6A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A Fase 2B tornou o banco com histórico indelével, o que protegia os dados
 * mas deixava um cartão encerrado para sempre na lista e nos selects.
 * Arquivar resolve isso sem apagar nada.
 *
 * A distinção que estes testes fixam: arquivar diz "não use para movimento
 * novo"; NÃO diz "este banco deixou de ter obrigações". Histórico, faturas e
 * parcelas futuras permanecem — e a exclusão continua barrada, para que
 * arquivar não vire um desvio em torno de BANK_HAS_HISTORY.
 */

function buildHarness(options: {
  bank?: ReturnType<typeof makeBank>;
  transactions?: number;
  invoices?: number;
  subscriptions?: number;
  /** Assinaturas ATIVAS — as que impedem o arquivamento. */
  activeSubscriptions?: number;
  /** Bancos devolvidos por `findAll`. */
  banks?: ReturnType<typeof makeBank>[];
}) {
  const bank = options.bank ?? makeBank();
  const calls = { deletedBank: false };

  const prisma = {
    bank: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(bank),
      create: vi.fn(async ({ data }: any) => makeBank(data)),
      update: vi.fn(async ({ data }: any) => ({ ...bank, ...data })),
      delete: vi.fn(async () => {
        calls.deletedBank = true;
        return bank;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        (options.banks ?? [bank])
          .filter(
            (item) =>
              item.isSystem === where.isSystem &&
              item.isArchived === where.isArchived,
          )
          .map((item) => ({
            ...item,
            _count: {
              transactions: options.transactions ?? 0,
              invoices: options.invoices ?? 0,
              subscriptions: options.subscriptions ?? 0,
            },
          })),
      ),
    },
    transaction: {
      count: vi.fn().mockResolvedValue(options.transactions ?? 0),
    },
    invoice: { count: vi.fn().mockResolvedValue(options.invoices ?? 0) },
    subscription: {
      // `remove` conta todas; `archive` conta só as ativas. O duplo papel é
      // resolvido pelo filtro que cada chamada usa.
      count: vi.fn(async ({ where }: any) =>
        where?.isActive === true
          ? (options.activeSubscriptions ?? 0)
          : (options.subscriptions ?? 0),
      ),
    },
  } as unknown as PrismaService;

  const validation = {
    validateBank: vi.fn().mockResolvedValue(bank),
  } as unknown as EntityValidationService;

  return { service: new BanksService(prisma, validation), prisma, calls, bank };
}

describe('BanksService.archive', () => {
  it('arquiva um banco vazio', async () => {
    const harness = buildHarness({});

    const result = await harness.service.archive('bank-1', USER_ID);

    expect(result.isArchived).toBe(true);
    expect(harness.prisma.bank.update).toHaveBeenCalled();
  });

  it('arquiva um banco com transações — histórico não impede', async () => {
    const harness = buildHarness({ transactions: 12 });

    const result = await harness.service.archive('bank-1', USER_ID);

    expect(result.isArchived).toBe(true);
  });

  it('arquiva um banco com faturas', async () => {
    const harness = buildHarness({ invoices: 6 });

    const result = await harness.service.archive('bank-1', USER_ID);

    expect(result.isArchived).toBe(true);
  });

  it('arquiva um banco com parcelas e faturas futuras', async () => {
    // Uma compra em 10x num cartão que se quer encerrar é o caso motivador:
    // as parcelas continuam existindo e vencendo no banco arquivado. O
    // arquivamento nem consulta essas contagens.
    const harness = buildHarness({ transactions: 10, invoices: 10 });

    const result = await harness.service.archive('bank-1', USER_ID);

    expect(result.isArchived).toBe(true);
    expect(harness.prisma.transaction.count).not.toHaveBeenCalled();
    expect(harness.prisma.invoice.count).not.toHaveBeenCalled();
  });

  it('nada é excluído ao arquivar', async () => {
    const harness = buildHarness({ transactions: 3, invoices: 2 });

    await harness.service.archive('bank-1', USER_ID);

    expect(harness.prisma.bank.delete).not.toHaveBeenCalled();
    expect(harness.calls.deletedBank).toBe(false);
  });

  it('não altera a configuração de fatura do banco', async () => {
    const harness = buildHarness({});

    await harness.service.archive('bank-1', USER_ID);

    const data = (harness.prisma.bank.update as any).mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['isArchived', 'updatedAt']);
    expect(data.isArchived).toBe(true);
  });

  it('recusa quando há assinatura ativa', async () => {
    // Sem esta guarda o arquivamento seria uma promessa falsa: o Cartero
    // continuaria criando transações no banco a cada ciclo.
    const harness = buildHarness({ activeSubscriptions: 1 });

    await expect(
      harness.service.archive('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'BANK_HAS_ACTIVE_SUBSCRIPTIONS',
      }),
    });

    expect(harness.prisma.bank.update).not.toHaveBeenCalled();
  });

  it('a mensagem de assinatura ativa orienta pausar ou mover', async () => {
    const harness = buildHarness({ activeSubscriptions: 3 });

    await expect(
      harness.service.archive('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/3 assinaturas ativas/i),
        details: { activeSubscriptions: 3 },
      }),
    });
  });

  it('permite arquivar com assinatura apenas inativa', async () => {
    // Assinatura pausada não gera lançamento, então não há contradição. A
    // reativação dela é barrada enquanto o banco estiver arquivado.
    const harness = buildHarness({ subscriptions: 2, activeSubscriptions: 0 });

    const result = await harness.service.archive('bank-1', USER_ID);

    expect(result.isArchived).toBe(true);
  });

  it('recusa arquivar banco de sistema', async () => {
    // A conta interna de recebíveis não aparece em select nenhum, então
    // arquivá-la não teria efeito — e a deixaria inconsistente com `remove`,
    // que já a protege.
    const harness = buildHarness({ bank: makeBank({ isSystem: true }) });

    await expect(harness.service.archive('bank-1', USER_ID)).rejects.toThrow(
      BadRequestException,
    );

    expect(harness.prisma.bank.update).not.toHaveBeenCalled();
  });

  it('arquivar duas vezes é idempotente, não erro', async () => {
    const harness = buildHarness({ bank: makeBank({ isArchived: true }) });

    const result = await harness.service.archive('bank-1', USER_ID);

    expect(result.isArchived).toBe(true);
    expect(harness.prisma.bank.update).not.toHaveBeenCalled();
  });
});

describe('BanksService.restore', () => {
  it('restaura um banco arquivado', async () => {
    const harness = buildHarness({ bank: makeBank({ isArchived: true }) });

    const result = await harness.service.restore('bank-1', USER_ID);

    expect(result.isArchived).toBe(false);
  });

  it('não altera configuração nem histórico ao restaurar', async () => {
    const harness = buildHarness({
      bank: makeBank({ isArchived: true, invoiceDueDate: 15 }),
      transactions: 8,
      invoices: 4,
    });

    const result = await harness.service.restore('bank-1', USER_ID);

    const data = (harness.prisma.bank.update as any).mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['isArchived', 'updatedAt']);
    expect(result.invoiceDueDate).toBe(15);
    expect(harness.prisma.bank.delete).not.toHaveBeenCalled();
  });

  it('restaurar um banco já ativo é idempotente', async () => {
    const harness = buildHarness({});

    const result = await harness.service.restore('bank-1', USER_ID);

    expect(result.isArchived).toBe(false);
    expect(harness.prisma.bank.update).not.toHaveBeenCalled();
  });
});

describe('BanksService — arquivar não contorna BANK_HAS_HISTORY', () => {
  it('banco arquivado COM histórico continua indelével', async () => {
    // O risco que este teste fecha: arquivar como caminho para conseguir
    // excluir depois.
    const harness = buildHarness({
      bank: makeBank({ isArchived: true }),
      transactions: 4,
    });

    await expect(
      harness.service.remove('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_HAS_HISTORY' }),
    });

    expect(harness.calls.deletedBank).toBe(false);
  });

  it('banco arquivado SEM histórico pode ser excluído', async () => {
    const harness = buildHarness({ bank: makeBank({ isArchived: true }) });

    await harness.service.remove('bank-1', USER_ID);

    expect(harness.calls.deletedBank).toBe(true);
  });
});

describe('BanksService.findAll — recorte por status', () => {
  it('por padrão devolve só os ativos', async () => {
    const harness = buildHarness({
      banks: [
        makeBank({ id: 'ativo' }),
        makeBank({ id: 'arquivado', isArchived: true }),
      ],
    });

    const result = await harness.service.findAll(USER_ID);

    expect(result.map((bank) => bank.id)).toEqual(['ativo']);
  });

  it('status ARCHIVED devolve só os arquivados', async () => {
    const harness = buildHarness({
      banks: [
        makeBank({ id: 'ativo' }),
        makeBank({ id: 'arquivado', isArchived: true }),
      ],
    });

    const result = await harness.service.findAll(USER_ID, 'ARCHIVED');

    expect(result.map((bank) => bank.id)).toEqual(['arquivado']);
  });

  it('nunca devolve o banco de sistema', async () => {
    const harness = buildHarness({
      banks: [
        makeBank({ id: 'ativo' }),
        makeBank({ id: 'sys', isSystem: true }),
      ],
    });

    const result = await harness.service.findAll(USER_ID);

    expect(result.map((bank) => bank.id)).toEqual(['ativo']);
  });

  it('canDelete é falso quando existe qualquer vínculo', async () => {
    // O frontend decide entre "Excluir" e "Arquivar" por este campo; se ele
    // divergisse da regra de `remove`, a UI ofereceria uma ação que falha.
    const harness = buildHarness({ transactions: 1 });

    const [bank] = await harness.service.findAll(USER_ID);

    expect(bank.canDelete).toBe(false);
  });

  it('canDelete é verdadeiro para banco realmente vazio', async () => {
    const harness = buildHarness({});

    const [bank] = await harness.service.findAll(USER_ID);

    expect(bank.canDelete).toBe(true);
  });

  it('assinatura inativa também impede a exclusão', async () => {
    // `remove` conta assinaturas independentemente de `isActive`; `canDelete`
    // precisa contar do mesmo jeito, senão a UI ofereceria Excluir e o
    // servidor recusaria.
    const harness = buildHarness({ subscriptions: 1 });

    const [bank] = await harness.service.findAll(USER_ID);

    expect(bank.canDelete).toBe(false);
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BanksService } from './banks.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, makeInvoice } from 'src/common/testing/fixtures';

/**
 * Bancos guardam o calendário da fatura. Dois pontos merecem teste: o cálculo
 * do dia de fechamento derivado do vencimento, e a política de exclusão —
 * banco com histórico financeiro é preservado (Crítico D, corrigido na
 * Fase 2B).
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
  /** Faturas do banco, para o plano de alteração de ciclo. */
  invoiceRows?: any[];
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
    invoice: {
      count: vi.fn().mockResolvedValue(options.invoices ?? 0),
      // O `update` de banco agora planeja o impacto sobre as faturas em
      // aberto; sem faturas no cenário o plano fica vazio e nada é escrito.
      findMany: vi.fn(async () => options.invoiceRows ?? []),
      update: vi.fn(async ({ data }: any) => data),
    },
    receivable: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    subscription: {
      // `remove` conta todas; `archive` conta só as ativas. O duplo papel é
      // resolvido pelo filtro que a chamada usa.
      count: vi.fn(async ({ where }: any) =>
        where?.isActive === true
          ? (options.activeSubscriptions ?? 0)
          : (options.subscriptions ?? 0),
      ),
    },
  } as any;

  // Executa o callback com os mesmos doubles — a atomicidade real é do
  // Postgres; aqui interessa que as escritas passem pelo caminho da transação.
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = {
    validateBank: vi.fn().mockResolvedValue(bank),
  } as unknown as EntityValidationService;

  return {
    service: new BanksService(prisma as unknown as PrismaService, validation),
    prisma,
    calls,
    bank,
  };
}

describe('BanksService.create', () => {
  it('deriva o dia de fechamento a partir do vencimento e do intervalo', async () => {
    const harness = buildHarness({});

    await harness.service.create(USER_ID, {
      name: 'Novo Cartão',
      invoiceDueDate: 10,
      invoiceDueDaysAfterClose: 7,
    } as any);

    const data = (harness.prisma.bank.create as any).mock.calls[0][0].data;
    expect(data.invoiceCloseDate).toBe(3);
    expect(data.invoiceDueDate).toBe(10);
  });

  it('aplica o intervalo padrão de 7 dias quando omitido', async () => {
    const harness = buildHarness({});

    await harness.service.create(USER_ID, {
      name: 'Novo Cartão',
      invoiceDueDate: 20,
    } as any);

    const data = (harness.prisma.bank.create as any).mock.calls[0][0].data;
    expect(data.invoiceDueDaysAfterClose).toBe(7);
    expect(data.invoiceCloseDate).toBe(13);
  });

  it('rejeita nome duplicado para o mesmo usuário', async () => {
    const harness = buildHarness({});
    (harness.prisma.bank.findFirst as any).mockResolvedValue(makeBank());

    await expect(
      harness.service.create(USER_ID, {
        name: 'Cartão Teste',
        invoiceDueDate: 10,
      } as any),
    ).rejects.toThrow(/já existe/);
  });
});

describe('BanksService.update', () => {
  it('recalcula o fechamento quando o vencimento muda', async () => {
    const harness = buildHarness({});

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 20,
    } as any);

    const data = (harness.prisma.bank.update as any).mock.calls[0][0].data;
    expect(data.invoiceCloseDate).toBe(13);
  });

  it('recalcula o fechamento quando só o intervalo muda', async () => {
    const harness = buildHarness({});

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDaysAfterClose: 15,
    } as any);

    const data = (harness.prisma.bank.update as any).mock.calls[0][0].data;
    // Vencimento 10 (do banco) menos 15 dias, dando a volta em 31.
    expect(data.invoiceCloseDate).toBeGreaterThanOrEqual(1);
    expect(data.invoiceCloseDate).toBeLessThanOrEqual(31);
  });

  it('não recalcula o fechamento quando só o nome muda', async () => {
    const harness = buildHarness({});

    await harness.service.update('bank-1', USER_ID, { name: 'Outro' } as any);

    // Os campos são montados explicitamente (sem spread do DTO), então a chave
    // existe com valor `undefined` — que o Prisma trata como "não alterar".
    const data = (harness.prisma.bank.update as any).mock.calls[0][0].data;
    expect(data.invoiceCloseDate).toBeUndefined();
    expect(data.name).toBe('Outro');
  });

  it('alterar só o nome não toca em nenhuma fatura', async () => {
    // Substitui um teste que documentava o defeito antigo ("não persiste nem
    // recalcula faturas existentes") e passava sem asseverar nada. Agora a
    // regra é outra: sem mudança no ciclo, o plano fica vazio.
    const harness = buildHarness({
      invoiceRows: [makeInvoice({ id: 'inv-open', status: 'OPEN' })],
    });

    await harness.service.update('bank-1', USER_ID, { name: 'Outro' } as any);

    expect(harness.prisma.bank.update).toHaveBeenCalled();
    expect(harness.prisma.invoice.update).not.toHaveBeenCalled();
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Crítico D — exclusão de banco com histórico (corrigido na Fase 2B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes, as guardas existiam mas estavam desativadas por `&& false`: a
 * exclusão apagava transações e faturas e ainda desvinculava pagamentos de
 * dívidas e cobranças, que continuavam `isPaid = true` sem nenhuma transação
 * que os comprovasse.
 *
 * Agora, qualquer histórico bloqueia a exclusão. Banco realmente sem uso
 * continua removível.
 */
describe('BanksService.remove — banco sem movimento', () => {
  it('exclui normalmente', async () => {
    const harness = buildHarness({});

    await harness.service.remove('bank-1', USER_ID);

    expect(harness.calls.deletedBank).toBe(true);
  });
});

describe('BanksService.remove — banco de sistema', () => {
  it('recusa excluir a conta interna de recebíveis', async () => {
    const harness = buildHarness({ bank: makeBank({ isSystem: true }) });

    await expect(harness.service.remove('bank-1', USER_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('a conta interna permanece intacta após a recusa', async () => {
    const harness = buildHarness({ bank: makeBank({ isSystem: true }) });

    await expect(harness.service.remove('bank-1', USER_ID)).rejects.toThrow();

    expect(harness.calls.deletedBank).toBe(false);
  });

  it('a mensagem está legível, sem caracteres corrompidos', async () => {
    const harness = buildHarness({ bank: makeBank({ isSystem: true }) });

    await expect(harness.service.remove('bank-1', USER_ID)).rejects.toThrow(
      /não podem ser excluídas/,
    );
  });
});

describe('Crítico D — banco com histórico não pode ser excluído', () => {
  it('recusa quando há transações', async () => {
    const harness = buildHarness({ transactions: 3 });

    await expect(
      harness.service.remove('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_HAS_HISTORY' }),
    });
  });

  it('recusa quando há faturas', async () => {
    const harness = buildHarness({ invoices: 2 });

    await expect(
      harness.service.remove('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_HAS_HISTORY' }),
    });
  });

  it('recusa quando há assinaturas — o bankId delas é obrigatório', async () => {
    const harness = buildHarness({ subscriptions: 1 });

    await expect(
      harness.service.remove('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_HAS_HISTORY' }),
    });
  });

  it('responde 409 Conflict', async () => {
    const harness = buildHarness({ transactions: 1 });

    await expect(harness.service.remove('bank-1', USER_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('a mensagem explica o motivo', async () => {
    const harness = buildHarness({ transactions: 1 });

    await expect(
      harness.service.remove('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('histórico financeiro'),
      }),
    });
  });

  it('informa o que impede a exclusão', async () => {
    const harness = buildHarness({
      transactions: 5,
      invoices: 2,
      subscriptions: 1,
    });

    await expect(
      harness.service.remove('bank-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        details: { transactions: 5, invoices: 2, subscriptions: 1 },
      }),
    });
  });

  it('nada é apagado quando a exclusão é recusada', async () => {
    const harness = buildHarness({ transactions: 1 });

    await expect(harness.service.remove('bank-1', USER_ID)).rejects.toThrow();

    expect(harness.calls.deletedBank).toBe(false);
    expect(harness.prisma.bank.delete).not.toHaveBeenCalled();
  });

  it('um banco usado para pagar dívidas não pode mais gerar isPaid órfão', async () => {
    // O pagamento de uma dívida é uma transação nesse banco; ela conta como
    // histórico, então a exclusão para antes de desvincular qualquer coisa.
    const harness = buildHarness({ transactions: 1 });

    await expect(harness.service.remove('bank-1', USER_ID)).rejects.toThrow(
      ConflictException,
    );

    expect(harness.calls.deletedBank).toBe(false);
  });
});

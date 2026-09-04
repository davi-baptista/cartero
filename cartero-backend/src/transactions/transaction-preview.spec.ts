import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import { planTransaction } from './transaction-plan.helper';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  makePerson,
} from 'src/common/testing/fixtures';

/**
 * A prévia responde "o que vai acontecer se eu salvar" sem gravar nada.
 *
 * Dois requisitos são testados aqui de forma explícita: ela não pode escrever
 * (nenhum create, nenhum update, nenhuma transação de banco), e não pode
 * divergir da criação — as duas derivam do mesmo `planTransaction`.
 */

/** Soma em centavos, para não reintroduzir erro de ponto flutuante. */
const sumCents = (values: number[]) =>
  values.reduce((total, value) => total + Math.round(value * 100), 0);

function buildHarness(
  options: {
    bank?: ReturnType<typeof makeBank>;
    /** Faturas que já existem no banco, para a prévia relatar o status. */
    invoices?: ReturnType<typeof makeInvoice>[];
    person?: ReturnType<typeof makePerson>;
  } = {},
) {
  const bank = options.bank ?? makeBank();
  const invoices = options.invoices ?? [];

  // Espiões de ESCRITA: qualquer chamada aqui é falha do requisito read-only.
  const writes = {
    transactionCreate: vi.fn(),
    transactionUpdate: vi.fn(),
    invoiceCreate: vi.fn(),
    invoiceUpdate: vi.fn(),
    receivableCreate: vi.fn(),
    dbTransaction: vi.fn(),
  };

  const prisma = {
    invoice: {
      findMany: vi.fn(async ({ where }: any) => {
        const wanted: Array<{ year: number; month: number }> = where.OR ?? [];
        return invoices.filter((invoice) =>
          wanted.some(
            (period) =>
              period.year === invoice.year && period.month === invoice.month,
          ),
        );
      }),
      create: writes.invoiceCreate,
      update: writes.invoiceUpdate,
    },
    transaction: {
      create: writes.transactionCreate,
      update: writes.transactionUpdate,
    },
    receivable: { create: writes.receivableCreate },
    $transaction: writes.dbTransaction,
  } as unknown as PrismaService;

  const validation = {
    validateBank: vi.fn(async () => bank),
    validateCategory: vi.fn(async () => ({ id: 'cat-1', userId: USER_ID })),
    validatePerson: vi.fn(async () => options.person ?? makePerson()),
  } as unknown as EntityValidationService;

  return {
    service: new TransactionsService(prisma, validation),
    prisma,
    validation,
    writes,
    bank,
  };
}

/** Vence dia 5, fecha 7 dias antes — o cartão dos testes da Fase 2B. */
const closesPreviousMonth = makeBank({
  invoiceDueDate: 5,
  invoiceDueDaysAfterClose: 7,
});

const baseInput = {
  bankId: 'bank-1',
  title: 'Compra',
  type: 'CREDIT_CARD' as const,
  amount: 100,
  date: '2026-08-01',
};

describe('previewCreate — crédito à vista', () => {
  it('devolve um único lançamento com o valor informado', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.installmentCount).toBe(1);
    expect(preview.installments).toHaveLength(1);
    expect(preview.installments[0].amount).toBe(100);
    expect(preview.totalAmount).toBe(100);
  });

  it('informa a competência e o vencimento da fatura', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    const invoice = preview.installments[0].invoice!;
    // Banco padrão vence dia 10 e fecha dia 3: 01/08 cai na fatura de agosto.
    expect(invoice.month).toBe(8);
    expect(invoice.year).toBe(2026);
    expect(invoice.dueDate?.getUTCDate()).toBe(10);
  });

  it('marca a fatura como inexistente quando ela ainda não foi criada', async () => {
    const harness = buildHarness({ invoices: [] });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.installments[0].invoice?.exists).toBe(false);
    expect(preview.installments[0].invoice?.status).toBeNull();
  });

  it('relata o status de uma fatura que já existe', async () => {
    const harness = buildHarness({
      invoices: [makeInvoice({ month: 8, year: 2026, status: 'CLOSED' })],
    });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.installments[0].invoice?.exists).toBe(true);
    expect(preview.installments[0].invoice?.status).toBe('CLOSED');
  });

  it('usa a data PERSISTIDA quando a fatura já existe', async () => {
    /**
     * O ponto da Fase 6B na prévia: a fatura de agosto foi criada quando o
     * cartão vencia dia 8 e guarda essa data. O cartão agora vence dia 10 (o
     * padrão do harness), e a projeção prospectiva diria 10 — mas o save vai
     * reusar a fatura existente, com o dia 8. Mostrar 10 seria prometer um
     * vencimento que não vai acontecer.
     */
    const harness = buildHarness({
      invoices: [
        makeInvoice({
          month: 8,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 },
        }),
      ],
    });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.installments[0].invoice?.exists).toBe(true);
    expect(preview.installments[0].invoice?.dueDate?.getUTCDate()).toBe(8);
  });

  it('usa a data prospectiva quando a fatura ainda não existe', async () => {
    // Contraparte: sem fatura, vale o cálculo pela configuração atual — e é
    // exatamente essa data que o save vai persistir ao criá-la.
    const harness = buildHarness({ invoices: [] });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.installments[0].invoice?.exists).toBe(false);
    expect(preview.installments[0].invoice?.dueDate?.getUTCDate()).toBe(10);
  });

  it('avisa que a criação será recusada por fatura paga', async () => {
    // A criação lança ForbiddenException nesse caso; a prévia antecipa.
    const harness = buildHarness({
      invoices: [makeInvoice({ month: 8, year: 2026, status: 'PAID' })],
    });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.blocked?.code).toBe('INVOICE_ALREADY_PAID');
  });

  it('não bloqueia quando nenhuma fatura do plano está paga', async () => {
    const harness = buildHarness({
      invoices: [makeInvoice({ month: 8, year: 2026, status: 'OPEN' })],
    });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.blocked).toBeNull();
  });
});

describe('previewCreate — parcelamento', () => {
  it('R$ 1.000 em 10x devolve dez parcelas de R$ 100', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 1000,
      installments: 10,
    } as any);

    expect(preview.installments).toHaveLength(10);
    expect(
      preview.installments.every((installment) => installment.amount === 100),
    ).toBe(true);
    expect(sumCents(preview.installments.map((i) => i.amount))).toBe(100000);
  });

  it('R$ 100 em 3x usa o rateio canônico', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 100,
      installments: 3,
    } as any);

    const amounts = preview.installments.map((i) => i.amount);
    expect(amounts[0]).toBeCloseTo(33.34, 10);
    expect(amounts[1]).toBeCloseTo(33.33, 10);
    expect(amounts[2]).toBeCloseTo(33.33, 10);
    expect(sumCents(amounts)).toBe(10000);
  });

  it('as competências avançam um mês por parcela', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 300,
      installments: 3,
    } as any);

    expect(
      preview.installments.map((i) => `${i.invoice!.year}-${i.invoice!.month}`),
    ).toEqual(['2026-8', '2026-9', '2026-10']);
  });

  it('atravessa a virada de ano', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      date: '2026-11-01',
      amount: 300,
      installments: 3,
    } as any);

    expect(
      preview.installments.map((i) => `${i.invoice!.year}-${i.invoice!.month}`),
    ).toEqual(['2026-11', '2026-12', '2027-1']);
  });

  it('numera o título de cada parcela', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      title: 'Notebook',
      amount: 300,
      installments: 3,
    } as any);

    expect(preview.installments.map((i) => i.title)).toEqual([
      'Notebook 1/3',
      'Notebook 2/3',
      'Notebook 3/3',
    ]);
  });

  it('faz uma única consulta de faturas, não uma por parcela', async () => {
    // Um parcelamento de 36x não pode virar 36 idas ao banco.
    const harness = buildHarness();

    await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 3600,
      installments: 36,
    } as any);

    expect(harness.prisma.invoice.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('previewCreate — competência do cartão que fecha no mês anterior', () => {
  // Vence dia 5, fecha 7 dias antes: fatura de março fecha em 26/02.
  const harnessFor = () => buildHarness({ bank: closesPreviousMonth });

  it('compra em 01/02 cai na fatura de março', async () => {
    const preview = await harnessFor().service.previewCreate(USER_ID, {
      ...baseInput,
      date: '2026-02-01',
    } as any);

    expect(preview.installments[0].invoice?.month).toBe(3);
  });

  it('compra em 26/02, no dia do fechamento, JÁ é abril', async () => {
    /*
      Contrato V2: o cutoff de fechamento é exclusivo. A prévia consome a
      mesma `getInvoicePeriodForDate` da criação — este teste existe para
      provar que ela não tem regra própria, e a mudança de policy aparecendo
      aqui é a evidência disso.
    */
    const preview = await harnessFor().service.previewCreate(USER_ID, {
      ...baseInput,
      date: '2026-02-26',
    } as any);

    expect(preview.installments[0].invoice?.month).toBe(4);
  });

  it('compra em 27/02 salta para abril', async () => {
    const preview = await harnessFor().service.previewCreate(USER_ID, {
      ...baseInput,
      date: '2026-02-27',
    } as any);

    expect(preview.installments[0].invoice?.month).toBe(4);
  });
});

describe('previewCreate — compra para outra pessoa', () => {
  it('à vista prevê uma cobrança com o vencimento da fatura', async () => {
    const harness = buildHarness({ person: makePerson({ name: 'Eva' }) });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 300,
      personId: 'person-1',
    } as any);

    expect(preview.receivables?.personName).toBe('Eva');
    expect(preview.receivables?.count).toBe(1);
    expect(preview.receivables?.total).toBe(300);
    expect(preview.receivables?.items[0].dueDate).toEqual(
      preview.installments[0].invoice?.dueDate,
    );
  });

  it('parcelado prevê uma cobrança por parcela, somando o total', async () => {
    const harness = buildHarness({ person: makePerson({ name: 'Eva' }) });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 1000,
      installments: 10,
      personId: 'person-1',
    } as any);

    expect(preview.receivables?.count).toBe(10);
    expect(sumCents(preview.receivables!.items.map((i) => i.amount))).toBe(
      100000,
    );
  });

  it('cada cobrança vence junto da sua própria fatura', async () => {
    const harness = buildHarness({ person: makePerson({ name: 'Eva' }) });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 300,
      installments: 3,
      personId: 'person-1',
    } as any);

    const receivableDates = preview.receivables!.items.map((i) =>
      i.dueDate?.toISOString(),
    );
    const invoiceDates = preview.installments.map((i) =>
      i.invoice?.dueDate?.toISOString(),
    );
    expect(receivableDates).toEqual(invoiceDates);
  });

  it('sem pessoa não prevê cobrança', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
    } as any);

    expect(preview.receivables).toBeNull();
  });

  it('recusa pessoa em lançamento que não é de crédito', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.previewCreate(USER_ID, {
        ...baseInput,
        type: 'PIX',
        personId: 'person-1',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('previewCreate — estorno', () => {
  it('prevê um único lançamento, sem parcelar', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      isRefund: true,
      installments: 3,
    } as any);

    expect(preview.installmentCount).toBe(1);
    expect(preview.installments).toHaveLength(1);
    expect(preview.isRefund).toBe(true);
  });

  it('recusa a combinação estorno + pessoa', async () => {
    // A combinação é incoerente no domínio: o estorno devolve dinheiro pela
    // fatura e a cobrança diria que a pessoa ainda deve. Recusada desde a
    // Fase 5C, tanto na prévia quanto na criação.
    const harness = buildHarness({ person: makePerson({ name: 'Eva' }) });

    await expect(
      harness.service.previewCreate(USER_ID, {
        ...baseInput,
        isRefund: true,
        personId: 'person-1',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REFUND_PERSON_NOT_SUPPORTED',
      }),
    });
  });

  it('estorno sem pessoa não prevê cobrança', async () => {
    const harness = buildHarness();

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      isRefund: true,
    } as any);

    expect(preview.receivables).toBeNull();
  });

  it('recusa estorno fora do cartão de crédito', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.previewCreate(USER_ID, {
        ...baseInput,
        type: 'PIX',
        isRefund: true,
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('previewCreate — formas sem fatura', () => {
  it.each(['PIX', 'DEBIT_CARD', 'BOLETO', 'INCOME'])(
    '%s não entra em fatura',
    async (type) => {
      const harness = buildHarness();

      const preview = await harness.service.previewCreate(USER_ID, {
        ...baseInput,
        type,
      } as any);

      expect(preview.affectsInvoice).toBe(false);
      expect(preview.installments[0].invoice).toBeNull();
      expect(preview.installmentCount).toBe(1);
    },
  );
});

describe('previewCreate — garantia read-only', () => {
  /** Nenhuma dessas operações pode ser chamada por uma prévia. */
  function expectNoWrites(writes: ReturnType<typeof buildHarness>['writes']) {
    expect(writes.transactionCreate).not.toHaveBeenCalled();
    expect(writes.transactionUpdate).not.toHaveBeenCalled();
    expect(writes.invoiceCreate).not.toHaveBeenCalled();
    expect(writes.invoiceUpdate).not.toHaveBeenCalled();
    expect(writes.receivableCreate).not.toHaveBeenCalled();
    expect(writes.dbTransaction).not.toHaveBeenCalled();
  }

  it('não escreve nada numa compra simples', async () => {
    const harness = buildHarness();

    await harness.service.previewCreate(USER_ID, { ...baseInput } as any);

    expectNoWrites(harness.writes);
  });

  it('não cria fatura mesmo quando ela ainda não existe', async () => {
    // O ponto mais delicado: a prévia mostra uma fatura prospectiva sem
    // materializá-la. Só o save cria.
    const harness = buildHarness({ invoices: [] });

    const preview = await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 1200,
      installments: 12,
    } as any);

    expect(preview.installments).toHaveLength(12);
    expect(harness.writes.invoiceCreate).not.toHaveBeenCalled();
    expectNoWrites(harness.writes);
  });

  it('não cria recebível numa compra de terceiro', async () => {
    const harness = buildHarness({ person: makePerson({ name: 'Eva' }) });

    await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 1000,
      installments: 10,
      personId: 'person-1',
    } as any);

    expect(harness.writes.receivableCreate).not.toHaveBeenCalled();
    expectNoWrites(harness.writes);
  });

  it('não abre transação de banco', async () => {
    const harness = buildHarness();

    await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      amount: 500,
      installments: 5,
    } as any);

    expect(harness.writes.dbTransaction).not.toHaveBeenCalled();
  });
});

describe('previewCreate — segurança', () => {
  it('valida a posse do banco', async () => {
    const harness = buildHarness();

    await harness.service.previewCreate(USER_ID, { ...baseInput } as any);

    expect(harness.validation.validateBank).toHaveBeenCalledWith(
      'bank-1',
      USER_ID,
    );
  });

  it('valida a posse da pessoa', async () => {
    const harness = buildHarness();

    await harness.service.previewCreate(USER_ID, {
      ...baseInput,
      personId: 'person-1',
    } as any);

    expect(harness.validation.validatePerson).toHaveBeenCalledWith(
      'person-1',
      USER_ID,
    );
  });

  it('não consulta pessoa quando ela não foi informada', async () => {
    const harness = buildHarness();

    await harness.service.previewCreate(USER_ID, { ...baseInput } as any);

    expect(harness.validation.validatePerson).not.toHaveBeenCalled();
  });
});

describe('prévia e criação não divergem', () => {
  /**
   * As duas derivam de `planTransaction`. Estes testes comparam a prévia com o
   * plano diretamente: se alguém reescrever o cálculo em um dos lados, a
   * divergência aparece aqui.
   */
  const schedule = {
    invoiceDueDate: 10,
    invoiceDueDaysAfterClose: 7,
  };

  it.each([
    [100, 1],
    [100, 3],
    [1000, 10],
    [2196.69, 10],
    [44.47, 6],
    [861.3, 10],
  ])(
    'R$ %s em %ix: valores e competências batem com o plano',
    async (amount, installments) => {
      const harness = buildHarness();

      const preview = await harness.service.previewCreate(USER_ID, {
        ...baseInput,
        amount,
        installments,
      } as any);

      const plan = planTransaction({
        type: 'CREDIT_CARD' as any,
        title: baseInput.title,
        amount,
        date: new Date(Date.UTC(2026, 7, 1, 12)),
        installments,
        schedule,
      });

      expect(preview.installmentCount).toBe(plan.installmentCount);
      expect(preview.installments.map((i) => i.amount)).toEqual(
        plan.installments.map((i) => i.amount),
      );
      expect(
        preview.installments.map(
          (i) => `${i.invoice?.year}-${i.invoice?.month}`,
        ),
      ).toEqual(
        plan.installments.map((i) => `${i.period?.year}-${i.period?.month}`),
      );
      expect(
        preview.installments.map((i) => i.invoice?.dueDate?.toISOString()),
      ).toEqual(plan.installments.map((i) => i.dueDate?.toISOString()));
      // O total previsto sempre fecha com o que o usuário informou.
      expect(sumCents(preview.installments.map((i) => i.amount))).toBe(
        Math.round(amount * 100),
      );
    },
  );
});

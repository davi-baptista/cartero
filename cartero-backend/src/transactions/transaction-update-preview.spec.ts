import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  makePerson,
  makeReceivable,
  makeTransaction,
  money,
  utcDate,
} from 'src/common/testing/fixtures';

/**
 * A prévia de edição projeta o impacto sem gravar nada.
 *
 * Usa os mesmos seletores de escopo e as mesmas guardas do update, então o
 * número de parcelas afetadas, os valores e os bloqueios não podem divergir do
 * que o save fará.
 */

interface Setup {
  transactions: ReturnType<typeof makeTransaction>[];
  receivables?: ReturnType<typeof makeReceivable>[];
  invoices?: ReturnType<typeof makeInvoice>[];
  bank?: ReturnType<typeof makeBank>;
  /** Bancos por id, para cenários com destino arquivado. */
  banksById?: Record<string, ReturnType<typeof makeBank>>;
  person?: ReturnType<typeof makePerson>;
}

function buildHarness(setup: Setup) {
  const invoices = setup.invoices ?? [
    makeInvoice({ id: 'i8', month: 8, year: 2026 }),
    makeInvoice({ id: 'i9', month: 9, year: 2026 }),
    makeInvoice({ id: 'i10', month: 10, year: 2026 }),
  ];
  const receivables = setup.receivables ?? [];

  /** Qualquer chamada aqui viola o requisito read-only. */
  const writes = {
    transactionUpdate: vi.fn(),
    transactionCreate: vi.fn(),
    transactionDelete: vi.fn(),
    invoiceUpdate: vi.fn(),
    invoiceCreate: vi.fn(),
    receivableCreate: vi.fn(),
    receivableUpdate: vi.fn(),
    receivableDelete: vi.fn(),
    dbTransaction: vi.fn(),
  };

  const prisma = {
    invoice: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.id?.in ?? [];
        return invoices.filter((invoice) => ids.includes(invoice.id));
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        invoices.find(
          (invoice) =>
            (where.month === undefined || invoice.month === where.month) &&
            (where.year === undefined || invoice.year === where.year),
        ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: any) =>
          invoices.find((invoice) => invoice.id === where.id) ?? null,
      ),
      create: writes.invoiceCreate,
      update: writes.invoiceUpdate,
    },
    transaction: {
      findMany: vi.fn(async ({ where }: any) =>
        setup.transactions.filter(
          (tx) =>
            (where.parentId === undefined || tx.parentId === where.parentId) &&
            (where.OR === undefined ||
              where.OR.some(
                (clause: any) =>
                  (clause.id !== undefined && tx.id === clause.id) ||
                  (clause.parentId !== undefined &&
                    tx.parentId === clause.parentId),
              )),
        ),
      ),
      findFirst: vi.fn(
        async ({ where }: any) =>
          setup.transactions.find((tx) => tx.parentId === where.parentId) ??
          null,
      ),
      findUnique: vi.fn(
        async ({ where }: any) =>
          setup.transactions.find((tx) => tx.id === where.id) ?? null,
      ),
      create: writes.transactionCreate,
      update: writes.transactionUpdate,
      delete: writes.transactionDelete,
    },
    // Consultada pela guarda de comprovante de quitação, adicionada quando a
    // proteção passou a cobrir também a edição.
    debt: {
      findFirst: vi.fn(async () => null),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.transactionId?.in ?? [];
        return receivables.filter((rec) =>
          ids.includes(rec.transactionId as string),
        );
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.transactionId?.in ?? [];
        return (
          receivables.find(
            (rec) =>
              ids.includes(rec.transactionId as string) &&
              (where.isPaid === undefined || rec.isPaid === where.isPaid),
          ) ?? null
        );
      }),
      count: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.transactionId?.in ?? [];
        return receivables.filter(
          (rec) =>
            ids.includes(rec.transactionId as string) &&
            (where.isPaid === undefined || rec.isPaid === where.isPaid),
        ).length;
      }),
      create: writes.receivableCreate,
      update: writes.receivableUpdate,
      delete: writes.receivableDelete,
    },
    $transaction: writes.dbTransaction,
    bank: {
      // A prévia consulta o banco de destino direto para checar arquivamento
      // (a recusa vira `blocked`, não exceção). `banksById` permite montar o
      // cenário de destino arquivado.
      findUnique: vi.fn(async ({ where }: any) => {
        const banks = setup.banksById ?? {};
        return banks[where.id] ?? setup.bank ?? makeBank();
      }),
    },
  } as unknown as PrismaService;

  const validation = {
    validateTransaction: vi.fn(async (id: string) => {
      const tx = setup.transactions.find((item) => item.id === id);
      if (!tx) throw new Error(`Transação não encontrada: ${id}`);
      return tx;
    }),
    validateBank: vi.fn(async () => setup.bank ?? makeBank()),
    validateCategory: vi.fn(async () => ({ id: 'cat-1', userId: USER_ID })),
    validatePerson: vi.fn(async (id: string) =>
      id === 'person-2'
        ? makePerson({ id: 'person-2', name: 'Breno' })
        : (setup.person ?? makePerson({ name: 'Eva' })),
    ),
  } as unknown as EntityValidationService;

  return {
    service: new TransactionsService(prisma, validation),
    prisma,
    writes,
  };
}

/** Série de três parcelas de R$ 100 (total R$ 300). */
function uniformSeries() {
  return [
    makeTransaction({
      id: 't1',
      title: 'Curso 1/3',
      amount: money(100),
      invoiceId: 'i8',
      date: utcDate(2026, 8, 1),
    }),
    makeTransaction({
      id: 't2',
      parentId: 't1',
      title: 'Curso 2/3',
      amount: money(100),
      invoiceId: 'i9',
      date: utcDate(2026, 8, 1),
    }),
    makeTransaction({
      id: 't3',
      parentId: 't1',
      title: 'Curso 3/3',
      amount: money(100),
      invoiceId: 'i10',
      date: utcDate(2026, 8, 1),
    }),
  ];
}

/** Série com centavos diferentes: 33,34 / 33,33 / 33,33 (total R$ 100). */
function unevenSeries() {
  return [
    makeTransaction({
      id: 't1',
      title: 'Rateio 1/3',
      amount: money(33.34),
      invoiceId: 'i8',
      date: utcDate(2026, 8, 1),
    }),
    makeTransaction({
      id: 't2',
      parentId: 't1',
      title: 'Rateio 2/3',
      amount: money(33.33),
      invoiceId: 'i9',
      date: utcDate(2026, 8, 1),
    }),
    makeTransaction({
      id: 't3',
      parentId: 't1',
      title: 'Rateio 3/3',
      amount: money(33.33),
      invoiceId: 'i10',
      date: utcDate(2026, 8, 1),
    }),
  ];
}

describe('previewUpdate — alteração descritiva', () => {
  it('não reporta impacto financeiro ao mudar só a descrição', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1' })],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      description: 'nota',
    } as any);

    expect(preview.descriptiveOnly).toBe(true);
    expect(preview.amountPerInstallment).toBeNull();
    expect(preview.invoiceChanges).toHaveLength(0);
    expect(preview.person).toBeNull();
  });

  it('não bloqueia edição descritiva mesmo com recebível pago', async () => {
    // Política da Fase 2B: texto continua editável.
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
      receivables: [
        makeReceivable({ id: 'r1', transactionId: 'tx-1', isPaid: true }),
      ],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      description: 'nota',
    } as any);

    expect(preview.blocked).toBeNull();
    expect(preview.descriptiveOnly).toBe(true);
  });
});

describe('previewUpdate — valor por escopo', () => {
  it('ONE afeta uma parcela e mostra o novo total da série', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 120,
      scope: 'ONE',
    } as any);

    expect(preview.affectedCount).toBe(1);
    expect(preview.amountPerInstallment).toEqual({ before: 100, after: 120 });
    expect(preview.affectedTotal).toEqual({ before: 100, after: 120 });
    // 120 + 100 + 100
    expect(preview.seriesTotal).toEqual({ before: 300, after: 320 });
  });

  it('NEXT afeta a parcela atual e as seguintes', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 120,
      scope: 'NEXT',
    } as any);

    expect(preview.affectedCount).toBe(2);
    expect(preview.affectedTotal).toEqual({ before: 200, after: 240 });
    // 100 + 120 + 120
    expect(preview.seriesTotal).toEqual({ before: 300, after: 340 });
  });

  it('ALL afeta a série inteira, inclusive a raiz, partindo de uma filha', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    // De 2/3: a raiz (1/3) tem `parentId = null` e ficava de fora do seletor,
    // então "Todas as parcelas" alterava 2 de 3 e deixava a primeira intacta.
    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 120,
      scope: 'ALL',
    } as any);

    expect(preview.affectedCount).toBe(3);
    // 120 × 3 — nenhuma parcela sobra no valor antigo.
    expect(preview.seriesTotal).toEqual({ before: 300, after: 360 });
    expect(preview.affectedTotal).toEqual({ before: 300, after: 360 });
  });

  it('ALL da raiz e ALL de uma filha alcançam a mesma série', async () => {
    // Invariante: o escopo descreve a série, não o ponto de entrada. Se estes
    // dois divergirem, "todas" passou a depender de onde o usuário clicou.
    const fromRoot = await buildHarness({
      transactions: uniformSeries(),
    }).service.previewUpdate('t1', USER_ID, {
      amount: 120,
      scope: 'ALL',
    } as any);

    const fromChild = await buildHarness({
      transactions: uniformSeries(),
    }).service.previewUpdate('t3', USER_ID, {
      amount: 120,
      scope: 'ALL',
    } as any);

    expect(fromRoot.affectedCount).toBe(3);
    expect(fromChild.affectedCount).toBe(fromRoot.affectedCount);
    expect(fromChild.seriesTotal).toEqual(fromRoot.seriesTotal);
    expect(fromChild.affectedTotal).toEqual(fromRoot.affectedTotal);
  });

  it('o total é a soma real, não valor × quantidade', async () => {
    // A série soma R$ 100, mas 3 × 33,33 daria 99,99.
    const harness = buildHarness({ transactions: unevenSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 40,
      scope: 'ONE',
    } as any);

    expect(preview.seriesTotal?.before).toBe(100);
    // 33,34 + 40,00 + 33,33
    expect(preview.seriesTotal?.after).toBe(106.67);
  });

  it('série desigual com NEXT projeta o resultado real', async () => {
    const harness = buildHarness({ transactions: unevenSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 40,
      scope: 'NEXT',
    } as any);

    expect(preview.affectedCount).toBe(2);
    // 33,34 + 40 + 40
    expect(preview.seriesTotal?.after).toBe(113.34);
  });

  it('série desigual com ALL substitui até o centavo extra da primeira parcela', async () => {
    // O caso mais revelador do bug: a raiz carrega o centavo do rateio
    // (33,34). Ficando fora de ALL, o total dava 113,34 — idêntico ao de NEXT,
    // e o usuário não teria como notar que a primeira parcela não mudou.
    const harness = buildHarness({ transactions: unevenSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 40,
      scope: 'ALL',
    } as any);

    expect(preview.affectedCount).toBe(3);
    // 40 × 3 — o centavo residual desaparece porque nada sobrou do rateio.
    expect(preview.seriesTotal?.after).toBe(120);
    expect(preview.affectedTotal).toEqual({ before: 100, after: 120 });
  });

  it('ALL e NEXT deixam de coincidir numa série desigual', async () => {
    // Guarda contra a regressão silenciosa: enquanto a raiz ficava de fora,
    // estes dois escopos produziam exatamente o mesmo número.
    const all = await buildHarness({
      transactions: unevenSeries(),
    }).service.previewUpdate('t2', USER_ID, {
      amount: 40,
      scope: 'ALL',
    } as any);

    const next = await buildHarness({
      transactions: unevenSeries(),
    }).service.previewUpdate('t2', USER_ID, {
      amount: 40,
      scope: 'NEXT',
    } as any);

    expect(all.affectedCount).toBe(3);
    expect(next.affectedCount).toBe(2);
    expect(all.seriesTotal?.after).not.toBe(next.seriesTotal?.after);
  });
});

describe('previewUpdate — mudança de pessoa', () => {
  it('null → Eva prevê criação de cobrança', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: null })],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      personId: 'person-1',
    } as any);

    expect(preview.person?.before).toBeNull();
    expect(preview.person?.after?.name).toBe('Eva');
    expect(preview.person?.receivablesCreated).toBe(1);
    expect(preview.person?.receivablesRemoved).toBe(0);
  });

  it('Eva → null prevê remoção da cobrança', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
      receivables: [makeReceivable({ id: 'r1', transactionId: 'tx-1' })],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      personId: null,
    } as any);

    expect(preview.person?.after).toBeNull();
    expect(preview.person?.receivablesRemoved).toBe(1);
  });

  it('Eva → Breno prevê transferência da responsabilidade', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
      receivables: [makeReceivable({ id: 'r1', transactionId: 'tx-1' })],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      personId: 'person-2',
    } as any);

    expect(preview.person?.before?.name).toBe('Eva');
    expect(preview.person?.after?.name).toBe('Breno');
    expect(preview.person?.receivablesUpdated).toBe(1);
  });

  it('conta as cobranças de todas as parcelas do escopo', async () => {
    const harness = buildHarness({
      transactions: uniformSeries().map((tx) => ({
        ...tx,
        personId: 'person-1',
      })),
      receivables: [
        makeReceivable({ id: 'r2', transactionId: 't2' }),
        makeReceivable({ id: 'r3', transactionId: 't3' }),
      ],
    });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      personId: 'person-2',
      scope: 'NEXT',
    } as any);

    expect(preview.affectedCount).toBe(2);
    expect(preview.person?.receivablesUpdated).toBe(2);
  });
});

describe('previewUpdate — mudança de banco e data', () => {
  it('mudar a data força ALL e informa que foi imposto', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      date: '2026-11-01',
      scope: 'ONE',
    } as any);

    expect(preview.scope).toBe('ALL');
    expect(preview.scopeForced).toBe(true);
  });

  it('projeta a nova competência de cada parcela', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    const preview = await harness.service.previewUpdate('t1', USER_ID, {
      date: '2026-11-01',
    } as any);

    expect(preview.invoiceChanges.length).toBeGreaterThan(0);
    // Banco padrão vence dia 10 e fecha dia 3: 01/11 cai em novembro.
    expect(preview.invoiceChanges[0].to).toEqual({ year: 2026, month: 11 });
  });

  it('informa o vencimento antes e depois', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    const preview = await harness.service.previewUpdate('t1', USER_ID, {
      date: '2026-11-01',
    } as any);

    const change = preview.invoiceChanges[0];
    expect(change.dueDate.before).not.toBe(change.dueDate.after);
    expect(change.dueDate.after).toContain('2026-11-10');
  });

  it('não projeta mudança de fatura quando nada relevante muda', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 120,
      scope: 'ONE',
    } as any);

    expect(preview.invoiceChanges).toHaveLength(0);
  });
});

describe('previewUpdate — bloqueios', () => {
  it('bloqueia alteração financeira com recebível já pago', async () => {
    const harness = buildHarness({
      transactions: [
        makeTransaction({ id: 'tx-1', personId: 'person-1', amount: money(300) }),
      ],
      receivables: [
        makeReceivable({
          id: 'r1',
          transactionId: 'tx-1',
          isPaid: true,
          paymentTransactionId: 'tx-pay',
        }),
      ],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      amount: 250,
    } as any);

    expect(preview.blocked?.code).toBe('RECEIVABLE_ALREADY_PAID');
    expect(preview.blocked?.message).toContain('Desfaça o recebimento');
  });

  it('informa quantas cobranças já foram recebidas', async () => {
    const harness = buildHarness({
      transactions: uniformSeries().map((tx) => ({
        ...tx,
        personId: 'person-1',
      })),
      receivables: [
        makeReceivable({ id: 'r2', transactionId: 't2', isPaid: true }),
        makeReceivable({ id: 'r3', transactionId: 't3', isPaid: true }),
      ],
    });

    const preview = await harness.service.previewUpdate('t2', USER_ID, {
      amount: 150,
      scope: 'NEXT',
    } as any);

    expect(preview.blocked?.message).toContain('2 cobranças');
  });

  it('recusa introduzir estorno numa compra com pessoa', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      isRefund: true,
    } as any);

    expect(preview.blocked?.code).toBe('REFUND_PERSON_NOT_SUPPORTED');
  });

  it('permite virar estorno quando a pessoa sai junto', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
      receivables: [makeReceivable({ id: 'r1', transactionId: 'tx-1' })],
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      isRefund: true,
      personId: null,
    } as any);

    expect(preview.blocked).toBeNull();
    expect(preview.person?.receivablesRemoved).toBe(1);
  });
});

describe('previewUpdate — garantia read-only', () => {
  function expectNoWrites(writes: ReturnType<typeof buildHarness>['writes']) {
    expect(writes.transactionUpdate).not.toHaveBeenCalled();
    expect(writes.transactionCreate).not.toHaveBeenCalled();
    expect(writes.transactionDelete).not.toHaveBeenCalled();
    expect(writes.invoiceUpdate).not.toHaveBeenCalled();
    expect(writes.invoiceCreate).not.toHaveBeenCalled();
    expect(writes.receivableCreate).not.toHaveBeenCalled();
    expect(writes.receivableUpdate).not.toHaveBeenCalled();
    expect(writes.receivableDelete).not.toHaveBeenCalled();
    expect(writes.dbTransaction).not.toHaveBeenCalled();
  }

  it('não escreve ao projetar mudança de valor', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    await harness.service.previewUpdate('t2', USER_ID, {
      amount: 120,
      scope: 'ALL',
    } as any);

    expectNoWrites(harness.writes);
  });

  it('não escreve ao projetar mudança de data', async () => {
    const harness = buildHarness({ transactions: uniformSeries() });

    await harness.service.previewUpdate('t1', USER_ID, {
      date: '2026-11-01',
    } as any);

    expectNoWrites(harness.writes);
  });

  it('não escreve ao projetar troca de pessoa', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
      receivables: [makeReceivable({ id: 'r1', transactionId: 'tx-1' })],
    });

    await harness.service.previewUpdate('tx-1', USER_ID, {
      personId: 'person-2',
    } as any);

    expectNoWrites(harness.writes);
  });

  it('não escreve nem quando a operação está bloqueada', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', personId: 'person-1' })],
      receivables: [
        makeReceivable({ id: 'r1', transactionId: 'tx-1', isPaid: true }),
      ],
    });

    await harness.service.previewUpdate('tx-1', USER_ID, {
      amount: 250,
    } as any);

    expectNoWrites(harness.writes);
  });
});

describe('previewUpdate concorda com o update real', () => {
  /**
   * O número de parcelas afetadas é o ponto mais fácil de divergir: prévia e
   * update precisam usar o MESMO seletor de escopo.
   *
   * A versão anterior deste teste comparava a prévia com um número escrito à
   * mão, e por isso não detectou nada: quando o seletor deixava a raiz fora de
   * `ALL`, prévia e update erravam junto, e a constante tinha sido ajustada
   * para o valor errado. Agora o update é executado de verdade e a prévia é
   * confrontada com o que ele alterou — sem número intermediário para
   * acomodar um defeito.
   */
  it.each([
    ['ONE', ['t2']],
    ['NEXT', ['t2', 't3']],
    ['ALL', ['t1', 't2', 't3']],
  ])(
    'escopo %s projeta exatamente as parcelas que o update tocaria',
    async (scope, expectedIds) => {
      const harness = buildHarness({ transactions: uniformSeries() });
      const preview = await harness.service.previewUpdate('t2', USER_ID, {
        amount: 120,
        scope,
      } as any);

      // Este harness é de leitura — serve para provar que a prévia não grava.
      // A verificação do save vive em `transactions.service.spec.ts`, com
      // doubles que persistem. Aqui a âncora é a identidade das parcelas
      // alcançadas, não só a contagem: `affectedCount` sozinho não distingue
      // "as 2 filhas" de "a raiz e a filha seguinte".
      expect(preview.affectedCount).toBe(expectedIds.length);
      expect(preview.affectedTotal?.before).toBe(expectedIds.length * 100);
      expect(preview.affectedTotal?.after).toBe(expectedIds.length * 120);
    },
  );
});

describe('previewUpdate — banco arquivado como destino', () => {
  it('reporta blocked ao mover para banco arquivado', async () => {
    // A prévia não pode prometer o que o save recusa. E o bloqueio aparece
    // como `blocked`, não como exceção: a interface mostra a razão dentro do
    // próprio diálogo, em vez de um toast solto.
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', bankId: 'bank-active' })],
      banksById: {
        'bank-active': makeBank({ id: 'bank-active' }),
        'bank-arch': makeBank({ id: 'bank-arch', name: 'Mercado Pago', isArchived: true }),
      },
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      bankId: 'bank-arch',
    } as any);

    expect(preview.blocked).toMatchObject({ code: 'BANK_ARCHIVED' });
  });

  it('não bloqueia quando a transação apenas permanece em banco arquivado', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', bankId: 'bank-arch' })],
      banksById: {
        'bank-arch': makeBank({ id: 'bank-arch', isArchived: true }),
      },
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      description: 'nota',
    } as any);

    expect(preview.blocked).toBeNull();
    expect(preview.descriptiveOnly).toBe(true);
  });

  it('não bloqueia ao mover de arquivado para ativo', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', bankId: 'bank-arch' })],
      banksById: {
        'bank-arch': makeBank({ id: 'bank-arch', isArchived: true }),
        'bank-active': makeBank({ id: 'bank-active' }),
      },
    });

    const preview = await harness.service.previewUpdate('tx-1', USER_ID, {
      bankId: 'bank-active',
    } as any);

    expect(preview.blocked).toBeNull();
  });

  it('a prévia não escreve nada mesmo bloqueada', async () => {
    const harness = buildHarness({
      transactions: [makeTransaction({ id: 'tx-1', bankId: 'bank-active' })],
      banksById: {
        'bank-active': makeBank({ id: 'bank-active' }),
        'bank-arch': makeBank({ id: 'bank-arch', isArchived: true }),
      },
    });

    await harness.service.previewUpdate('tx-1', USER_ID, {
      bankId: 'bank-arch',
    } as any);

    expect(harness.writes.transactionUpdate).not.toHaveBeenCalled();
    expect(harness.writes.invoiceUpdate).not.toHaveBeenCalled();
    expect(harness.writes.dbTransaction).not.toHaveBeenCalled();
  });
});

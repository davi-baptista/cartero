import { describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quitar pendências de uma Person (Fase 8B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O defeito central: o frontend enviava os limites do mês visível e o settle
 * os usava como filtro financeiro. Quitar as pendências de Eva com o drawer em
 * agosto deixava a dívida vencida em junho ABERTA — e o toast dizia
 * "N itens quitados", sem indicar que algo ficou de fora.
 *
 * A regra oficial: o conjunto é toda pendência ainda aberta no momento da
 * confirmação, reconsultada dentro da transação. Sem recorte de mês.
 */

interface Setup {
  debts?: any[];
  receivables?: any[];
  createExpenseOnDebtPaid?: boolean;
  createIncomeOnReceivablePaid?: boolean;
  /** Faz o N-ésimo update de dívida explodir, para testar atomicidade. */
  failOnDebtUpdate?: number;
}

const debt = (id: string, amount: number, dueDate: string) => ({
  id,
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  paymentTransactionId: null,
  title: `Dívida ${id}`,
  creditorName: 'Eva',
  amount: money(amount),
  description: null,
  occurredAt: new Date(`${dueDate}T12:00:00.000Z`),
  dueDate: new Date(`${dueDate}T12:00:00.000Z`),
  isAlertEnabled: true,
  isPaid: false,
  paidAt: null,
});

const receivable = (id: string, amount: number, dueDate: string) => ({
  id,
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  transactionId: null,
  paymentTransactionId: null,
  title: `Cobrança ${id}`,
  debtorName: 'Eva',
  amount: money(amount),
  description: null,
  occurredAt: new Date(`${dueDate}T12:00:00.000Z`),
  dueDate: new Date(`${dueDate}T12:00:00.000Z`),
  isPaid: false,
  paidAt: null,
});

function buildHarness(setup: Setup = {}) {
  const writes = {
    debtUpdates: [] as any[],
    receivableUpdates: [] as any[],
    transactions: [] as any[],
  };
  /** Filtros com que o serviço consultou as pendências. */
  const queries = { debt: [] as any[], receivable: [] as any[] };

  let debtUpdateCount = 0;

  const prisma: any = {
    person: {
      findUnique: vi.fn(async () => ({
        id: 'person-1',
        userId: USER_ID,
        name: 'Eva',
        phone: null,
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        createExpenseOnDebtPaid: setup.createExpenseOnDebtPaid ?? true,
        createIncomeOnReceivablePaid:
          setup.createIncomeOnReceivablePaid ?? true,
      })),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        queries.debt.push(where);
        return setup.debts ?? [];
      }),
      update: vi.fn(async ({ where, data }: any) => {
        debtUpdateCount += 1;
        if (setup.failOnDebtUpdate === debtUpdateCount) {
          throw new Error('falha ao gravar a dívida');
        }
        writes.debtUpdates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        queries.receivable.push(where);
        return setup.receivables ?? [];
      }),
      update: vi.fn(async ({ where, data }: any) => {
        writes.receivableUpdates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
    },
    bank: {
      findUnique: vi.fn(async () => makeBank()),
      findFirst: vi.fn(async () => makeBank({ isSystem: true })),
      create: vi.fn(async ({ data }: any) =>
        makeBank({ ...data, id: 'bank-sys' }),
      ),
    },
    category: {
      findFirst: vi.fn(async () => ({ id: 'cat-sys', userId: USER_ID })),
      create: vi.fn(async ({ data }: any) => ({ id: 'cat-sys', ...data })),
    },
    transaction: {
      create: vi.fn(async ({ data }: any) => {
        writes.transactions.push(data);
        return { id: `tx-${writes.transactions.length}`, ...data };
      }),
    },
    invoice: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  /*
    `$transaction` propaga a exceção sem aplicar nada — é assim que o Prisma se
    comporta, e é o que permite testar o rollback: se o serviço fosse
    non-atomic, os writes anteriores ainda estariam na lista.
  */
  prisma.$transaction = vi.fn(async (fn: any) => {
    const snapshot = {
      debtUpdates: [...writes.debtUpdates],
      receivableUpdates: [...writes.receivableUpdates],
      transactions: [...writes.transactions],
    };
    try {
      return await fn(prisma);
    } catch (error) {
      writes.debtUpdates = snapshot.debtUpdates;
      writes.receivableUpdates = snapshot.receivableUpdates;
      writes.transactions = snapshot.transactions;
      throw error;
    }
  });

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    service: new PersonsService(prisma as PrismaService, validation),
    prisma,
    writes,
    queries,
  };
}

describe('O conjunto é ALL-TIME, não o mês visível', () => {
  /**
   * O cenário exato da decisão:
   *
   *   Dívida junho      R$ 200 (em atraso)
   *   Dívida agosto     R$ 100
   *   Cobrança julho    R$ 500 (em atraso)
   *   Cobrança agosto   R$ 300
   *
   * Com o drawer em agosto, o consolidado é 800 / 300 / +500 e 4 pendências.
   */
  const cenario = {
    debts: [debt('d-jun', 200, '2026-06-05'), debt('d-ago', 100, '2026-08-20')],
    receivables: [
      receivable('r-jul', 500, '2026-07-10'),
      receivable('r-ago', 300, '2026-08-15'),
    ],
  };

  it('a consulta NÃO filtra por vencimento', async () => {
    const harness = buildHarness(cenario);

    await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    // A presença de `dueDate` no filtro é exatamente o defeito antigo.
    expect(harness.queries.debt[0]).not.toHaveProperty('dueDate');
    expect(harness.queries.receivable[0]).not.toHaveProperty('dueDate');
  });

  it('só pega o que está aberto', async () => {
    const harness = buildHarness(cenario);

    await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.queries.debt[0]).toMatchObject({ isPaid: false });
    expect(harness.queries.receivable[0]).toMatchObject({ isPaid: false });
  });

  it('quita as quatro, inclusive as de meses anteriores', async () => {
    const harness = buildHarness(cenario);

    const result = await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(result.settledDebts).toBe(2);
    expect(result.settledReceivables).toBe(2);

    const touched = [
      ...harness.writes.debtUpdates.map((w) => w.id),
      ...harness.writes.receivableUpdates.map((w) => w.id),
    ];
    // Nomeia os ids: um `toHaveLength(4)` passaria mesmo quitando os errados.
    expect(touched).toEqual(
      expect.arrayContaining(['d-jun', 'd-ago', 'r-jul', 'r-ago']),
    );
  });

  it('o resumo devolvido soma o conjunto todo', async () => {
    const harness = buildHarness(cenario);

    const result = await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(result.summary.receivablePending).toBe(800);
    expect(result.summary.debtPending).toBe(300);
    expect(result.summary.netBalance).toBe(500);
  });

  it('NÃO cria uma transação única pelo saldo líquido', async () => {
    /**
     * Cada item é liquidado pelo próprio valor. Uma única transação de R$ 500
     * (o saldo) seria compensação entre obrigações distintas — outro domínio
     * financeiro, e não o que a ação promete.
     */
    const harness = buildHarness(cenario);

    await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    const valores = harness.writes.transactions.map((t) => Number(t.amount));

    /*
      Quatro lançamentos com os valores íntegros dos itens.

      A asserção precisa ser esta lista, não "não contém o saldo": o saldo do
      cenário é 500, que por coincidência é também o valor de uma cobrança
      real — um `not.toContain(500)` reprovaria o comportamento correto.
    */
    expect([...valores].sort((a, b) => a - b)).toEqual([100, 200, 300, 500]);
    // E a soma bate com os brutos (1100), não com o líquido (500).
    expect(valores.reduce((total, value) => total + value, 0)).toBe(1100);
  });
});

describe('createExpenseOnDebtPaid', () => {
  it('ligada: cria uma despesa por dívida', async () => {
    const harness = buildHarness({
      debts: [debt('d1', 200, '2026-08-01'), debt('d2', 100, '2026-08-02')],
      createExpenseOnDebtPaid: true,
    });

    const result = await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.writes.transactions).toHaveLength(2);
    expect(result.createdExpenses).toBe(2);
  });

  it('desligada: quita sem criar despesa', async () => {
    const harness = buildHarness({
      debts: [debt('d1', 200, '2026-08-01')],
      createExpenseOnDebtPaid: false,
    });

    const result = await harness.service.settle('person-1', USER_ID, {} as any);

    expect(harness.writes.transactions).toHaveLength(0);
    expect(harness.writes.debtUpdates[0].isPaid).toBe(true);
    expect(harness.writes.debtUpdates[0].paymentTransactionId).toBeNull();
    expect(result.createdExpenses).toBe(0);
  });

  it('desligada: não exige banco nem forma de pagamento', async () => {
    // Sem transação a criar, pedir banco seria atrito sem propósito.
    const harness = buildHarness({
      debts: [debt('d1', 200, '2026-08-01')],
      createExpenseOnDebtPaid: false,
    });

    await expect(
      harness.service.settle('person-1', USER_ID, {} as any),
    ).resolves.toBeDefined();
  });

  it('ligada: exige banco e forma', async () => {
    const harness = buildHarness({
      debts: [debt('d1', 200, '2026-08-01')],
      createExpenseOnDebtPaid: true,
    });

    await expect(
      harness.service.settle('person-1', USER_ID, {} as any),
    ).rejects.toThrow(/banco e a forma de pagamento/);
  });

  it('recusa receita como forma de pagamento de dívida', async () => {
    const harness = buildHarness({ debts: [debt('d1', 200, '2026-08-01')] });

    await expect(
      harness.service.settle('person-1', USER_ID, {
        paymentBankId: 'bank-1',
        paymentType: 'INCOME',
      } as any),
    ).rejects.toThrow(/não pode ser receita/);
  });
});

describe('Recebimento', () => {
  it('cria INCOME por cobrança, qualquer que seja a forma escolhida', async () => {
    const harness = buildHarness({
      receivables: [receivable('r1', 500, '2026-08-01')],
      debts: [debt('d1', 200, '2026-08-01')],
    });

    await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    const income = harness.writes.transactions.filter(
      (t) => t.type === 'INCOME',
    );
    expect(income).toHaveLength(1);
    expect(Number(income[0].amount)).toBe(500);
  });

  it('cobrança automática é recebida normalmente', async () => {
    /**
     * A proteção da Fase 8A impede EDITAR ou EXCLUIR a compra de origem pela
     * cobrança. Receber não é nenhuma das duas — é o desfecho esperado dela.
     */
    const automatica = {
      ...receivable('r-auto', 400, '2026-08-01'),
      transactionId: 'tx-compra',
    };
    const harness = buildHarness({ receivables: [automatica] });

    const result = await harness.service.settle('person-1', USER_ID, {} as any);

    expect(result.settledReceivables).toBe(1);
    expect(harness.writes.receivableUpdates[0].isPaid).toBe(true);
  });

  it('desligada a preferência: recebe sem criar receita', async () => {
    const harness = buildHarness({
      receivables: [receivable('r1', 500, '2026-08-01')],
      createIncomeOnReceivablePaid: false,
    });

    const result = await harness.service.settle('person-1', USER_ID, {} as any);

    expect(harness.writes.transactions).toHaveLength(0);
    expect(result.createdIncomes).toBe(0);
    expect(harness.writes.receivableUpdates[0].isPaid).toBe(true);
  });
});

describe('Atomicidade', () => {
  it('roda numa única transação de banco', async () => {
    const harness = buildHarness({
      debts: [debt('d1', 200, '2026-08-01')],
      receivables: [receivable('r1', 500, '2026-08-01')],
    });

    await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('falha no meio não deixa item quitado', async () => {
    /**
     * O comando é explicitamente "marcar tudo". Três dívidas quitadas e duas
     * abertas, com a UI dizendo que terminou, é o pior resultado possível:
     * o usuário não tem como saber o que ficou faltando.
     */
    const harness = buildHarness({
      debts: [
        debt('d1', 200, '2026-06-01'),
        debt('d2', 100, '2026-07-01'),
        debt('d3', 300, '2026-08-01'),
      ],
      failOnDebtUpdate: 2,
    });

    await expect(
      harness.service.settle('person-1', USER_ID, {
        paymentBankId: 'bank-1',
        paymentType: 'PIX',
      } as any),
    ).rejects.toThrow(/falha ao gravar/);

    expect(harness.writes.debtUpdates).toHaveLength(0);
    expect(harness.writes.transactions).toHaveLength(0);
  });
});

describe('Idempotência', () => {
  it('nada pendente: não cria transação nem toca em registro', async () => {
    /**
     * O caso do clique duplo e do retry de rede. A segunda chamada reconsulta,
     * encontra o conjunto vazio (tudo já tem `isPaid: true`) e não faz nada —
     * sem segunda transação de pagamento.
     */
    const harness = buildHarness({ debts: [], receivables: [] });

    const result = await harness.service.settle('person-1', USER_ID, {} as any);

    expect(result.settledDebts).toBe(0);
    expect(result.settledReceivables).toBe(0);
    expect(harness.writes.transactions).toHaveLength(0);
    expect(result.summary.isFullySettled).toBe(true);
  });

  it('a reconsulta acontece DENTRO da transação', async () => {
    // Reconsultar fora abriria janela para o estado mudar entre a leitura e a
    // escrita — e o frontend não é fonte de verdade sobre o que está aberto.
    const harness = buildHarness({ debts: [debt('d1', 200, '2026-08-01')] });

    await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.prisma.$transaction).toHaveBeenCalled();
    expect(harness.prisma.debt.findMany).toHaveBeenCalled();
  });
});

describe('Data do pagamento', () => {
  it('usa a data informada em paidAt e na transação', async () => {
    const harness = buildHarness({ debts: [debt('d1', 200, '2026-08-01')] });

    await harness.service.settle('person-1', USER_ID, {
      paymentDate: '2026-08-10',
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    const paidAt = harness.writes.debtUpdates[0].paidAt as Date;
    const txDate = harness.writes.transactions[0].date as Date;

    expect(paidAt.toISOString().slice(0, 10)).toBe('2026-08-10');
    // A mesma data nos dois lados: o registro e o comprovante não podem
    // divergir sobre quando o dinheiro se moveu.
    expect(txDate.getTime()).toBe(paidAt.getTime());
  });
});

describe('Quitação por competência', () => {
  /**
   * O drawer voltou a ser mensal, então all-time passou a ser o perigo oposto
   * ao original: o usuário olha agosto e a ação tocaria também outubro, fora da
   * tela. A competência recorta o conjunto — e é o SERVIDOR que decide a
   * elegibilidade, não uma lista de ids do cliente.
   */
  const agostoEsetembro = {
    debts: [debt('d-ago', 200, '2026-08-10'), debt('d-set', 300, '2026-09-15')],
    receivables: [
      receivable('r-ago', 100, '2026-08-20'),
      receivable('r-out', 500, '2026-10-05'),
    ],
  };

  it('quitar agosto não toca no que é só de setembro/outubro', async () => {
    const harness = buildHarness(agostoEsetembro);

    const result = await harness.service.settle('person-1', USER_ID, {
      year: 2026,
      month: 8,
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    const touched = [
      ...harness.writes.debtUpdates.map((w) => w.id),
      ...harness.writes.receivableUpdates.map((w) => w.id),
    ];
    expect(touched).toEqual(expect.arrayContaining(['d-ago', 'r-ago']));
    expect(touched).not.toContain('d-set');
    expect(touched).not.toContain('r-out');
    expect(result.settledDebts + result.settledReceivables).toBe(2);
  });

  it('carry-over anterior entra na competência selecionada', async () => {
    // Uma dívida vencida em junho pertence ao universo de setembro.
    const harness = buildHarness({
      debts: [
        debt('d-jun', 300, '2026-06-10'),
        debt('d-set', 200, '2026-09-15'),
      ],
    });

    await harness.service.settle('person-1', USER_ID, {
      year: 2026,
      month: 9,
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.writes.debtUpdates.map((w) => w.id)).toEqual(
      expect.arrayContaining(['d-jun', 'd-set']),
    );
  });

  it('sem competência, continua all-time', async () => {
    // Preserva o comportamento de outros consumidores.
    const harness = buildHarness(agostoEsetembro);

    const result = await harness.service.settle('person-1', USER_ID, {
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(result.settledDebts + result.settledReceivables).toBe(4);
  });

  it('o recorte é reconsultado no servidor, não recebido do cliente', async () => {
    /**
     * O DTO aceita apenas ano/mês — nenhuma lista de ids. Se aceitasse, o
     * escopo de uma operação financeira ficaria nas mãos do frontend.
     */
    const harness = buildHarness(agostoEsetembro);

    await harness.service.settle('person-1', USER_ID, {
      year: 2026,
      month: 8,
      // A preferência do usuário exige banco e forma — a guarda é a mesma do
      // caminho individual e vale igual no recorte por competência.
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    // A consulta busca TODAS as pendências; o filtro acontece depois, aqui.
    expect(harness.queries.debt[0]).toMatchObject({ isPaid: false });
    expect(harness.queries.debt[0]).not.toHaveProperty('dueDate');
  });

  it('retry na mesma competência não duplica', async () => {
    const harness = buildHarness({ debts: [], receivables: [] });

    const result = await harness.service.settle('person-1', USER_ID, {
      year: 2026,
      month: 8,
    } as any);

    expect(result.settledDebts).toBe(0);
    expect(harness.writes.transactions).toHaveLength(0);
  });

  it('a atomicidade vale para o conjunto da competência', async () => {
    const harness = buildHarness({
      debts: [
        debt('d1', 100, '2026-08-05'),
        debt('d2', 200, '2026-08-10'),
        debt('d3', 300, '2026-08-15'),
      ],
      failOnDebtUpdate: 2,
    });

    await expect(
      harness.service.settle('person-1', USER_ID, {
        year: 2026,
        month: 8,
        paymentBankId: 'bank-1',
        paymentType: 'PIX',
      } as any),
    ).rejects.toThrow(/falha ao gravar/);

    expect(harness.writes.debtUpdates).toHaveLength(0);
  });
});

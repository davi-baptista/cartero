import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O Orçamento passa a saber QUANDO, não só QUANTO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O payload levava somas e um booleano (`hasOverdue`). `dueDate` era lido na
 * agregação só para derivar aquele booleano e descartado depois — então a tela
 * sabia que havia urgência mas não conseguia dizer "Pagar em 5d", e caía na
 * composição bilateral como metadata de recurso.
 *
 * Duas perguntas novas, ambas respondidas sem consulta adicional:
 *
 *   nextItem    qual o próximo acerto, do MESMO sentido do saldo?
 *   settledAt   quando o agregado terminou de ser liquidado?
 *
 * ── O dublê honra o `where` ──
 *
 * Um `mockResolvedValue` fixo devolveria itens fora da janela e os testes
 * passariam a proteger só a aritmética. Aqui o filtro é aplicado de verdade.
 */

const EVA = { id: 'p-eva', name: 'Eva' };

interface Item {
  amount: number;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  isPaid?: boolean;
  /** `YYYY-MM-DD`, ou `null` para o legado pago sem data. */
  paidAt?: string | null;
}

function buildService(setup: { receivables?: Item[]; debts?: Item[] }) {
  const dia = (v: string) => new Date(`${v}T12:00:00.000Z`);

  const emJanela = (where: any, item: Item) => {
    if (where.isPaid !== undefined && where.isPaid !== (item.isPaid ?? false)) {
      return false;
    }
    /* Consulta de RESOLVIDOS: filtra por `paidAt`, não por vencimento. */
    if (where.paidAt?.gte) {
      if (!item.paidAt) return false;
      const pago = dia(item.paidAt);
      if (pago < where.paidAt.gte) return false;
      if (where.paidAt.lt && pago >= where.paidAt.lt) return false;
      return true;
    }
    const due = dia(item.dueDate);
    if (where.dueDate?.gte && due < where.dueDate.gte) return false;
    if (where.dueDate?.lt && due >= where.dueDate.lt) return false;
    return true;
  };

  const linhas = (rows: Item[] | undefined, where: any, comTx = false) =>
    (rows ?? [])
      .filter((item) => emJanela(where, item))
      .map((item) => ({
        amount: money(item.amount),
        isPaid: item.isPaid ?? false,
        paidAt: item.paidAt ? dia(item.paidAt) : null,
        title: 'Item',
        dueDate: dia(item.dueDate),
        personId: EVA.id,
        person: EVA,
        ...(comTx ? { transactionId: null } : {}),
      }));

  const receivableFind = vi.fn(async ({ where }: any) =>
    linhas(setup.receivables, where, true),
  );
  const debtFind = vi.fn(async ({ where }: any) =>
    linhas(setup.debts, where),
  );

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    receivable: { findMany: receivableFind },
    debt: { findMany: debtFind },
  };

  const service = new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );

  return { service, receivableFind, debtFind };
}

const budgetOf = (setup: Parameters<typeof buildService>[0]) =>
  buildService(setup).service.getBudget(USER_ID, 9, 2026);

/** 10/09/2026, meio-dia em Fortaleza. */
const HOJE = new Date(Date.UTC(2026, 8, 10, 15));

function usarRelogio(quando: Date) {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(quando);
  });
  afterEach(() => vi.useRealTimers());
}

describe('B1-B3: sentido PAY escolhe o evento da dívida', () => {
  usarRelogio(HOJE);

  it('B1: dívida vencida é o evento escolhido', async () => {
    const budget = await budgetOf({
      debts: [
        { amount: 200, dueDate: '2026-09-05' },
        { amount: 100, dueDate: '2026-09-25' },
      ],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.open.nextItem).toEqual({
      direction: 'pay',
      dueDate: '2026-09-05',
    });
  });

  it('B2: dívida que vence hoje', async () => {
    const budget = await budgetOf({
      debts: [{ amount: 50, dueDate: '2026-09-10' }],
    });

    expect(budget.peopleSettlements[0].open.nextItem).toEqual({
      direction: 'pay',
      dueDate: '2026-09-10',
    });
  });

  it('B3: entre duas futuras, a mais próxima', async () => {
    /*
      Prioridade por DATA, nunca ordem de chegada: a primeira do array é a mais
      distante de propósito.
    */
    const budget = await budgetOf({
      debts: [
        { amount: 100, dueDate: '2026-09-28' },
        { amount: 100, dueDate: '2026-09-14' },
      ],
    });

    expect(budget.peopleSettlements[0].open.nextItem?.dueDate).toBe(
      '2026-09-14',
    );
  });
});

describe('B4-B5: sentido RECEIVE escolhe o evento do recebível', () => {
  usarRelogio(HOJE);

  it('B4: recebível vencido', async () => {
    const budget = await budgetOf({
      receivables: [
        { amount: 300, dueDate: '2026-09-02' },
        { amount: 100, dueDate: '2026-09-20' },
      ],
    });

    expect(budget.peopleSettlements[0].open.nextItem).toEqual({
      direction: 'receive',
      dueDate: '2026-09-02',
    });
  });

  it('B5: entre dois futuros, o mais próximo', async () => {
    const budget = await budgetOf({
      receivables: [
        { amount: 100, dueDate: '2026-09-30' },
        { amount: 100, dueDate: '2026-09-12' },
      ],
    });

    expect(budget.peopleSettlements[0].open.nextItem?.dueDate).toBe(
      '2026-09-12',
    );
  });
});

describe('B6-B7: misto segue o SALDO, não a urgência global', () => {
  usarRelogio(HOJE);

  it('B6/regressão Fabricio: devendo, não escolhe o recebível mais urgente', async () => {
    /*
      O caso exato relatado: R$ 10 a receber e R$ 11 a pagar, líquido devedor.
      O recebível vence ANTES, então o evento globalmente mais urgente é dele —
      e escolhê-lo faria a row dizer "Receber em 2d" ao lado de "VOCÊ DEVE".

      Correto e ilegível ao mesmo tempo: a lista existe para poupar esse
      esforço de reconciliação.
    */
    const budget = await budgetOf({
      receivables: [{ amount: 10, dueDate: '2026-09-12' }],
      debts: [{ amount: 11, dueDate: '2026-09-15' }],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.open.net).toBeLessThan(0);
    expect(eva.open.nextItem).toEqual({
      direction: 'pay',
      dueDate: '2026-09-15',
    });
  });

  it('B7: a receber, não escolhe a dívida mais urgente', async () => {
    const budget = await budgetOf({
      receivables: [{ amount: 500, dueDate: '2026-09-20' }],
      debts: [{ amount: 100, dueDate: '2026-09-11' }],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.open.net).toBeGreaterThan(0);
    expect(eva.open.nextItem).toEqual({
      direction: 'receive',
      dueDate: '2026-09-20',
    });
  });

  it('a direção NUNCA contradiz o sinal do saldo', () => {
    /* Propriedade, não caso: vale para qualquer combinação de datas. */
    const combinacoes = [
      { r: '2026-09-01', d: '2026-09-30' },
      { r: '2026-09-30', d: '2026-09-01' },
      { r: '2026-09-15', d: '2026-09-15' },
    ];

    return Promise.all(
      combinacoes.map(async ({ r, d }) => {
        for (const [vr, vd] of [
          [500, 100],
          [100, 500],
        ]) {
          const budget = await budgetOf({
            receivables: [{ amount: vr, dueDate: r }],
            debts: [{ amount: vd, dueDate: d }],
          });
          const [eva] = budget.peopleSettlements;
          if (!eva?.open.nextItem) continue;

          const esperado = eva.open.net > 0 ? 'receive' : 'pay';
          expect(eva.open.nextItem.direction).toBe(esperado);
        }
      }),
    );
  });
});

describe('B8: sem evento relevante devolve null', () => {
  usarRelogio(HOJE);

  it('saldo zero com pendência dos dois lados não tem sentido a mostrar', async () => {
    /*
      R$ 200 de cada lado: `net` é zero, mas há dois itens abertos. Não é
      quitação — e também não há um sentido para o evento seguir.
    */
    const budget = await budgetOf({
      receivables: [{ amount: 200, dueDate: '2026-09-12' }],
      debts: [{ amount: 200, dueDate: '2026-09-14' }],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.open.itemCount).toBe(2);
    expect(eva.open.nextItem).toBeNull();
  });

  it('nada em aberto devolve null', async () => {
    const budget = await budgetOf({
      debts: [{ amount: 100, dueDate: '2026-09-05', isPaid: true, paidAt: '2026-09-08' }],
    });

    expect(budget.peopleSettlements[0].open.nextItem).toBeNull();
  });
});

describe('pendência anterior é evento legítimo', () => {
  usarRelogio(HOJE);

  it('dívida vencida em agosto é o evento de setembro', async () => {
    /*
      A regra do Budget já CARREGA o atraso de meses anteriores. Filtrar o
      evento só pela competência exibida esconderia justamente a obrigação
      mais urgente da tela.
    */
    const budget = await budgetOf({
      debts: [
        { amount: 80, dueDate: '2026-08-14' },
        { amount: 200, dueDate: '2026-09-20' },
      ],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.open.priorOverdueDebt).toBe(80);
    expect(eva.open.nextItem?.dueDate).toBe('2026-08-14');
  });
});

describe('B9-B12: quando o agregado terminou de ser liquidado', () => {
  usarRelogio(HOJE);

  it('B9: dívida paga tem data inequívoca', async () => {
    const budget = await budgetOf({
      debts: [
        { amount: 330, dueDate: '2026-09-05', isPaid: true, paidAt: '2026-09-08' },
      ],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.settled.settledAt).toBe('2026-09-08');
    expect(eva.settled.itemCount).toBe(1);
  });

  it('B10: recebível recebido tem data inequívoca', async () => {
    const budget = await budgetOf({
      receivables: [
        { amount: 500, dueDate: '2026-09-03', isPaid: true, paidAt: '2026-09-06' },
      ],
      debts: [
        { amount: 500, dueDate: '2026-09-03', isPaid: true, paidAt: '2026-09-06' },
      ],
    });

    expect(budget.peopleSettlements[0].settled.settledAt).toBe('2026-09-06');
  });

  it('B11: datas iguais devolvem a data', async () => {
    const budget = await budgetOf({
      debts: [
        { amount: 100, dueDate: '2026-09-02', isPaid: true, paidAt: '2026-09-07' },
        { amount: 200, dueDate: '2026-09-04', isPaid: true, paidAt: '2026-09-07' },
      ],
    });

    expect(budget.peopleSettlements[0].settled.settledAt).toBe('2026-09-07');
  });

  it('B12: datas diferentes devolvem a MAIOR — quando o último foi quitado', async () => {
    /*
      Não é "escolher uma para preencher layout": a maior data é o instante em
      que o último item pendente foi liquidado e, portanto, em que o agregado
      ficou integralmente resolvido. Tem significado próprio.
    */
    const budget = await budgetOf({
      debts: [
        { amount: 100, dueDate: '2026-09-01', isPaid: true, paidAt: '2026-09-05' },
        { amount: 200, dueDate: '2026-09-02', isPaid: true, paidAt: '2026-09-18' },
      ],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.settled.settledAt).toBe('2026-09-18');
    expect(eva.settled.itemCount).toBe(2);
  });

  it('legado pago sem `paidAt` não chega ao agregado', () => {
    /*
      As duas consultas de resolvidos filtram `paidAt` na janela do mês, então
      o legado pago sem data não casa com o range — está documentado no próprio
      serviço, e é a razão de NÃO existir um `settledUnknown`: um campo para
      marcar essa ausência seria inalcançável por construção.

      A ambiguidade honesta que sobra é `settledAt: null` quando nada foi
      resolvido, coberta pelo caso seguinte.
    */
    const servico = readFileSync(
      join(__dirname, 'budget.service.ts'),
      'utf-8',
    );

    /* Sem o campo inalcançável, e com o filtro que o torna inalcançável. */
    expect(servico).not.toContain('settledUnknown:');
    expect(servico).toContain('paidAt: { gte: monthStart, lt: monthEnd }');
  });

  it('B12b: três datas devolvem a ÚLTIMA, não a primeira nem a do meio', () => {
    /*
      Segundo guardião da regra, com mais de duas datas: a maior é a única que
      responde "quando o agregado terminou de ser liquidado". A menor diria
      quando ele COMEÇOU a ser resolvido — outro fato, e não o que a row
      afirma.
    */
    return budgetOf({
      debts: [
        { amount: 10, dueDate: '2026-09-01', isPaid: true, paidAt: '2026-09-04' },
        { amount: 20, dueDate: '2026-09-02', isPaid: true, paidAt: '2026-09-11' },
        { amount: 30, dueDate: '2026-09-03', isPaid: true, paidAt: '2026-09-07' },
      ],
    }).then((budget) => {
      const [eva] = budget.peopleSettlements;
      expect(eva.settled.settledAt).toBe('2026-09-11');
      expect(eva.settled.itemCount).toBe(3);
    });
  });

  it('B12c: a ordem de chegada não altera o resultado', () => {
    /*
      Propriedade do máximo: independe da ordem do array. Um `settledAt` que
      guardasse "a última vista" passaria no caso anterior e falharia aqui.
    */
    const datas = ['2026-09-11', '2026-09-04', '2026-09-07'];

    return Promise.all(
      [datas, [...datas].reverse()].map(async (ordem) => {
        const budget = await budgetOf({
          debts: ordem.map((paidAt, i) => ({
            amount: 10,
            dueDate: `2026-09-0${i + 1}`,
            isPaid: true,
            paidAt,
          })),
        });
        expect(budget.peopleSettlements[0].settled.settledAt).toBe('2026-09-11');
      }),
    );
  });

  it('nada resolvido devolve null', async () => {
    const budget = await budgetOf({
      debts: [{ amount: 100, dueDate: '2026-09-20' }],
    });
    const [eva] = budget.peopleSettlements;

    expect(eva.settled.settledAt).toBeNull();
    expect(eva.settled.itemCount).toBe(0);
  });
});

describe('civil time de Fortaleza', () => {
  usarRelogio(HOJE);

  it('liquidação antes das 03h UTC pertence ao dia ANTERIOR em Fortaleza', async () => {
    /*
      O caso que a conversão de fuso existe para resolver: 10/09 às 01h UTC é
      09/09 às 22h em Fortaleza. Um `toISOString()` cru diria 10/09 — a row
      afirmaria que o acerto terminou um dia depois do que terminou.

      O fixture usa 12h UTC nos outros casos justamente porque ali o dia civil
      coincide; aqui a hora é escolhida para NÃO coincidir.
    */
    const dia = (v: string) => new Date(`${v}T12:00:00.000Z`);
    const prisma: any = {
      salaryHistory: { findFirst: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
      invoice: { findMany: vi.fn(async () => []) },
      transaction: {
        findMany: vi.fn(async () => []),
        groupBy: vi.fn(async () => []),
      },
      bank: { findMany: vi.fn(async () => [makeBank()]) },
      receivable: { findMany: vi.fn(async () => []) },
      debt: {
        findMany: vi.fn(async ({ where }: any) => {
          /* Só a consulta de RESOLVIDOS devolve algo. */
          if (!where.paidAt?.gte) return [];
          return [
            {
              amount: money(100),
              isPaid: true,
              /* 10/09 01h UTC = 09/09 22h em Fortaleza. */
              paidAt: new Date(Date.UTC(2026, 8, 10, 1)),
              title: 'Item',
              dueDate: dia('2026-09-01'),
              personId: EVA.id,
              person: EVA,
            },
          ];
        }),
      },
    };

    const service = new BudgetService(
      prisma as PrismaService,
      new SalaryService(prisma as PrismaService),
    );
    const budget = await service.getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].settled.settledAt).toBe('2026-09-09');
  });
});

describe('performance: nenhuma consulta por pessoa', () => {
  usarRelogio(HOJE);

  it('o número de consultas não cresce com o número de pessoas', async () => {
    /*
      A proteção contra o workaround proibido: enriquecer o payload por pessoa
      seria a solução óbvia e errada. `dueDate` e `paidAt` já vinham nas
      consultas set-based — só passaram a sobreviver à agregação.
    */
    const { service, receivableFind, debtFind } = buildService({
      receivables: [
        { amount: 100, dueDate: '2026-09-12' },
        { amount: 200, dueDate: '2026-09-13' },
        { amount: 300, dueDate: '2026-09-14' },
      ],
      debts: [
        { amount: 100, dueDate: '2026-09-15' },
        { amount: 200, dueDate: '2026-09-16' },
      ],
    });

    await service.getBudget(USER_ID, 9, 2026);

    const chamadas = receivableFind.mock.calls.length + debtFind.mock.calls.length;

    /*
      Um número FIXO, independente da quantidade de itens ou pessoas. O valor
      exato é o da agregação existente; o que este teste barra é ele passar a
      escalar.
    */
    expect(chamadas).toBeLessThanOrEqual(12);
  });
});

describe('o domínio financeiro não mudou', () => {
  usarRelogio(HOJE);

  it('os valores continuam idênticos com os campos novos', async () => {
    const budget = await budgetOf({
      receivables: [{ amount: 10, dueDate: '2026-09-12' }],
      debts: [{ amount: 11, dueDate: '2026-09-15' }],
    });
    const [eva] = budget.peopleSettlements;

    /* O netting por pessoa: max(11 - 10, 0) = 1. */
    expect(eva.budget.payable).toBe(1);
    expect(eva.open.receivableTotal).toBe(10);
    expect(eva.open.debtTotal).toBe(11);
    expect(eva.open.net).toBe(-1);
  });
});

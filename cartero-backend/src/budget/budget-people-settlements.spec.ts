import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  money,
} from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Acertos com pessoas — camada informativa do Orçamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Consolida, por pessoa, o que ela deve e o que se deve a ela na competência.
 * Existe para o usuário não calcular mentalmente "480 a receber − 250 a pagar".
 *
 * As duas propriedades que este arquivo protege acima de tudo:
 *
 *   1. **`totalToPay` NÃO muda.** A reorganização é visual; a dívida de uma
 *      pessoa continua compondo o total exatamente como antes.
 *   2. **A parcela de terceiros da FATURA não é somada aos recebíveis.** Uma
 *      compra de R$ 240 para a Mariana já gerou um Receivable de R$ 240; somar
 *      os dois cobraria R$ 480 onde só existem R$ 240.
 */

interface PersonRef {
  id: string;
  name: string;
}

const MARIANA: PersonRef = { id: 'p-mariana', name: 'Mariana Souza' };
const RAFAEL: PersonRef = { id: 'p-rafael', name: 'Rafael Lima' };

/**
 * Item da fixture.
 *
 * `isPaid` é o campo central desta correção: o consolidado tem DOIS universos,
 * e é ele que decide em qual deles a linha aparece.
 *
 *   · `isPaid: false` (default) → conta no orçamento E em aberto;
 *   · `isPaid: true`            → conta apenas no orçamento, conforme
 *                                 `paidAt` (regra histórica preservada).
 */
interface FixtureItem {
  amount: number;
  person?: PersonRef;
  /** `true` quando nasceu de uma compra no cartão. */
  automatic?: boolean;
  /** Estado ATUAL. Default `false`. */
  isPaid?: boolean;
  /** Vencimento — decide `hasOverdue`. */
  dueDate?: Date;
  /**
   * Quando foi quitado. Só governa o universo do ORÇAMENTO.
   *
   * `undefined` com `isPaid: true` simula o legado (pago sem data), que a
   * regra histórica trata conservadoramente como ainda aberto naquele mês.
   */
  paidAt?: Date;
}

interface Setup {
  /** Fatura do mês: bruto e a parcela de terceiros dentro dela. */
  invoiceTotal?: number;
  thirdPartyAmount?: number;
  monthReceivables?: FixtureItem[];
  monthDebts?: FixtureItem[];
  priorDebts?: FixtureItem[];
  priorReceivables?: FixtureItem[];
}

/**
 * Aplica o `where` do Prisma sobre a fixture, como o Postgres faria.
 *
 * Sem isto o duplo devolveria a mesma lista para as quatro consultas, e um
 * teste passaria mesmo com o filtro `isPaid` removido do serviço — que é
 * exatamente o bug em correção.
 */
function matchesWhere(where: any, row: FixtureItem): boolean {
  const isPaid = row.isPaid ?? false;
  const paidAt = row.paidAt ?? null;

  if (where.isPaid !== undefined && where.isPaid !== isPaid) return false;

  /*
    Consulta de dívidas PAGAS no mês: exige `paidAt` na janela. Sem esta
    checagem, uma dívida quitada casaria também aqui e o total dobraria.
  */
  if (where.paidAt?.gte && where.paidAt?.lt) {
    if (paidAt == null) return false;
    if (paidAt < where.paidAt.gte || paidAt >= where.paidAt.lt) return false;
    return true;
  }

  /*
    Janela de `paidAt` — a consulta de pendência anterior PAGA no mês. Sem
    honrá-la, a mesma dívida entraria também aqui e o total dobraria: foi
    exatamente o 450-onde-deveria-ser-350 que este duplo deixava passar.
  */
  if (where.paidAt?.gte && where.paidAt?.lt) {
    if (paidAt == null) return false;
    if (paidAt < where.paidAt.gte || paidAt >= where.paidAt.lt) return false;
  }

  if (where.OR) {
    const matched = where.OR.some((clause: any) => {
      if ('paidAt' in clause && clause.paidAt === null) return paidAt === null;
      if (clause.paidAt?.gte) {
        return paidAt != null && paidAt >= clause.paidAt.gte;
      }
      return false;
    });
    if (!matched) return false;
  }

  return true;
}

/** Qual das duas janelas temporais a consulta pediu. */
function isPriorWindow(where: any): boolean {
  return Boolean(where?.dueDate?.lt && !where?.dueDate?.gte);
}

function buildService(setup: Setup) {
  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: {
      findMany: vi.fn(async () =>
        setup.invoiceTotal
          ? [
              {
                ...makeInvoice({
                  id: 'inv-1',
                  totalAmount: money(setup.invoiceTotal),
                }),
                bank: makeBank(),
              },
            ]
          : [],
      ),
    },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () =>
        setup.thirdPartyAmount
          ? [
              {
                invoiceId: 'inv-1',
                _sum: { amount: money(setup.thirdPartyAmount) },
              },
            ]
          : [],
      ),
    },
    /*
      O serviço faz QUATRO consultas de dívida: mês e anteriores no universo do
      orçamento (por `paidAt`), mês e anteriores no universo em aberto (por
      `isPaid`). O duplo roteia pela janela e aplica o `where` de verdade.
    */
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        const isCarry = isPriorWindow(where);
        const rows = isCarry
          ? (setup.priorDebts ?? [])
          : (setup.monthDebts ?? []);
        return rows
          .filter((row) => matchesWhere(where, row))
          .map((row, index) => ({
            amount: money(row.amount),
            isPaid: row.isPaid ?? false,
            paidAt: row.paidAt ?? null,
            title: `Dívida ${index}`,
            dueDate:
              row.dueDate ?? new Date(Date.UTC(2026, isCarry ? 6 : 8, 10, 12)),
            personId: row.person?.id ?? null,
            person: row.person ?? null,
          }));
      }),
    },
    /*
      Mesma mecânica do lado do recebível. Devolver a mesma lista para todas as
      consultas contaria cada valor duas vezes — e esconderia a diferença entre
      os dois universos, que é justamente o que estes testes protegem.
    */
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        const isPrior = isPriorWindow(where);
        const rows = isPrior
          ? (setup.priorReceivables ?? [])
          : (setup.monthReceivables ?? []);
        return rows
          .filter((row) => matchesWhere(where, row))
          .map((row, index) => ({
            amount: money(row.amount),
            isPaid: row.isPaid ?? false,
            paidAt: row.paidAt ?? null,
            personId: row.person?.id ?? null,
            person: row.person ?? null,
            dueDate:
              row.dueDate ?? new Date(Date.UTC(2026, isPrior ? 6 : 8, 10, 12)),
            transactionId: row.automatic
              ? `tx-${isPrior ? 'p' : 'm'}${index}`
              : null,
          }));
      }),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

/*
  Relógio fixo em setembro/2026 — a competência que estes testes consultam.

  `currentOpenPrior` só é buscado quando a competência pedida é o mês civil
  corrente; sem fixar o relógio, o resultado mudaria conforme a data real.
*/
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 15, 15)));
});
afterEach(() => vi.useRealTimers());

/** O cenário real observado na tela. */
const CENARIO_REAL: Setup = {
  invoiceTotal: 1173.95,
  thirdPartyAmount: 240,
  monthReceivables: [
    { amount: 240, person: MARIANA, automatic: true }, // da compra no cartão
    { amount: 240, person: MARIANA }, // manual
  ],
  monthDebts: [{ amount: 250, person: MARIANA }],
};

describe('Cenário principal', () => {
  it('consolida a Mariana em uma linha', async () => {
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(1);
    expect(budget.peopleSettlements[0].personName).toBe('Mariana Souza');
  });

  it('a receber é 480, não 720', async () => {
    /**
     * 720 seria o resultado de somar a parcela de terceiros da FATURA
     * (240) aos dois recebíveis (480) — a dupla contagem que o item 7 proíbe.
     */
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].budget.receivableDueInMonth).toBe(480);
  });

  it('a pagar é 250 e o saldo é +230', async () => {
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);
    const mariana = budget.peopleSettlements[0];

    expect(mariana.budget.openDueInMonth).toBe(250);
    expect(mariana.open.net).toBe(230);
  });

  it('a fatura continua com sua parte de 933,95', async () => {
    // A seção de faturas responde outra pergunta e não muda.
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    expect(budget.netAmount).toBeCloseTo(933.95, 2);
    expect(budget.totalReimbursable).toBe(240);
  });

  it('marca quanto vem de compra no cartão', async () => {
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    // Derivado de `transactionId`, nunca da Invoice.
    expect(budget.peopleSettlements[0].budget.automaticReceivable).toBe(240);
  });
});

describe('totalToPay NÃO muda — a regressão obrigatória', () => {
  it('a dívida da pessoa continua no total', async () => {
    /**
     * A dívida sai da LISTA visual de "Dívidas" para aparecer no acerto da
     * pessoa, mas continua compondo `debts.openDueInMonth` e `totalToPay`. Tirá-la
     * do cálculo por causa de uma reorganização visual seria perder R$ 250.
     */
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    expect(budget.debts.openDueInMonth).toBe(250);
    expect(budget.debts.total).toBe(250);
    // 933,95 da fatura + 250 da dívida.
    expect(budget.totalToPay).toBeCloseTo(1183.95, 2);
  });

  it('o saldo líquido NÃO reduz o total', async () => {
    // Se os 480 abatessem, o total cairia para ~703,95.
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    expect(budget.totalToPay).toBeCloseTo(
      budget.netAmount + budget.totalDirectPayments + budget.debts.total,
      2,
    );
  });

  it('vincular a dívida a uma pessoa não altera nada no cálculo', async () => {
    /*
      Mesma dívida, uma vez com pessoa e outra sem: o total precisa ser
      idêntico. É o que garante que a seção nova é só apresentação.
    */
    const comPessoa = await buildService({
      monthDebts: [{ amount: 250, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    const semPessoa = await buildService({
      monthDebts: [{ amount: 250 }],
    }).getBudget(USER_ID, 9, 2026);

    expect(comPessoa.totalToPay).toBe(semPessoa.totalToPay);
    expect(comPessoa.debts.total).toBe(semPessoa.debts.total);
  });

  it('remaining e committedPct não são afetados', async () => {
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    // Sem SalaryHistory a renda é desconhecida — e continua assim.
    expect(budget.salaryKnown).toBe(false);
    expect(budget.remaining).toBeNull();
    expect(budget.committedPct).toBeNull();
  });
});

describe('Saldo líquido não é compensação', () => {
  it('valores iguais dão saldo zero, mas a dívida permanece no total', async () => {
    const budget = await buildService({
      monthReceivables: [{ amount: 500, person: MARIANA }],
      monthDebts: [{ amount: 500, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    const mariana = budget.peopleSettlements[0];
    expect(mariana.open.net).toBe(0);
    expect(mariana.budget.receivableDueInMonth).toBe(500);
    expect(mariana.budget.openDueInMonth).toBe(500);

    // O ponto: saldo zero NÃO zera a obrigação.
    expect(budget.debts.total).toBe(500);
    expect(budget.totalToPay).toBe(500);
  });

  it('saldo negativo quando se deve mais', async () => {
    const budget = await buildService({
      monthReceivables: [{ amount: 200, person: MARIANA }],
      monthDebts: [{ amount: 500, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.net).toBe(-300);
  });
});

describe('Dívidas sem pessoa', () => {
  it('não entram em acertos', async () => {
    const budget = await buildService({
      monthDebts: [{ amount: 420 }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
    // Mas continuam no total.
    expect(budget.debts.total).toBe(420);
  });

  it('convivem com dívidas de pessoa', async () => {
    const budget = await buildService({
      monthDebts: [{ amount: 420 }, { amount: 250, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(1);
    expect(budget.peopleSettlements[0].budget.openDueInMonth).toBe(250);
    expect(budget.debts.total).toBe(670);
  });
});

describe('Pendências anteriores da pessoa', () => {
  it('aparecem nos dois universos, em campos separados', async () => {
    const budget = await buildService({
      monthReceivables: [{ amount: 480, person: MARIANA }],
      monthDebts: [{ amount: 250, person: MARIANA }],
      priorDebts: [{ amount: 100, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    const mariana = budget.peopleSettlements[0];

    // Universo do orçamento: carry em campo próprio, para reconciliar o total.
    expect(mariana.budget.currentOpenPrior).toBe(100);
    expect(mariana.budget.debtTotal).toBe(350);

    /*
      Universo em aberto: a dívida anterior está aberta, então ENTRA no saldo.

      Aqui a pergunta é "quanto falta acertar?" — e falta acertar os 100
      também. O antigo `monthNet` respondia 230 porque excluía o carry por
      construção; era a resposta certa para outra pergunta.
    */
    expect(mariana.open.priorDebt).toBe(100);
    expect(mariana.open.net).toBe(130);
    expect(mariana.open.itemCount).toBe(3);
  });

  it('a pendência anterior aberta entra no total do mês corrente', async () => {
    const budget = await buildService({
      monthDebts: [{ amount: 250, person: MARIANA }],
      priorDebts: [{ amount: 100, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.debts.currentOpenPrior).toBe(100);
    expect(budget.debts.total).toBe(350);
  });

  it('carry sem pessoa não vai para acertos', async () => {
    const budget = await buildService({
      priorDebts: [{ amount: 300 }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
    expect(budget.debts.currentOpenPrior).toBe(300);
  });
});

describe('Recebíveis', () => {
  it('automático e manual somam igual na consolidação', async () => {
    const budget = await buildService({
      monthReceivables: [
        { amount: 240, person: MARIANA, automatic: true },
        { amount: 240, person: MARIANA },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].budget.receivableDueInMonth).toBe(480);
    // Só a origem é distinguida.
    expect(budget.peopleSettlements[0].budget.automaticReceivable).toBe(240);
  });

  it('recebível SEM pessoa não aparece em acertos, mas conta no total global', async () => {
    /**
     * Legítimo que a soma dos acertos não feche com o total global: contraparte
     * por nome livre não tem Person para consolidar, e criar uma
     * automaticamente inventaria um cadastro.
     */
    const budget = await buildService({
      monthReceivables: [{ amount: 480, person: MARIANA }, { amount: 100 }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.receivables.dueInMonth).toBe(580);
    expect(budget.peopleSettlements[0].budget.receivableDueInMonth).toBe(480);
  });

  it('recebível não altera totalToPay', async () => {
    const semRec = await buildService({
      monthDebts: [{ amount: 250, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    const comRec = await buildService({
      monthDebts: [{ amount: 250, person: MARIANA }],
      monthReceivables: [{ amount: 9999, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(comRec.totalToPay).toBe(semRec.totalToPay);
  });
});

describe('Múltiplas pessoas', () => {
  it('uma linha por pessoa, sem combinar', async () => {
    const budget = await buildService({
      monthReceivables: [
        { amount: 480, person: MARIANA },
        { amount: 350, person: RAFAEL },
      ],
      monthDebts: [{ amount: 250, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(2);
    const byName = new Map(
      budget.peopleSettlements.map((p) => [p.personName, p]),
    );
    expect(byName.get('Mariana Souza')?.open.net).toBe(230);
    expect(byName.get('Rafael Lima')?.open.net).toBe(350);
  });

  it('ordena por movimentação total, não por saldo', async () => {
    /**
     * Uma relação com R$ 500 de cada lado tem saldo ZERO e é das mais
     * relevantes da tela. Ordenar pelo líquido a jogaria para o fim.
     */
    const budget = await buildService({
      monthReceivables: [
        { amount: 500, person: MARIANA },
        { amount: 100, person: RAFAEL },
      ],
      monthDebts: [{ amount: 500, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    // Mariana movimenta 1000 (saldo 0); Rafael, 100 (saldo +100).
    expect(budget.peopleSettlements[0].personName).toBe('Mariana Souza');
    expect(budget.peopleSettlements[0].open.net).toBe(0);
  });

  it('pessoa sem valor nenhum não aparece', async () => {
    const budget = await buildService({
      monthReceivables: [{ amount: 0, person: RAFAEL }],
      monthDebts: [{ amount: 250, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(1);
    expect(budget.peopleSettlements[0].personName).toBe('Mariana Souza');
  });
});

describe('Performance', () => {
  it('não consulta por pessoa', async () => {
    /**
     * A consolidação é um agrupamento em memória sobre os datasets que o
     * Budget já busca em lote. Chamar `GET /persons/:id/statement` por pessoa
     * seria N+1 — e traria all-time, competência errada para o Orçamento.
     */
    const budget = await buildService(CENARIO_REAL).getBudget(USER_ID, 9, 2026);

    // `person.findMany` nem existe no duplo: se o serviço o usasse, quebraria.
    expect(budget.peopleSettlements).toHaveLength(1);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Universo B — "Em aberto agora"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Estes testes existem porque a camada anterior respondia com o universo
 * ERRADO. Ela era construída sobre `paidAt` ("estava aberto quando o mês
 * começou?") e apresentada como pendência atual ("ainda falta acertar").
 *
 * As duas perguntas divergem no instante em que algo é quitado — e foi
 * exatamente aí que os dois bugs apareceram.
 */
describe('Em aberto: recebível anterior já recebido', () => {
  /*
    Item 14/24 — os R$ 300 fantasmas.

    Um Receivable de 300 vencido em junho e JÁ RECEBIDO. As três variações de
    `paidAt` cobrem as três portas pelas quais ele entrava no carry antigo:
    recebido durante o mês, depois dele, e o legado sem data.
  */
  const RECEBIDO_EM = [
    { label: 'recebido dentro do mês', paidAt: new Date(Date.UTC(2026, 6, 5)) },
    { label: 'recebido depois do mês', paidAt: new Date(Date.UTC(2026, 7, 5)) },
    { label: 'legado: pago sem data', paidAt: undefined },
  ];

  for (const scenario of RECEBIDO_EM) {
    it(`não aparece como a receber — ${scenario.label}`, async () => {
      const budget = await buildService({
        priorReceivables: [
          {
            amount: 300,
            person: MARIANA,
            isPaid: true,
            paidAt: scenario.paidAt,
          },
        ],
        monthDebts: [{ amount: 100, person: MARIANA }],
      }).getBudget(USER_ID, 7, 2026);

      const mariana = budget.peopleSettlements[0];
      expect(mariana.open.priorReceivable).toBe(0);
      expect(mariana.open.receivableTotal).toBe(0);
      // Nunca "R$ 300 a receber de períodos anteriores".
      expect(mariana.open.priorNet).toBe(0);
    });
  }

  it('item 25: dívida anterior já paga não aparece como aberta', async () => {
    const budget = await buildService({
      priorDebts: [
        {
          amount: 200,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 6, 20)),
        },
      ],
      monthReceivables: [{ amount: 50, person: MARIANA }],
    }).getBudget(USER_ID, 8, 2026);

    const mariana = budget.peopleSettlements[0];
    expect(mariana.open.priorDebt).toBe(0);
    expect(mariana.open.debtTotal).toBe(0);
  });
});

describe('Em aberto: anteriores realmente abertos', () => {
  it('item 26: 300 a receber e 200 a pagar dão +100', async () => {
    const budget = await buildService({
      priorReceivables: [{ amount: 300, person: MARIANA }],
      priorDebts: [{ amount: 200, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    const mariana = budget.peopleSettlements[0];
    expect(mariana.open.priorReceivable).toBe(300);
    expect(mariana.open.priorDebt).toBe(200);
    expect(mariana.open.priorNet).toBe(100);
    expect(mariana.open.net).toBe(100);
  });

  it('item 27: 200 de cada lado dão zero, com 2 itens abertos', async () => {
    const budget = await buildService({
      priorReceivables: [{ amount: 200, person: MARIANA }],
      priorDebts: [{ amount: 200, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    const mariana = budget.peopleSettlements[0];
    expect(mariana.open.priorNet).toBe(0);
    expect(mariana.open.net).toBe(0);

    /*
      Saldo zero NÃO é quitação: os dois valores seguem existindo, e é por isso
      que `itemCount` está no contrato. Sem ele a UI diria "Nada em aberto"
      para uma relação com R$ 400 pendentes.
    */
    expect(mariana.open.receivableTotal).toBe(200);
    expect(mariana.open.debtTotal).toBe(200);
    expect(mariana.open.itemCount).toBe(2);
  });

  it('agrega vários meses anteriores por pessoa', async () => {
    const budget = await buildService({
      priorReceivables: [
        { amount: 100, person: MARIANA },
        { amount: 200, person: MARIANA },
      ],
      priorDebts: [
        { amount: 50, person: MARIANA },
        { amount: 200, person: MARIANA },
      ],
    }).getBudget(USER_ID, 9, 2026);

    const mariana = budget.peopleSettlements[0];
    expect(mariana.open.priorReceivable).toBe(300);
    expect(mariana.open.priorDebt).toBe(250);
    expect(mariana.open.priorNet).toBe(50);
    expect(mariana.open.itemCount).toBe(4);
  });
});

describe('Em aberto: antes e depois de quitar', () => {
  /** Item 23/29 — o cenário visual exato que o usuário relatou. */
  const AGOSTO = {
    monthReceivables: [{ amount: 200, person: MARIANA }],
    monthDebts: [{ amount: 200, person: MARIANA }],
  };

  it('ANTES: 200 de cada lado, saldo zero, 2 itens', async () => {
    const budget = await buildService(AGOSTO).getBudget(USER_ID, 9, 2026);
    const mariana = budget.peopleSettlements[0];

    expect(mariana.open.receivableTotal).toBe(200);
    expect(mariana.open.debtTotal).toBe(200);
    expect(mariana.open.net).toBe(0);
    expect(mariana.open.itemCount).toBe(2);
  });

  it('DEPOIS de quitar: nada em aberto dos dois lados', async () => {
    /*
      "Quitar pendências" marca `isPaid: true` nos dois. É o refetch seguinte
      que este teste representa.
    */
    const quitado = {
      monthReceivables: [
        {
          amount: 200,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 8, 20)),
        },
      ],
      monthDebts: [
        {
          amount: 200,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 8, 20)),
        },
      ],
    };

    const budget = await buildService(quitado).getBudget(USER_ID, 9, 2026);
    const mariana = budget.peopleSettlements[0];

    expect(mariana.open.receivableTotal).toBe(0);
    expect(mariana.open.debtTotal).toBe(0);
    expect(mariana.open.net).toBe(0);
    // O que a UI usa para dizer "Nada em aberto".
    expect(mariana.open.itemCount).toBe(0);

    /*
      Item 9/10: a dívida paga CONTINUA pertencendo ao orçamento de agosto — e
      por isso a pessoa permanece na lista. Se ela desaparecesse, o total do
      orçamento deixaria de fechar com as linhas visíveis.
    */
    /*
      A dívida foi PAGA nesta competência: pertence a `paidInMonth`, não ao
      bucket de abertas. O total do mês continua o mesmo.
    */
    expect(mariana.budget.paidInMonth).toBe(200);
    expect(budget.debts.paidInMonth).toBe(200);
    expect(budget.totalToPay).toBe(200);
  });

  it('quitar só o recebível não move totalToPay', async () => {
    /*
      Item 28: `isPaid` do recebível é irrelevante para o orçamento — ele nunca
      entrou em `totalToPay`. Este teste vigia que a nova camada não criou um
      caminho para ele entrar.
    */
    const aberto = await buildService(AGOSTO).getBudget(USER_ID, 9, 2026);
    const recebido = await buildService({
      ...AGOSTO,
      monthReceivables: [
        {
          amount: 200,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 8, 20)),
        },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(recebido.totalToPay).toBe(aberto.totalToPay);
    expect(recebido.debts.total).toBe(aberto.debts.total);
    expect(recebido.remaining).toBe(aberto.remaining);
    expect(recebido.committedPct).toBe(aberto.committedPct);

    // Só a camada em aberto reage.
    expect(recebido.peopleSettlements[0].open.receivableTotal).toBe(0);
    expect(recebido.peopleSettlements[0].open.net).toBe(-200);
  });
});

describe('Em aberto: renderização da pessoa', () => {
  it('item 12: só recebível aberto, sem dívida de orçamento', async () => {
    const budget = await buildService({
      priorReceivables: [{ amount: 300, person: RAFAEL }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(1);
    expect(budget.peopleSettlements[0].open.receivableTotal).toBe(300);
    expect(budget.peopleSettlements[0].budget.debtTotal).toBe(0);
  });

  it('item 13: nada em aberto e nada no orçamento → não renderiza', async () => {
    /*
      Recebível anterior já recebido é o único fato da pessoa. Ele não entra em
      aberto (está pago) nem no orçamento (recebível não compõe `totalToPay`),
      então não há linha a exibir.
    */
    const budget = await buildService({
      priorReceivables: [
        {
          amount: 300,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 5, 20)),
        },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
  });

  it('item 10: dívida paga do mês mantém a pessoa na lista', async () => {
    const budget = await buildService({
      monthDebts: [
        {
          amount: 200,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 8, 20)),
        },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(1);
    expect(budget.peopleSettlements[0].open.itemCount).toBe(0);
    expect(budget.peopleSettlements[0].budget.paidInMonth).toBe(200);
    expect(budget.totalToPay).toBe(200);
  });

  it('item 20: recebível sem pessoa não entra em acertos', async () => {
    const budget = await buildService({
      monthReceivables: [{ amount: 500 }],
      priorReceivables: [{ amount: 300 }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
    // Continua no informativo global, como antes.
    expect(budget.receivables.dueInMonth).toBe(500);
  });
});

describe('Em aberto: os dois universos não se contaminam', () => {
  it('item 18: automático vem só do Receivable, nunca da fatura', async () => {
    const budget = await buildService({
      invoiceTotal: 1173.95,
      thirdPartyAmount: 240,
      monthReceivables: [{ amount: 240, person: MARIANA, automatic: true }],
    }).getBudget(USER_ID, 9, 2026);

    const mariana = budget.peopleSettlements[0];
    // 480 seria a soma da parcela de terceiros da fatura com o recebível.
    expect(mariana.open.receivableTotal).toBe(240);
    expect(mariana.open.automaticReceivable).toBe(240);
    expect(mariana.budget.automaticReceivable).toBe(240);
  });

  it('a regra temporal de cada universo é a esperada', async () => {
    /*
      Vigia a separação na FONTE: as consultas do orçamento usam `paidAt`, as
      de em aberto usam `isPaid: false`. Se alguém unificar as duas famílias,
      este teste falha antes de qualquer aritmética.
    */
    const prisma: any = {
      salaryHistory: { findFirst: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
      invoice: { findMany: vi.fn(async () => []) },
      transaction: {
        findMany: vi.fn(async () => []),
        groupBy: vi.fn(async () => []),
      },
      debt: { findMany: vi.fn(async () => []) },
      receivable: { findMany: vi.fn(async () => []) },
      bank: { findMany: vi.fn(async () => [makeBank()]) },
    };
    await new BudgetService(
      prisma as PrismaService,
      new SalaryService(prisma as PrismaService),
    ).getBudget(USER_ID, 9, 2026);

    const wheres = (mock: any) =>
      mock.findMany.mock.calls.map((call: any[]) => call[0].where);

    const debtPrior = wheres(prisma.debt).filter(
      (w: any) => w.dueDate?.lt && !w.dueDate?.gte,
    );
    const recPrior = wheres(prisma.receivable).filter(
      (w: any) => w.dueDate?.lt && !w.dueDate?.gte,
    );

    /*
      A assimetria entre os lados é DELIBERADA.

      Dívida tem TRÊS consultas anteriores, porque responde a três perguntas:

        · pendência anterior ainda ABERTA (mês corrente, `isPaid: false`);
        · pendência anterior PAGA nesta competência (janela de `paidAt`);
        · o universo em aberto de "Acertos com pessoas" (`personId` + aberta).

      Recebível tem só a de em aberto: ele não compõe `totalToPay`, então não
      há reconstrução histórica que dependa dele — e a consulta que existia
      era a que produzia os R$ 300 fantasmas.

      Nenhuma delas usa mais o `OR` de `paidAt`: aquele era o snapshot mensal
      que repetia a mesma dívida em toda competência.
    */
    expect(debtPrior).toHaveLength(2);
    expect(recPrior).toHaveLength(1);

    const abertaNoMesCorrente = debtPrior.find(
      (w: any) => w.isPaid === false && w.personId === undefined,
    );
    expect(abertaNoMesCorrente).toBeDefined();
    // A de em aberto olha o estado ATUAL, nunca `paidAt`.
    expect(abertaNoMesCorrente.paidAt).toBeUndefined();

    /*
      A consulta de dívidas PAGAS não filtra por vencimento anterior: uma
      dívida resolvida pertence ao mês do pagamento, tenha vencido quando
      tiver. Por isso ela não aparece nesta lista de "anteriores".
    */

    // Nenhuma reconstrói o snapshot mensal antigo.
    for (const where of debtPrior) {
      expect(where.OR).toBeUndefined();
    }

    // O único carry anterior de recebível é o de em aberto.
    expect(recPrior[0].isPaid).toBe(false);
    expect(recPrior[0].OR).toBeUndefined();
  });

  it('ordena por movimentação somando os dois universos', async () => {
    /*
      Mariana: 500 abertos de cada lado → movimentação 1000, saldo 0.
      Rafael: 100 a receber → movimentação 100, saldo +100.
      Ordenar pelo saldo colocaria Rafael na frente.
    */
    const budget = await buildService({
      monthReceivables: [{ amount: 100, person: RAFAEL }],
      priorReceivables: [{ amount: 500, person: MARIANA }],
      priorDebts: [{ amount: 500, person: MARIANA }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].personName).toBe('Mariana Souza');
    expect(budget.peopleSettlements[0].open.net).toBe(0);
  });
});

describe('hasOverdue — urgência, não direção', () => {
  /**
   * O ícone da linha comunica "existe algo vencido nesta relação"; o valor
   * comunica direção (a receber / a pagar). São eixos independentes: um saldo
   * negativo dentro do prazo não é atraso, e um saldo positivo com cobrança
   * vencida é.
   */
  /*
    O relógio global deste arquivo já está fixo em 15/09/2026, então os dias
    abaixo se posicionam em relação a ele: 10 é passado, 15 é hoje, 20 é
    futuro.
  */
  function comVencimento(dia: number) {
    return new Date(Date.UTC(2026, 8, dia, 12));
  }

  it('item aberto já vencido marca a relação', async () => {
    const budget = await buildService({
      monthDebts: [
        { amount: 100, person: MARIANA, dueDate: comVencimento(10) },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(true);
  });

  it('item dentro do prazo NÃO marca', async () => {
    const budget = await buildService({
      monthDebts: [
        { amount: 100, person: MARIANA, dueDate: comVencimento(20) },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(false);
  });

  it('item 6: o PRÓPRIO dia do vencimento não é atraso', async () => {
    // Há o dia inteiro para resolver.
    const budget = await buildService({
      monthDebts: [
        { amount: 100, person: MARIANA, dueDate: comVencimento(15) },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(false);
  });

  it('item 7: cobrança vencida também marca, não só dívida', async () => {
    /*
      A urgência é da RELAÇÃO. Vincular o vermelho só a dívida esconderia uma
      cobrança atrasada de R$ 500.
    */
    const budget = await buildService({
      monthReceivables: [
        { amount: 500, person: MARIANA, dueDate: comVencimento(1) },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(true);
    // E o saldo continua positivo: direção e urgência não se confundem.
    expect(budget.peopleSettlements[0].open.net).toBe(500);
  });

  it('sem nada em aberto, não há atraso', async () => {
    const budget = await buildService({
      monthDebts: [
        {
          amount: 100,
          person: MARIANA,
          isPaid: true,
          paidAt: new Date(Date.UTC(2026, 8, 5, 12)),
        },
      ],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(false);
  });
});

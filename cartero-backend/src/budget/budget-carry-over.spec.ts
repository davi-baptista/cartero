import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';
import { routeDebtQuery } from 'src/common/testing/debt-query-double';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pendências anteriores — eventos, não snapshot mensal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A regra anterior perguntava "isto ainda estava aberto quando o mês
 * começou?", e repetia a MESMA obrigação em toda competência entre o
 * vencimento e o pagamento: uma dívida de 08/12 paga em 24/08 aparecia em
 * dezembro, janeiro, fevereiro… até agosto.
 *
 * Defensável como fotografia histórica, mas na tela parecia que a mesma dívida
 * estava sendo cobrada de novo a cada mês.
 *
 * ── Contrato V2: a competência é o VENCIMENTO ──
 *
 *   ABERTA → o vencimento (planejamento), mais o mês corrente se atrasada
 *   PAGA   → o vencimento também. `paidAt` não posiciona nada.
 *
 * O contrato anterior mandava a dívida paga para o mês do desembolso. Era
 * verdadeiro sobre fluxo de caixa — e é por isso que existiu —, mas o Budget
 * é competência e planejamento; o fluxo de caixa é o Extrato.
 *
 * `Pendências anteriores` passou a ser uma FILA VIVA: só o que ainda exige
 * ação. Resolver uma pendência antiga a remove de todos os meses posteriores
 * e a deixa na competência dela, exibida como paga.
 */

interface DebtRow {
  amount: number;
  /** Vencimento original. */
  dueDate: string;
  /** `null` = nunca paga. */
  paidAt?: string | null;
  personId?: string | null;
  personName?: string;
  title?: string;
}

/** 24/08/2026, meio-dia em Fortaleza — o "hoje" de todos os testes. */
const HOJE = new Date(Date.UTC(2026, 7, 24, 15));

/**
 * Prisma que aplica as TRÊS regras temporais de verdade.
 *
 * Um duplo que devolvesse listas fixas passaria mesmo com o serviço aplicando
 * a condição errada — e é exatamente a condição que este arquivo testa.
 */
function buildService(rows: DebtRow[]) {
  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    receivable: { findMany: vi.fn(async () => []) },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        const toRow = (row: DebtRow) => ({
          amount: money(row.amount),
          isPaid: row.paidAt != null,
          paidAt: row.paidAt ? new Date(`${row.paidAt}T12:00:00.000Z`) : null,
          title: row.title ?? 'Dívida',
          dueDate: new Date(`${row.dueDate}T12:00:00.000Z`),
          personId: row.personId ?? null,
          person: row.personId
            ? { id: row.personId, name: row.personName ?? 'Pessoa' }
            : null,
        });

        return routeDebtQuery(where, rows.map(toRow));
      }),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

describe('item 41: dezembro → agosto, sem repetir no meio', () => {
  /** R$ 300, vence 08/12/2025, paga em 24/08/2026. */
  const CENARIO: DebtRow[] = [
    { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('dezembro: a competência dela, mesmo paga meses depois', async () => {
    /*
      A inversão da V2. Antes dezembro devolvia zero, porque o desembolso
      tinha acontecido em agosto. Agora a obrigação pertence a dezembro — foi
      lá que ela venceu — e aparece como paga.
    */
    const budget = await buildService(CENARIO).getBudget(USER_ID, 12, 2025);

    expect(budget.debts.paidInCompetence).toBe(300);
    expect(budget.debts.total).toBe(300);
    /* E não como pendência anterior: a seção é fila viva. */
    expect(budget.debts.currentOpenPrior).toBe(0);
    expect(budget.debts.priorItems).toHaveLength(0);
  });

  it.each([
    ['janeiro', 1, 2026],
    ['fevereiro', 2, 2026],
    ['março', 3, 2026],
    ['julho', 7, 2026],
  ])('%s NÃO repete a dívida de dezembro', async (_nome, mes, ano) => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, mes, ano);

    expect(budget.debts.total).toBe(0);
    expect(budget.debts.currentOpenPrior).toBe(0);
    expect(budget.debts.paidInCompetence).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('agosto NÃO reconhece nada, mesmo tendo sido o mês do pagamento', async () => {
    /*
      A consequência aceita: `totalToPay` de agosto não conta esse
      desembolso. O fato financeiro está no Extrato, na data real.
    */
    const budget = await buildService(CENARIO).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.paidInCompetence).toBe(0);
    expect(budget.debts.currentOpenPrior).toBe(0);
    expect(budget.debts.total).toBe(0);
  });

  it('setembro (futuro) não projeta nada', async () => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, 9, 2026);

    expect(budget.debts.total).toBe(0);
  });
});

describe('item 42: dívida antiga ainda ABERTA', () => {
  const ABERTA: DebtRow[] = [{ amount: 300, dueDate: '2025-12-08' }];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('dezembro: obrigação do próprio mês', async () => {
    const budget = await buildService(ABERTA).getBudget(USER_ID, 12, 2025);
    expect(budget.debts.openDueInMonth).toBe(300);
  });

  it.each([
    ['janeiro', 1],
    ['março', 3],
    ['julho', 7],
  ])('%s histórico não repete', async (_nome, mes) => {
    const budget = await buildService(ABERTA).getBudget(USER_ID, mes, 2026);
    expect(budget.debts.total).toBe(0);
  });

  it('agosto (mês CORRENTE): aparece como pendência em aberto', async () => {
    /*
      O único caso em que dívida antiga aberta é carregada: ela precisa ser
      resolvida AGORA, e o orçamento do mês corrente é planejamento.
    */
    const budget = await buildService(ABERTA).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.currentOpenPrior).toBe(300);
    expect(budget.debts.paidInCompetence).toBe(0);
    expect(budget.totalToPay).toBe(300);
  });

  it('item 53: setembro futuro não projeta o atraso', async () => {
    const budget = await buildService(ABERTA).getBudget(USER_ID, 9, 2026);
    expect(budget.debts.total).toBe(0);
  });
});

describe('item 54: o carry acompanha o PRESENTE', () => {
  const ABERTA: DebtRow[] = [{ amount: 300, dueDate: '2025-12-08' }];

  afterEach(() => vi.useRealTimers());

  it('em agosto aparece em agosto; em setembro migra para setembro', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
    const agostoCorrente = await buildService(ABERTA).getBudget(
      USER_ID,
      8,
      2026,
    );
    expect(agostoCorrente.debts.currentOpenPrior).toBe(300);

    // O relógio avança: agosto vira histórico.
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 15, 15)));
    const agostoHistorico = await buildService(ABERTA).getBudget(
      USER_ID,
      8,
      2026,
    );
    const setembroCorrente = await buildService(ABERTA).getBudget(
      USER_ID,
      9,
      2026,
    );

    expect(agostoHistorico.debts.currentOpenPrior).toBe(0);
    expect(setembroCorrente.debts.currentOpenPrior).toBe(300);
  });
});

describe('item 43: transição open → paid no mês corrente', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('§5: pagar remove a pendência de agosto — retroatividade deliberada', async () => {
    /*
      A propriedade central da V2, e a consequência que o produto aceitou
      explicitamente: `Pendências anteriores` é uma FILA VIVA.

      Enquanto a dívida de dezembro está aberta, agosto a carrega e conta os
      R$ 300. Ao ser paga, ela sai de agosto — e o `totalToPay` de agosto
      DIMINUI. Não é bug: a obrigação foi resolvida e voltou para dezembro,
      a competência dela.

      O contrato anterior fazia o oposto: agosto continuava com R$ 300,
      porque o desembolso tinha acontecido ali.
    */
    const antes = await buildService([
      { amount: 300, dueDate: '2025-12-08' },
    ]).getBudget(USER_ID, 8, 2026);

    const depois = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 8, 2026);

    /* Aberta: agosto carrega. */
    expect(antes.debts.currentOpenPrior).toBe(300);
    expect(antes.debts.total).toBe(300);
    expect(antes.totalToPay).toBe(300);

    /* Paga: agosto esvazia. */
    expect(depois.debts.currentOpenPrior).toBe(0);
    expect(depois.debts.paidInCompetence).toBe(0);
    expect(depois.debts.total).toBe(0);
    expect(depois.totalToPay).toBe(0);
  });

  it('§5: e dezembro passa a exibi-la como paga', async () => {
    /* O outro lado da retroatividade: a competência original fica com ela. */
    const dezembro = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 12, 2025);

    expect(dezembro.debts.paidInCompetence).toBe(300);
    expect(dezembro.debts.total).toBe(300);
  });
});

describe('itens 7 e 45: paga no próprio mês do vencimento', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('conta UMA vez, como dívida do mês', async () => {
    const budget = await buildService([
      { amount: 300, dueDate: '2026-01-10', paidAt: '2026-01-20' },
    ]).getBudget(USER_ID, 1, 2026);

    /*
      Uma dívida resolvida usa `paidAt`, mesmo quando coincide com o mês do
      vencimento. O importante é contar UMA vez.
    */
    expect(budget.debts.openDueInMonth).toBe(0);
    expect(budget.debts.paidInCompetence).toBe(300);
    expect(budget.debts.total).toBe(300);
  });
});

describe('itens 20 e 46: legado pago sem data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  /*
    `isPaid: true` com `paidAt: null`. Sabemos que foi resolvida, não quando.
    O duplo representa isso como uma linha sem `paidAt` mas já quitada — o
    serviço a exclui de todos os ramos, sem inventar mês de pagamento.
  */
  const LEGADO: DebtRow[] = [
    { amount: 300, dueDate: '2025-12-08', paidAt: null },
  ];

  it('aparece no mês do vencimento', async () => {
    const budget = await buildService(LEGADO).getBudget(USER_ID, 12, 2025);
    expect(budget.debts.openDueInMonth).toBe(300);
  });

  it('não inventa mês de pagamento', async () => {
    for (const mes of [1, 3, 8]) {
      const budget = await buildService(LEGADO).getBudget(USER_ID, mes, 2026);
      expect(budget.debts.paidInCompetence).toBe(0);
    }
  });
});

describe('itens 51 e 52: os exemplos reais', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  const CENARIO: DebtRow[] = [
    // Dezembro: vence lá, paga só em agosto.
    { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    // Janeiro: dívida própria do mês.
    { amount: 300, dueDate: '2026-01-15' },
  ];

  it('dezembro: a dívida paga em agosto FICA aqui', async () => {
    /* V2: a competência é o vencimento, não o mês do desembolso. */
    const budget = await buildService(CENARIO).getBudget(USER_ID, 12, 2025);
    expect(budget.debts.total).toBe(300);
    expect(budget.debts.paidInCompetence).toBe(300);
  });

  it('janeiro: 300, não 600', async () => {
    /*
      A dívida de dezembro NÃO reaparece em janeiro só porque continuava
      aberta. Era exatamente essa soma que inflava o mês.
    */
    const budget = await buildService(CENARIO).getBudget(USER_ID, 1, 2026);

    expect(budget.debts.total).toBe(300);
    expect(budget.debts.openDueInMonth).toBe(300);
    expect(budget.debts.currentOpenPrior).toBe(0);
  });
});

describe('V2: corrigir `paidAt` NÃO move a dívida de competência', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('as duas datas de pagamento dão o mesmo resultado', async () => {
    /*
      Antes, corrigir `paidAt` movia a dívida de mês — e era por isso que a
      data precisava estar certa para o Budget ficar organizado. Sob a V2 ela
      não posiciona nada: a competência é o vencimento, dezembro, nos dois
      casos.

      É o que dispensa o usuário de pensar "em que mês eu paguei isso?".
    */
    const registradoEmAgosto = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 12, 2025);

    const registradoEmDezembro = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2025-12-20' },
    ]).getBudget(USER_ID, 12, 2025);

    expect(registradoEmAgosto.debts.paidInCompetence).toBe(300);
    expect(registradoEmDezembro.debts.paidInCompetence).toBe(300);
    expect(registradoEmAgosto.debts.total).toBe(
      registradoEmDezembro.debts.total,
    );
  });

  it('e nenhuma das duas aparece em agosto', async () => {
    for (const paidAt of ['2026-08-24', '2025-12-20']) {
      const agosto = await buildService([
        { amount: 300, dueDate: '2025-12-08', paidAt },
      ]).getBudget(USER_ID, 8, 2026);

      expect(agosto.debts.total, paidAt).toBe(0);
    }
  });
});

describe('V2: pendências pagas juntas voltam CADA UMA à sua competência', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  /** Três dívidas de meses diferentes, todas pagas no mesmo dia de agosto. */
  const TRES: DebtRow[] = [
    { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    { amount: 300, dueDate: '2026-01-15', paidAt: '2026-08-24' },
    { amount: 330, dueDate: '2026-02-10', paidAt: '2026-08-24' },
  ];

  it('agosto NÃO acumula os R$ 930', async () => {
    /*
      Era o efeito mais visível do contrato antigo: regularizar três meses de
      uma vez inflava agosto em R$ 930, e o Budget do mês passava a descrever
      uma dívida que veio de outro lugar.
    */
    const agosto = await buildService(TRES).getBudget(USER_ID, 8, 2026);

    expect(agosto.debts.total).toBe(0);
  });

  it('cada uma fica no seu mês', async () => {
    const [dezembro, janeiro, fevereiro] = await Promise.all([
      buildService(TRES).getBudget(USER_ID, 12, 2025),
      buildService(TRES).getBudget(USER_ID, 1, 2026),
      buildService(TRES).getBudget(USER_ID, 2, 2026),
    ]);

    expect(dezembro.debts.paidInCompetence).toBe(300);
    expect(janeiro.debts.paidInCompetence).toBe(300);
    expect(fevereiro.debts.paidInCompetence).toBe(330);
  });

  it('e a soma das competências preserva o valor total', async () => {
    /*
      Nada se perde na redistribuição: os R$ 930 continuam existindo, agora
      nos meses a que pertencem.
    */
    const meses: Array<[number, number]> = [
      [12, 2025],
      [1, 2026],
      [2, 2026],
    ];
    const totais = await Promise.all(
      meses.map(([m, a]) => buildService(TRES).getBudget(USER_ID, m, a)),
    );

    const soma = totais.reduce((t, b) => t + b.debts.paidInCompetence, 0);
    expect(soma).toBe(930);
  });
});

describe('uma obrigação, UMA seção', () => {
  /*
    A dívida carregada aparecia em `debts.priorItems` E em `debtBreakdown`,
    então a tela listava "Pendências anteriores · R$ 300,00" e "Dívidas ·
    R$ 300,00" — a MESMA dívida, duas linhas, na mesma competência.

    Os totais nunca dobraram: `debts.total` sempre somou os baldes separados.
    O defeito era de APRESENTAÇÃO, e por isso escapava dos testes de
    aritmética — a tela contradizia o próprio número, listando duas linhas
    sob um total que contava uma.

    `classifyDebtForBudget` já respondia isso; faltava `debtBreakdown`
    perguntar.
  */
  const ABERTA_EM_AGOSTO: DebtRow[] = [
    { amount: 300, dueDate: '2026-07-15', paidAt: null, title: 'Herdada' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('a dívida da fila NÃO aparece também em `debtBreakdown`', async () => {
    const budget = await buildService(ABERTA_EM_AGOSTO).getBudget(
      USER_ID,
      8,
      2026,
    );

    expect(budget.debts.priorItems.map((i) => i.title)).toEqual(['Herdada']);
    expect(budget.debtBreakdown.map((r) => r.name)).not.toContain('Herdada');
  });

  it('e o total continua contando-a UMA vez', async () => {
    const budget = await buildService(ABERTA_EM_AGOSTO).getBudget(
      USER_ID,
      8,
      2026,
    );

    expect(budget.debts.total).toBe(300);
    expect(budget.totalToPay).toBe(300);
  });

  it('na competência dela, ela está em `debtBreakdown` e fora da fila', async () => {
    /* Julho é a casa dela: seção normal, nenhuma pendência anterior. */
    const budget = await buildService(ABERTA_EM_AGOSTO).getBudget(
      USER_ID,
      7,
      2026,
    );

    expect(budget.debtBreakdown.map((r) => r.name)).toEqual(['Herdada']);
    expect(budget.debts.priorItems).toEqual([]);
  });
});

describe('o vencimento original é preservado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('o item aberto carrega a data real do vencimento', async () => {
    /* O vencimento ORIGINAL — nunca reescrito como se fosse deste mês. */
    const budget = await buildService([
      { amount: 300, dueDate: '2025-12-08' },
    ]).getBudget(USER_ID, 8, 2026);

    const [item] = budget.debts.priorItems;
    expect(item.dueDate.toISOString()).toContain('2025-12-08');
    expect(item.amount).toBe(300);
  });

  it('§5: `priorItems` NUNCA contém item resolvido', async () => {
    /*
      O invariante da fila viva. A seção não tem mais estado de quitação a
      exibir — e o campo que o carregava (`paidInMonth`) saiu do contrato,
      justamente para que uma regressão do backend falhe aqui em vez de
      aparecer como badge "PAGA" na tela.
    */
    const cenarios: DebtRow[][] = [
      /* paga na própria competência */
      [{ amount: 300, dueDate: '2026-08-10', paidAt: '2026-08-20' }],
      /* paga depois, vinda de mês anterior */
      [{ amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' }],
      /* aberta e vencida: o único caso que ENTRA */
      [{ amount: 300, dueDate: '2025-12-08' }],
    ];

    for (const [i, rows] of cenarios.entries()) {
      const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

      for (const item of budget.debts.priorItems) {
        /*
          O tipo já não expõe quitação; este assert prova que o objeto
          entregue também não a carrega por baixo.
        */
        expect(Object.keys(item), `cenário ${i}`).not.toContain('paidInMonth');
        expect(Object.keys(item), `cenário ${i}`).not.toContain('isPaid');
      }
    }

    /* E só o terceiro cenário produz alguma linha. */
    const [comPagaPropria, comPagaAntiga, comAberta] = await Promise.all(
      cenarios.map((rows) => buildService(rows).getBudget(USER_ID, 8, 2026)),
    );
    expect(comPagaPropria.debts.priorItems).toHaveLength(0);
    expect(comPagaAntiga.debts.priorItems).toHaveLength(0);
    expect(comAberta.debts.priorItems).toHaveLength(1);
  });
});

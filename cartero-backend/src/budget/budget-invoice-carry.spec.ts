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
import { routeInvoiceQuery } from 'src/common/testing/invoice-query-double';
import { routeDebtQuery } from 'src/common/testing/debt-query-double';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A fatura vencida também carrega
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dívida vencida sempre alimentou `Pendências anteriores`; fatura vencida
 * não. A assimetria não era um predicado errado — era uma pergunta que
 * ninguém fazia: a consulta de faturas era fechada em `{ month, year }`, e
 * uma fatura de agosto que venceu e continuou aberta simplesmente não existia
 * para setembro.
 *
 * Do ponto de vista de quem abre a tela, as duas são o mesmo fato: dinheiro
 * que devia ter saído e não saiu.
 *
 * ── O recorte ──
 *
 *   status: OVERDUE  +  competência ANTERIOR à exibida
 *
 * `OVERDUE` é a autoridade temporal que já existia — o cron move CLOSED →
 * OVERDUE no vencimento, e `deriveStatusFromInvoiceDates` faz o mesmo inline.
 * Comparar `dueDate < hoje` aqui criaria uma SEGUNDA definição de "vencida",
 * livre para divergir da primeira.
 *
 * Isso também resolve, sem cláusula extra, a fatura fechada-mas-não-vencida:
 * fecha em 25/08, vence em 05/09, está CLOSED, e pertence à competência dela.
 *
 * ── A retroatividade é deliberada ──
 *
 * Paga, a fatura deixa de ser OVERDUE, sai da consulta, e desaparece da fila
 * de TODOS os meses posteriores — reduzindo o `totalToPay` deles. Ela
 * permanece na competência original, onde sempre esteve, agora como PAGA.
 *
 * O mês em que o dinheiro efetivamente saiu não a reivindica: essa é a
 * pergunta do Extrato, não do Orçamento.
 */

/** 24/09/2026 — "hoje" para todos os cenários deste arquivo. */
const HOJE = new Date(Date.UTC(2026, 8, 24, 15));

interface InvoiceRow {
  id: string;
  month: number;
  year: number;
  status: 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID';
  total: number;
  /** Parte de terceiros dentro desta fatura. */
  thirdParty?: number;
}

interface DebtRow {
  amount: number;
  dueDate: string;
  paidAt?: string | null;
  title?: string;
}

function buildService(invoices: InvoiceRow[], debts: DebtRow[] = []) {
  const toInvoice = (row: InvoiceRow) => ({
    ...makeInvoice({
      id: row.id,
      month: row.month,
      year: row.year,
      status: row.status,
      totalAmount: money(row.total),
    }),
    bank: makeBank(),
  });

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: {
      /*
        Honra o `where` de verdade. Um duplo que devolvesse a mesma lista para
        as duas consultas — competência exibida e fila viva — contaria a
        fatura duas vezes, e `totalToPay` de 700 viraria 1400.
      */
      findMany: vi.fn(async ({ where }: any) =>
        /*
          `'strict'`: este arquivo declara faturas de competências diferentes
          e testa justamente qual delas cada consulta enxerga. No modo padrão
          a consulta da competência receberia todas, e o carry ficaria
          indistinguível da lista do mês.
        */
        routeInvoiceQuery(where, invoices, 'strict').map(toInvoice),
      ),
    },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () =>
        invoices
          .filter((inv) => inv.thirdParty)
          .map((inv) => ({
            invoiceId: inv.id,
            _sum: { amount: money(inv.thirdParty!) },
          })),
      ),
    },
    receivable: { findMany: vi.fn(async () => []) },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    debt: {
      findMany: vi.fn(async ({ where }: any) =>
        routeDebtQuery(
          where,
          debts.map((row) => ({
            amount: money(row.amount),
            isPaid: row.paidAt != null,
            paidAt: row.paidAt ? new Date(`${row.paidAt}T12:00:00.000Z`) : null,
            title: row.title ?? 'Dívida',
            dueDate: new Date(`${row.dueDate}T12:00:00.000Z`),
            personId: null,
            person: null,
          })),
        ),
      ),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

/*
  `getBudget` lê o relógio internamente — a regra de carry da dívida depende
  de "estamos no mês corrente?". Sem fixar o tempo, os cenários mudariam de
  resultado conforme a data real da execução.
*/
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(HOJE);
});

afterEach(() => {
  vi.useRealTimers();
});

const ver = (invoices: InvoiceRow[], month: number, debts: DebtRow[] = []) =>
  buildService(invoices, debts).getBudget(USER_ID, month, 2026);

// ─── I1-I3: a fatura vencida entra na fila e permanece ──────────────────────

describe('I1-I3: fatura OVERDUE aberta carrega para os meses seguintes', () => {
  const AGOSTO_VENCIDA: InvoiceRow = {
    id: 'inv-ago',
    month: 8,
    year: 2026,
    status: 'OVERDUE',
    total: 700,
  };

  it('I1: na competência ORIGINAL ela é uma fatura normal, não pendência', async () => {
    const budget = await ver([AGOSTO_VENCIDA], 8);

    expect(budget.invoices).toHaveLength(1);
    expect(budget.invoices[0].id).toBe('inv-ago');
    /*
      A fila é para o que veio de TRÁS. Em agosto ela não veio de lugar
      nenhum — está em casa, e listá-la duas vezes na mesma tela somaria a
      mesma obrigação duas vezes.
    */
    expect(budget.priorInvoices).toHaveLength(0);
    expect(budget.priorInvoicesTotal).toBe(0);
  });

  it('I2: no mês SEGUINTE aparece na fila', async () => {
    const budget = await ver([AGOSTO_VENCIDA], 9);

    expect(budget.priorInvoices).toHaveLength(1);
    expect(budget.priorInvoices[0].id).toBe('inv-ago');
    expect(budget.priorInvoicesTotal).toBe(700);
    /* E não vaza para a lista da competência exibida. */
    expect(budget.invoices).toHaveLength(0);
  });

  it('I3: NÃO é projetada para competências futuras', async () => {
    /*
      ── A fila é estado, não previsão ──

      Este teste afirmava o oposto: que a fatura "continua na fila nos meses
      posteriores", tratando a repetição como o ponto da fila. Isso vale
      enquanto o mês corrente AVANÇA sobre ela — em outubro de verdade, com a
      fatura ainda aberta, ela reaparece —, mas não vale para navegar até
      outubro hoje.

      Estando em setembro, dizer que o atraso ainda existirá em outubro
      afirmaria um fato que ninguém sabe: o usuário pode pagá-lo amanhã.

      A dívida já se comportava assim. A fatura projetava, e a divergência
      vinha de a consulta dela ter raciocinado só sobre o limite inferior.
    */
    const outubro = await ver([AGOSTO_VENCIDA], 10);
    const novembro = await ver([AGOSTO_VENCIDA], 11);

    expect(outubro.priorInvoices).toHaveLength(0);
    expect(novembro.priorInvoices).toHaveLength(0);
    /* E o total futuro não herda a obrigação. */
    expect(outubro.totalToPay).toBe(0);
  });

  it('I3: mas reaparece quando aquele mês VIRAR o corrente', async () => {
    /*
      A contrapartida — sem ela, o teste acima poderia ser satisfeito por uma
      fatura que simplesmente nunca carrega. O que muda não é a fatura: é
      qual mês é "hoje".
    */
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 15, 15))); // 15/10/2026

    const outubro = await ver([AGOSTO_VENCIDA], 10);

    expect(outubro.priorInvoices.map((i) => i.id)).toEqual(['inv-ago']);
    expect(outubro.priorInvoicesTotal).toBe(700);
  });

  it('preserva a identidade de FATURA, não vira dívida genérica', async () => {
    const budget = await ver([AGOSTO_VENCIDA], 9);
    const fila = budget.priorInvoices[0];

    /* Banco, competência de origem e datas — o que a row precisa. */
    expect(fila.bank.name).toBe('Cartão Teste');
    expect(fila.month).toBe(8);
    expect(fila.year).toBe(2026);
    expect(fila.status).toBe('OVERDUE');
    expect(fila.dueDate).toBeInstanceOf(Date);
    expect(fila.closeDate).toBeInstanceOf(Date);
  });
});

// ─── I4-I5: pagar remove o carry retroativamente ────────────────────────────

describe('I4-I5: fatura PAGA sai da fila de todos os meses posteriores', () => {
  const AGOSTO_PAGA: InvoiceRow = {
    id: 'inv-ago',
    month: 8,
    year: 2026,
    status: 'PAID',
    total: 700,
  };

  it('I4: setembro e outubro deixam de vê-la', async () => {
    const setembro = await ver([AGOSTO_PAGA], 9);
    const outubro = await ver([AGOSTO_PAGA], 10);

    expect(setembro.priorInvoices).toHaveLength(0);
    expect(setembro.priorInvoicesTotal).toBe(0);
    expect(outubro.priorInvoices).toHaveLength(0);
  });

  it('I5: e a competência ORIGINAL continua exibindo-a, agora como PAGA', async () => {
    const agosto = await ver([AGOSTO_PAGA], 8);

    expect(agosto.invoices).toHaveLength(1);
    expect(agosto.invoices[0].status).toBe('PAID');
  });

  it('I4: a retroatividade reduz o `totalToPay` do mês posterior', async () => {
    /*
      O mesmo mês exibido, com a fatura aberta e depois paga. O número do
      snapshot de setembro MUDA quando o usuário quita algo de agosto — é a
      consequência deliberada de a fila ser viva, e não histórico as-of.
    */
    const aberta = await ver(
      [{ ...AGOSTO_PAGA, status: 'OVERDUE' }],
      9,
    );
    const paga = await ver([AGOSTO_PAGA], 9);

    expect(aberta.totalToPay).toBe(700);
    expect(paga.totalToPay).toBe(0);
  });
});

// ─── I6: sua parte, nunca o bruto ───────────────────────────────────────────

describe('I6: a fatura da fila usa a SUA PARTE', () => {
  const COM_TERCEIRO: InvoiceRow = {
    id: 'inv-ago',
    month: 8,
    year: 2026,
    status: 'OVERDUE',
    total: 1000,
    thirdParty: 300,
  };

  it('a decomposição é a mesma da row normal do Orçamento', async () => {
    const budget = await ver([COM_TERCEIRO], 9);
    const fila = budget.priorInvoices[0];

    /* O bruto é preservado — é o que o banco cobra. */
    expect(Number(fila.totalAmount)).toBe(1000);
    expect(fila.reimbursable).toBe(300);
    /* Mas o que sai do MEU bolso é 700. */
    expect(fila.ownAmount).toBe(700);
  });

  it('e o total da fila soma a sua parte, nunca 1000', async () => {
    const budget = await ver([COM_TERCEIRO], 9);

    expect(budget.priorInvoicesTotal).toBe(700);
    expect(budget.priorInvoicesTotal).not.toBe(1000);
  });

  it('row, total da fila e `totalToPay` fecham na MESMA base', async () => {
    /*
      Três números derivados do mesmo fato. Se qualquer um usasse o bruto, a
      tela não reconciliaria — e o usuário veria a soma das linhas discordar
      do cabeçalho sem nenhuma pista do porquê.
    */
    const budget = await ver([COM_TERCEIRO], 9);
    const somaDasRows = budget.priorInvoices.reduce(
      (soma, inv) => soma + inv.ownAmount,
      0,
    );

    expect(somaDasRows).toBe(budget.priorInvoicesTotal);
    expect(budget.totalToPay).toBe(budget.priorInvoicesTotal);
  });

  it('o desconto de terceiros da fila não contamina o `netAmount` do mês', async () => {
    /*
      As duas consultas compartilham o agrupamento de terceiros. Sem isolar o
      desconto do próprio mês, a parte de terceiros de OUTRA competência
      abateria a fatura desta.
    */
    const budget = await ver(
      [
        COM_TERCEIRO,
        { id: 'inv-set', month: 9, year: 2026, status: 'OPEN', total: 500 },
      ],
      9,
    );

    /* Setembro não tem terceiros: a sua parte é a fatura inteira. */
    expect(budget.netAmount).toBe(500);
    expect(budget.totalToPay).toBe(500 + 700);
  });
});

// ─── I7-I8: o que NÃO carrega ───────────────────────────────────────────────

describe('I7-I8: só OVERDUE carrega', () => {
  it('I7: CLOSED e ainda não vencida NÃO entra na fila', async () => {
    /*
      Fecha em 25/08 e vence em 05/09: o dinheiro ainda não estava atrasado
      quando setembro começou. Ela pertence à competência dela.
    */
    const budget = await ver(
      [{ id: 'inv-ago', month: 8, year: 2026, status: 'CLOSED', total: 700 }],
      9,
    );

    expect(budget.priorInvoices).toHaveLength(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('I8: OPEN de competência anterior NÃO entra na fila', async () => {
    const budget = await ver(
      [{ id: 'inv-ago', month: 8, year: 2026, status: 'OPEN', total: 700 }],
      9,
    );

    expect(budget.priorInvoices).toHaveLength(0);
  });

  it('I8: fatura FUTURA não é projetada para trás', async () => {
    const budget = await ver(
      [{ id: 'inv-out', month: 10, year: 2026, status: 'OPEN', total: 700 }],
      9,
    );

    expect(budget.priorInvoices).toHaveLength(0);
    expect(budget.invoices).toHaveLength(0);
  });

  it('a virada de ANO é atravessada corretamente', async () => {
    /*
      O `OR` é `[{ year: { lt } }, { year, month: { lt } }]`. Um `month < 9`
      solto pegaria agosto de qualquer ano — e um `year < 2026` sozinho
      perderia agosto de 2026.
    */
    const budget = await ver(
      [{ id: 'inv-dez', month: 12, year: 2025, status: 'OVERDUE', total: 400 }],
      9,
    );

    expect(budget.priorInvoices.map((i) => i.id)).toEqual(['inv-dez']);
    expect(budget.priorInvoicesTotal).toBe(400);
  });
});

// ─── A fila mista: dívida e fatura na mesma seção ───────────────────────────

describe('a fila viva reúne dívida E fatura', () => {
  const FATURA: InvoiceRow = {
    id: 'inv-ago',
    month: 8,
    year: 2026,
    status: 'OVERDUE',
    total: 700,
  };
  /* Vencida em agosto, nunca paga — carrega para setembro, o mês corrente. */
  const DIVIDA: DebtRow = { amount: 300, dueDate: '2026-08-15', paidAt: null };

  it('as duas aparecem juntas', async () => {
    const budget = await ver([FATURA], 9, [DIVIDA]);

    expect(budget.priorInvoices).toHaveLength(1);
    expect(budget.debts.priorItems).toHaveLength(1);
    expect(budget.priorCount).toBe(2);
    expect(budget.totalToPay).toBe(1000);
  });

  it('pagar a FATURA deixa a dívida na fila', async () => {
    const budget = await ver([{ ...FATURA, status: 'PAID' }], 9, [DIVIDA]);

    expect(budget.priorInvoices).toHaveLength(0);
    expect(budget.debts.priorItems).toHaveLength(1);
    expect(budget.priorCount).toBe(1);
    expect(budget.totalToPay).toBe(300);
  });

  it('pagar a DÍVIDA deixa a fatura na fila', async () => {
    const budget = await ver([FATURA], 9, [
      { ...DIVIDA, paidAt: '2026-09-20' },
    ]);

    expect(budget.debts.priorItems).toHaveLength(0);
    expect(budget.priorInvoices).toHaveLength(1);
    expect(budget.priorCount).toBe(1);
    expect(budget.totalToPay).toBe(700);
  });

  it('pagar as DUAS esvazia a fila — a seção deixa de existir', async () => {
    const budget = await ver([{ ...FATURA, status: 'PAID' }], 9, [
      { ...DIVIDA, paidAt: '2026-09-20' },
    ]);

    expect(budget.priorInvoices).toHaveLength(0);
    expect(budget.debts.priorItems).toHaveLength(0);
    expect(budget.priorCount).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });
});

// ─── Dívida e fatura seguem a MESMA policy temporal ─────────────────────────

describe('SIMETRIA: dívida e fatura carregam pela mesma regra', () => {
  /*
    ══════════════════════════════════════════════════════════════════════
    Uma autoridade temporal, dois domínios
    ══════════════════════════════════════════════════════════════════════

    A dívida guardava o futuro em DOIS pontos — `isCurrentMonth`
    condicionando a consulta, e `classifyDebtForBudget` devolvendo
    `excluded` fora do mês corrente. A fatura não pegou nenhum dos dois: a
    consulta dela nasceu com a cláusula de competência ANTERIOR e nunca
    considerou o limite superior.

    O resultado era observável e incoerente: no mesmo outubro futuro, a
    dívida de agosto sumia e a fatura de agosto continuava lá.

    Estes testes comparam os dois lado a lado, no MESMO cenário — é o
    formato que impede a divergência de voltar por um dos lados só.
  */
  const FATURA: InvoiceRow = {
    id: 'inv-ago',
    month: 8,
    year: 2026,
    status: 'OVERDUE',
    total: 700,
  };
  const DIVIDA: DebtRow = { amount: 300, dueDate: '2026-08-15', paidAt: null };

  const fila = (b: Awaited<ReturnType<typeof ver>>) => ({
    dividas: b.debts.priorItems.length,
    faturas: b.priorInvoices.length,
  });

  it('mês CORRENTE: os dois aparecem', async () => {
    expect(fila(await ver([FATURA], 9, [DIVIDA]))).toEqual({
      dividas: 1,
      faturas: 1,
    });
  });

  it('mês FUTURO: nenhum dos dois aparece', async () => {
    /* A asserção que falhava: `faturas` vinha 1 enquanto `dividas` vinha 0. */
    expect(fila(await ver([FATURA], 10, [DIVIDA]))).toEqual({
      dividas: 0,
      faturas: 0,
    });
    expect(fila(await ver([FATURA], 11, [DIVIDA]))).toEqual({
      dividas: 0,
      faturas: 0,
    });
  });

  it('mês PASSADO: nenhum dos dois aparece', async () => {
    /*
      Pelo mesmo motivo, e não por acaso: aquele mês não viu o dinheiro sair,
      e contá-lo inventaria um desembolso histórico.
    */
    expect(fila(await ver([FATURA], 7, [DIVIDA]))).toEqual({
      dividas: 0,
      faturas: 0,
    });
  });

  it('o total futuro não herda nem a dívida nem a fatura', async () => {
    const outubro = await ver([FATURA], 10, [DIVIDA]);

    expect(outubro.totalToPay).toBe(0);
    expect(outubro.priorInvoicesTotal).toBe(0);
    expect(outubro.priorCount).toBe(0);
  });

  it('quando o futuro VIRA presente, os dois reaparecem juntos', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 15, 15))); // 15/10/2026

    expect(fila(await ver([FATURA], 10, [DIVIDA]))).toEqual({
      dividas: 1,
      faturas: 1,
    });
  });
});

// ─── O invariante ───────────────────────────────────────────────────────────

describe('INVARIANTE: a fila contém SOMENTE item não resolvido', () => {
  it('nenhuma fatura da fila está paga, em nenhum cenário', async () => {
    /*
      A asserção é sobre ESTADO, não sobre a ausência de um campo: `status`
      existe no payload, e é ele que precisa nunca dizer PAID aqui.
    */
    const cenarios: InvoiceRow[][] = [
      [{ id: 'a', month: 8, year: 2026, status: 'OVERDUE', total: 700 }],
      [{ id: 'b', month: 8, year: 2026, status: 'PAID', total: 700 }],
      [{ id: 'c', month: 7, year: 2026, status: 'OVERDUE', total: 100 }],
      [{ id: 'd', month: 12, year: 2025, status: 'PAID', total: 900 }],
      [
        { id: 'e', month: 8, year: 2026, status: 'OVERDUE', total: 700 },
        { id: 'f', month: 7, year: 2026, status: 'PAID', total: 200 },
      ],
    ];

    for (const [i, invoices] of cenarios.entries()) {
      const budget = await ver(invoices, 9);

      for (const fila of budget.priorInvoices) {
        expect(fila.status, `cenário ${i}`).toBe('OVERDUE');
        expect(fila.status, `cenário ${i}`).not.toBe('PAID');
      }
    }
  });

  it('a fila nunca repete uma fatura já listada na competência exibida', async () => {
    /*
      A regressão que o `invoice-query-double` existe para pegar: um duplo que
      ignora o `where` devolve a mesma fatura para as duas consultas, e o
      total dobra de 700 para 1400.
    */
    const budget = await ver(
      [{ id: 'inv-set', month: 9, year: 2026, status: 'OVERDUE', total: 700 }],
      9,
    );

    const idsDaCompetencia = budget.invoices.map((i) => i.id);
    const idsDaFila = budget.priorInvoices.map((i) => i.id);

    expect(idsDaFila.filter((id) => idsDaCompetencia.includes(id))).toEqual([]);
    expect(budget.totalToPay).toBe(700);
  });
});

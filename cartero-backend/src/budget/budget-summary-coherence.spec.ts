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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O resumo não pode dizer "Tudo em dia" com obrigação em aberto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A tela exibia `Tudo em dia` no topo enquanto, logo abaixo, havia uma fatura
 * `FATURA VENCIDA` e uma pessoa `VOCÊ DEVE`. O mesmo estado afirmava duas
 * coisas opostas.
 *
 * ── Onde estava o defeito ──
 *
 * NÃO era o predicado do frontend. `budgetAllSettled` já é econômico —
 * `totalPaid > 0 && totalPending <= 0` — e usa os agregados fechados pelo
 * backend, sem recalcular nada.
 *
 * O defeito era a BASE de `paidInvoices`: somava `totalAmount`, o BRUTO das
 * faturas pagas, enquanto `totalToPay` conta apenas a sua parte
 * (`netAmount`). Duas bases no mesmo quociente.
 *
 *   fatura paga     R$ 1.000  (R$ 600 de terceiros → sua parte R$ 400)
 *   fatura vencida  R$   300  (sua, integralmente)
 *
 *   totalToPay = 400 + 300 = 700
 *   totalPaid  = min(1000, 700) = 700   ← o bruto SATURA o teto
 *   totalPending = 0                     → "Tudo em dia", com 300 vencidos
 *
 * O `Math.min(..., totalToPay)` existe para impedir "pagou mais que o total".
 * Com bases divergentes ele deixou de ser um teto de sanidade e virou o
 * mecanismo que escondia a pendência.
 *
 * ── A correção ──
 *
 * `paidInvoices` passou a somar `ownAmount`, a mesma decomposição que a row
 * exibe e que `netAmount` soma. Uma base só, e a saturação deixa de ser
 * alcançável por construção.
 *
 * Nada do domínio mudou: contribuição da pessoa, netting, carry e atribuição
 * de fatura seguem idênticos.
 */

const EVA = { id: 'p-eva', name: 'Eva' };

interface InvoiceRow {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID';
  total: number;
  /** Parte de terceiros dentro desta fatura. */
  thirdParty?: number;
}

interface DebtRow {
  amount: number;
  dueDate: string;
  isPaid?: boolean;
  paidAt?: string | null;
  comPessoa?: boolean;
}

interface RecvRow {
  amount: number;
  dueDate: string;
  isPaid?: boolean;
  paidAt?: string | null;
}

function buildService(setup: {
  invoices?: InvoiceRow[];
  debts?: DebtRow[];
  receivables?: RecvRow[];
}) {
  const dia = (v: string) => new Date(`${v}T12:00:00.000Z`);
  const invoices = setup.invoices ?? [];

  const casa = (where: any, item: { isPaid?: boolean; paidAt?: string | null; dueDate: string }) => {
    if (where.isPaid !== undefined && where.isPaid !== (item.isPaid ?? false)) {
      return false;
    }
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

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: {
      findMany: vi.fn(async ({ where }: any) =>
        routeInvoiceQuery(
          where,
          invoices.map((r) => ({ ...r, month: 8, year: 2026 })),
          'strict',
        ).map((r: any) => ({
          ...makeInvoice({
            id: r.id,
            month: 8,
            year: 2026,
            status: r.status,
            totalAmount: money(r.total),
          }),
          bank: makeBank(),
        })),
      ),
    },
    transaction: {
      findMany: vi.fn(async () => []),
      /* A parte de terceiros de cada fatura, como o serviço a consulta. */
      groupBy: vi.fn(async () =>
        invoices
          .filter((inv) => inv.thirdParty)
          .map((inv) => ({
            invoiceId: inv.id,
            _sum: { amount: money(inv.thirdParty!) },
          })),
      ),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    receivable: {
      findMany: vi.fn(async ({ where }: any) =>
        (setup.receivables ?? [])
          .filter((r) => casa(where, r))
          .map((r) => ({
            amount: money(r.amount),
            isPaid: r.isPaid ?? false,
            paidAt: r.paidAt ? dia(r.paidAt) : null,
            title: 'Recv',
            dueDate: dia(r.dueDate),
            personId: EVA.id,
            person: EVA,
            transactionId: null,
          })),
      ),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) =>
        (setup.debts ?? [])
          .filter((d) => casa(where, d))
          .filter((d) => !(where.personId?.not === null && d.comPessoa === false))
          .map((d) => ({
            amount: money(d.amount),
            isPaid: d.isPaid ?? false,
            paidAt: d.paidAt ? dia(d.paidAt) : null,
            title: 'Debt',
            dueDate: dia(d.dueDate),
            personId: d.comPessoa === false ? null : EVA.id,
            person: d.comPessoa === false ? null : EVA,
          })),
      ),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

/** 15/09/2026 — agosto é passado, o mês das obrigações do cenário. */
const HOJE = new Date(Date.UTC(2026, 8, 15, 15));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(HOJE);
});
afterEach(() => vi.useRealTimers());

const verAgosto = (setup: Parameters<typeof buildService>[0]) =>
  buildService(setup).getBudget(USER_ID, 8, 2026);

/**
 * A MESMA regra do frontend (`budgetAllSettled`), reproduzida aqui sobre os
 * agregados que o backend fecha.
 *
 * Não é uma segunda autoridade: é a asserção de que os DOIS números que a
 * frase consome descrevem o estado real. Se `totalPending` mentir, a frase
 * mente junto — e é exatamente isso que estes testes vigiam.
 */
const EPSILON = 0.005;
const tudoEmDia = (b: { totalPaid: number; totalPending: number }) =>
  b.totalPaid > EPSILON && b.totalPending <= EPSILON;

// ─── S1-S4: o que bloqueia a frase ──────────────────────────────────────────

describe('S1-S4: "Tudo em dia" exige TODAS as obrigações resolvidas', () => {
  const PAGA_COM_TERCEIRO: InvoiceRow = {
    id: 'inv-paga',
    status: 'PAID',
    total: 1000,
    thirdParty: 600,
  };
  const VENCIDA: InvoiceRow = { id: 'inv-venc', status: 'OVERDUE', total: 300 };

  it('S2: fatura VENCIDA bloqueia, mesmo com a pessoa quitada', async () => {
    /*
      ── A regressão que motivou esta fase ──

      A fatura paga tem R$ 600 de terceiros. Somando o BRUTO, o "pago"
      recebia 1.000 contra um total de 700 e saturava o teto: `totalPending`
      zerava e a frase aparecia com R$ 300 vencidos na tela.
    */
    const b = await verAgosto({ invoices: [PAGA_COM_TERCEIRO, VENCIDA] });

    expect(b.totalToPay).toBeCloseTo(700, 2);
    expect(b.totalPaid).toBeCloseTo(400, 2);
    expect(b.totalPending).toBeCloseTo(300, 2);
    expect(tudoEmDia(b)).toBe(false);
  });

  it('S1: contribuição de pessoa em aberto bloqueia, com as faturas pagas', async () => {
    /*
      Dívida de R$ 100 que vence em agosto e continua ABERTA: a contribuição
      da pessoa tem `remaining` e o resumo precisa refleti-lo.
    */
    const b = await verAgosto({
      invoices: [PAGA_COM_TERCEIRO],
      debts: [{ amount: 100, dueDate: '2026-08-10' }],
    });

    expect(b.peopleSettlements[0].contribution.remaining).toBeCloseTo(100, 2);
    expect(b.totalPending).toBeGreaterThan(EPSILON);
    expect(tudoEmDia(b)).toBe(false);
  });

  it('S3: os dois juntos — fatura vencida E pessoa em aberto', async () => {
    const b = await verAgosto({
      invoices: [PAGA_COM_TERCEIRO, VENCIDA],
      debts: [{ amount: 100, dueDate: '2026-08-10' }],
    });

    /* 400 próprios + 300 vencidos + 100 da pessoa. */
    expect(b.totalToPay).toBeCloseTo(800, 2);
    expect(b.totalPaid).toBeCloseTo(400, 2);
    expect(b.totalPending).toBeCloseTo(400, 2);
    expect(tudoEmDia(b)).toBe(false);
  });

  it('S4: tudo resolvido → a frase aparece', async () => {
    const b = await verAgosto({
      invoices: [PAGA_COM_TERCEIRO],
      debts: [
        { amount: 100, dueDate: '2026-08-10', isPaid: true, paidAt: '2026-08-12' },
      ],
    });

    expect(b.totalPending).toBeCloseTo(0, 2);
    expect(b.totalPaid).toBeGreaterThan(EPSILON);
    expect(tudoEmDia(b)).toBe(true);
  });

  it('mês VAZIO não recebe a frase — nunca ter tido ≠ ter quitado', async () => {
    const b = await verAgosto({});

    expect(b.totalPending).toBe(0);
    expect(b.totalPaid).toBe(0);
    expect(tudoEmDia(b)).toBe(false);
  });
});

// ─── S5: o parcial da pessoa entra pelo valor certo ─────────────────────────

describe('S5: contribuição PARCIAL da pessoa compõe o progresso', () => {
  it('o caso Fabricio: 46,24 pago · 11,00 a pagar dentro do total', async () => {
    /*
      A contribuição não entra inteira em nenhum dos dois lados: os R$ 57,24
      se dividem em coberto e a descobrir, e o resumo precisa somar cada
      parte no lado certo.
    */
    const b = await verAgosto({
      debts: [
        { amount: 50, dueDate: '2026-08-05', isPaid: true, paidAt: '2026-08-06' },
        { amount: 35.37, dueDate: '2026-08-05', isPaid: true, paidAt: '2026-08-18' },
        { amount: 11, dueDate: '2026-08-08' },
      ],
      receivables: [
        { amount: 39.13, dueDate: '2026-08-05', isPaid: true, paidAt: '2026-08-10' },
      ],
    });

    const c = b.peopleSettlements[0].contribution;
    expect(c.planned).toBeCloseTo(57.24, 2);
    expect(c.paid).toBeCloseTo(46.24, 2);
    expect(c.remaining).toBeCloseTo(11, 2);

    /* E o resumo reconcilia com a contribuição, parte por parte. */
    expect(b.totalToPay).toBeCloseTo(57.24, 2);
    expect(b.totalPaid).toBeCloseTo(46.24, 2);
    expect(b.totalPending).toBeCloseTo(11, 2);
    expect(tudoEmDia(b)).toBe(false);
  });
});

// ─── S6: contribuição zero não bloqueia ─────────────────────────────────────

describe('S6: `isSettled: false` sem obrigação econômica NÃO bloqueia', () => {
  it('dívida 30 com recebível 50 convive com "Tudo em dia"', async () => {
    /*
      ── Por que o resumo não pode olhar `isSettled` ──

      Contribuição zero devolve `isSettled: false`, que ali significa "não há
      saída a cobrir" — não "pendente". Um resumo escrito como
      `every(c => c.isSettled)` bloquearia a frase para sempre por causa de
      uma relação que não deve nada ao orçamento.

      A autoridade é o VALOR (`totalPending`), não o booleano.
    */
    const b = await verAgosto({
      invoices: [{ id: 'inv-p', status: 'PAID', total: 500 }],
      debts: [{ amount: 30, dueDate: '2026-08-10' }],
      receivables: [{ amount: 50, dueDate: '2026-08-10' }],
    });

    const p = b.peopleSettlements[0];
    expect(p.contribution.planned).toBe(0);
    expect(p.contribution.isSettled).toBe(false);
    expect(p.budget.payable).toBe(0);

    /* A fatura paga é a única obrigação, e está resolvida. */
    expect(b.totalPending).toBeCloseTo(0, 2);
    expect(tudoEmDia(b)).toBe(true);
  });
});

// ─── A invariante ───────────────────────────────────────────────────────────

describe('INVARIANTE: o pago nunca ultrapassa o total, sem saturar', () => {
  it('`totalPaid + totalPending = totalToPay` em qualquer combinação', async () => {
    const cenarios: Array<Parameters<typeof buildService>[0]> = [
      { invoices: [{ id: 'a', status: 'PAID', total: 1000, thirdParty: 600 }] },
      {
        invoices: [
          { id: 'a', status: 'PAID', total: 1000, thirdParty: 600 },
          { id: 'b', status: 'OVERDUE', total: 300 },
        ],
      },
      {
        invoices: [{ id: 'a', status: 'PAID', total: 500 }],
        debts: [{ amount: 100, dueDate: '2026-08-10' }],
      },
      {
        debts: [
          { amount: 80, dueDate: '2026-08-05', isPaid: true, paidAt: '2026-08-06' },
          { amount: 20, dueDate: '2026-08-08' },
        ],
      },
    ];

    for (const [i, setup] of cenarios.entries()) {
      const b = await verAgosto(setup);

      expect(b.totalPaid + b.totalPending, `cenário ${i}`).toBeCloseTo(
        b.totalToPay,
        2,
      );
      /* E o pago nunca é inflado além do que o mês realmente custa. */
      expect(b.totalPaid, `cenário ${i}`).toBeLessThanOrEqual(
        b.totalToPay + EPSILON,
      );
    }
  });

  it('a parte de TERCEIROS nunca conta como pagamento seu', async () => {
    /*
      A asserção que mata a base bruta diretamente: com a fatura inteiramente
      de terceiros, a sua parte é zero e nada foi pago por você.
    */
    const b = await verAgosto({
      invoices: [{ id: 'a', status: 'PAID', total: 900, thirdParty: 900 }],
    });

    expect(b.totalToPay).toBeCloseTo(0, 2);
    expect(b.totalPaid).toBeCloseTo(0, 2);
  });
});

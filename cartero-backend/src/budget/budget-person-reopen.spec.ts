import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Desfazer um pagamento REARMA a competência original
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O cenário relatado: uma Debt de R$ 11 vinculada a Fabricio, vencida em
 * 08/08, é paga e depois REABERTA. Três superfícies precisam concordar:
 *
 *   Person drawer           A pagar R$ 11 · 1 item em aberto
 *   Budget de setembro      Queijo · EM ATRASO (a fila viva da V2)
 *   Budget de AGOSTO        ← a competência original
 *
 * Se agosto continuasse dizendo `PAGO` / `Quitado em 18/08` / `Tudo em dia`,
 * o mesmo estado financeiro produziria "a pagar" e "quitado" ao mesmo tempo.
 *
 * ── Por que este arquivo existe ──
 *
 * `budget-person-contribution.spec.ts` cobre a contribuição em profundidade,
 * mas sempre no sentido ABERTO → PAGO. Nenhum teste exercitava a volta, e é
 * justamente ela que poderia regredir em silêncio: bastaria alguém tornar
 * `paid` cumulativo, ou preservar `settledAt` como fato histórico, para a
 * competência original congelar num settlement que já foi desfeito.
 *
 * ── O que NÃO é o contrato ──
 *
 * `anyOpenDebt` NÃO decide settlement. A autoridade é econômica: a
 * contribuição planejada é `max(dívidas − recebíveis, 0)`, e ela continua
 * coberta enquanto os pagamentos elegíveis alcançarem esse valor — mesmo com
 * alguma dívida reaberta. Os testes P1-P3 existem para provar isso; sem eles,
 * um fix ingênuo passaria.
 */

const EVA = { id: 'p-eva', name: 'Eva' };

interface Item {
  amount: number;
  dueDate: string;
  isPaid?: boolean;
  paidAt?: string | null;
  comPessoa?: boolean;
}

function buildService(setup: { receivables?: Item[]; debts?: Item[] }) {
  const dia = (v: string) => new Date(`${v}T12:00:00.000Z`);

  /*
    O dublê honra o `where` de verdade.

    É o que dá sentido ao teste: reabrir uma dívida é `isPaid: false`, e é o
    filtro da consulta que precisa deixar de trazê-la para `paidInCompetence`.
    Um dublê de lista fixa devolveria a dívida reaberta como paga e o teste
    passaria com o bug presente.
  */
  const emJanela = (where: any, item: Item) => {
    if (where.isPaid !== undefined && where.isPaid !== (item.isPaid ?? false)) {
      return false;
    }
    if (where.personId?.not === null && item.comPessoa === false) return false;
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
      .map((item) => {
        const temPessoa = item.comPessoa !== false;
        return {
          amount: money(item.amount),
          isPaid: item.isPaid ?? false,
          paidAt: item.paidAt ? dia(item.paidAt) : null,
          title: 'Item',
          dueDate: dia(item.dueDate),
          personId: temPessoa ? EVA.id : null,
          person: temPessoa ? EVA : null,
          ...(comTx ? { transactionId: null } : {}),
        };
      });

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    receivable: {
      findMany: vi.fn(async ({ where }: any) =>
        linhas(setup.receivables, where, true),
      ),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) => linhas(setup.debts, where)),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

/** A competência ORIGINAL das dívidas: agosto. */
const verAgosto = (setup: Parameters<typeof buildService>[0]) =>
  buildService(setup).getBudget(USER_ID, 8, 2026);

/** O mês CORRENTE, onde a fila viva da V2 opera. */
const verSetembro = (setup: Parameters<typeof buildService>[0]) =>
  buildService(setup).getBudget(USER_ID, 9, 2026);

/** 15/09/2026 — setembro é o mês corrente em todos os cenários. */
const HOJE = new Date(Date.UTC(2026, 8, 15, 15));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(HOJE);
});
afterEach(() => vi.useRealTimers());

const pessoa = (b: Awaited<ReturnType<typeof verAgosto>>) =>
  b.peopleSettlements[0];

// ─── O caso Fabricio, nos três estados ──────────────────────────────────────

describe('R1-R4: o caso Fabricio — pago, reaberto, pago de novo', () => {
  /*
    R$ 46,24 + R$ 11,00 = R$ 57,24, sem recebível: a contribuição planejada é
    o próprio bruto. É a forma exata do caso relatado.
  */
  const MERCADO = { amount: 46.24, dueDate: '2026-08-08' };
  const QUEIJO = { amount: 11, dueDate: '2026-08-08' };

  const pago = (i: typeof QUEIJO) => ({
    ...i,
    isPaid: true,
    paidAt: '2026-08-18',
  });

  it('A: as duas pagas → contribuição coberta', async () => {
    const b = await verAgosto({ debts: [pago(MERCADO), pago(QUEIJO)] });
    const c = pessoa(b).contribution;

    expect(c.planned).toBe(57.24);
    expect(c.paid).toBe(57.24);
    expect(c.remaining).toBe(0);
    expect(c.isSettled).toBe(true);
    expect(c.settledAt).toBe('2026-08-18');
    /* É o par que o frontend usa para "Tudo em dia". */
    expect(b.totalPending).toBe(0);
  });

  it('R1: reabrir Queijo torna a contribuição NÃO coberta', async () => {
    const b = await verAgosto({ debts: [pago(MERCADO), QUEIJO] });
    const c = pessoa(b).contribution;

    /*
      O planejado NÃO muda: a obrigação de R$ 57,24 continua sendo desta
      competência. O que muda é quanto dela já está coberto.
    */
    expect(c.planned).toBe(57.24);
    expect(c.paid).toBe(46.24);
    expect(c.remaining).toBe(11);
    expect(c.isSettled).toBe(false);
  });

  it('R2: `settledAt` desaparece quando a cobertura se desfaz', async () => {
    /*
      A data descreve QUANDO a cobertura se completou. Sem cobertura ela não
      descreve nada — e mantê-la faria a tela dizer "Quitado em 18/08" sobre
      uma obrigação que voltou a dever R$ 11.
    */
    const b = await verAgosto({ debts: [pago(MERCADO), QUEIJO] });

    expect(pessoa(b).contribution.settledAt).toBeNull();
  });

  it('R2b: nunca existe data de quitação sem cobertura, em nenhum estado', async () => {
    /*
      ── A invariante, não um caso ──

      A versão anterior deste teste checava um cenário só, e uma probe que
      removia o guard `isSettled &&` de `settledAt` sobrevivia a ele: naquele
      cenário a data já era `null` por outro motivo (o acumulado nunca alcança
      o alvo, então a cobertura nunca é registrada).

      Ou seja, o teste passava por acidente da aritmética, não por vigiar a
      regra. Este varre os estados possíveis e afirma o PAR — `settledAt` só
      pode existir quando `isSettled`. Vale mesmo que a implementação mude a
      forma de calcular a data.
    */
    const estados = [
      [pago(MERCADO), pago(QUEIJO)],
      [pago(MERCADO), QUEIJO],
      [MERCADO, pago(QUEIJO)],
      [MERCADO, QUEIJO],
    ];

    for (const [i, debts] of estados.entries()) {
      const c = pessoa(await verAgosto({ debts })).contribution;
      if (!c.isSettled) {
        expect(c.settledAt, `estado ${i} não coberto`).toBeNull();
      }
    }
  });

  it('R3: o resumo deixa de poder dizer "Tudo em dia"', async () => {
    /*
      `budgetAllSettled` no frontend é `totalPaid > 0 && totalPending <= 0`.
      Testar o par aqui protege a frase sem duplicar a regra de apresentação.
    */
    const b = await verAgosto({ debts: [pago(MERCADO), QUEIJO] });

    expect(b.totalPending).toBeGreaterThan(0);
    expect(b.totalPending).toBe(11);
    expect(b.totalPaid).toBe(46.24);
  });

  it('R4: pagar novamente volta a cobrir — o ciclo é reversível', async () => {
    /*
      Não basta funcionar no primeiro toggle: settled → reaberto → settled
      precisa fechar exatamente onde começou.
    */
    const inicial = pessoa(
      await verAgosto({ debts: [pago(MERCADO), pago(QUEIJO)] }),
    ).contribution;
    const reaberto = pessoa(
      await verAgosto({ debts: [pago(MERCADO), QUEIJO] }),
    ).contribution;
    const denovo = pessoa(
      await verAgosto({ debts: [pago(MERCADO), pago(QUEIJO)] }),
    ).contribution;

    expect(reaberto.isSettled).toBe(false);
    expect(denovo).toEqual(inicial);
    expect(denovo.settledAt).toBe('2026-08-18');
  });

  it('a contribuição NUNCA é monotônica: paid acompanha o estado atual', async () => {
    /*
      A probe M1 do handoff — congelar `paid` após o primeiro settlement.
      Se alguém acumulasse em vez de derivar, este teste cairia.
    */
    const estados = [
      { debts: [pago(MERCADO), pago(QUEIJO)], esperado: 57.24 },
      { debts: [pago(MERCADO), QUEIJO], esperado: 46.24 },
      { debts: [MERCADO, QUEIJO], esperado: 0 },
      { debts: [pago(MERCADO), pago(QUEIJO)], esperado: 57.24 },
    ];

    for (const [i, caso] of estados.entries()) {
      const c = pessoa(await verAgosto({ debts: caso.debts })).contribution;
      expect(c.paid, `estado ${i}`).toBe(caso.esperado);
      expect(c.planned, `estado ${i}`).toBe(57.24);
    }
  });
});

// ─── A parte que impede o fix ingênuo ───────────────────────────────────────

describe('P1-P3: settlement é ECONÔMICO, não `anyOpenDebt`', () => {
  /*
    Dívidas de 60 + 30 + 10 = 100, recebível de 40 → planejado 60.

    Com tudo pago, os pagamentos elegíveis somam 100 para cobrir 60: há folga
    de 40. Reabrir uma dívida pequena consome a folga sem descobrir o
    planejado, e o Orçamento continua legitimamente coberto.

    Um fix do tipo "qualquer dívida aberta ⇒ não coberta" quebraria aqui.
  */
  const D60 = { amount: 60, dueDate: '2026-08-08' };
  const D30 = { amount: 30, dueDate: '2026-08-08' };
  const D10 = { amount: 10, dueDate: '2026-08-08' };
  const R40 = { amount: 40, dueDate: '2026-08-08' };

  const pg = (i: { amount: number; dueDate: string }, dia: string) => ({
    ...i,
    isPaid: true,
    paidAt: dia,
  });

  it('P1: tudo pago → coberto, planejado 60 (não 100)', async () => {
    const c = pessoa(
      await verAgosto({
        receivables: [R40],
        debts: [pg(D60, '2026-08-11'), pg(D30, '2026-08-12'), pg(D10, '2026-08-13')],
      }),
    ).contribution;

    expect(c.planned).toBe(60);
    expect(c.paid).toBe(60);
    expect(c.isSettled).toBe(true);
  });

  it('P2: reabrir R$ 10 mantém COBERTO — elegível 90 ≥ 60', async () => {
    const c = pessoa(
      await verAgosto({
        receivables: [R40],
        debts: [pg(D60, '2026-08-11'), pg(D30, '2026-08-12'), D10],
      }),
    ).contribution;

    expect(c.isSettled).toBe(true);
    expect(c.remaining).toBe(0);
  });

  it('P2b: reabrir mais R$ 30 ainda mantém coberto — elegível 60 ≥ 60', async () => {
    /* Exatamente no limite: a fronteira precisa ser inclusiva. */
    const c = pessoa(
      await verAgosto({
        receivables: [R40],
        debts: [pg(D60, '2026-08-11'), D30, D10],
      }),
    ).contribution;

    expect(c.paid).toBe(60);
    expect(c.isSettled).toBe(true);
  });

  it('P3: reabrir o R$ 60 derruba a cobertura — elegível 40 < 60', async () => {
    const c = pessoa(
      await verAgosto({
        receivables: [R40],
        debts: [D60, pg(D30, '2026-08-12'), pg(D10, '2026-08-13')],
      }),
    ).contribution;

    expect(c.paid).toBe(40);
    expect(c.remaining).toBe(20);
    expect(c.isSettled).toBe(false);
  });
});

// ─── O que o reopen NÃO pode quebrar ────────────────────────────────────────

describe('R7-R10: o reopen preserva os contratos vizinhos', () => {
  const MERCADO = {
    amount: 46.24,
    dueDate: '2026-08-08',
    isPaid: true,
    paidAt: '2026-08-18',
  };
  const QUEIJO_ABERTO = { amount: 11, dueDate: '2026-08-08' };

  it('R7: a dívida reaberta aparece na fila viva do mês corrente', async () => {
    /*
      O outro lado da reconciliação: agosto diz "falta R$ 11" e setembro
      mostra o item. As duas superfícies descrevem o mesmo fato.
    */
    const b = await verSetembro({ debts: [MERCADO, QUEIJO_ABERTO] });

    expect(b.debts.priorItems).toHaveLength(1);
    expect(b.debts.priorItems[0].amount).toBe(11);
  });

  it('R7b: e some da fila quando é paga de novo', async () => {
    const b = await verSetembro({
      debts: [MERCADO, { ...QUEIJO_ABERTO, isPaid: true, paidAt: '2026-09-20' }],
    });

    expect(b.debts.priorItems).toHaveLength(0);
  });

  it('R8: mês FUTURO continua sem projetar o atraso', async () => {
    /* O hardening da fase anterior não pode regredir por causa deste fix. */
    const outubro = await buildService({
      debts: [MERCADO, QUEIJO_ABERTO],
    }).getBudget(USER_ID, 10, 2026);

    expect(outubro.debts.priorItems).toHaveLength(0);
    expect(outubro.priorInvoices).toHaveLength(0);
  });

  it('R9: zero-net não vira saída bruta ao reabrir', async () => {
    /*
      Devo 100, ela me deve 100: a contribuição é ZERO mesmo com item aberto.
      Reabrir não pode transformar isso em R$ 100 de saída.
    */
    const b = await verAgosto({
      receivables: [{ amount: 100, dueDate: '2026-08-08' }],
      debts: [{ amount: 100, dueDate: '2026-08-08' }],
    });

    const p = b.peopleSettlements[0];
    expect(p.budget.payable).toBe(0);
    expect(p.contribution.planned).toBe(0);
    expect(b.totalToPay).toBe(0);
  });

  it('R10: a dívida reaberta não é contada duas vezes em agosto', async () => {
    /*
      Ela pertence ao agregado da pessoa, e NÃO deve aparecer também como row
      solta — seria o gross leak que o netting existe para impedir.
    */
    const b = await verAgosto({ debts: [MERCADO, QUEIJO_ABERTO] });

    expect(b.debtBreakdown.filter((r) => r.kind === 'debt')).toHaveLength(0);
    expect(b.peopleSettlements).toHaveLength(1);
    /* O total é o líquido da pessoa, uma vez só. */
    expect(b.totalToPay).toBe(57.24);
  });
});

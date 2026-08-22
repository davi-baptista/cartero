import { describe, expect, it } from 'vitest';
import {
  buildInvoiceKey,
  forecastSubscriptionOccurrences,
  type ForecastableSubscription,
  type KnownInvoice,
} from './subscription-forecast.helper';
import { nextChargeDate } from 'src/common/helpers/subscription.helper';
import type { InvoiceSchedule } from 'src/common/helpers/invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Projeção de assinaturas em Compromissos (Fase 7B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O que se corrige: o forecast aplicava `subscription.amount` igual nos seis
 * meses do horizonte, ignorando `dayOfMonth`, `startedAt`, `activeSince`,
 * `lastGeneratedFor` e a competência da fatura. O número não correspondia a
 * nada que o sistema fosse gerar.
 *
 * A projeção agora usa as MESMAS regras da geração real, e a primeira
 * ocorrência coincide com o `nextCharge` que a listagem de assinaturas mostra.
 */

const CARD: InvoiceSchedule = {
  invoiceDueDate: 5,
  invoiceDueDaysAfterClose: 7,
};

function sub(
  overrides: Partial<ForecastableSubscription> = {},
): ForecastableSubscription {
  return {
    id: 'sub-1',
    title: 'Netflix',
    amount: 39.9,
    type: 'PIX',
    dayOfMonth: 12,
    startedAt: '2026-01',
    activeSince: null,
    lastGeneratedFor: null,
    isActive: true,
    bankId: 'bank-1',
    ...overrides,
  };
}

function run(
  subscriptions: ForecastableSubscription[],
  options: {
    today?: string;
    horizon?: number;
    invoices?: KnownInvoice[];
    archived?: string[];
    schedule?: InvoiceSchedule;
  } = {},
) {
  const invoices = new Map<string, KnownInvoice>();
  for (const invoice of options.invoices ?? []) {
    invoices.set(
      buildInvoiceKey(invoice.bankId, invoice.year, invoice.month),
      invoice,
    );
  }

  return forecastSubscriptionOccurrences({
    subscriptions,
    schedules: new Map([['bank-1', options.schedule ?? CARD]]),
    invoices,
    archivedBankIds: new Set(options.archived ?? []),
    horizonMonths: options.horizon ?? 6,
    today: new Date(options.today ?? '2026-08-05T12:00:00Z'),
  });
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const period = (o: { financialPeriod: { year: number; month: number } }) =>
  `${o.financialPeriod.year}-${String(o.financialPeriod.month).padStart(2, '0')}`;

describe('forecast — regras temporais da recorrência', () => {
  it('dia futuro no mês corrente: a primeira ocorrência é neste mês', () => {
    // Hoje 05/08, cobrança dia 12.
    const result = run([sub({ lastGeneratedFor: '2026-07' })]);

    expect(day(result[0].chargeDate)).toBe('2026-08-12');
  });

  it('dia já passado: a primeira ocorrência é no mês seguinte', () => {
    const result = run([sub({ lastGeneratedFor: '2026-08' })], {
      today: '2026-08-20T12:00:00Z',
    });

    expect(day(result[0].chargeDate)).toBe('2026-09-12');
  });

  it('no próprio dia da cobrança: o mês corrente conta', () => {
    const result = run([sub({ lastGeneratedFor: '2026-07' })], {
      today: '2026-08-12T12:00:00Z',
    });

    expect(day(result[0].chargeDate)).toBe('2026-08-12');
  });

  it('pausada não produz ocorrência alguma', () => {
    // Compromissos representa obrigação futura ativa; pausada não é obrigação.
    const result = run([sub({ isActive: false })]);

    expect(result).toEqual([]);
  });

  it('reativada não recupera os meses pausados', () => {
    // Gerou até maio, ficou pausada, reativou em agosto com o dia já passado.
    const result = run(
      [
        sub({
          lastGeneratedFor: '2026-05',
          activeSince: '2026-09',
        }),
      ],
      { today: '2026-08-20T12:00:00Z' },
    );

    expect(result.map((o) => o.cycle)).not.toContain('2026-06');
    expect(result.map((o) => o.cycle)).not.toContain('2026-07');
    expect(result[0].cycle).toBe('2026-09');
  });

  it('startedAt no futuro não é projetado antes do tempo', () => {
    // O horizonte não é uma matriz de seis posições a preencher.
    const result = run([sub({ startedAt: '2026-11' })]);

    expect(result[0].cycle).toBe('2026-11');
    expect(result.every((o) => o.cycle >= '2026-11')).toBe(true);
  });

  it('respeita o horizonte', () => {
    const result = run([sub({ lastGeneratedFor: '2026-07' })], { horizon: 3 });

    // Agosto, setembro, outubro.
    expect(result).toHaveLength(3);
  });

  it('aplica o clamp em mês curto', () => {
    const result = run([sub({ dayOfMonth: 31, lastGeneratedFor: '2026-01' })], {
      today: '2026-02-05T12:00:00Z',
      horizon: 2,
    });

    expect(day(result[0].chargeDate)).toBe('2026-02-28');
  });

  it('acerta fevereiro em ano bissexto', () => {
    // `startedAt` acompanha o cenário: o default de `sub()` é 2026, e uma
    // assinatura não é projetada antes de começar.
    const result = run(
      [
        sub({
          dayOfMonth: 31,
          startedAt: '2023-01',
          lastGeneratedFor: '2024-01',
        }),
      ],
      { today: '2024-02-05T12:00:00Z', horizon: 1 },
    );

    expect(day(result[0].chargeDate)).toBe('2024-02-29');
  });

  it('atravessa a virada de ano', () => {
    const result = run([sub({ dayOfMonth: 10, lastGeneratedFor: '2026-11' })], {
      today: '2026-12-05T12:00:00Z',
      horizon: 3,
    });

    expect(result.map((o) => o.cycle)).toEqual([
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
});

describe('forecast — coerência com nextCharge', () => {
  it('a primeira ocorrência é exatamente o nextCharge', () => {
    /**
     * Invariante do item 22: a listagem de assinaturas mostra `nextCharge` e o
     * forecast mostra a mesma cobrança. Duas regras concorrentes divergiriam, e
     * a divergência apareceria como "próxima cobrança dia 12" ao lado de um
     * forecast começando em outro mês.
     */
    const subscription = sub({ lastGeneratedFor: '2026-07' });
    const today = new Date('2026-08-05T12:00:00Z');

    const next = nextChargeDate(subscription, today);
    const result = run([subscription], { today: '2026-08-05T12:00:00Z' });

    expect(day(result[0].chargeDate)).toBe(day(next!));
  });

  it('a coerência vale também depois de reativação', () => {
    const subscription = sub({
      lastGeneratedFor: '2026-05',
      activeSince: '2026-09',
    });
    const today = new Date('2026-08-20T12:00:00Z');

    const next = nextChargeDate(subscription, today);
    const result = run([subscription], { today: '2026-08-20T12:00:00Z' });

    expect(day(result[0].chargeDate)).toBe(day(next!));
  });
});

describe('forecast — mês financeiro', () => {
  it('formas sem fatura usam o mês da própria cobrança', () => {
    // PIX, débito e boleto não passam por fatura.
    const result = run([sub({ type: 'PIX', lastGeneratedFor: '2026-07' })], {
      horizon: 1,
    });

    expect(period(result[0])).toBe('2026-08');
    expect(result[0].invoiceStatus).toBeNull();
  });

  it('crédito usa a competência da fatura, não o mês da cobrança', () => {
    /**
     * O caso que o item 26 descreve. Cartão vence dia 5 e fecha 7 dias antes,
     * então a fatura de setembro fecha em 29/08. Uma cobrança em 30/08 não
     * cabe nela: cai na fatura de outubro, e é em outubro que o dinheiro sai.
     */
    const result = run(
      [
        sub({
          type: 'CREDIT_CARD',
          dayOfMonth: 30,
          lastGeneratedFor: '2026-07',
        }),
      ],
      { today: '2026-08-05T12:00:00Z', horizon: 6 },
    );

    const first = result[0];
    expect(day(first.chargeDate)).toBe('2026-08-30');
    // Cobrança em agosto, mês financeiro em outubro.
    expect(period(first)).toBe('2026-10');
  });

  it('cobrança antes do fechamento cai na fatura do mês seguinte', () => {
    // Fatura de setembro fecha 29/08; cobrança em 12/08 entra nela.
    const result = run(
      [
        sub({
          type: 'CREDIT_CARD',
          dayOfMonth: 12,
          lastGeneratedFor: '2026-07',
        }),
      ],
      { horizon: 2 },
    );

    expect(day(result[0].chargeDate)).toBe('2026-08-12');
    expect(period(result[0])).toBe('2026-09');
  });
});

describe('forecast — faturas existentes e bloqueios', () => {
  const creditSub = sub({
    type: 'CREDIT_CARD',
    dayOfMonth: 12,
    lastGeneratedFor: '2026-07',
  });

  it('fatura PAID bloqueia a ocorrência', () => {
    /**
     * A geração real descarta o ciclo permanentemente quando a fatura já foi
     * conciliada. Contabilizar esse valor prometeria um gasto que o sistema
     * não vai criar.
     */
    const result = run([creditSub], {
      invoices: [
        {
          bankId: 'bank-1',
          year: 2026,
          month: 9,
          status: 'PAID',
          dueDate: new Date(Date.UTC(2026, 8, 5, 3)),
        },
      ],
      horizon: 2,
    });

    const blocked = result.filter((o) => o.blocked === 'invoice-paid');
    expect(blocked).toHaveLength(1);
    expect(period(blocked[0])).toBe('2026-09');
  });

  it('fatura CLOSED continua sendo compromisso válido', () => {
    // A criação normal aceita lançar em fatura fechada; a projeção acompanha.
    const result = run([creditSub], {
      invoices: [
        {
          bankId: 'bank-1',
          year: 2026,
          month: 9,
          status: 'CLOSED',
          dueDate: new Date(Date.UTC(2026, 8, 5, 3)),
        },
      ],
      horizon: 2,
    });

    const target = result.find((o) => period(o) === '2026-09');
    expect(target?.blocked).toBeNull();
    expect(target?.invoiceStatus).toBe('CLOSED');
  });

  it('banco arquivado marca as ocorrências como bloqueadas', () => {
    // Não deveria existir após as guardas da 6A, mas dado legado pode. O
    // forecast é defensivo: não projeta como normal nem quebra.
    const result = run([creditSub], {
      archived: ['bank-1'],
      horizon: 2,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((o) => o.blocked === 'bank-archived')).toBe(true);
  });

  it('sem fatura existente a ocorrência não é bloqueada', () => {
    const result = run([creditSub], { horizon: 2 });

    expect(result.every((o) => o.blocked === null)).toBe(true);
    expect(result.every((o) => o.invoiceStatus === null)).toBe(true);
  });
});

describe('forecast — dupla contagem', () => {
  it('ciclo já gerado não reaparece como projeção', () => {
    /**
     * O ciclo de agosto já virou Transaction, e essa Transaction já entra em
     * Compromissos pelo caminho das parcelas/lançamentos reais. Projetar o
     * mesmo ciclo de novo somaria o valor duas vezes.
     */
    const result = run([sub({ lastGeneratedFor: '2026-08' })], {
      today: '2026-08-20T12:00:00Z',
    });

    expect(result.map((o) => o.cycle)).not.toContain('2026-08');
    expect(result[0].cycle).toBe('2026-09');
  });

  it('nenhum ciclo aparece duas vezes', () => {
    const result = run([sub({ lastGeneratedFor: '2026-07' })]);

    const cycles = result.map((o) => o.cycle);
    expect(new Set(cycles).size).toBe(cycles.length);
  });
});

describe('forecast — múltiplas assinaturas', () => {
  it('projeta cada uma com a sua própria regra', () => {
    const result = run([
      sub({ id: 'a', title: 'Netflix', dayOfMonth: 12, amount: 39.9 }),
      sub({ id: 'b', title: 'Spotify', dayOfMonth: 25, amount: 21.9 }),
      sub({ id: 'c', title: 'Pausada', isActive: false }),
    ]);

    const ids = new Set(result.map((o) => o.subscriptionId));
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });

  it('o valor de cada ocorrência é o da assinatura', () => {
    // Não é média nem arredondamento: cada ocorrência usa o amount atual.
    const result = run([sub({ amount: 33.34, lastGeneratedFor: '2026-07' })], {
      horizon: 2,
    });

    expect(result.every((o) => o.amount === 33.34)).toBe(true);
  });

  it('ordena por data da cobrança', () => {
    const result = run([
      sub({ id: 'a', dayOfMonth: 25 }),
      sub({ id: 'b', dayOfMonth: 8 }),
    ]);

    const dates = result.map((o) => o.chargeDate.getTime());
    expect([...dates].sort((x, y) => x - y)).toEqual(dates);
  });
});

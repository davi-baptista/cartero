import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
  deriveInvoiceStatus,
  getInvoiceCloseDateForPeriod,
  getInvoiceDueDateForPeriod,
  getInvoicePeriodForDate,
  getLegacyCloseDay,
  offsetInvoicePeriod,
  type InvoiceSchedule,
} from './invoice.helper';
import { parseDateOnly } from './date-only.helper';

/** Dia civil de uma data, para comparar datas ignorando a hora-âncora. */
function toCivilDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * O núcleo financeiro do Cartero. Uma fatura é identificada pelo mês em que
 * VENCE; o fechamento é contado para trás a partir do vencimento, em dias
 * corridos, e por isso pode cair no mês anterior.
 *
 * Todas as datas aqui são explícitas e em UTC — nenhum teste consulta o
 * relógio real, e `deriveInvoiceStatus` sempre recebe o "hoje" por parâmetro.
 */

/** Vence dia 10, fecha 7 dias antes → dia 3 do mesmo mês. */
const closesSameMonth: InvoiceSchedule = {
  invoiceDueDate: 10,
  invoiceDueDaysAfterClose: 7,
};

/** Vence dia 5, fecha 7 dias antes → dia 29 do mês ANTERIOR. */
const closesPreviousMonth: InvoiceSchedule = {
  invoiceDueDate: 5,
  invoiceDueDaysAfterClose: 7,
};

/** Uma data-calendário em UTC, sem componente de hora relevante. */
function utc(year: number, month: number, day: number, hour = 12): Date {
  return new Date(Date.UTC(year, month - 1, day, hour));
}

describe('getInvoiceDueDateForPeriod', () => {
  it('usa o dia de vencimento dentro do mês do período', () => {
    const due = getInvoiceDueDateForPeriod(closesSameMonth, 2026, 3);
    expect(due.getUTCFullYear()).toBe(2026);
    expect(due.getUTCMonth() + 1).toBe(3);
    expect(due.getUTCDate()).toBe(10);
  });

  it('ancora o vencimento às 3h UTC', () => {
    // A âncora existe para que Fortaleza (UTC-3) renderize o dia correto.
    // Fixá-la em teste protege contra uma mudança acidental de fuso.
    const due = getInvoiceDueDateForPeriod(closesSameMonth, 2026, 3);
    expect(due.getUTCHours()).toBe(3);
  });

  it('trunca o dia para o último dia de meses mais curtos', () => {
    const dueDay31: InvoiceSchedule = {
      invoiceDueDate: 31,
      invoiceDueDaysAfterClose: 7,
    };

    expect(getInvoiceDueDateForPeriod(dueDay31, 2026, 4).getUTCDate()).toBe(30);
    expect(getInvoiceDueDateForPeriod(dueDay31, 2026, 2).getUTCDate()).toBe(28);
  });

  it('respeita fevereiro em ano bissexto', () => {
    const dueDay31: InvoiceSchedule = {
      invoiceDueDate: 31,
      invoiceDueDaysAfterClose: 7,
    };

    // 2028 é bissexto; 2027 não é.
    expect(getInvoiceDueDateForPeriod(dueDay31, 2028, 2).getUTCDate()).toBe(29);
    expect(getInvoiceDueDateForPeriod(dueDay31, 2027, 2).getUTCDate()).toBe(28);
  });
});

describe('getInvoiceCloseDateForPeriod', () => {
  it('conta os dias de intervalo para trás a partir do vencimento', () => {
    const close = getInvoiceCloseDateForPeriod(closesSameMonth, 2026, 3);
    expect(close.getUTCMonth() + 1).toBe(3);
    expect(close.getUTCDate()).toBe(3);
  });

  it('cai no mês anterior quando o intervalo atravessa a virada', () => {
    // Vence 5 de março, fecha 7 dias antes → 26 de fevereiro.
    const close = getInvoiceCloseDateForPeriod(closesPreviousMonth, 2026, 3);
    expect(close.getUTCMonth() + 1).toBe(2);
    expect(close.getUTCDate()).toBe(26);
  });

  it('atravessa a virada de ano para trás', () => {
    // Fatura de janeiro/2026 vence dia 5 → fecha 29 de dezembro/2025.
    const close = getInvoiceCloseDateForPeriod(closesPreviousMonth, 2026, 1);
    expect(close.getUTCFullYear()).toBe(2025);
    expect(close.getUTCMonth() + 1).toBe(12);
    expect(close.getUTCDate()).toBe(29);
  });

  it('trata intervalo zero ou negativo como um dia', () => {
    // `intervalDays` aplica Math.max(1, ...): fechamento e vencimento nunca
    // colapsam no mesmo instante, senão nenhuma compra seria atribuível.
    const zero: InvoiceSchedule = {
      invoiceDueDate: 10,
      invoiceDueDaysAfterClose: 0,
    };
    const close = getInvoiceCloseDateForPeriod(zero, 2026, 3);
    expect(close.getUTCDate()).toBe(9);
  });
});

describe('getInvoicePeriodForDate — associação de compra à fatura', () => {
  it('compra antes do fechamento entra na fatura do próprio mês', () => {
    expect(getInvoicePeriodForDate(closesSameMonth, utc(2026, 3, 1))).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it('compra no dia do fechamento ainda pertence à fatura corrente', () => {
    const closeDate = getInvoiceCloseDateForPeriod(closesSameMonth, 2026, 3);
    expect(getInvoicePeriodForDate(closesSameMonth, closeDate)).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it('compra depois do fechamento vai para a fatura seguinte', () => {
    expect(getInvoicePeriodForDate(closesSameMonth, utc(2026, 3, 4))).toEqual({
      year: 2026,
      month: 4,
    });
  });

  it('o dia do fechamento pertence à fatura corrente em qualquer horário', () => {
    // Antes, uma compra date-only (ancorada em 12h) no próprio dia do
    // fechamento (ancorado em 3h) caía na fatura seguinte só pela diferença
    // de âncora. A comparação agora é por dia civil.
    for (const hour of [0, 3, 6, 12, 23]) {
      expect(
        getInvoicePeriodForDate(closesSameMonth, utc(2026, 3, 3, hour)),
      ).toEqual({ year: 2026, month: 3 });
    }
  });

  it('o dia seguinte ao fechamento vai para a próxima em qualquer horário', () => {
    for (const hour of [0, 3, 12, 23]) {
      expect(
        getInvoicePeriodForDate(closesSameMonth, utc(2026, 3, 4, hour)),
      ).toEqual({ year: 2026, month: 4 });
    }
  });

  it('o dia anterior ao fechamento permanece na fatura corrente', () => {
    for (const hour of [0, 12, 23]) {
      expect(
        getInvoicePeriodForDate(closesSameMonth, utc(2026, 3, 2, hour)),
      ).toEqual({ year: 2026, month: 3 });
    }
  });

  it('uma data date-only cai na mesma fatura independentemente da âncora', () => {
    // Garante que a competência é função do dia civil, não do instante.
    const asDateOnly = parseDateOnly('2026-03-03');
    const atMidnight = utc(2026, 3, 3, 0);

    expect(getInvoicePeriodForDate(closesSameMonth, asDateOnly)).toEqual(
      getInvoicePeriodForDate(closesSameMonth, atMidnight),
    );
  });

  it('atravessa dezembro → janeiro do ano seguinte', () => {
    expect(getInvoicePeriodForDate(closesSameMonth, utc(2026, 12, 20))).toEqual(
      {
        year: 2027,
        month: 1,
      },
    );
  });

  it('mantém o ano quando a compra cai antes do fechamento de dezembro', () => {
    expect(getInvoicePeriodForDate(closesSameMonth, utc(2026, 12, 1))).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it('lida com compra em fevereiro de ano bissexto', () => {
    expect(getInvoicePeriodForDate(closesSameMonth, utc(2028, 2, 29))).toEqual({
      year: 2028,
      month: 3,
    });
  });
});

/**
 * Cartão que fecha no mês ANTERIOR ao vencimento (vence dia 5, fecha 7 dias
 * antes). Os fechamentos reais em 2026:
 *
 *   fatura 02/2026 → fecha 29/01     fatura 03/2026 → fecha 26/02
 *   fatura 04/2026 → fecha 29/03     fatura 05/2026 → fecha 28/04
 *
 * Duas consequências, e só a segunda era um defeito:
 *
 * 1. Nenhuma compra feita em fevereiro cai na fatura de fevereiro — ela já
 *    havia fechado em 29/01. Isso é a regra funcionando, não um bug.
 *
 * 2. Uma compra em 27/02 não pertence a março: março fechou em 26/02. A
 *    implementação anterior avançava no máximo UMA competência e parava em
 *    março sem reverificar. Corrigido: a busca agora percorre competências até
 *    achar a primeira ainda aberta.
 */
describe('getInvoicePeriodForDate — fechamento no mês anterior ao vencimento', () => {
  it('compra bem antes do fechamento da competência seguinte', () => {
    // 01/02: fevereiro já fechou (29/01); março fecha em 26/02 → março.
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 2, 1)),
    ).toEqual({ year: 2026, month: 3 });
  });

  it('compra no dia do fechamento pertence à fatura que fecha nele', () => {
    // 26/02 é exatamente o fechamento de março → ainda é março.
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 2, 26)),
    ).toEqual({ year: 2026, month: 3 });
  });

  it('compra no dia seguinte ao fechamento salta para a competência seguinte', () => {
    // 27/02: março fechou ontem → abril. Antes da correção ia para março.
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 2, 27)),
    ).toEqual({ year: 2026, month: 4 });
  });

  it('último dia do mês continua na competência correta', () => {
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 2, 28)),
    ).toEqual({ year: 2026, month: 4 });
  });

  it('avalia mais de uma competência candidata quando necessário', () => {
    // O caso que exige a busca: o mês da compra E o seguinte já fecharam.
    // 30/03 → abril fechou em 29/03 → maio.
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 3, 30)),
    ).toEqual({ year: 2026, month: 5 });
  });

  it('atravessa a virada de ano saltando duas competências', () => {
    // 30/12/2026: janeiro/2027 fecha em 29/12/2026 → fevereiro/2027.
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 12, 30)),
    ).toEqual({ year: 2027, month: 2 });
  });

  it('atravessa a virada de ano sem saltar quando ainda cabe', () => {
    // 28/12/2026: janeiro/2027 fecha em 29/12 → ainda é janeiro/2027.
    expect(
      getInvoicePeriodForDate(closesPreviousMonth, utc(2026, 12, 28)),
    ).toEqual({ year: 2027, month: 1 });
  });

  it('nunca devolve uma competência cujo fechamento já passou', () => {
    // Invariante geral, varrido dia a dia por dois anos e em vários
    // calendários — inclusive fevereiro de ano bissexto e meses de 28 a 31
    // dias. É a propriedade que a implementação anterior violava.
    const schedules: InvoiceSchedule[] = [
      closesSameMonth,
      closesPreviousMonth,
      { invoiceDueDate: 1, invoiceDueDaysAfterClose: 10 },
      { invoiceDueDate: 31, invoiceDueDaysAfterClose: 7 },
      { invoiceDueDate: 15, invoiceDueDaysAfterClose: 45 },
    ];

    for (const schedule of schedules) {
      for (let offset = 0; offset < 730; offset++) {
        const purchase = new Date(Date.UTC(2026, 0, 1 + offset, 12));
        const { year, month } = getInvoicePeriodForDate(schedule, purchase);
        const closeDate = getInvoiceCloseDateForPeriod(schedule, year, month);

        // A compra não pode ser posterior ao fechamento da fatura escolhida.
        expect(toCivilDay(purchase)).toBeLessThanOrEqual(toCivilDay(closeDate));
      }
    }
  });

  it('escolhe sempre a PRIMEIRA competência aberta, nunca uma posterior', () => {
    // Complemento do invariante acima: junto, os dois fixam a competência
    // exata — nem antes (fechada), nem depois (pularia uma válida).
    const schedules: InvoiceSchedule[] = [closesSameMonth, closesPreviousMonth];

    for (const schedule of schedules) {
      for (let offset = 0; offset < 400; offset++) {
        const purchase = new Date(Date.UTC(2026, 0, 1 + offset, 12));
        const { year, month } = getInvoicePeriodForDate(schedule, purchase);

        const previous = offsetInvoicePeriod(year, month, -1);
        const previousClose = getInvoiceCloseDateForPeriod(
          schedule,
          previous.year,
          previous.month,
        );

        // A competência anterior tem de estar fechada para a compra.
        expect(toCivilDay(purchase)).toBeGreaterThan(toCivilDay(previousClose));
      }
    }
  });
});

describe('offsetInvoicePeriod — parcelas em faturas subsequentes', () => {
  it('desloca meses dentro do mesmo ano', () => {
    expect(offsetInvoicePeriod(2026, 3, 2)).toEqual({ year: 2026, month: 5 });
  });

  it('atravessa a virada de ano', () => {
    expect(offsetInvoicePeriod(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
  });

  it('offset zero devolve o próprio período', () => {
    expect(offsetInvoicePeriod(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });

  it('cobre um parcelamento de 12x sem perder o mês', () => {
    expect(offsetInvoicePeriod(2026, 8, 11)).toEqual({ year: 2027, month: 7 });
  });
});

describe('deriveInvoiceStatus — fronteiras de status', () => {
  // Fatura de março/2026: fecha 03/03 às 3h, vence 10/03 às 3h.
  const year = 2026;
  const month = 3;

  it('antes do fechamento é OPEN', () => {
    expect(
      deriveInvoiceStatus(closesSameMonth, year, month, utc(2026, 3, 1)),
    ).toBe('OPEN');
  });

  it('no instante do fechamento já é CLOSED', () => {
    // A regra usa `today >= closeDate`.
    const closeDate = getInvoiceCloseDateForPeriod(
      closesSameMonth,
      year,
      month,
    );
    expect(deriveInvoiceStatus(closesSameMonth, year, month, closeDate)).toBe(
      'CLOSED',
    );
  });

  it('entre fechamento e vencimento é CLOSED', () => {
    expect(
      deriveInvoiceStatus(closesSameMonth, year, month, utc(2026, 3, 7)),
    ).toBe('CLOSED');
  });

  it('no instante do vencimento ainda é CLOSED', () => {
    // OVERDUE exige `today > dueDate` — vencer hoje não é estar vencida.
    const dueDate = getInvoiceDueDateForPeriod(closesSameMonth, year, month);
    expect(deriveInvoiceStatus(closesSameMonth, year, month, dueDate)).toBe(
      'CLOSED',
    );
  });

  it('depois do vencimento é OVERDUE', () => {
    expect(
      deriveInvoiceStatus(closesSameMonth, year, month, utc(2026, 3, 11)),
    ).toBe('OVERDUE');
  });

  it('nunca devolve PAID — pagamento não vem do calendário', () => {
    // `deriveInvoiceStatus` decide pelo tempo; PAID é sempre ação do usuário.
    // Isso é o que permite reabrir uma fatura paga e recebê-la como OVERDUE.
    const statuses = [utc(2026, 3, 1), utc(2026, 3, 5), utc(2026, 3, 30)].map(
      (today) => deriveInvoiceStatus(closesSameMonth, year, month, today),
    );

    expect(statuses).not.toContain('PAID');
  });
});

describe('getLegacyCloseDay', () => {
  it('calcula o dia de fechamento a partir do vencimento', () => {
    expect(getLegacyCloseDay(10, 7)).toBe(3);
  });

  it('mantém o resultado dentro de 1-31 ao dar a volta', () => {
    const day = getLegacyCloseDay(5, 7);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it('trata intervalo zero como um dia', () => {
    expect(getLegacyCloseDay(10, 0)).toBe(9);
  });
});

describe('constantes', () => {
  it('o intervalo padrão entre fechamento e vencimento é de 7 dias', () => {
    expect(DEFAULT_INVOICE_DAYS_AFTER_CLOSE).toBe(7);
  });
});

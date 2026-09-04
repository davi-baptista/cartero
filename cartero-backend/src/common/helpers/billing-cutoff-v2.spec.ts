import { describe, expect, it } from 'vitest';
import {
  getInvoiceCloseDateForPeriod,
  getInvoicePeriodForDate,
  type InvoiceSchedule,
} from './invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * BILLING CUTOFF V2 — o dia do fechamento pertence ao PRÓXIMO ciclo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Mudança deliberada de contrato de produto.
 *
 *   ANTES   date <= closeDate  → ciclo corrente
 *   AGORA   date <  closeDate  → ciclo corrente
 *
 * O `closeDate` passou a ser EXCLUSIVO.
 *
 * ── Por que ──
 *
 * O Cartero modela fechamento por DIA CIVIL. Não guarda horário de cutoff do
 * emissor, timezone por cartão, nem o momento real de processamento do banco.
 * Sem essas informações, tratar o dia inteiro do fechamento como ainda-aberto
 * afirmaria uma disponibilidade que o app não pode garantir — o início do dia
 * civil é a fronteira determinística.
 *
 * ── O que NÃO mudou ──
 *
 * O algoritmo de calendário (clamp de fim de mês, fechamento em outro mês que
 * a competência, virada de ano) e a semântica de vencimento. A única alteração
 * é a inclusividade da fronteira.
 */

/** Vence dia 17, fecha 7 dias antes → fechamento no dia 10 do mesmo mês. */
const FECHA_DIA_10: InvoiceSchedule = {
  invoiceDueDate: 17,
  invoiceDueDaysAfterClose: 7,
};

/** Vence dia 5, fecha 10 dias antes → fechamento no mês ANTERIOR. */
const FECHA_MES_ANTERIOR: InvoiceSchedule = {
  invoiceDueDate: 5,
  invoiceDueDaysAfterClose: 10,
};

/** Compra ancorada ao meio-dia, como `parseDateOnly` faz. */
const compra = (ano: number, mes: number, dia: number, hora = 12) =>
  new Date(Date.UTC(ano, mes - 1, dia, hora));

describe('B1-B3: a fronteira do dia do fechamento', () => {
  it('B1: 09/09 com fechamento em 10/09 → ciclo CORRENTE', () => {
    /* O dia anterior continua na fatura que fecha — sem off-by-one invertido. */
    expect(getInvoicePeriodForDate(FECHA_DIA_10, compra(2026, 9, 9))).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it('B2: 10/09 com fechamento em 10/09 → ciclo SEGUINTE', () => {
    /* O teste principal da fase: o dia exato já saltou. */
    expect(getInvoicePeriodForDate(FECHA_DIA_10, compra(2026, 9, 10))).toEqual({
      year: 2026,
      month: 10,
    });
  });

  it('B3: 11/09 com fechamento em 10/09 → ciclo SEGUINTE', () => {
    expect(getInvoicePeriodForDate(FECHA_DIA_10, compra(2026, 9, 11))).toEqual({
      year: 2026,
      month: 10,
    });
  });

  it('o fechamento projetado é realmente o dia 10', () => {
    /* Ancora o cenário: sem isto os três testes acima poderiam medir outro dia. */
    const close = getInvoiceCloseDateForPeriod(FECHA_DIA_10, 2026, 9);

    expect(close.getUTCDate()).toBe(10);
    expect(close.getUTCMonth() + 1).toBe(9);
  });
});

describe('B4 / §7: a HORA não decide a fatura', () => {
  it('qualquer instante de 10/09 cai na MESMA fatura seguinte', () => {
    /*
      A comparação é por dia civil. Comparar instantes crus faria 00h01 e
      23h59 divergirem — e o cutoff deixaria de ser determinístico, que é
      justamente a razão de a V2 existir.
    */
    for (const hora of [0, 1, 3, 6, 12, 18, 23]) {
      expect(
        getInvoicePeriodForDate(FECHA_DIA_10, compra(2026, 9, 10, hora)),
        `hora ${hora}`,
      ).toEqual({ year: 2026, month: 10 });
    }
  });

  it('e qualquer instante de 09/09 permanece no corrente', () => {
    for (const hora of [0, 3, 12, 23]) {
      expect(
        getInvoicePeriodForDate(FECHA_DIA_10, compra(2026, 9, 9, hora)),
        `hora ${hora}`,
      ).toEqual({ year: 2026, month: 9 });
    }
  });

  it('a fronteira é o dia, não o instante do fechamento', () => {
    /*
      As datas de fatura são ancoradas em 3h e as compras em 12h. Se a
      comparação usasse timestamp cru, uma compra às 00h do dia do fechamento
      (antes das 3h) responderia diferente de uma às 12h.
    */
    const meiaNoite = getInvoicePeriodForDate(
      FECHA_DIA_10,
      compra(2026, 9, 10, 0),
    );
    const depoisDasTres = getInvoicePeriodForDate(
      FECHA_DIA_10,
      compra(2026, 9, 10, 4),
    );

    expect(meiaNoite).toEqual(depoisDasTres);
  });
});

describe('§9: viradas de mês e de ano', () => {
  it('fechamento dia 31 em dezembro salta para 2027', () => {
    /* Vence 07/01 fechando 7 dias antes → fecha 31/12. */
    const cartao: InvoiceSchedule = {
      invoiceDueDate: 7,
      invoiceDueDaysAfterClose: 7,
    };
    const close = getInvoiceCloseDateForPeriod(cartao, 2027, 1);

    expect(close.getUTCFullYear()).toBe(2026);
    expect(close.getUTCMonth() + 1).toBe(12);
    expect(close.getUTCDate()).toBe(31);

    /* 30/12 ainda é a competência de janeiro/2027. */
    expect(getInvoicePeriodForDate(cartao, compra(2026, 12, 30))).toEqual({
      year: 2027,
      month: 1,
    });
    /* 31/12 — o dia do fechamento — já é fevereiro/2027. */
    expect(getInvoicePeriodForDate(cartao, compra(2026, 12, 31))).toEqual({
      year: 2027,
      month: 2,
    });
  });

  it('o fechamento no mês ANTERIOR à competência segue a mesma regra', () => {
    /* Vence 05/03 fechando 10 dias antes → março fecha em 23/02. */
    const close = getInvoiceCloseDateForPeriod(FECHA_MES_ANTERIOR, 2026, 3);
    expect(close.getUTCMonth() + 1).toBe(2);
    expect(close.getUTCDate()).toBe(23);

    /* 22/02 ainda é março; 23/02 — o dia do fechamento — já é abril. */
    expect(
      getInvoicePeriodForDate(FECHA_MES_ANTERIOR, compra(2026, 2, 22)),
    ).toEqual({ year: 2026, month: 3 });
    expect(
      getInvoicePeriodForDate(FECHA_MES_ANTERIOR, compra(2026, 2, 23)),
    ).toEqual({ year: 2026, month: 4 });
  });
});

describe('§10: o clamp de fim de mês não mudou', () => {
  const venceUltimoDia: InvoiceSchedule = {
    invoiceDueDate: 31,
    invoiceDueDaysAfterClose: 1,
  };

  it('fevereiro não bissexto: vence 28, fecha 27', () => {
    const close = getInvoiceCloseDateForPeriod(venceUltimoDia, 2026, 2);

    expect(close.getUTCDate()).toBe(27);
    /* 26 ainda é fevereiro; 27 — o fechamento — já é março. */
    expect(getInvoicePeriodForDate(venceUltimoDia, compra(2026, 2, 26))).toEqual(
      { year: 2026, month: 2 },
    );
    expect(getInvoicePeriodForDate(venceUltimoDia, compra(2026, 2, 27))).toEqual(
      { year: 2026, month: 3 },
    );
  });

  it('fevereiro bissexto: vence 29, fecha 28', () => {
    const close = getInvoiceCloseDateForPeriod(venceUltimoDia, 2028, 2);

    expect(close.getUTCDate()).toBe(28);
  });

  it('abril tem 30 dias', () => {
    expect(
      getInvoiceCloseDateForPeriod(venceUltimoDia, 2026, 4).getUTCDate(),
    ).toBe(29);
  });

  it('mês de 31 dias usa o dia cheio', () => {
    expect(
      getInvoiceCloseDateForPeriod(venceUltimoDia, 2026, 5).getUTCDate(),
    ).toBe(30);
  });

  it('nenhum overflow silencioso de mês', () => {
    /*
      `new Date(2026, 1, 31)` viraria 03/03 em JS. O clamp impede que a
      competência escorregue para outro mês.
    */
    for (const mes of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const close = getInvoiceCloseDateForPeriod(venceUltimoDia, 2026, mes);
      const mesDoFechamento = close.getUTCMonth() + 1;
      /* O fechamento é do próprio mês da competência neste cartão. */
      expect(mesDoFechamento, `competência ${mes}`).toBe(mes);
    }
  });
});

describe('§11: o vencimento não mudou de semântica', () => {
  it('fecha 10, vence 17 — mesmo mês', () => {
    const close = getInvoiceCloseDateForPeriod(FECHA_DIA_10, 2026, 9);

    expect(close.getUTCDate()).toBe(10);
    expect(close.getUTCMonth() + 1).toBe(9);
  });

  it('fecha 26/02, vence 05/03 — meses diferentes', () => {
    /* O vencimento segue a competência; só o fechamento recua. */
    const close = getInvoiceCloseDateForPeriod(FECHA_MES_ANTERIOR, 2026, 3);

    expect(close.getUTCMonth() + 1).toBe(2);
  });
});

describe('a competência escolhida é sempre a PRIMEIRA aberta', () => {
  it('nunca salta uma competência válida', () => {
    /*
      Propriedade sobre 400 dias: a anterior tem de estar fechada (`>=`, pelo
      cutoff exclusivo) e a escolhida ainda aberta (`<`).
    */
    for (const cartao of [FECHA_DIA_10, FECHA_MES_ANTERIOR]) {
      for (let offset = 0; offset < 400; offset++) {
        const data = new Date(Date.UTC(2026, 0, 1 + offset, 12));
        const { year, month } = getInvoicePeriodForDate(cartao, data);

        const close = getInvoiceCloseDateForPeriod(cartao, year, month);
        const dia = (d: Date) =>
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

        /* A escolhida ainda não fechou para esta compra. */
        expect(dia(data), `${data.toISOString()}`).toBeLessThan(dia(close));
      }
    }
  });
});

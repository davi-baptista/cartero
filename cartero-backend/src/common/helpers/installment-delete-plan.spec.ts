import { describe, expect, it } from 'vitest';
import {
  buildInstallmentDeletePlan,
  deletableSetChanged,
  readInstallmentNumber,
  resolvePreservationReason,
  type InstallmentCandidate,
  type InstallmentProtectionFacts,
} from './installment-delete-plan';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A política de "excluir parcelas em aberto"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A regra que decide o que sai e o que fica é pura, e é testada aqui sem
 * banco. O spec do service cobre a integração; este cobre a decisão.
 */

const semProtecao: InstallmentProtectionFacts = {
  paidInvoiceIds: new Set(),
  receivedReceivableSourceIds: new Set(),
  paymentTransactionIds: new Set(),
  pendingReceivableSourceIds: new Set(),
};

function parcela(
  numero: number,
  total: number,
  extras: Partial<InstallmentCandidate> = {},
): InstallmentCandidate {
  return {
    id: `t${numero}`,
    amount: 100,
    date: new Date('2026-01-10T00:00:00Z'),
    title: `Notebook ${numero}/${total}`,
    invoiceId: `inv${numero}`,
    ...extras,
  };
}

const serie = (total: number) =>
  Array.from({ length: total }, (_, i) => parcela(i + 1, total));

/** Totais de fatura que fazem cada uma zerar ao perder sua parcela. */
const totaisQueZeram = (candidatas: InstallmentCandidate[]) =>
  new Map(
    candidatas
      .filter((c) => c.invoiceId)
      .map((c) => [c.invoiceId as string, Number(c.amount)]),
  );

describe('S1: série inteiramente aberta', () => {
  it('todas as parcelas são deletáveis', () => {
    const s = serie(10);
    const plan = buildInstallmentDeletePlan(s, semProtecao, totaisQueZeram(s));

    expect(plan.deletable).toHaveLength(10);
    expect(plan.preserved).toHaveLength(0);
  });
});

describe('S2: 6 pagas + 4 abertas — o cenário central', () => {
  const s = serie(10);
  const facts: InstallmentProtectionFacts = {
    ...semProtecao,
    paidInvoiceIds: new Set(['inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'inv6']),
  };

  it('remove as 4 abertas e preserva as 6 pagas', () => {
    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));

    expect(plan.deletable.map((t) => t.id)).toEqual(['t7', 't8', 't9', 't10']);
    expect(plan.preserved.map((p) => p.transaction.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
    ]);
  });

  it('o histórico pago NÃO bloqueia as abertas', () => {
    /*
      A regressão que esta fase existe para impedir: antes, `ALL` numa série
      assim era recusado inteiro e o usuário não tinha caminho nenhum.
    */
    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));
    expect(plan.deletable.length).toBeGreaterThan(0);
  });

  it('cada preservada carrega o motivo', () => {
    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));
    expect(plan.preserved.every((p) => p.reason === 'PAID_INVOICE')).toBe(true);
  });
});

describe('S3/S9: série inteiramente protegida', () => {
  it('nada é deletável', () => {
    const s = serie(10);
    const facts: InstallmentProtectionFacts = {
      ...semProtecao,
      paidInvoiceIds: new Set(s.map((t) => t.invoiceId as string)),
    };

    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));

    expect(plan.deletable).toHaveLength(0);
    expect(plan.preserved).toHaveLength(10);
  });
});

describe('S4: proteções de motivos diferentes na mesma série', () => {
  it('separa as três razões e ainda remove as deletáveis', () => {
    const s = serie(10);
    const facts: InstallmentProtectionFacts = {
      paidInvoiceIds: new Set(['inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'inv6']),
      receivedReceivableSourceIds: new Set(['t7']),
      paymentTransactionIds: new Set(['t8']),
      pendingReceivableSourceIds: new Set(),
    };

    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));

    expect(plan.deletable.map((t) => t.id)).toEqual(['t9', 't10']);

    const motivos = Object.fromEntries(
      plan.preserved.map((p) => [p.transaction.id, p.reason]),
    );
    expect(motivos.t1).toBe('PAID_INVOICE');
    expect(motivos.t7).toBe('RECEIVABLE_ALREADY_PAID');
    expect(motivos.t8).toBe('PAYMENT_TRANSACTION_LINKED');
  });
});

describe('S7: parcela vencida e não liquidada continua aberta', () => {
  it('vencer não consolida nada — ela é deletável', () => {
    /*
      "Em aberto" não é "futura". Uma parcela que venceu e não foi paga
      continua reversível; tratá-la como histórico prenderia o usuário.
    */
    const vencida = parcela(1, 3, {
      date: new Date('2020-01-01T00:00:00Z'),
      invoiceId: 'invVencida',
    });

    const plan = buildInstallmentDeletePlan(
      [vencida],
      semProtecao,
      new Map([['invVencida', 100]]),
    );

    expect(plan.deletable).toHaveLength(1);
  });
});

describe('S8: uma única parcela aberta restante', () => {
  it('ela sai e o histórico fica', () => {
    const s = serie(10);
    const facts: InstallmentProtectionFacts = {
      ...semProtecao,
      paidInvoiceIds: new Set(s.slice(0, 9).map((t) => t.invoiceId as string)),
    };

    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));

    expect(plan.deletable.map((t) => t.id)).toEqual(['t10']);
    expect(plan.preserved).toHaveLength(9);
  });
});

describe('parcela sem fatura', () => {
  it('débito, PIX e boleto são deletáveis — não há fatura que os trave', () => {
    const avulsa = parcela(1, 2, { invoiceId: null });
    const plan = buildInstallmentDeletePlan([avulsa], semProtecao, new Map());

    expect(plan.deletable).toHaveLength(1);
    expect(plan.invoicesEmptied).toHaveLength(0);
  });
});

describe('precedência dos motivos', () => {
  /*
    Uma parcela pode satisfazer mais de uma condição. A ordem tem de ser a
    mesma do `remove` legado, senão a prévia diria um motivo e a recusa diria
    outro — e as duas telas se contradiriam.
  */
  const alvo = parcela(1, 1);

  it('fatura paga vence cobrança recebida', () => {
    const reason = resolvePreservationReason(alvo, {
      ...semProtecao,
      paidInvoiceIds: new Set(['inv1']),
      receivedReceivableSourceIds: new Set(['t1']),
    });
    expect(reason).toBe('PAID_INVOICE');
  });

  it('cobrança recebida vence comprovante de quitação', () => {
    const reason = resolvePreservationReason(alvo, {
      ...semProtecao,
      receivedReceivableSourceIds: new Set(['t1']),
      paymentTransactionIds: new Set(['t1']),
    });
    expect(reason).toBe('RECEIVABLE_ALREADY_PAID');
  });

  it('sem trava alguma, nada protege', () => {
    expect(resolvePreservationReason(alvo, semProtecao)).toBeNull();
  });
});

describe('S5/S6: cobranças derivadas', () => {
  it('conta a cobrança pendente que sai com a compra deletável', () => {
    const s = serie(3);
    const plan = buildInstallmentDeletePlan(
      s,
      { ...semProtecao, pendingReceivableSourceIds: new Set(['t1', 't2']) },
      totaisQueZeram(s),
    );

    expect(plan.receivablesRemoved).toBe(2);
  });

  it('NÃO conta a cobrança de uma parcela preservada', () => {
    const s = serie(3);
    const plan = buildInstallmentDeletePlan(
      s,
      {
        ...semProtecao,
        paidInvoiceIds: new Set(['inv1']),
        pendingReceivableSourceIds: new Set(['t1']),
      },
      totaisQueZeram(s),
    );

    /* t1 fica; a cobrança dela também. */
    expect(plan.receivablesRemoved).toBe(0);
  });

  it('cobrança RECEBIDA protege a compra e não é contada como removida', () => {
    const s = serie(2);
    const plan = buildInstallmentDeletePlan(
      s,
      { ...semProtecao, receivedReceivableSourceIds: new Set(['t1']) },
      totaisQueZeram(s),
    );

    expect(plan.preserved.map((p) => p.transaction.id)).toEqual(['t1']);
    expect(plan.receivablesRemoved).toBe(0);
  });
});

describe('faturas que ficam vazias', () => {
  it('duas parcelas na MESMA fatura contam a fatura uma vez só', () => {
    /*
      O erro que este teste barra: descontar parcela por parcela concluiria
      que a fatura não zera, quando as duas juntas a zeram. A tela prometeria
      algo diferente do que a execução faz.
    */
    const a = parcela(1, 2, { id: 'a', invoiceId: 'inv', amount: 60 });
    const b = parcela(2, 2, { id: 'b', invoiceId: 'inv', amount: 40 });

    const plan = buildInstallmentDeletePlan(
      [a, b],
      semProtecao,
      new Map([['inv', 100]]),
    );

    expect(plan.invoicesEmptied).toEqual(['inv']);
  });

  it('fatura com outras compras não zera', () => {
    const a = parcela(1, 1, { id: 'a', invoiceId: 'inv', amount: 60 });
    const plan = buildInstallmentDeletePlan(
      [a],
      semProtecao,
      new Map([['inv', 250]]),
    );

    expect(plan.invoicesEmptied).toHaveLength(0);
  });

  it('uma fatura zera e outra não, na mesma série', () => {
    const a = parcela(1, 2, { id: 'a', invoiceId: 'invA', amount: 100 });
    const b = parcela(2, 2, { id: 'b', invoiceId: 'invB', amount: 100 });

    const plan = buildInstallmentDeletePlan(
      [a, b],
      semProtecao,
      new Map([
        ['invA', 100],
        ['invB', 380],
      ]),
    );

    expect(plan.invoicesEmptied).toEqual(['invA']);
  });
});

describe('numeração', () => {
  it('lê o número original do título', () => {
    expect(readInstallmentNumber('Notebook 7/10')).toBe(7);
  });

  it('devolve null fora de série', () => {
    expect(readInstallmentNumber('Mercado')).toBeNull();
  });

  it('7/10 continua 7 mesmo com 8, 9 e 10 removidas', () => {
    /*
      Renumerar reescreveria o contrato original da compra para caber no que
      sobrou. O título é registro histórico, não índice de array.
    */
    const s = serie(10);
    const facts: InstallmentProtectionFacts = {
      ...semProtecao,
      paidInvoiceIds: new Set(['inv7']),
    };

    const plan = buildInstallmentDeletePlan(s, facts, totaisQueZeram(s));
    const sobrevivente = plan.preserved[0].transaction;

    expect(sobrevivente.title).toBe('Notebook 7/10');
    expect(readInstallmentNumber(sobrevivente.title)).toBe(7);
  });
});

describe('conjunto obsoleto', () => {
  it('detecta troca de identidade com a MESMA contagem', () => {
    /*
      É por isso que a comparação é por id e não por número: A,B,C → A,B,D
      mantém três, e apagar D em vez de C seria executar outra operação sob a
      confirmação da primeira.
    */
    expect(deletableSetChanged(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(true);
  });

  it('ordem diferente não é mudança', () => {
    expect(deletableSetChanged(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('tamanho diferente é mudança', () => {
    expect(deletableSetChanged(['a', 'b'], ['a'])).toBe(true);
  });

  it('conjunto idêntico não é mudança', () => {
    expect(deletableSetChanged(['a', 'b'], ['a', 'b'])).toBe(false);
  });
});

describe('valores', () => {
  it('a soma usa os valores reais, não valor × quantidade', () => {
    /*
      R$ 1.000 em 3x é 333,33 + 333,33 + 333,34. Multiplicar erraria o total
      justamente na tela que promete o impacto.
    */
    const s = [
      parcela(1, 3, { id: 'a', amount: 333.33, invoiceId: 'i1' }),
      parcela(2, 3, { id: 'b', amount: 333.33, invoiceId: 'i2' }),
      parcela(3, 3, { id: 'c', amount: 333.34, invoiceId: 'i3' }),
    ];

    const plan = buildInstallmentDeletePlan(s, semProtecao, new Map());
    const total = plan.deletable.reduce((t, i) => t + Number(i.amount), 0);

    expect(total).toBeCloseTo(1000, 2);
    expect(total).not.toBe(333.33 * 3);
  });
});

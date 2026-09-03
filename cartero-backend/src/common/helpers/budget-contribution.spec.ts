import { describe, expect, it } from 'vitest';
import { resolveContribution } from './budget-contribution.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A contribuição ao Orçamento tem estado próprio
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "A saída líquida desta relação já foi coberta?" é outra pergunta de "a
 * relação bilateral terminou?". Devendo R$ 11 a quem me deve R$ 10, pagar a
 * dívida cobre a saída de R$ 1 — mesmo com o recebível ainda aberto.
 */

const pago = (amount: number, dia: string | null) => ({
  amount,
  paidAt: dia ? new Date(`${dia}T12:00:00.000Z`) : null,
});

describe('o teto: pago nunca ultrapassa o planejado', () => {
  it('M1: nada pago', () => {
    const r = resolveContribution(50, []);

    expect(r).toMatchObject({ planned: 50, paid: 0, remaining: 50, isSettled: false });
  });

  it('M2: cobertura parcial', () => {
    const r = resolveContribution(50, [pago(30, '2026-09-05')]);

    expect(r).toMatchObject({ planned: 50, paid: 30, remaining: 20, isSettled: false });
  });

  it('M3: pago LIMITADO ao planejado, nunca o bruto', () => {
    /*
      R$ 130 em dívidas, R$ 80 a receber, tudo quitado: a saída foi R$ 50.
      Dizer R$ 130 afirmaria mais desembolso do que a competência planejou.
    */
    const r = resolveContribution(50, [
      pago(30, '2026-09-05'),
      pago(100, '2026-09-12'),
    ]);

    expect(r.paid).toBe(50);
    expect(r.paid).not.toBe(130);
    expect(r.remaining).toBe(0);
    expect(r.isSettled).toBe(true);
  });

  it('planned = paid + remaining, sempre', () => {
    const casos: Array<[number, Array<ReturnType<typeof pago>>]> = [
      [50, []],
      [50, [pago(30, '2026-09-05')]],
      [50, [pago(30, '2026-09-05'), pago(100, '2026-09-12')]],
      [1, [pago(11, '2026-09-12')]],
      [0, [pago(30, '2026-09-12')]],
    ];

    for (const [planned, pagamentos] of casos) {
      const r = resolveContribution(planned, pagamentos);
      expect(r.paid + r.remaining, `planejado ${planned}`).toBeCloseTo(
        r.planned,
        2,
      );
    }
  });
});

describe('T1-T4: quando a cobertura se completou', () => {
  it('T1: a data em que o acumulado cruzou o planejado', () => {
    /*
      Planejado 50. R$ 30 em 05/09 não cobre; os R$ 100 de 12/09 completam.
    */
    const r = resolveContribution(50, [
      pago(30, '2026-09-05'),
      pago(100, '2026-09-12'),
    ]);

    expect(r.settledAt).toBe('2026-09-12');
  });

  it('T2: pagamento POSTERIOR não muda a data', () => {
    /*
      A razão de não usar `max(paidAt)`: a terceira dívida veio depois de a
      saída já estar coberta, e não participa do momento da cobertura.
    */
    const r = resolveContribution(50, [
      pago(30, '2026-09-05'),
      pago(100, '2026-09-12'),
      pago(70, '2026-09-20'),
    ]);

    expect(r.settledAt).toBe('2026-09-12');
    expect(r.settledAt).not.toBe('2026-09-20');
  });

  it('a ordem de chegada não altera o resultado', () => {
    /*
      A resposta depende da ordem CRONOLÓGICA, não da ordem do array — que
      vem da consulta e não é contrato.
    */
    const pagamentos = [
      pago(70, '2026-09-20'),
      pago(30, '2026-09-05'),
      pago(100, '2026-09-12'),
    ];

    expect(resolveContribution(50, pagamentos).settledAt).toBe('2026-09-12');
    expect(resolveContribution(50, [...pagamentos].reverse()).settledAt).toBe(
      '2026-09-12',
    );
  });

  it('um pagamento que cobre sozinho', () => {
    expect(resolveContribution(1, [pago(11, '2026-09-02')]).settledAt).toBe(
      '2026-09-02',
    );
  });

  it('T4: pagamento sem data não impede quando outro cobre sozinho', () => {
    /*
      Sem `paidAt` o pagamento vai para o FIM da ordenação — não sabemos
      quando ocorreu, então não pode determinar o momento da cobertura.

      Aqui os R$ 100 de 12/09 cobrem os R$ 50 sozinhos, antes de o sem-data
      ser sequer alcançado: a data é afirmável e não há por que descartá-la.
    */
    const r = resolveContribution(50, [pago(30, null), pago(100, '2026-09-12')]);

    expect(r.isSettled).toBe(true);
    expect(r.settledAt).toBe('2026-09-12');
  });

  it('T4b: mas sem data NECESSÁRIA para cobrir, nenhum dia é inventado', () => {
    /*
      Aqui o sem-data é indispensável: R$ 30 datados não cobrem os R$ 50, e o
      que completa não tem quando. Afirmar 05/09 diria que a saída estava
      coberta antes de estar.
    */
    const r = resolveContribution(50, [pago(30, '2026-09-05'), pago(40, null)]);

    expect(r.isSettled).toBe(true);
    expect(r.settledAt).toBeNull();
  });

  it('sem cobertura completa não há data', () => {
    expect(resolveContribution(50, [pago(30, '2026-09-05')]).settledAt).toBeNull();
  });

  it('dia civil de Fortaleza', () => {
    /* 12/09 01h UTC é 11/09 22h em Fortaleza. */
    const r = resolveContribution(10, [
      { amount: 10, paidAt: new Date(Date.UTC(2026, 8, 12, 1)) },
    ]);

    expect(r.settledAt).toBe('2026-09-11');
  });
});

describe('§19: contribuição zero não é "pago"', () => {
  it('devo 30 a quem me deve 50 → planejado zero', () => {
    /*
      A relação não tira nada do bolso. Marcar como "pago" criaria uma
      conclusão sobre uma saída que nunca existiu — e um valor sem origem no
      resumo, porque a pessoa nem aparece em "Acertos com pessoas".
    */
    const r = resolveContribution(0, [pago(30, '2026-09-12')]);

    expect(r).toMatchObject({
      planned: 0,
      paid: 0,
      remaining: 0,
      isSettled: false,
      settledAt: null,
    });
  });

  it('planejado negativo é tratado como zero', () => {
    /* Quem me deve mais não vira crédito no orçamento. */
    expect(resolveContribution(-20, [pago(30, '2026-09-12')]).planned).toBe(0);
  });
});

describe('§15: a cobertura independe da relação bilateral', () => {
  it('Fabricio: dívida paga, recebível aberto → contribuição coberta', () => {
    /*
      O contrato deliberado. `resolveContribution` só olha os pagamentos de
      DÍVIDA — recebimentos não cobrem saída de caixa, e esperar por eles faria
      o orçamento dizer "a pagar R$ 1" depois de o dinheiro ter saído.
    */
    const r = resolveContribution(1, [pago(11, '2026-09-02')]);

    expect(r.isSettled).toBe(true);
    expect(r.paid).toBe(1);
    expect(r.settledAt).toBe('2026-09-02');
  });
});

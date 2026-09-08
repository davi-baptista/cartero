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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O recebível abate os DOIS lados — a simetria
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A versão anterior era assimétrica: o recebível subtraía do alvo e não dos
 * pagamentos. A folga resultante — exatamente do tamanho do recebível —
 * absorvia dívida ABERTA, e a competência se declarava quitada com obrigação
 * vencida em aberto.
 *
 * Os casos abaixo são os do contrato aprovado, com o caso real de produção
 * (T1) na frente. `planned` é sempre `max(dívidas − recebíveis, 0)`; o que
 * mudou é a cobertura, agora `max(Σ pagas − recebíveis, 0)`.
 */
describe('T1-T6: a cobertura é LÍQUIDA de recebíveis', () => {
  it('T1: o caso real — 85,37 pagas · 11 aberta · 39,13 a receber', () => {
    /*
      Produção declarava esta competência QUITADA: `min(57,24, 85,37)` dava
      cobertura total, porque os 85,37 chegavam brutos. A dívida de R$ 11
      estava aberta e vencida.
    */
    const r = resolveContribution(57.24, [pago(85.37, '2026-08-06')], 39.13);

    expect(r.planned).toBe(57.24);
    expect(r.paid).toBe(46.24);
    expect(r.remaining).toBe(11);
    expect(r.isSettled).toBe(false);
    expect(r.settledAt).toBeNull();
  });

  it('T2: a fronteira — aberta igual ao recebível', () => {
    /* 85,37 − 39,13 = 46,24 de cobertura para um alvo de 85,37. */
    const r = resolveContribution(85.37, [pago(85.37, '2026-08-06')], 39.13);

    expect(r.paid).toBe(46.24);
    expect(r.remaining).toBe(39.13);
    expect(r.isSettled).toBe(false);
  });

  it('T3: devo 11 a quem me deve 10 — pagar a dívida QUITA a saída de 1', () => {
    /*
      O caso que motivou a contribuição líquida, e que precisa continuar
      valendo: 11 − 10 = 1 de alvo, 11 − 10 = 1 de cobertura.
    */
    const r = resolveContribution(1, [pago(11, '2026-09-02')], 10);

    expect(r.planned).toBe(1);
    expect(r.paid).toBe(1);
    expect(r.remaining).toBe(0);
    expect(r.isSettled).toBe(true);
    expect(r.settledAt).toBe('2026-09-02');
  });

  it('T4: net zero — dívida 30, recebível 50, nada pago', () => {
    /*
      Não é `anyOpenDebt`: existe dívida ABERTA e mesmo assim a relação não
      tira nada do bolso nesta competência. O netting por pessoa é preservado.
    */
    const r = resolveContribution(0, [], 50);

    expect(r.planned).toBe(0);
    expect(r.paid).toBe(0);
    expect(r.remaining).toBe(0);
    expect(r.isSettled).toBe(false);
  });

  it('T5: misto — 20 pagas, 30 abertas, 40 a receber', () => {
    /* Os 20 pagos nem chegam a repor o recebível: cobertura ZERO. */
    const r = resolveContribution(10, [pago(20, '2026-09-05')], 40);

    expect(r.planned).toBe(10);
    expect(r.paid).toBe(0);
    expect(r.remaining).toBe(10);
    expect(r.isSettled).toBe(false);
  });

  it('T6: sem recebível, o comportamento intuitivo não muda', () => {
    const r = resolveContribution(57.24, [pago(46.24, '2026-08-18')], 0);

    expect(r.planned).toBe(57.24);
    expect(r.paid).toBe(46.24);
    expect(r.remaining).toBe(11);
    expect(r.isSettled).toBe(false);
  });

  it('o parâmetro é opcional — quem não passa nada mantém o comportamento antigo', () => {
    const semArg = resolveContribution(57.24, [pago(46.24, '2026-08-18')]);
    const comZero = resolveContribution(57.24, [pago(46.24, '2026-08-18')], 0);

    expect(semArg).toEqual(comZero);
  });

  it('`paid` nunca fica negativo quando o recebível supera os pagamentos', () => {
    /*
      O acumulador começa em `−recebíveis`. Sem o piso em zero, `paid` sairia
      negativo e `paid + remaining = planned` deixaria de fechar.
    */
    const r = resolveContribution(10, [pago(5, '2026-09-05')], 40);

    expect(r.paid).toBe(0);
    expect(r.paid + r.remaining).toBe(r.planned);
  });

  it('a identidade `planned = paid + remaining` vale com recebível', () => {
    const casos: Array<[number, number, number]> = [
      [57.24, 85.37, 39.13],
      [85.37, 85.37, 39.13],
      [1, 11, 10],
      [10, 20, 40],
      [60, 90, 40],
    ];

    for (const [planned, pagas, recv] of casos) {
      const r = resolveContribution(planned, [pago(pagas, '2026-08-06')], recv);
      expect(Math.abs(r.planned - (r.paid + r.remaining))).toBeLessThan(0.005);
    }
  });

  it('`settledAt` só existe quando a cobertura LÍQUIDA se completa', () => {
    /*
      Dois pagamentos: o primeiro é inteiramente consumido repondo o
      recebível, então a data da cobertura é a do SEGUNDO.
    */
    const r = resolveContribution(
      20,
      [pago(30, '2026-09-05'), pago(30, '2026-09-12')],
      40,
    );

    expect(r.isSettled).toBe(true);
    expect(r.settledAt).toBe('2026-09-12');
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Duas probes que NÃO morrem — e por quê
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Vale registrar, porque a ausência de teste aqui é deliberada.
 *
 * ── `anyOpenDebt` como guard de `isSettled` ──
 *
 * Com a cobertura líquida, os dois critérios COINCIDEM em `isSettled`:
 *
 *   settled ⟺ (Σpagas − recv) ≥ (Σpagas + abertas − recv) ⟺ abertas ≤ 0
 *
 * Não existe estado com dívida aberta e contribuição coberta, então nenhum
 * teste sobre `isSettled` consegue separar as regras. A diferença real está
 * em `planned`/`payable`: com dívida 30 e recebível 50 o alvo é ZERO e a
 * pessoa fica fora do orçamento — é o que o caso net-zero (T4) e o teste de
 * zero-net do serviço protegem. Escrever um teste de `isSettled` para isso
 * seria teatro: ele passaria com as duas implementações.
 *
 * ── `settledAt` sem o guard `isSettled &&` ──
 *
 * `cobertura` só é atribuída dentro do laço quando o acumulado alcança o
 * alvo — a mesma condição de `isSettled`. Um estado descoberto nunca chega a
 * registrar data, e o guard é redundância defensiva. A invariante que importa
 * (`settledAt` só existe com `isSettled`) é afirmada nos testes acima e no
 * `R2b` do serviço, varrendo estados em vez de fixar um caso.
 */

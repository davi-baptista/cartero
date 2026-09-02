import { describe, expect, it } from 'vitest';
import {
  nextSettlementItem,
  type SettleableItem,
} from './person-settlement-month';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Qual acerto a lista de Pessoas destaca
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A linha mostrava o saldo do mês sem dizer quando algo acontece. Este helper
 * escolhe o item que merece atenção — e a escolha precisa ser explícita:
 * pegar o primeiro da consulta daria a ordem do banco, que não é contrato.
 *
 * ── Só o lado que o saldo mostra ──
 *
 * Uma pessoa pode ter dívida e cobrança ao mesmo tempo. O item vem do MESMO
 * sentido do saldo líquido, para a row não se contradizer: "A RECEBER" com
 * "Pagar amanhã" embaixo é factualmente correto e cobra do leitor um esforço
 * que a lista existe para evitar.
 *
 * O custo é conhecido: uma dívida vencendo amanhã não aparece quando o saldo é
 * a receber. Ela continua no extrato da pessoa.
 */

function item(dueDate: string, isPaid = false): SettleableItem {
  return {
    id: dueDate,
    /* 03h UTC é a âncora que o resto do schema usa para datas civis. */
    dueDate: new Date(`${dueDate}T03:00:00.000Z`),
    isPaid,
  };
}

describe('P8/P9: escolhe por urgência, não por ordem de chegada', () => {
  it('P9: o vencido supera o futuro', () => {
    const receivables = [item('2026-09-20'), item('2026-08-25'), item('2026-09-05')];
    expect(nextSettlementItem(receivables, [], 500)).toEqual({
      direction: 'receive',
      dueDate: '2026-08-25',
    });
  });

  it('P8: entre vários futuros, o mais próximo', () => {
    const receivables = [item('2026-12-01'), item('2026-09-10'), item('2026-10-05')];
    expect(nextSettlementItem(receivables, [], 500)?.dueDate).toBe('2026-09-10');
  });

  it('a ordem da lista não influencia o resultado', () => {
    /*
      Duas entradas com os mesmos itens, embaralhadas: se divergirem, a
      escolha está caindo na ordem de inserção.
    */
    const a = [item('2026-09-20'), item('2026-08-25')];
    const b = [item('2026-08-25'), item('2026-09-20')];
    expect(nextSettlementItem(a, [], 500)).toEqual(nextSettlementItem(b, [], 500));
  });

  it('itens já resolvidos não são candidatos', () => {
    /* Uma cobrança recebida não tem mais nada a acontecer. */
    const receivables = [item('2026-08-01', true), item('2026-09-15')];
    expect(nextSettlementItem(receivables, [], 500)?.dueDate).toBe('2026-09-15');
  });
});

describe('a direção segue o saldo', () => {
  it('saldo positivo olha os RECEBÍVEIS', () => {
    const r = [item('2026-09-10')];
    const d = [item('2026-09-03')];
    expect(nextSettlementItem(r, d, 500)).toEqual({
      direction: 'receive',
      dueDate: '2026-09-10',
    });
  });

  it('saldo negativo olha as DÍVIDAS', () => {
    const r = [item('2026-09-03')];
    const d = [item('2026-09-10')];
    expect(nextSettlementItem(r, d, -500)).toEqual({
      direction: 'pay',
      dueDate: '2026-09-10',
    });
  });

  it('o lado oposto é ignorado mesmo sendo mais urgente', () => {
    /*
      A decisão de produto desta fase, e o seu custo: a dívida vence amanhã e
      não aparece, porque o saldo é a receber e a row diria "A RECEBER · Pagar
      amanhã". O item segue visível no extrato da pessoa.
    */
    const receivables = [item('2026-09-30')];
    const debts = [item('2026-09-03')];
    expect(nextSettlementItem(receivables, debts, 800)).toEqual({
      direction: 'receive',
      dueDate: '2026-09-30',
    });
  });
});

describe('P11: saldo zero', () => {
  it('saldo zero não destaca evento, mesmo com pendências abertas', () => {
    /*
      Saldo zero NÃO significa ausência de pendência: pode haver R$ 500
      abertos de cada lado. Mas também não há um sentido a mostrar — a row
      diria "SEM SALDO" e o subtexto teria de escolher um lado
      arbitrariamente.
    */
    const receivables = [item('2026-09-03')];
    const debts = [item('2026-09-04')];
    expect(nextSettlementItem(receivables, debts, 0)).toBeNull();
  });

  it('a tolerância evita que centavos decidam a direção', () => {
    expect(nextSettlementItem([item('2026-09-03')], [], 0.001)).toBeNull();
  });
});

describe('sem candidatos', () => {
  it('nenhuma pendência devolve null', () => {
    expect(nextSettlementItem([], [], 500)).toBeNull();
  });

  it('saldo aponta para um lado vazio devolve null', () => {
    /*
      Combinação possível quando o saldo vem de itens de outra competência: o
      lado indicado não tem item nesta, e nada é inventado.
    */
    expect(nextSettlementItem([], [item('2026-09-03')], 500)).toBeNull();
  });
});

describe('o dia civil de Fortaleza', () => {
  it('a data é devolvida como dia, sem hora', () => {
    expect(nextSettlementItem([item('2026-09-10')], [], 500)?.dueDate).toBe(
      '2026-09-10',
    );
  });

  it('meia-noite UTC não escorrega para o dia anterior', () => {
    /*
      `2026-09-10T00:00:00Z` é 21h do dia 9 em Fortaleza. A âncora de 03h UTC
      que o schema usa mantém o dia correto; este caso vigia que a conversão
      não volte a ser ingênua.
    */
    const meiaNoite: SettleableItem = {
      id: 'x',
      dueDate: new Date('2026-09-10T03:00:00.000Z'),
      isPaid: false,
    };
    expect(nextSettlementItem([meiaNoite], [], 500)?.dueDate).toBe('2026-09-10');
  });
});

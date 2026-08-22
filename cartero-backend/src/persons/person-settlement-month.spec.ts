import { describe, expect, it } from 'vitest';
import {
  belongsToCompetence,
  competenceOf,
  dueMonthOf,
  dueStateOf,
  referenceMonthOf,
  resolveDefaultCompetence,
  type SettleableItem,
} from 'src/common/helpers/person-settlement-month';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Competência de acerto com uma pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O drawer é MENSAL e responde "quanto temos para acertar nesta competência?".
 *
 * O caso que dá nome a tudo: um jantar dividido em 16/08 que vence com a
 * fatura em 10/09 pertence ao acerto de AGOSTO e vence em SETEMBRO. Ele precisa
 * ser visível nos dois meses — não porque haja duas obrigações, mas porque as
 * duas competências fazem perguntas diferentes sobre o mesmo item.
 */

/** Data em horário civil de Fortaleza. */
function civil(year: number, month: number, day: number): Date {
  // 12h locais: longe das bordas, para o teste não medir fuso por acidente.
  return new Date(Date.UTC(year, month - 1, day, 15));
}

const AGOSTO = { year: 2026, month: 8 };
const SETEMBRO = { year: 2026, month: 9 };
const OUTUBRO = { year: 2026, month: 10 };

/** Recebível automático: nasceu de uma compra no cartão. */
function automatic(over: {
  id?: string;
  purchase: Date;
  due: Date;
  isPaid?: boolean;
}): SettleableItem {
  return {
    id: over.id ?? 'auto-1',
    dueDate: over.due,
    isPaid: over.isPaid ?? false,
    transactionId: 'tx-1',
    transaction: { date: over.purchase },
  };
}

/** Recebível manual ou dívida: sem compra de origem. */
function plain(over: {
  id?: string;
  due: Date;
  isPaid?: boolean;
}): SettleableItem {
  return {
    id: over.id ?? 'plain-1',
    dueDate: over.due,
    isPaid: over.isPaid ?? false,
    transactionId: null,
    transaction: null,
  };
}

describe('referenceMonth e dueMonth', () => {
  it('automático: referência é o mês da COMPRA', () => {
    /**
     * A compra é o evento financeiro que originou a cobrança. Usar o
     * vencimento aqui jogaria o acerto para o mês da fatura, escondendo o que
     * de fato aconteceu em agosto.
     */
    const item = automatic({
      purchase: civil(2026, 8, 16),
      due: civil(2026, 9, 10),
    });

    expect(referenceMonthOf(item)).toEqual(AGOSTO);
    expect(dueMonthOf(item)).toEqual(SETEMBRO);
  });

  it('manual: referência é o vencimento', () => {
    const item = plain({ due: civil(2026, 9, 10) });

    expect(referenceMonthOf(item)).toEqual(SETEMBRO);
    expect(dueMonthOf(item)).toEqual(SETEMBRO);
  });

  it('dívida: referência é o vencimento, nunca occurredAt', () => {
    const item = plain({ due: civil(2026, 9, 21) });

    expect(referenceMonthOf(item)).toEqual(SETEMBRO);
  });

  it('automático sem a relação carregada cai no vencimento', () => {
    // Fallback conservador: nunca esconde o item.
    const item: SettleableItem = {
      id: 'x',
      dueDate: civil(2026, 9, 10),
      isPaid: false,
      transactionId: 'tx-1',
      transaction: null,
    };

    expect(referenceMonthOf(item)).toEqual(SETEMBRO);
  });

  it('a competência respeita o fuso de Fortaleza', () => {
    /**
     * 01/09 às 01h UTC é 31/08 às 22h em Fortaleza — ainda agosto. Sem o
     * ajuste, o item mudaria de competência na última noite do mês.
     */
    expect(competenceOf(new Date('2026-09-01T01:00:00.000Z'))).toEqual(AGOSTO);
    expect(competenceOf(new Date('2026-09-01T04:00:00.000Z'))).toEqual(
      SETEMBRO,
    );
  });
});

describe('Universo de uma competência', () => {
  const jantar = automatic({
    purchase: civil(2026, 8, 16),
    due: civil(2026, 9, 10),
  });

  it('agosto mostra o item originado em agosto', () => {
    expect(belongsToCompetence(jantar, AGOSTO)).toBe(true);
  });

  it('setembro TAMBÉM mostra, porque vence lá', () => {
    // Não é duplicação: as duas competências respondem perguntas diferentes.
    expect(belongsToCompetence(jantar, SETEMBRO)).toBe(true);
  });

  it('outubro mostra como carry-over se continuar aberto', () => {
    expect(belongsToCompetence(jantar, OUTUBRO)).toBe(true);
  });

  it('julho NÃO mostra: o item ainda não existia', () => {
    expect(belongsToCompetence(jantar, { year: 2026, month: 7 })).toBe(false);
  });

  it('item resolvido sai do universo aberto', () => {
    const pago = automatic({
      purchase: civil(2026, 8, 16),
      due: civil(2026, 9, 10),
      isPaid: true,
    });

    expect(belongsToCompetence(pago, AGOSTO)).toBe(false);
    expect(belongsToCompetence(pago, SETEMBRO)).toBe(false);
  });

  it('dívida puramente de setembro não aparece em agosto', () => {
    const setembro = plain({ due: civil(2026, 9, 21) });

    expect(belongsToCompetence(setembro, AGOSTO)).toBe(false);
    expect(belongsToCompetence(setembro, SETEMBRO)).toBe(true);
  });

  it('atraso antigo aparece no mês corrente', () => {
    // Uma pendência de junho não desaparece em setembro.
    const junho = plain({ due: civil(2026, 6, 15) });

    expect(belongsToCompetence(junho, SETEMBRO)).toBe(true);
  });

  it('cada item devolve um booleano — nunca duas linhas', () => {
    /**
     * Quando referência e vencimento coincidem, o item satisfaz duas condições
     * ao mesmo tempo. O contrato é por item, então a lista não pode duplicá-lo.
     */
    const mesmoMes = plain({ due: civil(2026, 9, 10) });

    expect(belongsToCompetence(mesmoMes, SETEMBRO)).toBe(true);
  });
});

describe('Estado temporal', () => {
  const jantar = automatic({
    purchase: civil(2026, 8, 16),
    due: civil(2026, 9, 10),
  });

  it('antes do vencimento, visto de setembro: A vencer', () => {
    // Veio de agosto e ainda está no prazo — nem "Pendente" nem "Em atraso".
    expect(dueStateOf(jantar, SETEMBRO, civil(2026, 9, 5))).toBe('upcoming');
  });

  it('no PRÓPRIO dia do vencimento: não é atraso', () => {
    expect(dueStateOf(jantar, SETEMBRO, civil(2026, 9, 10))).toBe('dueToday');
  });

  it('depois do vencimento: em atraso', () => {
    expect(dueStateOf(jantar, SETEMBRO, civil(2026, 9, 11))).toBe('overdue');
  });

  it('visto de agosto, antes de vencer: pendente comum', () => {
    // Aqui a referência é a própria competência — não veio de antes.
    expect(dueStateOf(jantar, AGOSTO, civil(2026, 8, 20))).toBe('pending');
  });

  it('item do próprio mês, futuro: pendente', () => {
    const setembro = plain({ due: civil(2026, 9, 21) });

    expect(dueStateOf(setembro, SETEMBRO, civil(2026, 9, 5))).toBe('pending');
  });
});

describe('Competência padrão ao abrir o drawer', () => {
  const jantar = automatic({
    purchase: civil(2026, 8, 16),
    due: civil(2026, 9, 10),
  });

  it('01/09: abre AGOSTO — o acerto de agosto está em andamento', () => {
    expect(resolveDefaultCompetence([jantar], civil(2026, 9, 1))).toEqual(
      AGOSTO,
    );
  });

  it('05/09: continua agosto', () => {
    expect(resolveDefaultCompetence([jantar], civil(2026, 9, 5))).toEqual(
      AGOSTO,
    );
  });

  it('10/09 (dia do vencimento): ainda agosto', () => {
    // No próprio dia o item continua no prazo.
    expect(resolveDefaultCompetence([jantar], civil(2026, 9, 10))).toEqual(
      AGOSTO,
    );
  });

  it('11/09: passa para SETEMBRO', () => {
    /**
     * O item venceu: o acerto de agosto não está mais "em andamento". Ele
     * reaparece em setembro como carry-over em atraso.
     */
    expect(resolveDefaultCompetence([jantar], civil(2026, 9, 11))).toEqual(
      SETEMBRO,
    );
  });

  it('recebido antes: abre setembro', () => {
    const recebido = automatic({
      purchase: civil(2026, 8, 16),
      due: civil(2026, 9, 10),
      isPaid: true,
    });

    expect(resolveDefaultCompetence([recebido], civil(2026, 9, 6))).toEqual(
      SETEMBRO,
    );
  });

  it('com dois itens de agosto, basta um no prazo', () => {
    const a = automatic({
      id: 'a',
      purchase: civil(2026, 8, 5),
      due: civil(2026, 9, 10),
    });
    const b = automatic({
      id: 'b',
      purchase: civil(2026, 8, 6),
      due: civil(2026, 9, 21),
    });

    // 15/09: A venceu, B não. Agosto segue em andamento.
    expect(resolveDefaultCompetence([a, b], civil(2026, 9, 15))).toEqual(
      AGOSTO,
    );
    // 22/09: nenhum no prazo.
    expect(resolveDefaultCompetence([a, b], civil(2026, 9, 22))).toEqual(
      SETEMBRO,
    );
  });

  it('NUNCA abre num mês mais antigo que o anterior', () => {
    /**
     * Uma pendência de junho aparece como carry-over em setembro, mas abrir o
     * drawer em junho jogaria o usuário num mês que ele não pediu.
     */
    const junho = plain({ due: civil(2026, 6, 15) });

    expect(resolveDefaultCompetence([junho], civil(2026, 9, 5))).toEqual(
      SETEMBRO,
    );
  });

  it('sem itens, abre o mês corrente', () => {
    expect(resolveDefaultCompetence([], civil(2026, 9, 5))).toEqual(SETEMBRO);
  });

  it('atravessa a virada de ano', () => {
    // Em janeiro, o mês anterior é dezembro do ano passado.
    const dezembro = automatic({
      purchase: civil(2025, 12, 20),
      due: civil(2026, 1, 10),
    });

    expect(resolveDefaultCompetence([dezembro], civil(2026, 1, 5))).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it('a virada de mês respeita o fuso', () => {
    /**
     * 01/09 às 01h UTC ainda é 31/08 em Fortaleza: o mês corrente é agosto, e
     * o anterior julho. Usar UTC cru mudaria a competência 3h antes da hora.
     */
    expect(
      resolveDefaultCompetence([], new Date('2026-09-01T01:00:00.000Z')),
    ).toEqual(AGOSTO);
    expect(
      resolveDefaultCompetence([], new Date('2026-09-01T04:00:00.000Z')),
    ).toEqual(SETEMBRO);
  });
});

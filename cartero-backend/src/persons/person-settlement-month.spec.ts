import { describe, expect, it } from 'vitest';
import {
  belongsToCompetence,
  belongsToHistoryCompetence,
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

describe('Universo de uma competência — só o vencimento', () => {
  /**
   * O caso "Pinga": compra em agosto, cobrança vence 10/09.
   *
   * Antes o item aparecia nos DOIS meses — em agosto porque nasceu lá, em
   * setembro porque vence lá. A mesma obrigação parecia pertencer a duas
   * competências, e nenhuma das telas era claramente a certa para agir.
   */
  const pinga = automatic({
    purchase: civil(2026, 8, 16),
    due: civil(2026, 9, 10),
  });

  const HOJE_AGOSTO = civil(2026, 8, 24);
  const HOJE_SETEMBRO = civil(2026, 9, 5);

  it('item 39: agosto NÃO mostra — a compra não define a competência', () => {
    expect(belongsToCompetence(pinga, AGOSTO, HOJE_AGOSTO)).toBe(false);
  });

  it('item 39: setembro mostra, porque é lá que vence', () => {
    expect(belongsToCompetence(pinga, SETEMBRO, HOJE_AGOSTO)).toBe(true);
  });

  it('item 9: vencimento futuro do mês selecionado aparece', () => {
    // Navegar para setembro em 24/08 mostra o que vence lá.
    expect(belongsToCompetence(pinga, SETEMBRO, HOJE_AGOSTO)).toBe(true);
  });

  it('outubro mostra como carry, se já vencido e ainda aberto', () => {
    expect(belongsToCompetence(pinga, OUTUBRO, civil(2026, 10, 5))).toBe(true);
  });

  it('item resolvido sai do universo aberto', () => {
    const pago = automatic({
      purchase: civil(2026, 8, 16),
      due: civil(2026, 9, 10),
      isPaid: true,
    });

    expect(belongsToCompetence(pago, SETEMBRO, HOJE_SETEMBRO)).toBe(false);
  });

  it('item 41: dívida de setembro não aparece em agosto', () => {
    const setembro = plain({ due: civil(2026, 9, 8) });

    expect(belongsToCompetence(setembro, AGOSTO, HOJE_AGOSTO)).toBe(false);
    expect(belongsToCompetence(setembro, SETEMBRO, HOJE_AGOSTO)).toBe(true);
  });

  it('item 43: atraso antigo continua aparecendo', () => {
    const agosto = plain({ due: civil(2026, 8, 20) });

    expect(belongsToCompetence(agosto, SETEMBRO, civil(2026, 9, 10))).toBe(
      true,
    );
  });

  it('item 44: NÃO projeta carry futuro', () => {
    /*
      Hoje 24/08, dívida vence 30/08, olhando setembro. Ela ainda está no
      prazo — tratá-la como atraso de setembro afirmaria um fato que não
      aconteceu.
    */
    const trintaDeAgosto = plain({ due: civil(2026, 8, 30) });

    expect(
      belongsToCompetence(trintaDeAgosto, SETEMBRO, civil(2026, 8, 24)),
    ).toBe(false);

    // Depois de vencer, vira carry normalmente.
    expect(
      belongsToCompetence(trintaDeAgosto, SETEMBRO, civil(2026, 9, 1)),
    ).toBe(true);
  });

  it('cada item devolve um booleano — nunca duas linhas', () => {
    const mesmoMes = plain({ due: civil(2026, 9, 10) });
    expect(belongsToCompetence(mesmoMes, SETEMBRO, HOJE_SETEMBRO)).toBe(true);
  });

  it('item 51: carry cross-year', () => {
    const dezembro = plain({ due: civil(2025, 12, 14) });

    expect(
      belongsToCompetence(
        dezembro,
        { year: 2026, month: 1 },
        civil(2026, 1, 20),
      ),
    ).toBe(true);
    // E dezembro de 2026 não é confundido com o de 2025.
    const dez2026 = plain({ due: civil(2026, 12, 14) });
    expect(
      belongsToCompetence(
        dez2026,
        { year: 2026, month: 1 },
        civil(2026, 1, 20),
      ),
    ).toBe(false);
  });
});

describe('Estado temporal — só vencimento contra hoje', () => {
  const pinga = automatic({
    purchase: civil(2026, 8, 16),
    due: civil(2026, 9, 10),
  });

  it('antes do vencimento: Pendente (não mais "A vencer")', () => {
    expect(dueStateOf(pinga, SETEMBRO, civil(2026, 9, 5))).toBe('pending');
  });

  it('no PRÓPRIO dia do vencimento: não é atraso', () => {
    expect(dueStateOf(pinga, SETEMBRO, civil(2026, 9, 10))).toBe('dueToday');
  });

  it('depois do vencimento: em atraso', () => {
    expect(dueStateOf(pinga, SETEMBRO, civil(2026, 9, 11))).toBe('overdue');
  });

  it('o estado não depende da competência exibida', () => {
    /*
      Antes, o mesmo item era "upcoming" visto de setembro e "pending" visto
      de agosto. O estado é um fato sobre a data, não sobre a tela.
    */
    const hoje = civil(2026, 9, 5);
    expect(dueStateOf(pinga, AGOSTO, hoje)).toBe(
      dueStateOf(pinga, SETEMBRO, hoje),
    );
  });

  it('item 24: o ano participa da comparação', () => {
    const out2025 = plain({ due: civil(2025, 10, 14) });
    const out2026 = plain({ due: civil(2026, 10, 14) });
    const hoje = civil(2026, 3, 10);

    expect(dueStateOf(out2025, SETEMBRO, hoje)).toBe('overdue');
    expect(dueStateOf(out2026, SETEMBRO, hoje)).toBe('pending');
  });
});

describe('Competência padrão — sempre o mês corrente', () => {
  it('item 45: abre o mês corrente, não o da compra', () => {
    /*
      A inteligência anterior abria agosto enquanto houvesse cobrança
      originada lá e ainda no prazo. Com o vencimento como regra única, abrir
      agosto para um item que aparece em setembro só desorienta.
    */
    expect(resolveDefaultCompetence(civil(2026, 9, 5))).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it('não depende de item nenhum', () => {
    expect(resolveDefaultCompetence(civil(2026, 12, 31))).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it('usa o dia civil de Fortaleza', () => {
    // 01/09 às 00:30 UTC ainda é 31/08 em Fortaleza (UTC-3).
    const viradaUtc = new Date(Date.UTC(2026, 8, 1, 0, 30));
    expect(resolveDefaultCompetence(viradaUtc)).toEqual({
      year: 2026,
      month: 8,
    });
  });
});

describe('belongsToHistoryCompetence — arquivo por dueMonth', () => {
  /**
   * O histórico do drawer deixou de ser organizado por `paidAt`.
   *
   * Uma dívida de julho paga em setembro pertence ao acerto de JULHO: é ali
   * que o usuário procura ao revisar aquele mês. Arquivar pelo movimento do
   * dinheiro espalhava um mesmo combinado por vários meses conforme cada
   * parte fosse quitada.
   */
  const JULHO = { year: 2026, month: 7 };
  const AGOSTO = { year: 2026, month: 8 };
  const SETEMBRO = { year: 2026, month: 9 };
  const OUTUBRO = { year: 2026, month: 10 };

  it('item 3: Debt de julho paga em setembro arquiva em julho', () => {
    const debt = {
      id: 'd1',
      dueDate: new Date('2026-07-20T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-09-15T12:00:00.000Z'),
    };

    expect(belongsToHistoryCompetence(debt, JULHO)).toBe(true);
    // E não reaparece no mês do pagamento: uma competência canônica por item.
    expect(belongsToHistoryCompetence(debt, SETEMBRO)).toBe(false);
  });

  it('item 4: Receivable manual de agosto recebido em outubro', () => {
    const receivable = {
      id: 'r1',
      dueDate: new Date('2026-08-10T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-10-03T12:00:00.000Z'),
      transactionId: null,
    };

    expect(belongsToHistoryCompetence(receivable, AGOSTO)).toBe(true);
    expect(belongsToHistoryCompetence(receivable, OUTUBRO)).toBe(false);
  });

  it('item 15/47: Receivable automático arquiva pelo VENCIMENTO', () => {
    /*
      Compra 16/08, vence 10/09, recebido 15/10 → pertence a SETEMBRO.

      Nem a compra nem o pagamento decidem: o histórico usa a mesma
      competência canônica dos itens abertos, senão um item mudaria de
      prateleira ao ser quitado.
    */
    const automatico = {
      id: 'r2',
      dueDate: new Date('2026-09-10T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-10-15T12:00:00.000Z'),
      transactionId: 'tx-1',
      transaction: { date: new Date('2026-08-16T12:00:00.000Z') },
    };

    expect(belongsToHistoryCompetence(automatico, SETEMBRO)).toBe(true);
    expect(belongsToHistoryCompetence(automatico, AGOSTO)).toBe(false);
    expect(belongsToHistoryCompetence(automatico, OUTUBRO)).toBe(false);
  });

  it('item 6: nunca em duas competências ao mesmo tempo', () => {
    const debt = {
      id: 'd2',
      dueDate: new Date('2026-07-20T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-09-15T12:00:00.000Z'),
    };

    const meses = [JULHO, AGOSTO, SETEMBRO, OUTUBRO];
    const encontrados = meses.filter((mes) =>
      belongsToHistoryCompetence(debt, mes),
    );

    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]).toEqual(JULHO);
  });

  it('item aberto NÃO entra no histórico', () => {
    const aberto = {
      id: 'd3',
      dueDate: new Date('2026-07-20T12:00:00.000Z'),
      isPaid: false,
      paidAt: null,
    };

    expect(belongsToHistoryCompetence(aberto, JULHO)).toBe(false);
  });

  it('sem a relação carregada, o automático cai no vencimento', () => {
    /*
      Conservador de propósito: melhor arquivar pelo vencimento do que sumir
      com o item. Por isso a consulta do histórico carrega `transaction` —
      sem ela o fallback seria silencioso.
    */
    const semRelacao = {
      id: 'r3',
      dueDate: new Date('2026-09-10T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-10-15T12:00:00.000Z'),
      transactionId: 'tx-1',
      transaction: null,
    };

    expect(belongsToHistoryCompetence(semRelacao, SETEMBRO)).toBe(true);
  });

  it('vencimento no dia 1 não escorrega para o mês anterior', () => {
    /*
      Fortaleza é UTC-3: um item gravado à meia-noite UTC do dia 1 cai no dia
      30 do mês anterior em horário local. `competenceOf` já trata isso, e
      este teste vigia a propriedade — foi exatamente o erro que apareceu ao
      derivar a competência do filtro a partir de um `Date`.
    */
    const primeiroDia = {
      id: 'd4',
      dueDate: new Date('2026-05-01T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-03T12:00:00.000Z'),
    };

    expect(
      belongsToHistoryCompetence(primeiroDia, { year: 2026, month: 5 }),
    ).toBe(true);
    expect(
      belongsToHistoryCompetence(primeiroDia, { year: 2026, month: 4 }),
    ).toBe(false);
  });

  it('atravessa a virada de ano', () => {
    const dezembro = {
      id: 'd5',
      dueDate: new Date('2025-12-20T12:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-02-10T12:00:00.000Z'),
    };

    expect(
      belongsToHistoryCompetence(dezembro, { year: 2025, month: 12 }),
    ).toBe(true);
    expect(belongsToHistoryCompetence(dezembro, { year: 2026, month: 2 })).toBe(
      false,
    );
  });
});

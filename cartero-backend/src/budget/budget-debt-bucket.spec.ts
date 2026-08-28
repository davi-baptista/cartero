import { describe, expect, it } from 'vitest';
import {
  classifyDebtForBudget,
  debtFinancialPeriod,
  type ClassifiableDebt,
} from 'src/common/helpers/budget-debt-bucket';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Uma dívida, um balde
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O bug: "Dívidas · R$ 600,00" e "Pendências anteriores · R$ 600,00"
 * mostravam a MESMA dívida — Dentista, paga, R$ 600,00 nas duas seções.
 *
 * A causa era um predicado que tratava "paga nesta competência" como
 * sinônimo de "vem de mês anterior". Vencer 20/07 e pagar 28/07 é atraso
 * dentro do próprio mês; não muda a competência de origem.
 *
 * Este arquivo fixa a tabela temporal inteira e, no fim, o invariante que
 * torna a duplicação impossível: nenhuma dívida em dois baldes.
 */

const AGOSTO = { year: 2026, month: 8 };
const JULHO = { year: 2026, month: 7 };
const SETEMBRO = { year: 2026, month: 9 };

/** 15/08/2026, meio-dia — longe das bordas do dia civil. */
const HOJE = new Date('2026-08-15T12:00:00.000Z');

const debt = (over: Partial<ClassifiableDebt> = {}): ClassifiableDebt => ({
  dueDate: new Date('2026-08-20T00:00:00.000Z'),
  isPaid: false,
  paidAt: null,
  personId: null,
  ...over,
});

describe('o bug da tela: paga no mesmo mês do vencimento', () => {
  it('item 34: vence 20/07 e paga 28/07, vendo JULHO → balde normal', () => {
    /*
      O caso exato da screenshot. `paidAt > dueDate`, mas as duas datas caem
      em julho: é atraso de oito dias dentro do próprio mês, não obrigação
      herdada de outra competência.
    */
    const d = debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-07-28T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, JULHO, HOJE)).toBe('currentGeneric');
  });

  it('vencer e pagar no mesmo mês NUNCA é pendência anterior', () => {
    // A propriedade, não só o caso: vale para qualquer dia dentro do mês.
    for (const dia of ['01', '15', '28', '31']) {
      const d = debt({
        dueDate: new Date('2026-07-05T00:00:00.000Z'),
        isPaid: true,
        paidAt: new Date(`2026-07-${dia}T00:00:00.000Z`),
      });

      expect(classifyDebtForBudget(d, JULHO, HOJE)).not.toBe('prior');
    }
  });
});

describe('itens 7, 10 e 35: dívida paga segue o paidAt', () => {
  it('vence 20/07, paga 05/08 → pertence a AGOSTO, como pendência anterior', () => {
    const d = debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('prior');
  });

  it('e NÃO conta mais em julho', () => {
    /*
      Julho não viu esse dinheiro sair. Contá-lo lá afirmaria um desembolso
      que aconteceu em agosto.
    */
    const d = debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, JULHO, HOJE)).toBe('excluded');
  });

  it('item 41: pagamento antecipado conta no mês do pagamento', () => {
    /*
      Vence em setembro, paga em agosto: conta uma vez, em agosto, no balde
      normal. Chamá-la de "pendência anterior" seria o oposto do que
      aconteceu — ela foi resolvida ANTES da hora.
    */
    const d = debt({
      dueDate: new Date('2026-09-10T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('currentGeneric');
    expect(classifyDebtForBudget(d, SETEMBRO, HOJE)).toBe('excluded');
  });

  it('legado pago sem paidAt cai no vencimento', () => {
    /*
      Sem saber quando o dinheiro saiu, a melhor referência é a data que
      temos. Exibir a mais é recuperável; sumir com uma obrigação não é.
    */
    const d = debt({
      dueDate: new Date('2026-08-10T00:00:00.000Z'),
      isPaid: true,
      paidAt: null,
    });

    expect(debtFinancialPeriod(d)).toEqual(AGOSTO);
    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('currentGeneric');
  });
});

describe('itens 11, 12 e 38: dívida aberta', () => {
  it('mês passado com dívida ainda aberta NÃO vira gasto histórico', () => {
    /*
      O dinheiro não saiu em julho — e continua não tendo saído. Somá-lo ao
      orçamento de julho inventaria um desembolso que nunca existiu.
    */
    const d = debt({ dueDate: new Date('2026-07-20T00:00:00.000Z') });

    expect(classifyDebtForBudget(d, JULHO, HOJE)).toBe('excluded');
  });

  it('vencida antes e aberta hoje → pendência anterior no mês CORRENTE', () => {
    const d = debt({ dueDate: new Date('2026-07-20T00:00:00.000Z') });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('prior');
  });

  it('vence no mês selecionado → balde normal', () => {
    expect(classifyDebtForBudget(debt(), AGOSTO, HOJE)).toBe('currentGeneric');
  });

  it('item 39: pendência anterior NÃO é projetada para o futuro', () => {
    /*
      Afirmar que ela ainda estará aberta em setembro é algo que ninguém
      sabe. Regra de "no future overdue projection", já consolidada.
    */
    const d = debt({ dueDate: new Date('2026-07-20T00:00:00.000Z') });

    expect(classifyDebtForBudget(d, SETEMBRO, HOJE)).toBe('excluded');
  });

  it('mês futuro mostra o que vence NELE', () => {
    const d = debt({ dueDate: new Date('2026-09-10T00:00:00.000Z') });

    expect(classifyDebtForBudget(d, SETEMBRO, HOJE)).toBe('currentGeneric');
  });
});

describe('itens 15 e 40: o que vence HOJE ainda está no prazo', () => {
  it('vencendo hoje não é pendência anterior', () => {
    /*
      Dia civil de Fortaleza. No próprio dia do vencimento há o dia inteiro
      para resolver — comparar instantes marcaria como vencido, à noite, algo
      ainda no prazo.
    */
    const d = debt({ dueDate: new Date('2026-08-15T00:00:00.000Z') });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('currentGeneric');
  });

  it('vencido ONTEM já conta como anterior quando é de outro mês', () => {
    const d = debt({ dueDate: new Date('2026-07-31T00:00:00.000Z') });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('prior');
  });
});

describe('itens 4, 5, 18 e 36: temporalidade vence pessoa', () => {
  it('dívida ANTERIOR com pessoa vai para pendências, não para acertos', () => {
    /*
      A mudança de produto desta tarefa. Antes o `personId` capturava a
      dívida antes de qualquer verificação temporal, e ela sumia das
      pendências para dentro de "Acertos com pessoas".
    */
    const d = debt({
      personId: 'rafael',
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('prior');
  });

  it('anterior com pessoa e ainda aberta também vai para pendências', () => {
    const d = debt({
      personId: 'rafael',
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('prior');
  });

  it('item 37: dívida do PRÓPRIO mês com pessoa segue em acertos', () => {
    // O comportamento de Person para o próprio período não mudou.
    const d = debt({
      personId: 'rafael',
      dueDate: new Date('2026-08-20T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('currentPerson');
  });
});

describe('item 42: o invariante', () => {
  /*
    A garantia estrutural: `classifyDebtForBudget` devolve UM valor. Não há
    como uma dívida sair como `current` e `prior` ao mesmo tempo — o tipo não
    permite expressar isso, e é por construção, não por dedupe.
  */
  const CENARIOS: ClassifiableDebt[] = [
    debt(),
    debt({ personId: 'p1' }),
    debt({ dueDate: new Date('2026-07-01T00:00:00.000Z') }),
    debt({ dueDate: new Date('2026-07-01T00:00:00.000Z'), personId: 'p1' }),
    debt({ isPaid: true, paidAt: new Date('2026-08-10T00:00:00.000Z') }),
    debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    }),
    debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-07-28T00:00:00.000Z'),
    }),
    debt({ dueDate: new Date('2026-09-10T00:00:00.000Z') }),
  ];

  it('cada dívida pertence a exatamente um balde, em qualquer mês', () => {
    for (const periodo of [JULHO, AGOSTO, SETEMBRO]) {
      for (const d of CENARIOS) {
        const baldes = [
          'currentGeneric',
          'currentPerson',
          'prior',
          'excluded',
        ].filter((b) => classifyDebtForBudget(d, periodo, HOJE) === b);

        expect(baldes).toHaveLength(1);
      }
    }
  });

  it('a soma dos baldes cobre o conjunto, sem sobra nem repetição', () => {
    const porBalde = {
      currentGeneric: 0,
      currentPerson: 0,
      prior: 0,
      excluded: 0,
    };

    for (const d of CENARIOS) {
      porBalde[classifyDebtForBudget(d, AGOSTO, HOJE)] += 1;
    }

    const total = Object.values(porBalde).reduce((a, b) => a + b, 0);
    expect(total).toBe(CENARIOS.length);
  });

  it('nenhum cenário devolve um balde fora do conjunto conhecido', () => {
    for (const d of CENARIOS) {
      expect([
        'currentGeneric',
        'currentPerson',
        'prior',
        'excluded',
      ]).toContain(classifyDebtForBudget(d, AGOSTO, HOJE));
    }
  });
});

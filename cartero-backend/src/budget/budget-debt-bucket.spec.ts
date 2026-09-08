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

describe('V2: dívida paga fica na competência do VENCIMENTO', () => {
  /*
    Contrato substituído deliberadamente. Antes, uma dívida paga pertencia ao
    mês do desembolso (`paidAt`) — verdadeiro sobre fluxo de caixa, e por isso
    a regra existiu.

    Mas o Budget é competência e planejamento; o fluxo de caixa é o Extrato.
    Deslocar a dívida obrigava o usuário a pensar "em que mês eu paguei isso?"
    para a tela ficar organizada.
  */

  it('vence 20/07, paga 05/08 → pertence a JULHO', () => {
    const d = debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    /* Na própria competência, resolvida: seção normal, nunca `prior`. */
    expect(classifyDebtForBudget(d, JULHO, HOJE)).toBe('currentGeneric');
  });

  it('e NÃO aparece em agosto, onde o dinheiro saiu', () => {
    /*
      A consequência aceita: o mês do desembolso deixa de contá-lo, e o
      `totalToPay` de agosto diminui. O fato financeiro está no Extrato.
    */
    const d = debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('excluded');
  });

  it('paga NUNCA entra em `Pendências anteriores`', () => {
    /*
      A seção passou a ser fila viva. Antes, a dívida de julho paga em agosto
      chegava lá como pendência resolvida — e era o que a fazia reaparecer
      meses depois.
    */
    const d = debt({
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    for (const mes of [JULHO, AGOSTO, SETEMBRO]) {
      expect(classifyDebtForBudget(d, mes, HOJE)).not.toBe('prior');
    }
  });

  it('pagamento antecipado também segue o vencimento', () => {
    /*
      Vence em setembro, paga em agosto: conta em SETEMBRO. Antes contava em
      agosto, o mês do desembolso.
    */
    const d = debt({
      dueDate: new Date('2026-09-10T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, SETEMBRO, HOJE)).toBe('currentGeneric');
    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('excluded');
  });

  it('`paidAt` não influencia a competência, qualquer que seja', () => {
    /*
      A propriedade central: mesmo vencimento, três datas de pagamento
      diferentes, uma única competência.
    */
    const base = { dueDate: new Date('2026-07-20T00:00:00.000Z'), isPaid: true };
    const datas = [
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-25T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z'),
    ];

    for (const paidAt of datas) {
      expect(
        classifyDebtForBudget(debt({ ...base, paidAt }), JULHO, HOJE),
        paidAt.toISOString(),
      ).toBe('currentGeneric');
    }
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
      A temporalidade decide ANTES da pessoa. Sem isso o `personId` capturava
      a dívida antes de qualquer verificação temporal, e ela sumia das
      pendências para dentro de "Acertos com pessoas".

      O fixture mudou com a V2: era uma dívida PAGA em outro mês, que agora é
      `excluded` (a competência é o vencimento). A propriedade testada é a
      mesma — o que a prova é a dívida ABERTA vinda de mês anterior, que é o
      único caso que `prior` ainda aceita.
    */
    const d = debt({
      personId: 'rafael',
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('prior');
  });

  it('e uma dívida com pessoa PAGA fica no acerto da própria competência', () => {
    /*
      Resolvida não é pendência anterior sob a V2 — e continua roteada pelo
      agregado de Pessoa, sem virar dívida bruta individual.
    */
    const d = debt({
      personId: 'rafael',
      dueDate: new Date('2026-07-20T00:00:00.000Z'),
      isPaid: true,
      paidAt: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(classifyDebtForBudget(d, JULHO, HOJE)).toBe('currentPerson');
    expect(classifyDebtForBudget(d, AGOSTO, HOJE)).toBe('excluded');
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

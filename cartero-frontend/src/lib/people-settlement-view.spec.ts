import { describe, expect, it } from 'vitest'
import {
  budgetContextLabel,
  openBalanceLabel,
  openCompositionParts,
  openDirection,
  openPriorLabel,
  settlementAriaLabel,
  summarizePeopleSettlements,
  summaryAriaLabel,
  summaryBalanceLabel,
  summaryCompositionParts,
  summaryDirection,
  budgetDebtContribution,
  shouldRenderPeopleSettlement,
  peopleRowView,
  peopleRowStatusLabel,
  peopleRowAriaLabel,
} from './people-settlement-view'
import type { BudgetSummary } from '@/services/budget.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Acertos com pessoas — os dois universos na apresentação
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A propriedade central: nenhum rótulo de "em aberto" pode ser derivado do
 * universo do orçamento. Eles divergem no instante da quitação, e foi essa
 * confusão que exibia "A pagar R$ 200" para uma dívida já paga.
 */

type PersonSettlement = BudgetSummary['peopleSettlements'][number]

const brl = (value: number) =>
  `R$ ${value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/, '.')}`

function person(overrides: {
  budget?: Partial<PersonSettlement['budget']>
  open?: Partial<PersonSettlement['open']>
  settled?: Partial<PersonSettlement['settled']>
  contribution?: Partial<PersonSettlement['contribution']>
  name?: string
}): PersonSettlement {
  return {
    personId: 'p-1',
    personName: overrides.name ?? 'Mariana Souza',
    budget: {
      receivableDueInMonth: 0,
      openDueInMonth: 0,
      currentOpenPrior: 0,
      paidInMonth: 0,
      receivableAmount: 0,
      payable: 0,
      debtTotal: 0,
      automaticReceivable: 0,
      ...overrides.budget,
    },
    open: {
      receivableInMonth: 0,
      debtInMonth: 0,
      priorOverdueReceivable: 0,
      priorOverdueDebt: 0,
      receivableTotal: 0,
      debtTotal: 0,
      net: 0,
      priorOverdueNet: 0,
      itemCount: 0,
      hasOverdue: false,
      automaticReceivable: 0,
      nextItem: null,
      ...overrides.open,
    },
    settled: {
      settledAt: null,
      itemCount: 0,
      ...overrides.settled,
    },
    /*
      A contribuição derivada do próprio cenário.

      `isSettled` responde "a saída líquida já foi coberta?" — outra pergunta
      de "a relação terminou?". Aqui o default segue o estado bilateral (sem
      item aberto → coberta), que é o comportamento destes casos; os testes
      que separam as duas perguntas passam `contribution` explicitamente.
    */
    contribution: {
      planned: overrides.budget?.payable ?? 0,
      paid: 0,
      remaining: overrides.budget?.payable ?? 0,
      isSettled: (overrides.open?.itemCount ?? 0) === 0,
      settledAt: overrides.settled?.settledAt ?? null,
      ...overrides.contribution,
    },
  }
}

describe('openDirection', () => {
  it('distingue saldo zerado COM itens de nada em aberto', () => {
    /*
      Os dois têm `net: 0`. Só um deles é quitação — e essa é a distinção mais
      importante do módulo. Chamar 200/200 de "acertado" repetiria o erro que a
      Fase 8B removeu da mensagem de WhatsApp.
    */
    const compensado = person({
      open: { receivableTotal: 200, debtTotal: 200, net: 0, itemCount: 2 },
    })
    const quitado = person({ open: { net: 0, itemCount: 0 } })

    expect(openDirection(compensado)).toBe('offset')
    expect(openDirection(quitado)).toBe('settled')
  })

  it('direção segue o sinal do saldo em aberto', () => {
    expect(
      openDirection(person({ open: { net: 100, itemCount: 1 } })),
    ).toBe('receive')
    expect(
      openDirection(person({ open: { net: -100, itemCount: 1 } })),
    ).toBe('pay')
  })

  it('ignora resíduo de centavo', () => {
    expect(
      openDirection(person({ open: { net: 0.001, itemCount: 1 } })),
    ).toBe('offset')
  })
})

describe('openBalanceLabel', () => {
  it('diz "Nada em aberto" só quando não há itens', () => {
    expect(openBalanceLabel(person({ open: { itemCount: 0 } }), brl)).toBe(
      'Nada em aberto',
    )
  })

  it('saldo zerado com itens não usa linguagem de conclusão', () => {
    const label = openBalanceLabel(
      person({
        open: { receivableTotal: 200, debtTotal: 200, net: 0, itemCount: 2 },
      }),
      brl,
    )
    expect(label).toBe('Saldo em aberto zerado')
    expect(label).not.toContain('Nada')
  })

  it('nomeia a direção', () => {
    expect(
      openBalanceLabel(person({ open: { net: 100, itemCount: 1 } }), brl),
    ).toContain('a receber')
    expect(
      openBalanceLabel(person({ open: { net: -100, itemCount: 1 } }), brl),
    ).toContain('a pagar')
  })
})

describe('openCompositionParts', () => {
  it('omite o lado zerado', () => {
    const parts = openCompositionParts(
      person({ open: { receivableTotal: 300, itemCount: 1 } }),
    )
    expect(parts).toHaveLength(1)
    expect(parts[0].side).toBe('receivable')
  })

  it('nada em aberto não produz composição', () => {
    expect(openCompositionParts(person({ open: { itemCount: 0 } }))).toEqual([])
  })

  it('os dois lados aparecem quando ambos existem', () => {
    const parts = openCompositionParts(
      person({
        open: { receivableTotal: 200, debtTotal: 200, net: 0, itemCount: 2 },
      }),
    )
    expect(parts.map((p) => p.side)).toEqual(['receivable', 'debt'])
  })
})

describe('openPriorLabel', () => {
  it('anterior líquido zero não anuncia nada', () => {
    /*
      O bug corrigido: 200 de cada lado anunciava "+ R$ 200 anterior". Nada foi
      trazido em termos líquidos.
    */
    /*
      Mudou: com R$ 200 de cada lado o líquido é zero, mas existem DUAS
      obrigações vivas trazidas de antes. Esconder isso era a mesma
      afirmação falsa que a Fase 8B removeu do WhatsApp.
    */
    const label = openPriorLabel(
      person({
        open: { priorOverdueReceivable: 200, priorOverdueDebt: 200 },
      }),
      brl,
    )

    expect(label).toContain('200')
    expect(label).toContain('a receber')
    expect(label).toContain('a pagar')
  })

  it('tem direção explícita', () => {
    expect(
      openPriorLabel(person({ open: { priorOverdueReceivable: 100 } }), brl),
    ).toContain('a receber')
    expect(
      openPriorLabel(person({ open: { priorOverdueDebt: 200 } }), brl),
    ).toContain('a pagar')
  })

  it('sem nada de antes, não há linha', () => {
    expect(openPriorLabel(person({}), brl)).toBeNull()
  })

  it('nunca deriva do universo do orçamento', () => {
    /*
      Cenário dos R$ 300 fantasmas: o orçamento reconhece a dívida do mês, mas
      não há nada aberto de antes. A linha de carry precisa ficar ausente.
    */
    const paga = person({
      budget: { openDueInMonth: 300, debtTotal: 300 },
      open: { priorOverdueNet: 0, itemCount: 0 },
    })
    expect(openPriorLabel(paga, brl)).toBeNull()
  })
})

describe('budgetContextLabel — pendência anterior paga na competência', () => {
  /*
    Com a competência de EVENTO, o contexto do orçamento não é mais "o que
    sobrou de outro mês": é o desembolso que aconteceu AQUI, mesmo que a
    obrigação tenha nascido antes.
  */
  it('pendência anterior paga neste mês aparece', () => {
    const pagaAqui = person({
      budget: { paidInMonth: 330, debtTotal: 330 },
      open: { itemCount: 0 },
    })
    const label = budgetContextLabel(pagaAqui, brl)

    expect(label).toContain('330')
    expect(label).toContain('pagas neste mês')
  })

  it('dívida do próprio mês não vira contexto de pendência anterior', () => {
    /*
      Ela já aparece como dívida da competência; rotulá-la de "anterior"
      duplicaria a leitura.
    */
    const doMes = person({
      budget: { openDueInMonth: 330, debtTotal: 330 },
      open: { debtInMonth: 330, debtTotal: 330, net: -330, itemCount: 1 },
    })
    expect(budgetContextLabel(doMes, brl)).toBeNull()
  })

  it('pendência anterior ainda ABERTA não usa a frase de pagamento', () => {
    // Ela está viva; dizer "paga neste mês" seria falso.
    const aberta = person({
      budget: { currentOpenPrior: 300, debtTotal: 300 },
      open: { priorOverdueDebt: 300, debtTotal: 300, net: -300, itemCount: 1 },
    })
    expect(budgetContextLabel(aberta, brl)).toBeNull()
  })

  it('sem dívida nenhuma não há linha', () => {
    expect(budgetContextLabel(person({}), brl)).toBeNull()
  })

  it('pessoa só com recebível não ganha linha artificial', () => {
    const soRecebivel = person({
      budget: { receivableDueInMonth: 780.28 },
      open: { receivableTotal: 780.28, net: 780.28, itemCount: 1 },
    })
    expect(budgetContextLabel(soRecebivel, brl)).toBeNull()
  })

  it('não repete a competência — ela já está no título da seção', () => {
    const pagaAqui = person({
      budget: { paidInMonth: 330, debtTotal: 330 },
      open: { itemCount: 0 },
    })
    expect(budgetContextLabel(pagaAqui, brl)).not.toMatch(
      /orçamento de \w+ \d{4}/,
    )
  })
})

describe('settlementAriaLabel', () => {
  it('descreve a composição em aberto sem depender de cor', () => {
    const label = settlementAriaLabel(
      person({
        budget: { openDueInMonth: 200, debtTotal: 200 },
        open: { receivableTotal: 200, debtTotal: 200, net: 0, itemCount: 2 },
      }),
      brl,
    )

    expect(label).toContain('em aberto')
    expect(label).toContain('a receber')
    expect(label).toContain('a pagar')
    /*
      Nada foi quitado, então o rótulo não repete o valor do orçamento — o
      leitor de tela ouviria "200" duas vezes sem distinção de universo.
    */
    expect(label).not.toContain('já quitados')
  })

  it('depois da quitação diz nada em aberto, sem perder o contexto', () => {
    const label = settlementAriaLabel(
      person({
        budget: { paidInMonth: 200, debtTotal: 200 },
        open: { itemCount: 0 },
      }),
      brl,
    )

    expect(label).toContain('nada em aberto')
    // O contexto que reconcilia o total continua audível.
    expect(label).toContain('pagas neste mês')
    // Não pode sugerir pendência viva.
    expect(label).not.toMatch(/em aberto, R\$/)
  })

  it('não repete a competência — já está no título da seção', () => {
    const label = settlementAriaLabel(
      person({ budget: { debtTotal: 330 }, open: { itemCount: 0 } }),
      brl,
    )
    expect(label).not.toContain('orçamento de')
  })
})

describe('coerência entre os universos', () => {
  it('o cenário relatado: quitado em aberto, presente no orçamento', () => {
    /*
      A regressão exata que o usuário viu: depois de "Quitar pendências", os
      valores a receber desapareceram e a dívida seguiu como "A pagar R$ 200".

      Agora: contexto do orçamento preservado, nada em aberto.
    */
    const depoisDeQuitar = person({
      budget: {
        receivableDueInMonth: 200,
        paidInMonth: 200,
        debtTotal: 200,
      },
      open: { itemCount: 0 },
    })

    expect(openBalanceLabel(depoisDeQuitar, brl)).toBe('Nada em aberto')
    expect(openCompositionParts(depoisDeQuitar)).toEqual([])
    expect(openPriorLabel(depoisDeQuitar, brl)).toBeNull()
    // O contexto que reconcilia o Budget continua visível.
    expect(budgetContextLabel(depoisDeQuitar, brl)).not.toBeNull()
  })

  it('nenhum rótulo de aberto lê campos do orçamento', () => {
    /*
      Duplo adversarial: orçamento cheio, aberto vazio. Se algum rótulo
      operacional consultasse `budget`, apareceria valor aqui.
    */
    const so_orcamento = person({
      budget: {
        receivableDueInMonth: 9999,
        openDueInMonth: 9999,
        currentOpenPrior: 9999,
        paidInMonth: 9999,
        debtTotal: 19998,
        automaticReceivable: 9999,
      },
      open: { itemCount: 0 },
    })

    expect(openDirection(so_orcamento)).toBe('settled')
    expect(openBalanceLabel(so_orcamento, brl)).toBe('Nada em aberto')
    expect(openCompositionParts(so_orcamento)).toEqual([])
    expect(openPriorLabel(so_orcamento, brl)).toBeNull()
  })
})

describe('summarizePeopleSettlements — o cabeçalho da seção', () => {
  /**
   * A propriedade central: o cabeçalho tem de FECHAR com as linhas exibidas.
   * Qualquer outro agregado (como `receivables.dueInMonth`, que inclui
   * cobrança sem pessoa) divergiria da lista logo abaixo.
   */
  it('item 48: o cenário real Eva + Jeoge + Fabrício', () => {
    const eva = person({
      name: 'Eva',
      open: {
        receivableTotal: 780.28,
        debtTotal: 330,
        net: 450.28,
        itemCount: 2,
      },
    })
    const jeoge = person({
      name: 'Jeoge',
      open: { receivableTotal: 219.66, net: 219.66, itemCount: 1 },
    })
    const fabricio = person({
      name: 'Fabrício',
      open: { receivableTotal: 10, debtTotal: 11, net: -1, itemCount: 2 },
    })

    const summary = summarizePeopleSettlements([eva, jeoge, fabricio])

    expect(summary.receivableTotal).toBeCloseTo(1009.94, 2)
    expect(summary.debtTotal).toBeCloseTo(341, 2)
    expect(summary.net).toBeCloseTo(668.94, 2)
    expect(summaryBalanceLabel(summary, brl)).toContain('a receber')
  })

  it('item 25: reconcilia exatamente com a soma das linhas', () => {
    const people = [
      person({ open: { receivableTotal: 780.28, debtTotal: 330, itemCount: 2 } }),
      person({ open: { receivableTotal: 219.66, itemCount: 1 } }),
      person({ open: { receivableTotal: 10, debtTotal: 11, itemCount: 2 } }),
    ]
    const summary = summarizePeopleSettlements(people)

    const somaLinhas = people.reduce(
      (acc, p) => ({
        receber: acc.receber + p.open.receivableTotal,
        pagar: acc.pagar + p.open.debtTotal,
      }),
      { receber: 0, pagar: 0 },
    )

    expect(summary.receivableTotal).toBe(somaLinhas.receber)
    expect(summary.debtTotal).toBe(somaLinhas.pagar)
  })

  it('item 49: contexto histórico do orçamento NÃO entra', () => {
    /*
      Dívida de 330 já quitada: continua compondo `totalToPay` e mantém a
      pessoa na lista, mas não é pendência. Somá-la ao "a pagar" do cabeçalho
      afirmaria uma obrigação viva que não existe.
    */
    const quitada = person({
      budget: { openDueInMonth: 330, debtTotal: 330 },
      open: { itemCount: 0 },
    })

    const summary = summarizePeopleSettlements([quitada])

    expect(summary.debtTotal).toBe(0)
    expect(summary.debtTotal).not.toBe(330)
    expect(summary.isEmpty).toBe(true)
  })

  it('item 50: prior não é contado duas vezes', () => {
    /*
      `receivableTotal` JÁ é `receivableInMonth + priorOverdueReceivable`. Somar os
      componentes de novo daria 600 onde existem 300.
    */
    const comPrior = person({
      open: {
        receivableInMonth: 200,
        priorOverdueReceivable: 100,
        receivableTotal: 300,
        net: 300,
        itemCount: 2,
      },
    })

    const summary = summarizePeopleSettlements([comPrior])

    expect(summary.receivableTotal).toBe(300)
    expect(summary.receivableTotal).not.toBe(600)
  })

  it('item 52: saldo zero COM itens não é "Nada em aberto"', () => {
    const compensado = person({
      open: { receivableTotal: 500, debtTotal: 500, net: 0, itemCount: 2 },
    })

    const summary = summarizePeopleSettlements([compensado])

    expect(summary.isEmpty).toBe(false)
    expect(summaryBalanceLabel(summary, brl)).toBe('Saldo zerado')
    expect(summaryBalanceLabel(summary, brl)).not.toContain('Nada')
    // Os dois lados continuam visíveis no cabeçalho.
    expect(summaryCompositionParts(summary)).toHaveLength(2)
  })

  it('item 53: nada em aberto, mas pessoa presente por contexto', () => {
    const soHistorico = person({
      budget: { openDueInMonth: 200, debtTotal: 200 },
      open: { itemCount: 0 },
    })

    const summary = summarizePeopleSettlements([soHistorico])

    expect(summaryBalanceLabel(summary, brl)).toBe('Nada em aberto')
    // Sem "R$ 0 a receber · R$ 0 a pagar".
    expect(summaryCompositionParts(summary)).toEqual([])
  })

  it('item 29: só a receber não exibe "R$ 0 a pagar"', () => {
    const summary = summarizePeopleSettlements([
      person({ open: { receivableTotal: 300, net: 300, itemCount: 1 } }),
    ])

    const parts = summaryCompositionParts(summary)
    expect(parts).toHaveLength(1)
    expect(parts[0].side).toBe('receivable')
    expect(summaryDirection(summary)).toBe('receive')
  })

  it('item 30: só a pagar', () => {
    const summary = summarizePeopleSettlements([
      person({ open: { debtTotal: 300, net: -300, itemCount: 1 } }),
    ])

    const parts = summaryCompositionParts(summary)
    expect(parts).toHaveLength(1)
    expect(parts[0].side).toBe('debt')
    expect(summaryBalanceLabel(summary, brl)).toContain('a pagar')
    expect(summaryDirection(summary)).toBe('pay')
  })

  it('lista vazia é um resumo vazio', () => {
    const summary = summarizePeopleSettlements([])
    expect(summary).toMatchObject({ receivableTotal: 0, debtTotal: 0, net: 0 })
    expect(summary.isEmpty).toBe(true)
  })
})

describe('summaryAriaLabel', () => {
  it('item 43: cada número sai com a sua direção', () => {
    const summary = summarizePeopleSettlements([
      person({
        open: {
          receivableTotal: 1009.94,
          debtTotal: 341,
          net: 668.94,
          itemCount: 3,
        },
      }),
    ])

    const label = summaryAriaLabel(summary, brl)

    expect(label).toContain('Acertos com pessoas')
    expect(label).toContain('a receber')
    expect(label).toContain('a pagar')
    expect(label).toContain('Saldo em aberto')
    // Nenhum valor solto, sem direção monetária.
    expect(label).not.toMatch(/R\$ [\d.,]+\.\s*$/)
  })

  it('nada em aberto tem rótulo próprio', () => {
    const summary = summarizePeopleSettlements([
      person({ budget: { debtTotal: 200 }, open: { itemCount: 0 } }),
    ])
    expect(summaryAriaLabel(summary, brl)).toBe(
      'Acertos com pessoas. Nada em aberto.',
    )
  })
})

describe('Projeção por pessoa dos três buckets do orçamento', () => {
  /**
   * O bug: `budgetContextLabel` lia SÓ `priorPaidInMonth`.
   *
   * Em dezembro, uma dívida de R$ 300 que vence no mês e foi paga depois tem
   * `openDueInMonth: 300` e `paidInMonth: 0` — o rótulo voltava `null`,
   * a linha ficava sem contexto, e como a dívida já estava quitada o lado em
   * aberto também estava vazio. Uma linha em branco, enquanto os R$ 300
   * seguiam dentro do total do mês.
   */
  it('item 19: dívida do mês já quitada explica a contribuição', () => {
    const dezembro = person({
      budget: { openDueInMonth: 300, debtTotal: 300 },
      open: { itemCount: 0 },
    })

    const label = budgetContextLabel(dezembro, brl)
    expect(label).not.toBeNull()
    expect(label).toContain('300')
    expect(label).toContain('em dívidas deste mês')
  })

  it('item 21: open zerado NÃO significa contribuição zero', () => {
    const dezembro = person({
      budget: { openDueInMonth: 300, debtTotal: 300 },
      open: { itemCount: 0 },
    })

    expect(budgetDebtContribution(dezembro)).toBe(300)
    expect(openBalanceLabel(dezembro, brl)).toBe('Nada em aberto')
  })

  it('item 18: dívida do mês ainda aberta não repete o número', () => {
    /*
      "A pagar R$ 300" já está na linha. Repetir "R$ 300 em dívidas deste mês"
      logo abaixo seria ruído — o backend segue entregando o valor.
    */
    const aberta = person({
      budget: { openDueInMonth: 300, debtTotal: 300 },
      open: { debtInMonth: 300, debtTotal: 300, net: -300, itemCount: 1 },
    })

    expect(budgetContextLabel(aberta, brl)).toBeNull()
    expect(budgetDebtContribution(aberta)).toBe(300)
  })

  it('itens 14-15: prior paid usa vocabulário próprio', () => {
    const agosto = person({
      budget: { paidInMonth: 2580, debtTotal: 2580 },
      open: { itemCount: 0 },
    })

    const label = budgetContextLabel(agosto, brl)
    expect(label).toContain('pendências anteriores pagas neste mês')
    // Não nasceram em agosto — chamá-las de "dívidas deste mês" seria falso.
    expect(label).not.toContain('deste mês já')
    expect(label).not.toMatch(/em dívidas deste mês/)
  })

  it('item 23: os dois componentes aparecem juntos', () => {
    const misto = person({
      budget: { openDueInMonth: 300, paidInMonth: 200, debtTotal: 500 },
      open: { itemCount: 0 },
    })

    const label = budgetContextLabel(misto, brl)
    expect(label).toContain('300')
    expect(label).toContain('200')
    expect(budgetDebtContribution(misto)).toBe(500)
  })

  it('item 16: currentOpenPrior não ganha texto duplicado', () => {
    /*
      Ele SEMPRE aparece como "A pagar" no lado em aberto, porque a dívida
      está viva. Descrevê-lo aqui repetiria o mesmo número na mesma linha.
    */
    const abertaAntiga = person({
      budget: { currentOpenPrior: 300, debtTotal: 300 },
      open: { priorOverdueDebt: 300, debtTotal: 300, net: -300, itemCount: 1 },
    })

    expect(budgetContextLabel(abertaAntiga, brl)).toBeNull()
    expect(budgetDebtContribution(abertaAntiga)).toBe(300)
  })

  it('item 17: a transição open → paid preserva a contribuição', () => {
    const antes = person({
      budget: { currentOpenPrior: 300, debtTotal: 300 },
      open: { priorOverdueDebt: 300, debtTotal: 300, net: -300, itemCount: 1 },
    })
    const depois = person({
      budget: { paidInMonth: 300, debtTotal: 300 },
      open: { itemCount: 0 },
    })

    expect(budgetDebtContribution(antes)).toBe(300)
    expect(budgetDebtContribution(depois)).toBe(300)

    // O que muda é a explicação, não o valor.
    expect(budgetContextLabel(antes, brl)).toBeNull()
    expect(budgetContextLabel(depois, brl)).toContain('pagas neste mês')
  })
})

describe('shouldRenderPeopleSettlement', () => {
  it('sem saída líquida, não renderiza', () => {
    /*
      O caso dos meses intermediários: a dívida de dezembro paga em agosto não
      contribui para março, e a pessoa não tem mais nada lá. Renderizar
      produziria a linha vazia com "Nada em aberto".
    */
    expect(shouldRenderPeopleSettlement(person({}))).toBe(false)
  })

  it('pessoa só com recebível NÃO aparece no Orçamento', () => {
    /*
      Mudou com o netting por pessoa: a seção virou decomposição das SAÍDAS.
      Quem só tem a receber não representa gasto — continua em Pessoas, A
      Receber e no drawer, que são as superfícies dessa pergunta.
    */
    const soRecebivel = person({
      open: { receivableTotal: 300, net: 300, itemCount: 1 },
    })
    expect(shouldRenderPeopleSettlement(soRecebivel)).toBe(false)
  })

  it('só aparece quem tem saída líquida, mesmo sem nada em aberto', () => {
    /*
      O critério passou a ser `payable`: dívida bruta sozinha não basta, pois
      pode estar inteiramente compensada por recebíveis da mesma pessoa.
    */
    const comSaida = person({
      budget: { openDueInMonth: 300, payable: 300, debtTotal: 300 },
      open: { itemCount: 0 },
    })
    expect(shouldRenderPeopleSettlement(comSaida)).toBe(true)

    const compensada = person({
      budget: { openDueInMonth: 300, payable: 0, debtTotal: 300 },
      open: { itemCount: 0 },
    })
    expect(shouldRenderPeopleSettlement(compensada)).toBe(false)
  })

  it('recebível do orçamento sozinho NÃO basta', () => {
    // Sem dívida, `payable` é zero: nenhuma saída a decompor.
    const recebivelDoMes = person({
      budget: { receivableDueInMonth: 480 },
      open: { itemCount: 0 },
    })
    expect(shouldRenderPeopleSettlement(recebivelDoMes)).toBe(false)
  })
})

describe('peopleRowView — anatomia da linha', () => {
  /*
    ── O amount destas rows é a CONTRIBUIÇÃO ao orçamento ──

    Os casos abaixo verificavam `open.net` aberto e `budget.debtTotal`
    resolvido — duas bases, nenhuma igual à do total da seção. Agora todas
    leem `budget.payable`, e os fixtures o declaram explicitamente.

    `budget-contribution.spec.ts` cobre a invariante em detalhe; aqui o que
    importa é a anatomia da linha continuar correta.
  */
  it('item 45: sem nada aberto, o destaque é a contribuição do mês', () => {
    const eva = person({
      budget: { paidInMonth: 300, debtTotal: 300, payable: 300 },
      open: { itemCount: 0 },
    })
    const view = peopleRowView(eva, brl)

    expect(view.status).toBe('settled')
    /* A contribuição, a mesma base que o total da seção soma. */
    expect(view.amount).toBe(300)
    /*
      O vocabulário passou a ser o de PESSOAS: a mesma relação com a mesma
      pessoa aparece em /persons como PAGO, e "Quitado" era um par só desta
      tela.
    */
    expect(peopleRowStatusLabel(view.status, view.direction)).toBe('PAGO')
    // O trailing comunica o estado; a linha não repete "Nada em aberto".
    expect(view.metadata).toEqual([])
  })

  it('item 43: só dívida aberta destaca o saldo devedor', () => {
    const view = peopleRowView(
      person({
        budget: { openDueInMonth: 300, debtTotal: 300, payable: 300 },
        open: { debtTotal: 300, net: -300, itemCount: 1 },
      }),
      brl,
    )

    expect(view.status).toBe('open')
    expect(view.direction).toBe('out')
    /* A contribuição é magnitude; a direção vem de `direction`. */
    expect(view.amount).toBe(300)
    // Um lado só: o valor já diz tudo, sem composição redundante.
    expect(view.metadata).toEqual([])
  })

  it('item 44: bilateral mostra a composição', () => {
    const view = peopleRowView(
      person({
        /*
          Credora: recebe 610,90 e deve 330. Pelo netting por pessoa,
          `payable = max(330 − 610,90, 0)` = ZERO — quem me deve mais do que eu
          devo não vira crédito no orçamento.
        */
        budget: { receivableAmount: 610.9, openDueInMonth: 330, payable: 0 },
        open: {
          receivableTotal: 610.9,
          debtTotal: 330,
          net: 280.9,
          itemCount: 2,
        },
      }),
      brl,
    )

    expect(view.direction).toBe('in')
    /*
      ZERO, não 280,90.

      O valor da row é a CONTRIBUIÇÃO ao orçamento, e esta pessoa não
      acrescenta nada: o que ela me deve é menor do que o que me deve a mim.
      280,90 é o líquido em aberto da RELAÇÃO — informação de Pessoas, não do
      Orçamento.

      A composição bilateral continua na metadata, dizendo os dois lados.
    */
    expect(view.amount).toBe(0)
    expect(view.metadata[0]).toContain('a receber')
    expect(view.metadata[0]).toContain('a pagar')
  })

  it('item 41: saldo zero COM itens não é Quitado', () => {
    /*
      R$ 300 de cada lado dá net zero com duas obrigações vivas. Chamar isso
      de quitado repetiria o erro que a Fase 8B removeu do WhatsApp.
    */
    const view = peopleRowView(
      person({
        open: { receivableTotal: 300, debtTotal: 300, net: 0, itemCount: 2 },
      }),
      brl,
    )

    expect(view.status).toBe('open')
    expect(view.direction).toBe('neutral')
    expect(view.amount).toBe(0)
  })

  it('item 46: pago + aberto mostra os dois', () => {
    const view = peopleRowView(
      person({
        budget: { paidInMonth: 300, debtTotal: 400, payable: 100 },
        open: { debtTotal: 100, net: -100, itemCount: 1 },
      }),
      brl,
    )

    // Ainda existe o que resolver: o estado principal é "Em aberto".
    expect(view.status).toBe('open')
    /* Magnitude: a direção vem de `direction`. */
    expect(view.amount).toBe(100)
    // E o desembolso já feito não desaparece.
    expect(view.metadata.some((m) => m.includes('quitados neste mês'))).toBe(
      true,
    )
  })

  it('item 42: origem em compra no cartão vira metadata', () => {
    const view = peopleRowView(
      person({
        open: {
          receivableTotal: 219.66,
          net: 219.66,
          itemCount: 1,
          automaticReceivable: 219.66,
        },
      }),
      brl,
    )

    expect(view.metadata.some((m) => m.includes('compras no seu cartão'))).toBe(
      true,
    )
  })

  it('item 55: o rótulo acessível não depende de cor', () => {
    const aberto = peopleRowAriaLabel(
      person({ open: { net: 280.9, itemCount: 1 } }),
      brl,
    )
    const quitado = peopleRowAriaLabel(
      person({
        budget: { paidInMonth: 300, debtTotal: 300, payable: 300 },
        open: { itemCount: 0 },
      }),
      brl,
    )

    expect(aberto).toContain('Em aberto')
    expect(aberto).toContain('a receber')
    expect(quitado).toContain('Quitado')
    expect(quitado).toContain('pagos nesta competência')
  })
})

describe('Cores: direção no valor, urgência no ícone', () => {
  /**
   * Os dois eixos são independentes. Antes um `tone` só pintava ícone e valor
   * juntos: saldo positivo ficava branco (perdendo o "a receber") e saldo
   * negativo deixava o ícone vermelho mesmo sem nada vencido.
   */
  it('item 10: net positivo sem atraso → verde, ícone neutro', () => {
    const eva = person({
      open: {
        receivableTotal: 610.9,
        debtTotal: 330,
        net: 280.9,
        itemCount: 2,
      },
    })
    const view = peopleRowView(eva, brl)

    expect(view.direction).toBe('in')
    expect(view.iconState).toBe('neutral')
  })

  it('item 12: net negativo sem atraso → vermelho, ícone NEUTRO', () => {
    /*
      O caso do Fabrício: −R$ 1,00 com tudo dentro do prazo. O ícone vermelho
      dizia "urgente" por um saldo que é apenas negativo.
    */
    const fabricio = person({
      open: { receivableTotal: 10, debtTotal: 11, net: -1, itemCount: 2 },
    })
    const view = peopleRowView(fabricio, brl)

    expect(view.direction).toBe('out')
    expect(view.iconState).toBe('neutral')
  })

  it('item 19.3: net zero com itens → neutro, ainda Em aberto', () => {
    const view = peopleRowView(
      person({
        open: { receivableTotal: 300, debtTotal: 300, net: 0, itemCount: 2 },
      }),
      brl,
    )

    expect(view.direction).toBe('neutral')
    expect(view.status).toBe('open')
  })

  it('item 7: net positivo COM atraso → verde e ícone vermelho', () => {
    /*
      Cobrança de R$ 500 vencida e dívida de R$ 100 no prazo. As cores não se
      contradizem: uma diz direção, a outra diz urgência.
    */
    const view = peopleRowView(
      person({
        open: {
          receivableTotal: 500,
          debtTotal: 100,
          net: 400,
          itemCount: 2,
          hasOverdue: true,
        },
      }),
      brl,
    )

    expect(view.direction).toBe('in')
    expect(view.iconState).toBe('overdue')
  })

  it('item 19.5: net negativo com atraso → vermelho nos dois', () => {
    const view = peopleRowView(
      person({
        open: { debtTotal: 300, net: -300, itemCount: 1, hasOverdue: true },
      }),
      brl,
    )

    expect(view.direction).toBe('out')
    expect(view.iconState).toBe('overdue')
  })

  it('item 8: quitado tem ícone de concluído e valor NEUTRO', () => {
    /*
      O valor de uma dívida quitada não fica verde: aquele dinheiro SAIU do
      bolso, e verde sugeriria recebimento. O verde do estado vive no ícone.
    */
    const view = peopleRowView(
      person({
        budget: { paidInMonth: 300, debtTotal: 300, payable: 300 },
        open: { itemCount: 0 },
      }),
      brl,
    )

    expect(view.iconState).toBe('settled')
    expect(view.direction).toBe('neutral')
  })

  it('urgência nunca é derivada do saldo', () => {
    // Duplo adversarial: mesmo saldo, `hasOverdue` diferente.
    const semAtraso = peopleRowView(
      person({ open: { debtTotal: 999, net: -999, itemCount: 1 } }),
      brl,
    )
    const comAtraso = peopleRowView(
      person({
        open: { debtTotal: 999, net: -999, itemCount: 1, hasOverdue: true },
      }),
      brl,
    )

    expect(semAtraso.direction).toBe(comAtraso.direction)
    expect(semAtraso.iconState).not.toBe(comAtraso.iconState)
  })
})

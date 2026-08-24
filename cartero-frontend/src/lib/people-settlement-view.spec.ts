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
  name?: string
}): PersonSettlement {
  return {
    personId: 'p-1',
    personName: overrides.name ?? 'Mariana Souza',
    budget: {
      receivableDueInMonth: 0,
      debtDueInMonth: 0,
      priorDebtCarry: 0,
      debtTotal: 0,
      automaticReceivable: 0,
      ...overrides.budget,
    },
    open: {
      receivableInMonth: 0,
      debtInMonth: 0,
      priorReceivable: 0,
      priorDebt: 0,
      receivableTotal: 0,
      debtTotal: 0,
      net: 0,
      priorNet: 0,
      itemCount: 0,
      automaticReceivable: 0,
      ...overrides.open,
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
    expect(
      openPriorLabel(
        person({
          open: { priorReceivable: 200, priorDebt: 200, priorNet: 0 },
        }),
        brl,
      ),
    ).toBeNull()
  })

  it('tem direção explícita', () => {
    expect(
      openPriorLabel(person({ open: { priorNet: 100 } }), brl),
    ).toContain('a receber de períodos anteriores')
    expect(
      openPriorLabel(person({ open: { priorNet: -200 } }), brl),
    ).toContain('a pagar de períodos anteriores')
  })

  it('nunca deriva do universo do orçamento', () => {
    /*
      Cenário dos R$ 300 fantasmas: o orçamento reconhece a dívida do mês, mas
      não há nada aberto de antes. A linha de carry precisa ficar ausente.
    */
    const paga = person({
      budget: { debtDueInMonth: 300, debtTotal: 300 },
      open: { priorNet: 0, itemCount: 0 },
    })
    expect(openPriorLabel(paga, brl)).toBeNull()
  })
})

describe('budgetContextLabel — só o que acrescenta informação', () => {
  /*
    A linha de contexto repetia o número que já aparecia em "A pagar":

        No orçamento de setembro 2026 · R$ 330 em dívidas
        A pagar R$ 330

    Agora ela mostra apenas a DIFERENÇA entre os dois universos — a parcela
    já quitada, que é a única coisa que "Em aberto" não consegue dizer.
  */
  it('caso 1: dívida totalmente em aberto não gera contexto', () => {
    const totalmenteAberta = person({
      budget: { debtDueInMonth: 330, debtTotal: 330 },
      open: { debtInMonth: 330, debtTotal: 330, net: -330, itemCount: 1 },
    })
    expect(budgetContextLabel(totalmenteAberta, brl)).toBeNull()
  })

  it('caso 2: dívida totalmente quitada mostra o valor inteiro', () => {
    const quitada = person({
      budget: { debtDueInMonth: 330, debtTotal: 330 },
      open: { itemCount: 0 },
    })
    const label = budgetContextLabel(quitada, brl)
    expect(label).toContain('330')
    expect(label).toContain('já quitados')
    expect(label).toContain('compõem o orçamento')
  })

  it('caso 3: parcialmente quitada mostra só a diferença', () => {
    /*
      500 no orçamento, 300 em aberto → 200 quitados.
      Repetir os 500 inteiros duplicaria os 300 que já aparecem em "A pagar".
    */
    const parcial = person({
      budget: { debtDueInMonth: 500, debtTotal: 500 },
      open: { debtInMonth: 300, debtTotal: 300, net: -300, itemCount: 1 },
    })
    const label = budgetContextLabel(parcial, brl)
    expect(label).toContain('200')
    expect(label).not.toContain('500')
    expect(label).not.toContain('300')
  })

  it('caso 4: sem dívida nenhuma não há linha', () => {
    expect(budgetContextLabel(person({}), brl)).toBeNull()
  })

  it('caso 5: pessoa só com recebível não ganha linha artificial', () => {
    // O caso do Jeoge: recebível aberto, nenhuma dívida em nenhum universo.
    const soRecebivel = person({
      budget: { receivableDueInMonth: 780.28 },
      open: { receivableTotal: 780.28, net: 780.28, itemCount: 1 },
    })
    expect(budgetContextLabel(soRecebivel, brl)).toBeNull()
  })

  it('o carry histórico quitado também conta como diferença', () => {
    /*
      A parcela quitada pode vir do carry anterior, não só do mês. O cálculo é
      sobre `debtTotal` justamente para não precisar distinguir a origem.
    */
    const carryQuitado = person({
      budget: { debtDueInMonth: 250, priorDebtCarry: 100, debtTotal: 350 },
      open: { debtInMonth: 250, debtTotal: 250, net: -250, itemCount: 1 },
    })
    expect(budgetContextLabel(carryQuitado, brl)).toContain('100')
  })

  it('não repete a competência — ela já está no título da seção', () => {
    const quitada = person({
      budget: { debtTotal: 330 },
      open: { itemCount: 0 },
    })
    expect(budgetContextLabel(quitada, brl)).not.toMatch(/orçamento de \w+ \d{4}/)
  })
})

describe('settlementAriaLabel', () => {
  it('descreve a composição em aberto sem depender de cor', () => {
    const label = settlementAriaLabel(
      person({
        budget: { debtDueInMonth: 200, debtTotal: 200 },
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
        budget: { debtDueInMonth: 200, debtTotal: 200 },
        open: { itemCount: 0 },
      }),
      brl,
    )

    expect(label).toContain('nada em aberto')
    // O contexto que reconcilia o total continua audível.
    expect(label).toContain('já quitados')
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
        debtDueInMonth: 200,
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
        debtDueInMonth: 9999,
        priorDebtCarry: 9999,
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
      budget: { debtDueInMonth: 330, debtTotal: 330 },
      open: { itemCount: 0 },
    })

    const summary = summarizePeopleSettlements([quitada])

    expect(summary.debtTotal).toBe(0)
    expect(summary.debtTotal).not.toBe(330)
    expect(summary.isEmpty).toBe(true)
  })

  it('item 50: prior não é contado duas vezes', () => {
    /*
      `receivableTotal` JÁ é `receivableInMonth + priorReceivable`. Somar os
      componentes de novo daria 600 onde existem 300.
    */
    const comPrior = person({
      open: {
        receivableInMonth: 200,
        priorReceivable: 100,
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
      budget: { debtDueInMonth: 200, debtTotal: 200 },
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

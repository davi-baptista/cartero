import { describe, expect, it } from 'vitest'
import {
  peopleRowView,
  priorOverdueLabel,
  summarizePriorOverdue,
} from './people-settlement-view'
import type { BudgetSummary } from '@/services/budget.service'

/*
  Derivado do contrato em vez de duplicado: se `peopleSettlements` mudar de
  forma, este teste falha junto — que é o ponto.
*/
type PersonSettlement = BudgetSummary['peopleSettlements'][number]

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pendências anteriores — quanto veio de trás, e em qual direção
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O backend decide o que é anterior-e-vencido; aqui só decidimos como dizer
 * isso. Nenhuma data é reinterpretada nesta camada — se ela reimplementasse a
 * regra temporal, as duas poderiam divergir e a tela contaria uma história
 * diferente da consulta.
 */

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

function person(over: {
  personId?: string
  priorOverdueReceivable?: number
  priorOverdueDebt?: number
  receivableTotal?: number
  debtTotal?: number
  net?: number
  itemCount?: number
  automaticReceivable?: number
}): PersonSettlement {
  const open = {
    receivableInMonth: 0,
    debtInMonth: 0,
    priorOverdueReceivable: over.priorOverdueReceivable ?? 0,
    priorOverdueDebt: over.priorOverdueDebt ?? 0,
    receivableTotal: over.receivableTotal ?? 0,
    debtTotal: over.debtTotal ?? 0,
    net: over.net ?? 0,
    priorOverdueNet:
      (over.priorOverdueReceivable ?? 0) - (over.priorOverdueDebt ?? 0),
    itemCount: over.itemCount ?? 1,
    hasOverdue:
      (over.priorOverdueReceivable ?? 0) > 0 ||
      (over.priorOverdueDebt ?? 0) > 0,
    automaticReceivable: over.automaticReceivable ?? 0,
  }

  return {
    personId: over.personId ?? 'p-1',
    personName: 'Eva',
    /*
      A contribuição derivada do próprio cenário.

      `payable = max(dívidas − recebíveis, 0)`, o netting por pessoa que o
      backend aplica — e a base que a row exibe. Fixá-la em zero fazia o
      fixture testar a base antiga (`open.net`).
    */
    budget: {
      receivableDueInMonth: 0,
      openDueInMonth: over.debtTotal ?? 0,
      currentOpenPrior: 0,
      paidInMonth: 0,
      receivableAmount: over.receivableTotal ?? 0,
      payable: Math.max((over.debtTotal ?? 0) - (over.receivableTotal ?? 0), 0),
      debtTotal: over.debtTotal ?? 0,
      automaticReceivable: 0,
    },
    open,
  } as PersonSettlement
}

describe('priorOverdueLabel — sem netting', () => {
  it('item 16: um lado só diz esse lado', () => {
    expect(priorOverdueLabel(277.63, 0, brl)).toBe(
      'Pendências anteriores: R$ 277,63 a receber',
    )
    expect(priorOverdueLabel(0, 80, brl)).toBe(
      'Pendências anteriores: R$ 80,00 a pagar',
    )
  })

  it('item 18: os dois lados aparecem juntos', () => {
    /*
      O líquido diria "+R$ 227,63" e esconderia que existem duas obrigações
      vivas. A composição é a informação; o líquido já está no valor em
      destaque da linha.
    */
    const label = priorOverdueLabel(277.63, 50, brl)

    expect(label).toContain('277,63 a receber')
    expect(label).toContain('50,00 a pagar')
  })

  it('item 19: sem carry, nada é dito', () => {
    // Nunca "Pendências anteriores: R$ 0,00".
    expect(priorOverdueLabel(0, 0, brl)).toBeNull()
  })
})

describe('summarizePriorOverdue — agregação do cabeçalho', () => {
  it('item 37: soma os buckets de todas as pessoas', () => {
    const total = summarizePriorOverdue([
      person({ personId: 'eva', priorOverdueReceivable: 100 }),
      person({ personId: 'jeoge' }),
      person({ personId: 'fabricio', priorOverdueDebt: 20 }),
    ])

    expect(total.receivable).toBe(100)
    expect(total.debt).toBe(20)
  })

  it('lista vazia devolve zeros, não NaN', () => {
    expect(summarizePriorOverdue([])).toEqual({ receivable: 0, debt: 0 })
  })

  it('o cabeçalho só fala quando existe carry', () => {
    const semCarry = summarizePriorOverdue([person({ receivableTotal: 500 })])
    expect(priorOverdueLabel(semCarry.receivable, semCarry.debt, brl)).toBeNull()
  })
})

describe('A linha explica o que veio de trás', () => {
  it('item 19: com os dois lados abertos, a bilateral tem prioridade', () => {
    /*
      Mudou com o padrão mobile: UMA faixa secundária, por prioridade. A
      composição bilateral explica melhor o líquido em destaque; a pendência
      anterior fica no drawer.
    */
    const eva = person({
      priorOverdueReceivable: 277.63,
      receivableTotal: 1453.63,
      debtTotal: 330,
      net: 1123.63,
      itemCount: 3,
    })
    const view = peopleRowView(eva, brl)

    expect(view.metadata).toHaveLength(1)
    expect(view.metadata[0]).toContain('a receber')
    expect(view.metadata[0]).toContain('a pagar')
  })

  it('item 19: sem bilateral, a pendência anterior aparece', () => {
    const soAnterior = person({
      priorOverdueDebt: 100,
      debtTotal: 100,
      net: -100,
      itemCount: 1,
    })
    const view = peopleRowView(soAnterior, brl)

    expect(view.metadata[0]).toContain('Pendências anteriores')
  })

  it('item 19: sem carry, a linha não ganha ruído', () => {
    const jeoge = person({
      receivableTotal: 439.32,
      net: 439.32,
      itemCount: 1,
      automaticReceivable: 439.32,
    })
    const view = peopleRowView(jeoge, brl)

    expect(
      view.metadata.some((m) => m.includes('Pendências anteriores')),
    ).toBe(false)
    // A origem no cartão continua sendo dita.
    expect(
      view.metadata.some((m) => m.includes('compras no seu cartão')),
    ).toBe(true)
  })

  it('item 22: carry implica ícone de atraso', () => {
    /*
      Membership e visual usam a MESMA definição temporal: se algo anterior
      entrou, é porque está vencido — e o ícone precisa dizer isso.
    */
    const view = peopleRowView(
      person({
        priorOverdueDebt: 80,
        debtTotal: 80,
        net: -80,
        itemCount: 1,
      }),
      brl,
    )

    expect(view.iconState).toBe('overdue')
  })
})

describe('Cor do valor: estado, não direção', () => {
  /**
   * A coluna monetária significava coisas diferentes em duas tabelas
   * vizinhas: em Faturas a cor conta o ESTADO (aberta neutra, paga verde);
   * aqui contava o SINAL do saldo (verde a receber, vermelho a pagar).
   *
   * Nesta tabela o número é o impacto da pessoa no Orçamento — e o estado é
   * o que o qualifica. Atraso continua no ícone, camada à parte.
   */
  it('item 2: em aberto usa valor neutro, mesmo devendo', () => {
    // O caso do Fabrício: R$ 1,00 a pagar deixa de ser vermelho.
    const fabricio = person({
      receivableTotal: 10,
      debtTotal: 11,
      net: -1,
      itemCount: 2,
    })
    const view = peopleRowView(fabricio, brl)

    expect(view.status).toBe('open')
    expect(view.amountTone).toBe('neutral')
  })

  it('em aberto a receber também é neutro', () => {
    // Nem verde por ser positivo: a cor não fala mais de direção.
    const view = peopleRowView(
      person({ receivableTotal: 500, net: 500, itemCount: 1 }),
      brl,
    )

    expect(view.amountTone).toBe('neutral')
  })

  it('item 3: quitado usa verde, como fatura paga', () => {
    const view = peopleRowView(
      person({ itemCount: 0 }),
      brl,
    )

    expect(view.status).toBe('settled')
    expect(view.amountTone).toBe('positive')
    expect(view.iconState).toBe('settled')
  })

  it('item 5: atraso pinta o ÍCONE, nunca o valor', () => {
    /*
      As duas camadas coexistem: ícone vermelho avisa que algo venceu, valor
      neutro diz que a saída ainda não aconteceu.
    */
    const comAtraso = person({
      priorOverdueDebt: 100,
      debtTotal: 100,
      net: -100,
      itemCount: 1,
    })
    const view = peopleRowView(comAtraso, brl)

    expect(view.iconState).toBe('overdue')
    expect(view.amountTone).toBe('neutral')
  })

  it('item 4: a cor não deriva mais do sinal do saldo', () => {
    // Duplo adversarial: saldos opostos, mesma cor de valor.
    const aReceber = peopleRowView(
      person({ receivableTotal: 300, net: 300, itemCount: 1 }),
      brl,
    )
    const aPagar = peopleRowView(
      person({ debtTotal: 300, net: -300, itemCount: 1 }),
      brl,
    )

    expect(aReceber.amountTone).toBe(aPagar.amountTone)
    // A direção continua exposta — o rótulo acessível a usa.
    expect(aReceber.direction).not.toBe(aPagar.direction)
  })

  it('item 13.5: o valor numérico não muda', () => {
    const view = peopleRowView(
      person({ receivableTotal: 10, debtTotal: 11, net: -1, itemCount: 2 }),
      brl,
    )

    /*
      A contribuição: `max(11 − 10, 0)` = 1, magnitude. O sinal vem de
      `direction`, e é o mesmo número que o total da seção soma.
    */
    expect(view.amount).toBe(1)
    expect(view.direction).toBe('out')
  })
})

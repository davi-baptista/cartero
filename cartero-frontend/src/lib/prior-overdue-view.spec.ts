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
    budget: {
      receivableDueInMonth: 0,
      openDueInMonth: 0,
      currentOpenPrior: 0,
      paidInMonth: 0,
      receivableAmount: 0,
      payable: 0,
      debtTotal: 0,
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

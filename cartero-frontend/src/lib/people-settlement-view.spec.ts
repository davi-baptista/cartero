import { describe, expect, it } from 'vitest'
import {
  budgetContextLabel,
  openBalanceLabel,
  openCompositionParts,
  openDirection,
  openPriorLabel,
  settlementAriaLabel,
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

describe('budgetContextLabel', () => {
  it('mostra a obrigação do mês mesmo já paga', () => {
    /*
      Item 10: sem esta linha, uma dívida quitada sumiria da tela enquanto
      continua somando em `totalToPay` — e o total deixaria de fechar com as
      linhas visíveis.
    */
    const quitada = person({
      budget: { debtDueInMonth: 200, debtTotal: 200 },
      open: { itemCount: 0 },
    })
    expect(budgetContextLabel(quitada, brl)).toContain('em dívidas')
  })

  it('sem dívida no orçamento não há linha de contexto', () => {
    // Item 12: pessoa presente apenas por acerto em aberto.
    const soAberto = person({
      open: { receivableTotal: 300, net: 300, itemCount: 1 },
    })
    expect(budgetContextLabel(soAberto, brl)).toBeNull()
  })

  it('inclui o carry histórico no contexto', () => {
    const comCarry = person({
      budget: { debtDueInMonth: 250, priorDebtCarry: 100, debtTotal: 350 },
    })
    expect(budgetContextLabel(comCarry, brl)).toContain('350')
  })
})

describe('settlementAriaLabel', () => {
  it('nomeia os dois universos separadamente', () => {
    const label = settlementAriaLabel(
      person({
        budget: { debtDueInMonth: 200, debtTotal: 200 },
        open: { receivableTotal: 200, debtTotal: 200, net: 0, itemCount: 2 },
      }),
      brl,
      'agosto de 2026',
    )

    expect(label).toContain('no orçamento de agosto de 2026')
    expect(label).toContain('em aberto')
    // Sem depender de cor nem de posição para saber qual número é qual.
    expect(label).toContain('a receber')
    expect(label).toContain('a pagar')
  })

  it('depois da quitação diz nada em aberto, sem perder o contexto', () => {
    const label = settlementAriaLabel(
      person({
        budget: { debtDueInMonth: 200, debtTotal: 200 },
        open: { itemCount: 0 },
      }),
      brl,
      'agosto de 2026',
    )

    expect(label).toContain('nada em aberto')
    expect(label).toContain('em dívidas')
    // Não pode sugerir pendência viva.
    expect(label).not.toMatch(/em aberto, R\$/)
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

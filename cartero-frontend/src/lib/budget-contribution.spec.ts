import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { peopleRowView } from './people-settlement-view'
import type { BudgetSummary } from '@/services/budget.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O amount do Acerto NÃO troca de base depois do settlement
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A row usava TRÊS bases diferentes, e nenhuma era a do total da seção:
 *
 *   aberta          `open.net`           outstanding líquido
 *   resolvida       `budget.debtTotal`   dívida BRUTA
 *   total da seção  `budget.payable`     contribuição ao orçamento
 *
 * Com R$ 10 a receber e R$ 11 a pagar, a row dizia R$ 1 aberta e saltava para
 * R$ 11 ao ser quitada — enquanto o total do cabeçalho seguia somando R$ 1.
 * Settlement trocava a MATEMÁTICA da linha, não só o estado dela.
 *
 * ── Por que aqui NÃO alterna, se em Pessoas alterna ──
 *
 * Em Pessoas a troca outstanding → histórico é deliberada, e o trailing muda
 * para `SALDO FINAL` para avisar. A pergunta lá muda: "quanto falta" → "quanto
 * houve".
 *
 * Aqui a pergunta é uma só — "quanto esta pessoa acrescenta ao orçamento DESTA
 * competência?" — e a resposta é um fato do mês. Quitar não altera o custo do
 * mês; altera quem já pagou.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))
const VIEW = semComentarios(ler('./people-settlement-view.ts'))

type PersonSettlement = BudgetSummary['peopleSettlements'][number]

const brl = (v: number) =>
  `R$ ${v.toFixed(2).replace('.', ',')}`

function pessoa(o: {
  budget?: Partial<PersonSettlement['budget']>
  open?: Partial<PersonSettlement['open']>
  settled?: Partial<PersonSettlement['settled']>
}): PersonSettlement {
  return {
    personId: 'p1',
    personName: 'Fabricio',
    budget: {
      receivableDueInMonth: 0,
      openDueInMonth: 0,
      currentOpenPrior: 0,
      paidInMonth: 0,
      receivableAmount: 0,
      payable: 0,
      debtTotal: 0,
      automaticReceivable: 0,
      ...o.budget,
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
      ...o.open,
    },
    settled: { settledAt: null, itemCount: 0, ...o.settled },
  }
}

/** O cenário exato do relato: R$ 10 a receber, R$ 11 a pagar → contribui R$ 1. */
const ABERTO = pessoa({
  budget: { receivableAmount: 10, openDueInMonth: 11, debtTotal: 11, payable: 1 },
  open: {
    receivableTotal: 10,
    debtTotal: 11,
    net: -1,
    itemCount: 2,
    nextItem: { direction: 'pay', dueDate: '2026-09-15' },
  },
})

/** O MESMO agregado, inteiramente liquidado. */
const RESOLVIDO = pessoa({
  budget: { receivableAmount: 10, paidInMonth: 11, debtTotal: 11, payable: 1 },
  open: { itemCount: 0 },
  settled: { settledAt: '2026-09-10', itemCount: 2 },
})

describe('B1-B3: a base do amount é estável', () => {
  it('B1: aberto usa a contribuição', () => {
    expect(peopleRowView(ABERTO, brl).amount).toBe(1)
  })

  it('B2: resolvido usa a MESMA contribuição', () => {
    expect(peopleRowView(RESOLVIDO, brl).amount).toBe(1)
  })

  it('B3: settlement NÃO troca para a dívida bruta', () => {
    /*
      O bug exato: R$ 11 é `budget.debtTotal`, a dívida sem o abatimento do
      recebível da mesma pessoa.
    */
    const depois = peopleRowView(RESOLVIDO, brl).amount

    expect(depois).not.toBe(11)
    expect(depois).toBe(peopleRowView(ABERTO, brl).amount)
  })

  it('o estado muda, o número não', () => {
    const antes = peopleRowView(ABERTO, brl)
    const depois = peopleRowView(RESOLVIDO, brl)

    expect(antes.status).toBe('open')
    expect(depois.status).toBe('settled')
    expect(antes.amount).toBe(depois.amount)
  })
})

describe('B4: o total da seção reconcilia com as rows', () => {
  it('a soma das rows é a soma dos `payable`', () => {
    /*
      O invariante que o bug quebrava: a row exibia uma base e o cabeçalho
      somava outra, então nenhuma soma de linhas fechava com o total.
    */
    const pessoas = [
      pessoa({ budget: { payable: 1 }, open: { itemCount: 2, net: -1 } }),
      pessoa({ budget: { payable: 250 }, open: { itemCount: 1, net: -250 } }),
      pessoa({
        budget: { payable: 40, debtTotal: 900 },
        open: { itemCount: 0 },
        settled: { settledAt: '2026-09-10', itemCount: 3 },
      }),
    ]

    const somaRows = pessoas.reduce(
      (t, p) => t + peopleRowView(p, brl).amount,
      0,
    )
    const somaTotal = pessoas.reduce((t, p) => t + p.budget.payable, 0)

    expect(somaRows).toBe(somaTotal)
    expect(somaRows).toBe(291)
  })

  it('a reconciliação sobrevive a um settlement', () => {
    /*
      A mesma pessoa aberta e resolvida contribui igual — então quitar não
      desalinha a soma das linhas do total do cabeçalho.
    */
    const antes = peopleRowView(ABERTO, brl).amount
    const depois = peopleRowView(RESOLVIDO, brl).amount

    expect(antes).toBe(ABERTO.budget.payable)
    expect(depois).toBe(RESOLVIDO.budget.payable)
  })

  it('a página soma `payable` no cabeçalho', () => {
    expect(BUDGET).toContain('total + person.budget.payable')
  })
})

describe('B5: o domínio financeiro não mudou', () => {
  it('`payable` continua sendo decidido pelo backend', () => {
    const servico = semComentarios(ler('../services/budget.service.ts'))

    expect(servico).toContain('payable')
    /* A view não recalcula netting — só lê. */
    expect(VIEW).toContain('return person.budget.payable')
    expect(VIEW).not.toContain('Math.max(')
  })

  it('quem recebe mais do que deve contribui com ZERO, nunca crédito', () => {
    /*
      `payable = max(dívidas − recebíveis, 0)`. Uma pessoa que me deve mais do
      que eu devo não vira desconto no orçamento — e a row exibe o mesmo zero.
    */
    const credora = pessoa({
      budget: { receivableAmount: 500, openDueInMonth: 100, payable: 0 },
      open: { receivableTotal: 500, debtTotal: 100, net: 400, itemCount: 2 },
    })

    expect(peopleRowView(credora, brl).amount).toBe(0)
  })
})

describe('B6-B9: o estado muda, com o vocabulário do Orçamento', () => {
  it('B6: aberto usa VOCÊ DEVE / A RECEBER', () => {
    const v = peopleRowView(ABERTO, brl)

    expect(v.status).toBe('open')
    expect(v.direction).toBe('out')
  })

  it('B7/B8: resolvido usa PAGO — não `SALDO FINAL`', () => {
    /*
      `SALDO FINAL` é linguagem de Pessoas, onde o número muda de base. Aqui a
      base é estável, então o trailing descreve o pagamento.
    */
    expect(peopleRowView(RESOLVIDO, brl).status).toBe('settled')
    expect(BUDGET).toContain('peopleRowStatusLabel(view.status, view.direction)')
    expect(BUDGET).not.toContain('SALDO FINAL')
  })

  it('B8: a metadata resolvida diz quando', () => {
    expect(BUDGET).toContain('settlementRowMeta(view.status,')
    expect(BUDGET).toContain('settledAt: person.settled.settledAt')
  })

  it('B9: o valor permanece neutro', () => {
    const row = semComentarios(ler('../components/ui/status-list-row.tsx'))

    expect(row).not.toContain('amountTone')
    expect(BUDGET).toContain('amount={view.amount}')
    /* A bifurcação de sinal saiu com a das bases. */
    expect(BUDGET).not.toContain('Math.abs(view.amount)')
  })
})

describe('B40: os três conceitos são distintos', () => {
  it('settlement muda outstanding, não histórico nem contribuição', () => {
    /*
      O contrato central da fase, verificado nos dados: o mesmo agregado antes
      e depois.
    */
    expect(ABERTO.open.itemCount).toBe(2)
    expect(RESOLVIDO.open.itemCount).toBe(0)

    /* Histórico: idêntico. */
    expect(ABERTO.budget.debtTotal).toBe(RESOLVIDO.budget.debtTotal)
    expect(ABERTO.budget.receivableAmount).toBe(
      RESOLVIDO.budget.receivableAmount,
    )

    /* Contribuição: idêntica. */
    expect(ABERTO.budget.payable).toBe(RESOLVIDO.budget.payable)
  })

  it('uma única authority alimenta os dois estados', () => {
    /*
      Sem `if open: net / if settled: bruto`. O assert é sobre a AUSÊNCIA da
      bifurcação, que é o que permitia a divergência.
    */
    expect(VIEW).toContain('amount: budgetContribution(person)')
    expect(VIEW).not.toContain('amount: person.open.net')
    expect(VIEW).not.toContain('amount: person.budget.debtTotal')

    const chamadas = VIEW.match(/amount: budgetContribution\(person\)/g) ?? []
    expect(chamadas.length).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import {
  belongsToCompetence,
  dueLabel,
  dueStateOf,
  openItemsFor,
  summarizeCompetence,
} from './person-settlement-view'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Acerto mensal — apresentação
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O caso central: um jantar dividido comprado em 16/08 que vence com a fatura
 * em 10/09 pertence ao acerto de AGOSTO e vence em SETEMBRO. Ele é visível nos
 * dois meses — as duas competências fazem perguntas diferentes sobre o mesmo
 * item, e nada soma agosto com setembro.
 */

const AGOSTO = { year: 2026, month: 8 }
const SETEMBRO = { year: 2026, month: 9 }
const OUTUBRO = { year: 2026, month: 10 }

function item(over: {
  dueDate: string
  amount?: number
  isPaid?: boolean
  reference?: { year: number; month: number }
}) {
  const due = over.dueDate
  const [y, m] = due.slice(0, 10).split('-').map(Number)
  return {
    dueDate: due,
    amount: over.amount ?? 100,
    isPaid: over.isPaid ?? false,
    referenceMonth: over.reference ?? { year: y, month: m },
    dueMonth: { year: y, month: m },
  }
}

/** O jantar: originado em agosto, vencendo em setembro. */
const JANTAR = item({
  dueDate: '2026-09-10',
  amount: 240,
  reference: AGOSTO,
})

describe('Universo da competência', () => {
  it('agosto mostra o item originado em agosto', () => {
    expect(belongsToCompetence(JANTAR, AGOSTO)).toBe(true)
  })

  it('setembro também mostra, porque vence lá', () => {
    expect(belongsToCompetence(JANTAR, SETEMBRO)).toBe(true)
  })

  it('outubro mostra como carry-over', () => {
    expect(belongsToCompetence(JANTAR, OUTUBRO)).toBe(true)
  })

  it('julho não mostra', () => {
    expect(belongsToCompetence(JANTAR, { year: 2026, month: 7 })).toBe(false)
  })

  it('item resolvido sai do universo aberto', () => {
    const pago = item({
      dueDate: '2026-09-10',
      reference: AGOSTO,
      isPaid: true,
    })

    expect(belongsToCompetence(pago, AGOSTO)).toBe(false)
    expect(belongsToCompetence(pago, SETEMBRO)).toBe(false)
  })

  it('item puramente de setembro não aparece em agosto', () => {
    expect(belongsToCompetence(item({ dueDate: '2026-09-21' }), AGOSTO)).toBe(
      false,
    )
  })

  it('atraso antigo aparece na competência atual', () => {
    expect(belongsToCompetence(item({ dueDate: '2026-06-15' }), SETEMBRO)).toBe(
      true,
    )
  })

  it('não duplica quando referência e vencimento coincidem', () => {
    const proprio = item({ dueDate: '2026-09-10' })
    const rows = openItemsFor([proprio], SETEMBRO, '2026-09-05')

    expect(rows).toHaveLength(1)
  })
})

describe('Estado e microcopy', () => {
  it('05/09 em setembro: A vencer, referente a agosto', () => {
    expect(dueStateOf(JANTAR, SETEMBRO, '2026-09-05')).toBe('upcoming')
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-05')).toBe(
      'A vencer · referente a agosto · vence em 10/09',
    )
  })

  it('10/09: vence hoje, não em atraso', () => {
    expect(dueStateOf(JANTAR, SETEMBRO, '2026-09-10')).toBe('dueToday')
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-10')).toBe(
      'A vencer · referente a agosto · vence hoje',
    )
  })

  it('11/09: em atraso, com a origem preservada', () => {
    expect(dueStateOf(JANTAR, SETEMBRO, '2026-09-11')).toBe('overdue')
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-11')).toBe(
      'Em atraso · referente a agosto · venceu em 10/09',
    )
  })

  it('visto de agosto, é pendente comum', () => {
    // Aqui a referência É a competência: não veio de antes.
    expect(dueStateOf(JANTAR, AGOSTO, '2026-08-20')).toBe('pending')
    expect(dueLabel(JANTAR, AGOSTO, '2026-08-20')).toBe(
      'Pendente · vence em 10/09',
    )
  })

  it('item do próprio mês em atraso não menciona origem', () => {
    const proprio = item({ dueDate: '2026-09-05' })

    expect(dueLabel(proprio, SETEMBRO, '2026-09-11')).toBe(
      'Em atraso · venceu em 05/09',
    )
  })

  it('nunca chama item futuro de atraso', () => {
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-05')).not.toMatch(/atraso/i)
  })
})

describe('Ordenação', () => {
  it('urgência temporal vem antes da data de origem', () => {
    const atrasado = item({ dueDate: '2026-09-01', amount: 1 })
    const hoje = item({ dueDate: '2026-09-05', amount: 2 })
    const futuro = item({ dueDate: '2026-09-20', amount: 3 })

    const rows = openItemsFor(
      [futuro, hoje, atrasado],
      SETEMBRO,
      '2026-09-05',
    )

    expect(rows.map((r) => r.amount)).toEqual([1, 2, 3])
  })

  it('carry em atraso vem primeiro', () => {
    const carry = item({ dueDate: '2026-07-10', amount: 99 })
    const proprio = item({ dueDate: '2026-09-20', amount: 50 })

    const rows = openItemsFor([proprio, carry], SETEMBRO, '2026-09-05')

    expect(rows[0].amount).toBe(99)
  })
})

describe('Resumo da competência', () => {
  it('soma cada lado, sem compensar', () => {
    const s = summarizeCompetence(
      [item({ dueDate: '2026-09-15', amount: 250 }), JANTAR],
      [item({ dueDate: '2026-09-21', amount: 200 })],
      SETEMBRO,
      '2026-09-05',
    )

    expect(s.receivableTotal).toBe(490)
    expect(s.debtTotal).toBe(200)
    expect(s.net).toBe(290)
  })

  it('destaca o que veio de competências anteriores', () => {
    const s = summarizeCompetence([JANTAR], [], SETEMBRO, '2026-09-05')

    // Os 240 nasceram em agosto.
    expect(s.carriedReceivable).toBe(240)
    expect(s.carriedDebt).toBe(0)
  })

  it('conta os itens que ainda não venceram', () => {
    const s = summarizeCompetence(
      [JANTAR],
      [item({ dueDate: '2026-09-21', amount: 200 })],
      SETEMBRO,
      '2026-09-05',
    )

    expect(s.notYetDueCount).toBe(2)
  })

  it('saldo zero com itens abertos NÃO é quitação', () => {
    const s = summarizeCompetence(
      [item({ dueDate: '2026-09-10', amount: 500 })],
      [item({ dueDate: '2026-09-10', amount: 500 })],
      SETEMBRO,
      '2026-09-05',
    )

    expect(s.net).toBe(0)
    expect(s.itemCount).toBe(2)
    // `isEmpty` olha as CONTAGENS, nunca o saldo.
    expect(s.isEmpty).toBe(false)
  })

  it('vazio de verdade quando não há item', () => {
    const s = summarizeCompetence([], [], SETEMBRO, '2026-09-05')

    expect(s.isEmpty).toBe(true)
    expect(s.net).toBe(0)
  })
})

describe('Cenário do item 75', () => {
  it('setembro: 590 a receber, 200 a pagar, saldo +390', () => {
    const receivables = [
      item({ dueDate: '2026-09-15', amount: 250 }), // do próprio mês
      JANTAR, // 240, originado em agosto
      item({ dueDate: '2026-07-20', amount: 100 }), // carry em atraso
    ]
    const debts = [item({ dueDate: '2026-09-21', amount: 200 })]

    const visiveis = {
      receivables: openItemsFor(receivables, SETEMBRO, '2026-09-05'),
      debts: openItemsFor(debts, SETEMBRO, '2026-09-05'),
    }
    const s = summarizeCompetence(
      visiveis.receivables,
      visiveis.debts,
      SETEMBRO,
      '2026-09-05',
    )

    expect(s.receivableTotal).toBe(590)
    expect(s.debtTotal).toBe(200)
    expect(s.net).toBe(390)
    expect(s.itemCount).toBe(4)
  })
})

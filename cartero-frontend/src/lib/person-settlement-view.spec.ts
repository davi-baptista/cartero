import { describe, expect, it } from 'vitest'
import {
  belongsToCompetence,
  dueLabel,
  dueStateOf,
  openItemsFor,
  summarizeCompetence,
  resolvedLabel,
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

describe('resolvedLabel — microcopy do Histórico', () => {
  /**
   * O histórico é arquivado por `referenceMonth`, não pelo mês de `paidAt`.
   * Por isso a data real da resolução precisa estar na linha: sem ela, uma
   * dívida de julho paga em setembro ficaria no mês certo sem dizer quando
   * foi quitada.
   */
  it('mesma competência: diz quando foi pago', () => {
    const debt = {
      dueDate: '2026-07-20',
      paidAt: '2026-07-25',
      referenceMonth: { year: 2026, month: 7 },
    }
    expect(resolvedLabel(debt, 'debt')).toBe('Pago em 25/07/2026')
  })

  it('recebível usa o verbo próprio', () => {
    const receivable = {
      dueDate: '2026-08-10',
      paidAt: '2026-08-12',
      referenceMonth: { year: 2026, month: 8 },
    }
    expect(resolvedLabel(receivable, 'receivable')).toBe(
      'Recebido em 12/08/2026',
    )
  })

  it('vencimento em outra competência mantém o contexto', () => {
    /*
      Recebível automático: compra em agosto (referência), vence 10/09,
      recebido 15/10. Só "Recebido em 15/10" dentro do histórico de agosto
      pareceria erro — o vencimento explica a distância.
    */
    const automatico = {
      dueDate: '2026-09-10',
      paidAt: '2026-10-15',
      referenceMonth: { year: 2026, month: 8 },
    }
    const label = resolvedLabel(automatico, 'receivable')

    expect(label).toContain('Venceu em 10/09')
    expect(label).toContain('recebido em 15/10')
  })

  it('sem paidAt (legado), não inventa data', () => {
    const semData = {
      dueDate: '2026-07-20',
      paidAt: null,
      referenceMonth: { year: 2026, month: 7 },
    }
    const label = resolvedLabel(semData, 'debt')

    expect(label).toBe('Venceu em 20/07')
    expect(label).not.toContain('Pago em')
  })

  it('não desloca o dia por fuso', () => {
    /*
      Data lida da STRING, nunca por `new Date(iso)`: em UTC-3 o dia 1 às
      00:00Z vira dia 30 do mês anterior.
    */
    const primeiroDia = {
      dueDate: '2026-05-01',
      paidAt: '2026-05-01',
      referenceMonth: { year: 2026, month: 5 },
    }
    expect(resolvedLabel(primeiroDia, 'debt')).toBe('Pago em 01/05/2026')
  })
})

describe('Cross-year: ano faz parte de toda decisão temporal', () => {
  /**
   * O drawer exibe parcelamentos que atravessam a virada do ano: em março de
   * 2026 a lista mostra 14/09, 14/10, 14/11, 14/12, 14/01, 14/02, 14/03.
   *
   * A auditoria confirmou que a LÓGICA sempre considerou o ano — `dueStateOf`
   * compara `YYYY-MM-DD` inteiro e `compareCompetence` compara ano antes de
   * mês. O que faltava era o ano chegar aos olhos: `14/10` renderizava igual
   * para 2025 e 2026.
   */
  const MARCO = { year: 2026, month: 3 }
  const HOJE = '2026-03-10'

  const item = (
    dueDate: string,
    reference: { year: number; month: number },
  ) => ({
    dueDate: `${dueDate}T12:00:00.000Z`,
    isPaid: false,
    referenceMonth: reference,
    dueMonth: {
      year: Number(dueDate.slice(0, 4)),
      month: Number(dueDate.slice(5, 7)),
    },
  })

  it('item 18: outubro do ano ANTERIOR é carry em atraso, com ano visível', () => {
    const carry = item('2025-10-14', { year: 2025, month: 10 })

    expect(belongsToCompetence(carry, MARCO)).toBe(true)
    expect(dueStateOf(carry, MARCO, HOJE)).toBe('overdue')

    const label = dueLabel(carry, MARCO, HOJE)
    expect(label).toContain('Em atraso')
    // O ano deixa imediatamente claro por que "outubro" aparece em março.
    expect(label).toContain('14/10/2025')
    expect(label).toContain('outubro de 2025')
  })

  it('item 19: outubro do MESMO ano, futuro, não entra na competência', () => {
    const futuro = item('2026-10-14', { year: 2026, month: 10 })

    expect(belongsToCompetence(futuro, MARCO)).toBe(false)
  })

  it('item 7: mesmo dia e mês, anos diferentes, estados opostos', () => {
    const passado = item('2025-10-14', { year: 2025, month: 10 })
    const futuro = item('2026-10-14', { year: 2026, month: 10 })

    expect(dueStateOf(passado, MARCO, HOJE)).toBe('overdue')
    expect(dueStateOf(futuro, MARCO, HOJE)).toBe('pending')
    expect(dueStateOf(passado, MARCO, HOJE)).not.toBe(
      dueStateOf(futuro, MARCO, HOJE),
    )
  })

  it('item 20: futuro COM referenceMonth da competência aparece', () => {
    // Cobrança automática originada em março, vencendo em outubro.
    const originadoEmMarco = item('2026-10-14', { year: 2026, month: 3 })

    expect(belongsToCompetence(originadoEmMarco, MARCO)).toBe(true)
    expect(dueStateOf(originadoEmMarco, MARCO, HOJE)).toBe('pending')
    // Não é carry: nasceu na competência exibida.
    expect(dueLabel(originadoEmMarco, MARCO, HOJE)).toContain('Pendente')
  })

  it('item 21: a virada do ano classifica cada parcela individualmente', () => {
    const parcelas = [
      { due: '2025-12-14', esperado: 'overdue' },
      { due: '2026-01-14', esperado: 'overdue' },
      { due: '2026-02-14', esperado: 'overdue' },
      { due: '2026-03-14', esperado: 'pending' },
    ] as const

    for (const parcela of parcelas) {
      const ref = {
        year: Number(parcela.due.slice(0, 4)),
        month: Number(parcela.due.slice(5, 7)),
      }
      expect(dueStateOf(item(parcela.due, ref), MARCO, HOJE)).toBe(
        parcela.esperado,
      )
    }
  })

  it('dezembro de 2025 não é tratado como dezembro de 2026', () => {
    const dez2025 = item('2025-12-14', { year: 2025, month: 12 })
    const dez2026 = item('2026-12-14', { year: 2026, month: 12 })

    expect(dueStateOf(dez2025, MARCO, HOJE)).toBe('overdue')
    expect(dueStateOf(dez2026, MARCO, HOJE)).toBe('pending')
    expect(dueLabel(dez2025, MARCO, HOJE)).toContain('2025')
  })

  it('item 23: o ano só aparece quando difere da competência', () => {
    const mesmoAno = item('2026-03-14', { year: 2026, month: 3 })
    const outroAno = item('2025-10-14', { year: 2025, month: 10 })

    // Forma compacta onde não há ambiguidade.
    expect(dueLabel(mesmoAno, MARCO, HOJE)).toContain('14/03')
    expect(dueLabel(mesmoAno, MARCO, HOJE)).not.toContain('14/03/2026')

    expect(dueLabel(outroAno, MARCO, HOJE)).toContain('14/10/2025')
  })

  it('item 17: a ordenação é cronológica através dos anos', () => {
    const lista = [
      item('2026-03-14', { year: 2026, month: 3 }),
      item('2025-10-14', { year: 2025, month: 10 }),
      item('2025-09-14', { year: 2025, month: 9 }),
      item('2026-01-14', { year: 2026, month: 1 }),
    ]

    const ordenada = openItemsFor(lista, MARCO, HOJE)

    expect(ordenada.map((i) => i.dueDate.slice(0, 10))).toEqual([
      '2025-09-14',
      '2025-10-14',
      '2026-01-14',
      '2026-03-14',
    ])
  })

  it('item 13: parcelas compartilham a origem, cada uma com seu vencimento', () => {
    /*
      Compra parcelada em 14/09/2025: TODAS as parcelas têm o mesmo
      `referenceMonth` (a compra), e vencimentos que avançam mês a mês.
    */
    const origem = { year: 2025, month: 9 }
    const marco = item('2026-03-14', origem)

    // Veio de antes e ainda não venceu → "A vencer", nunca "Em atraso".
    expect(dueStateOf(marco, MARCO, HOJE)).toBe('upcoming')
    const label = dueLabel(marco, MARCO, HOJE)
    expect(label).toContain('A vencer')
    expect(label).toContain('setembro de 2025')
  })
})

describe('Cross-year no Histórico', () => {
  it('item 12/22: arquiva por referenceMonth, com paidAt completo', () => {
    /*
      referenceMonth agosto/2025, recebido em outubro/2025: pertence à
      prateleira de agosto, e a data de resolução sai com o ano.
    */
    const label = resolvedLabel(
      {
        dueDate: '2025-08-14',
        paidAt: '2025-10-17',
        referenceMonth: { year: 2025, month: 8 },
      },
      'receivable',
    )

    expect(label).toContain('17/10/2025')
  })

  it('vencimento em outro ano mantém os dois contextos', () => {
    const label = resolvedLabel(
      {
        dueDate: '2025-12-10',
        paidAt: '2026-03-15',
        referenceMonth: { year: 2025, month: 8 },
      },
      'debt',
    )

    expect(label).toContain('10/12/2025')
    expect(label).toContain('15/03/2026')
  })
})

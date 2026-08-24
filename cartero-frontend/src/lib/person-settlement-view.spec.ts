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
 * A competência canônica é UMA: o mês do VENCIMENTO.
 *
 * O caso central: um jantar comprado em 16/08 que vence em 10/09 pertence ao
 * acerto de SETEMBRO. Antes ele aparecia nos dois meses — em agosto pela
 * origem, em setembro pelo vencimento —, e a mesma obrigação parecia
 * pertencer a duas competências.
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

describe('Universo da competência — só o vencimento', () => {
  const HOJE_AGOSTO = '2026-08-24'
  const HOJE_SETEMBRO = '2026-09-05'

  it('item 39: agosto NÃO mostra o jantar — a compra não decide', () => {
    expect(belongsToCompetence(JANTAR, AGOSTO, HOJE_AGOSTO)).toBe(false)
  })

  it('item 39: setembro mostra, porque é lá que vence', () => {
    expect(belongsToCompetence(JANTAR, SETEMBRO, HOJE_AGOSTO)).toBe(true)
  })

  it('item 9: vencimento futuro do mês selecionado aparece', () => {
    // Navegar para setembro em 24/08 mostra o que vence lá.
    expect(belongsToCompetence(JANTAR, SETEMBRO, HOJE_AGOSTO)).toBe(true)
  })

  it('outubro mostra como carry se já vencido e aberto', () => {
    expect(belongsToCompetence(JANTAR, OUTUBRO, '2026-10-05')).toBe(true)
  })

  it('item resolvido sai do universo aberto', () => {
    const pago = item({
      dueDate: '2026-09-10',
      reference: AGOSTO,
      isPaid: true,
    })
    expect(belongsToCompetence(pago, SETEMBRO, HOJE_SETEMBRO)).toBe(false)
  })

  it('item 44: NÃO projeta carry futuro', () => {
    /*
      Hoje 24/08, vence 30/08, olhando setembro: ainda está no prazo. Marcá-la
      como carry afirmaria um atraso que não aconteceu.
    */
    const fimDeAgosto = item({ dueDate: '2026-08-30' })

    expect(belongsToCompetence(fimDeAgosto, SETEMBRO, '2026-08-24')).toBe(false)
    expect(belongsToCompetence(fimDeAgosto, SETEMBRO, '2026-09-01')).toBe(true)
  })

  it('item 43: atraso antigo continua visível', () => {
    const junho = item({ dueDate: '2026-06-15' })
    expect(belongsToCompetence(junho, SETEMBRO, HOJE_SETEMBRO)).toBe(true)
  })

  it('cada item devolve um booleano — nunca duas linhas', () => {
    expect(belongsToCompetence(JANTAR, SETEMBRO, HOJE_SETEMBRO)).toBe(true)
  })
})

describe('Estado e microcopy — sem "referente a"', () => {
  it('antes do vencimento: Pendente', () => {
    expect(dueStateOf(JANTAR, SETEMBRO, '2026-09-05')).toBe('pending')
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-05')).toBe(
      'Pendente · vence em 10/09',
    )
  })

  it('no dia: vence hoje, não em atraso', () => {
    expect(dueStateOf(JANTAR, SETEMBRO, '2026-09-10')).toBe('dueToday')
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-10')).toBe(
      'Pendente · vence hoje',
    )
  })

  it('depois: em atraso', () => {
    expect(dueStateOf(JANTAR, SETEMBRO, '2026-09-11')).toBe('overdue')
    expect(dueLabel(JANTAR, SETEMBRO, '2026-09-11')).toBe(
      'Em atraso · venceu em 10/09',
    )
  })

  it('a origem não aparece mais no status', () => {
    /*
      "A vencer · referente a agosto" sugeria que o item pertencia a outro mês.
      A origem virou metadado ("No cartão"), fora do status temporal.
    */
    const label = dueLabel(JANTAR, SETEMBRO, '2026-09-05')
    expect(label).not.toContain('referente a')
    expect(label).not.toContain('A vencer')
  })

  it('o estado não depende da competência exibida', () => {
    const hoje = '2026-09-05'
    expect(dueStateOf(JANTAR, AGOSTO, hoje)).toBe(
      dueStateOf(JANTAR, SETEMBRO, hoje),
    )
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

  it('destaca o que VENCEU em competências anteriores', () => {
    /*
      Carry é vencimento anterior, não origem anterior. O jantar nasceu em
      agosto mas vence em setembro — é item do próprio mês, não pendência
      trazida de antes.
    */
    const carry = item({ dueDate: '2026-07-20', amount: 100 })
    const s = summarizeCompetence([JANTAR, carry], [], SETEMBRO, '2026-09-05')

    expect(s.carriedReceivable).toBe(100)
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
   * O histórico é arquivado por `dueMonth`, não pelo mês de `paidAt`.
   * Por isso a data real da resolução precisa estar na linha: sem ela, uma
   * dívida de julho paga em setembro ficaria no mês certo sem dizer quando
   * foi quitada.
   */
  it('mesma competência: diz quando foi pago', () => {
    const debt = {
      dueDate: '2026-07-20',
      paidAt: '2026-07-25',
      dueMonth: { year: 2026, month: 7 },
    }
    expect(resolvedLabel(debt, 'debt')).toBe('Pago em 25/07/2026')
  })

  it('recebível usa o verbo próprio', () => {
    const receivable = {
      dueDate: '2026-08-10',
      paidAt: '2026-08-12',
      dueMonth: { year: 2026, month: 8 },
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
      dueMonth: { year: 2026, month: 8 },
    }
    const label = resolvedLabel(automatico, 'receivable')

    expect(label).toContain('Venceu em 10/09')
    expect(label).toContain('recebido em 15/10')
  })

  it('sem paidAt (legado), não inventa data', () => {
    const semData = {
      dueDate: '2026-07-20',
      paidAt: null,
      dueMonth: { year: 2026, month: 7 },
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
      dueMonth: { year: 2026, month: 5 },
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

    expect(belongsToCompetence(carry, MARCO, HOJE)).toBe(true)
    expect(dueStateOf(carry, MARCO, HOJE)).toBe('overdue')

    const label = dueLabel(carry, MARCO, HOJE)
    expect(label).toContain('Em atraso')
    // O ano deixa imediatamente claro por que "outubro" aparece em março.
    expect(label).toContain('14/10/2025')
  })

  it('item 19: outubro do MESMO ano, futuro, não entra na competência', () => {
    const futuro = item('2026-10-14', { year: 2026, month: 10 })

    expect(belongsToCompetence(futuro, MARCO, HOJE)).toBe(false)
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

  it('item 40: origem na competência NÃO traz o item de volta', () => {
    /*
      Cobrança comprada em março, vencendo em outubro: pertence a OUTUBRO.
      Antes a origem a puxava para março, e ela aparecia nos dois meses.
    */
    const compradoEmMarco = item('2026-10-14', { year: 2026, month: 3 })

    expect(belongsToCompetence(compradoEmMarco, MARCO, HOJE)).toBe(false)
    expect(
      belongsToCompetence(compradoEmMarco, { year: 2026, month: 10 }, HOJE),
    ).toBe(true)
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

  it('item 13: cada parcela pertence ao mês do SEU vencimento', () => {
    /*
      Compra parcelada em 14/09/2025: todas as parcelas compartilham a origem,
      mas cada uma vence num mês diferente — e é o vencimento que decide onde
      ela aparece. A origem comum não as agrupa mais em setembro/2025.
    */
    const origem = { year: 2025, month: 9 }
    const marco = item('2026-03-14', origem)

    expect(belongsToCompetence(marco, MARCO, HOJE)).toBe(true)
    expect(dueStateOf(marco, MARCO, HOJE)).toBe('pending')

    const label = dueLabel(marco, MARCO, HOJE)
    expect(label).toBe('Pendente · vence em 14/03')
    expect(label).not.toContain('setembro')
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
        dueMonth: { year: 2025, month: 8 },
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
        dueMonth: { year: 2025, month: 8 },
      },
      'debt',
    )

    expect(label).toContain('10/12/2025')
    expect(label).toContain('15/03/2026')
  })
})

describe('Escopo do settle segue o universo exibido', () => {
  /**
   * `openItemsFor` define o que a tela mostra E o que o settle alcança — o
   * backend reconsulta com a mesma regra. Um item invisível não pode ser
   * quitado por acidente.
   */
  const SET = { year: 2026, month: 9 }
  const HOJE = '2026-09-10'

  it('item 49: A (setembro) + B (agosto vencido), nunca C (outubro)', () => {
    const a = item({ dueDate: '2026-09-15', amount: 10 })
    const b = item({ dueDate: '2026-08-20', amount: 20 })
    // Comprado em setembro, vence em outubro: pertence a outubro.
    const c = item({ dueDate: '2026-10-14', amount: 30, reference: SET })

    const visiveis = openItemsFor([a, b, c], SET, HOJE)

    expect(visiveis.map((i) => i.amount).sort()).toEqual([10, 20])
    expect(visiveis.some((i) => i.amount === 30)).toBe(false)
  })

  it('item 50: quitação antecipada continua possível', () => {
    /*
      Hoje em agosto, olhando setembro: o item aparece e pode ser quitado.
      O diálogo avisa que ainda não venceu — `notYetDueCount` é o dado.
    */
    const futuro = item({ dueDate: '2026-09-10', amount: 100 })
    const visiveis = openItemsFor([futuro], SET, '2026-08-24')

    expect(visiveis).toHaveLength(1)

    const resumo = summarizeCompetence(visiveis, [], SET, '2026-08-24')
    expect(resumo.notYetDueCount).toBe(1)
  })

  it('carry ainda não vencido não entra no settle do mês seguinte', () => {
    // Hoje 24/08, vence 30/08: não é pendência de setembro ainda.
    const fimDeAgosto = item({ dueDate: '2026-08-30', amount: 55 })

    expect(openItemsFor([fimDeAgosto], SET, '2026-08-24')).toHaveLength(0)
    expect(openItemsFor([fimDeAgosto], SET, '2026-09-01')).toHaveLength(1)
  })
})

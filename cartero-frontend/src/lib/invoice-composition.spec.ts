import { describe, expect, it } from 'vitest'
import { TransactionType } from '@/types'
import type { Transaction } from '@/types'
import {
  filterByCompositionKey,
  invoiceBreakdown,
  invoiceComposition,
  invoiceSectionParts,
  summarizeInvoiceSection,
  THIRD_PARTY_BUCKET,
  invoiceRowView,
  invoiceRowAriaLabel,
} from './invoice-composition'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Composição da fatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dois defeitos observados em dados reais motivaram estes testes:
 *
 *   1. `R$ NaN sua parte` no cabeçalho — a API serializa `Decimal` como
 *      STRING, e a soma concatenava texto em vez de somar.
 *   2. O gráfico por categoria mostrava "Lazer R$ 336,50", misturando
 *      R$ 96,50 próprios com R$ 240 de um jantar da Mariana — sugerindo que
 *      os R$ 240 eram gasto pessoal de Lazer.
 */

function tx(over: {
  id: string
  amount: number | string
  categoryId?: string
  categoryName?: string
  personId?: string
  isRefund?: boolean
  type?: TransactionType
  title?: string
}): Transaction {
  return {
    id: over.id,
    userId: 'u1',
    bankId: 'b1',
    categoryId: over.categoryId ?? 'c1',
    type: over.type ?? TransactionType.CREDIT_CARD,
    title: over.title ?? over.id,
    amount: over.amount as number,
    date: '2026-08-15',
    personId: over.personId,
    isRefund: over.isRefund,
    category: over.categoryId
      ? { id: over.categoryId, name: over.categoryName ?? over.categoryId }
      : undefined,
    createdAt: '',
    updatedAt: '',
  } as unknown as Transaction
}

/** O cenário real observado: fatura de setembro/2026. */
const FATURA_REAL = [
  tx({ id: 'mercado', amount: '430.75', categoryId: 'alim', categoryName: 'Alimentação' }),
  tx({ id: 'lazer', amount: '96.5', categoryId: 'lazer', categoryName: 'Lazer' }),
  tx({ id: 'notebook', amount: '320', categoryId: 'elet', categoryName: 'Eletrônicos' }),
  tx({
    id: 'jantar',
    amount: '240',
    categoryId: 'lazer',
    categoryName: 'Lazer',
    personId: 'mariana',
    title: 'Jantar dividido',
  }),
  tx({ id: 'netflix', amount: '44.9', categoryId: 'assin', categoryName: 'Assinatura' }),
  tx({ id: 'spotify', amount: '21.9', categoryId: 'assin', categoryName: 'Assinatura' }),
  tx({ id: 'prime', amount: '19.9', categoryId: 'assin', categoryName: 'Assinatura' }),
]

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

describe('Breakdown do cabeçalho', () => {
  it('valores em STRING não produzem NaN', () => {
    /**
     * O bug exato: `Decimal` vira string no JSON, e `0 + "430.75" + "96.5"`
     * concatenava para `"0430.7596.5"`, chegando em `formatCurrency` como NaN.
     */
    const b = invoiceBreakdown('1173.95', FATURA_REAL)

    expect(Number.isNaN(b.own)).toBe(false)
    expect(Number.isNaN(b.others)).toBe(false)
    expect(b.own).toBeCloseTo(933.95, 2)
    expect(b.others).toBeCloseTo(240, 2)
  })

  it('gross = own + others', () => {
    const b = invoiceBreakdown(1173.95, FATURA_REAL)

    expect(b.own + b.others).toBeCloseTo(b.gross, 2)
  })

  it('fatura sem terceiros: others = 0 e own = gross', () => {
    const b = invoiceBreakdown(500, [
      tx({ id: 'a', amount: 500, categoryId: 'alim' }),
    ])

    expect(b.others).toBe(0)
    expect(b.own).toBe(500)
  })

  it('fatura 100% de terceiros: own = 0, nunca NaN', () => {
    // Caso defensivo do item 13.
    const b = invoiceBreakdown(500, [
      tx({ id: 'a', amount: 500, personId: 'eva' }),
    ])

    expect(b.others).toBe(500)
    expect(b.own).toBe(0)
    expect(Number.isNaN(b.own)).toBe(false)
  })

  it('estorno de terceiro legado ABATE, não aumenta', () => {
    /**
     * Combinação bloqueada para novas operações, mas possível em legado. Se o
     * estorno somasse, "de outras pessoas" cresceria e "sua parte" cairia — o
     * inverso do correto.
     */
    const b = invoiceBreakdown(700, [
      tx({ id: 'a', amount: 300, personId: 'eva' }),
      tx({ id: 'b', amount: 100, personId: 'eva', isRefund: true }),
    ])

    expect(b.others).toBe(200)
    expect(b.own).toBe(500)
  })

  it('sem transações carregadas, own não é NaN', () => {
    const b = invoiceBreakdown(1000, [])

    expect(b.own).toBe(1000)
    expect(b.others).toBe(0)
  })
})

describe('Composição por bucket', () => {
  const rows = invoiceComposition(FATURA_REAL)

  it('a ordem é por valor decrescente', () => {
    expect(rows.map((r) => r.name)).toEqual([
      'Alimentação',
      'Eletrônicos',
      'De outras pessoas',
      'Lazer',
      'Assinatura',
    ])
  })

  it('os valores são os esperados', () => {
    const byName = new Map(rows.map((r) => [r.name, r.amount]))

    expect(byName.get('Alimentação')).toBeCloseTo(430.75, 2)
    expect(byName.get('Eletrônicos')).toBeCloseTo(320, 2)
    expect(byName.get('De outras pessoas')).toBeCloseTo(240, 2)
    expect(byName.get('Lazer')).toBeCloseTo(96.5, 2)
    expect(byName.get('Assinatura')).toBeCloseTo(86.7, 2)
  })

  it('Lazer contém só os R$ 96,50 PRÓPRIOS', () => {
    /**
     * O defeito visual: Lazer aparecia como R$ 336,50 (96,50 + 240), fazendo o
     * jantar da Mariana parecer gasto pessoal de lazer.
     */
    const lazer = rows.find((r) => r.name === 'Lazer')

    expect(lazer?.amount).toBeCloseTo(96.5, 2)
    expect(lazer?.amount).not.toBeCloseTo(336.5, 2)
  })

  it('a soma das linhas fecha com o total da fatura', () => {
    const soma = rows.reduce((s, r) => s + r.amount, 0)

    expect(soma).toBeCloseTo(1173.95, 2)
  })

  it('o bucket de terceiros é marcado como especial', () => {
    const bucket = rows.find((r) => r.key === THIRD_PARTY_BUCKET)

    expect(bucket?.isThirdParty).toBe(true)
    // Sem cor de Category: o bucket não É uma categoria.
    expect(bucket?.color).toBeNull()
  })

  it('categorias próprias não são marcadas como terceiros', () => {
    for (const row of rows.filter((r) => r.key !== THIRD_PARTY_BUCKET)) {
      expect(row.isThirdParty).toBe(false)
    }
  })

  it('sem terceiros, o bucket não é criado', () => {
    // Item 12: nada de "De outras pessoas R$ 0".
    const semTerceiros = invoiceComposition([
      tx({ id: 'a', amount: 300, categoryId: 'alim', categoryName: 'Alimentação' }),
    ])

    expect(semTerceiros.some((r) => r.key === THIRD_PARTY_BUCKET)).toBe(false)
  })

  it('categoria totalmente estornada sai da composição', () => {
    const comEstorno = invoiceComposition([
      tx({ id: 'a', amount: 100, categoryId: 'lazer', categoryName: 'Lazer' }),
      tx({ id: 'b', amount: 150, categoryId: 'lazer', isRefund: true }),
    ])

    expect(comEstorno).toHaveLength(0)
  })

  it('receita não entra na composição', () => {
    const comIncome = invoiceComposition([
      tx({ id: 'a', amount: 300, categoryId: 'alim', categoryName: 'Alimentação' }),
      tx({ id: 'i', amount: 500, type: TransactionType.INCOME }),
    ])

    expect(comIncome).toHaveLength(1)
    expect(comIncome[0].amount).toBeCloseTo(300, 2)
  })
})

describe('Filtro pela linha da composição', () => {
  it('o bucket de terceiros mostra só quem tem pessoa', () => {
    const filtered = filterByCompositionKey(FATURA_REAL, THIRD_PARTY_BUCKET)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].title).toBe('Jantar dividido')
  })

  it('a linha filtrada preserva a Category REAL', () => {
    /**
     * Item 9: dentro do filtro de terceiros a transação continua sendo Lazer.
     * O bucket é agrupamento visual, não substituição de categoria.
     */
    const filtered = filterByCompositionKey(FATURA_REAL, THIRD_PARTY_BUCKET)

    expect(filtered[0].categoryId).toBe('lazer')
    expect(filtered[0].category?.name).toBe('Lazer')
    expect(filtered[0].personId).toBe('mariana')
  })

  it('categoria própria NÃO inclui a transação de terceiro', () => {
    // Coerência com a composição: o jantar está no outro bucket.
    const filtered = filterByCompositionKey(FATURA_REAL, 'lazer')

    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('lazer')
  })

  it('sem filtro, devolve tudo', () => {
    expect(filterByCompositionKey(FATURA_REAL, null)).toHaveLength(
      FATURA_REAL.length,
    )
  })

  it('o filtro não altera o breakdown', () => {
    // Item 11: filtrar é navegação, não recálculo.
    const antes = invoiceBreakdown(1173.95, FATURA_REAL)
    filterByCompositionKey(FATURA_REAL, THIRD_PARTY_BUCKET)
    const depois = invoiceBreakdown(1173.95, FATURA_REAL)

    expect(depois).toEqual(antes)
  })
})

describe('summarizeInvoiceSection — cabeçalho da seção Faturas', () => {
  /**
   * O cabeçalho passou a expor os três números explicitamente, no lugar de
   * "já descontado R$ X de outras pessoas" — que não dizia se o valor tinha
   * sido somado ou subtraído do número ao lado.
   */
  it('item 11: expõe bruto, sua parte e terceiros', () => {
    const summary = summarizeInvoiceSection({
      totalInvoices: 1325.14,
      netAmount: 886.98,
      totalReimbursable: 438.16,
    })

    expect(summary.own).toBeCloseTo(886.98, 2)
    expect(summary.thirdParty).toBeCloseTo(438.16, 2)
    expect(summary.gross).toBeCloseTo(1325.14, 2)
  })

  it('o bruto fecha com own + terceiros', () => {
    const summary = summarizeInvoiceSection({
      totalInvoices: 1325.14,
      netAmount: 886.98,
      totalReimbursable: 438.16,
    })

    expect(summary.own + summary.thirdParty).toBeCloseTo(summary.gross, 2)
  })

  it('item 7: reconcilia com a soma das faturas listadas', () => {
    /*
      Bradesco 144,55 (87,70 de terceiros) · Mercado Pago 748,95 (350,46) ·
      Santander 245,59 · Porto Seguro 186,05.
    */
    const faturas = [
      { total: 144.55, thirdParty: 87.7 },
      { total: 748.95, thirdParty: 350.46 },
      { total: 245.59, thirdParty: 0 },
      { total: 186.05, thirdParty: 0 },
    ]
    const bruto = faturas.reduce((sum, f) => sum + f.total, 0)
    const terceiros = faturas.reduce((sum, f) => sum + f.thirdParty, 0)

    const summary = summarizeInvoiceSection({
      totalInvoices: bruto,
      netAmount: bruto - terceiros,
      totalReimbursable: terceiros,
    })

    expect(summary.gross).toBeCloseTo(1325.14, 2)
    expect(summary.thirdParty).toBeCloseTo(438.16, 2)
    expect(summary.own).toBeCloseTo(886.98, 2)
  })

  it('item 5: o bruto NÃO é totalToPay', () => {
    /*
      `totalToPay` soma ainda pagamentos diretos, dívidas e pendências
      anteriores. Usar um no lugar do outro afirmaria que o mês custa o
      valor das faturas — e ele custa mais.
    */
    const summary = summarizeInvoiceSection({
      totalInvoices: 1325.14,
      netAmount: 886.98,
      totalReimbursable: 438.16,
    })
    const totalToPay = 1603.95 // faturas + diretos + dívidas

    expect(summary.gross).not.toBe(totalToPay)
    expect(summary.own).not.toBe(totalToPay)
  })
})

describe('invoiceSectionParts', () => {
  it('item 12: sem terceiros, omite o lado zerado', () => {
    const parts = invoiceSectionParts(
      summarizeInvoiceSection({
        totalInvoices: 1000,
        netAmount: 1000,
        totalReimbursable: 0,
      }),
    )

    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('own')
    // Nada de "R$ 0,00 de outras pessoas".
    expect(parts.some((p) => p.kind === 'thirdParty')).toBe(false)
  })

  it('com terceiros, os dois lados aparecem nesta ordem', () => {
    const parts = invoiceSectionParts(
      summarizeInvoiceSection({
        totalInvoices: 1325.14,
        netAmount: 886.98,
        totalReimbursable: 438.16,
      }),
    )

    expect(parts.map((p) => p.kind)).toEqual(['own', 'thirdParty'])
  })

  it('fatura integralmente de terceiros não inventa "sua parte"', () => {
    const parts = invoiceSectionParts(
      summarizeInvoiceSection({
        totalInvoices: 240,
        netAmount: 0,
        totalReimbursable: 240,
      }),
    )

    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('thirdParty')
  })

  it('sem faturas, não há composição', () => {
    const parts = invoiceSectionParts(
      summarizeInvoiceSection({
        totalInvoices: 0,
        netAmount: 0,
        totalReimbursable: 0,
      }),
    )
    expect(parts).toEqual([])
  })
})

describe('invoiceRowView — o bruto em destaque', () => {
  /**
   * O número principal da linha passou a ser o BRUTO, o mesmo que o drawer
   * mostra ao abrir. Antes a linha destacava a sua parte, e R$ 56,85 virava
   * R$ 144,55 ao clicar — os dois corretos, mas obrigando o leitor a
   * reconciliar de cabeça.
   */
  it('item 20: Bradesco expõe os três valores', () => {
    const view = invoiceRowView({
      totalAmount: 144.55,
      ownAmount: 56.85,
      reimbursable: 87.7,
    })

    expect(view.gross).toBeCloseTo(144.55, 2)
    expect(view.own).toBeCloseTo(56.85, 2)
    expect(view.thirdParty).toBeCloseTo(87.7, 2)
    expect(view.showBreakdown).toBe(true)
  })

  it('item 21: Mercado Pago idem', () => {
    const view = invoiceRowView({
      totalAmount: 748.95,
      ownAmount: 398.49,
      reimbursable: 350.46,
    })

    expect(view.gross).toBeCloseTo(748.95, 2)
    expect(view.showBreakdown).toBe(true)
  })

  it('item 22: sem terceiros, nenhuma linha secundária', () => {
    /*
      `own` seria idêntico ao bruto — repetir "Sua parte R$ 245,59" abaixo de
      R$ 245,59 só gastaria altura.
    */
    const view = invoiceRowView({
      totalAmount: 245.59,
      ownAmount: 245.59,
      reimbursable: 0,
    })

    expect(view.gross).toBeCloseTo(245.59, 2)
    expect(view.showBreakdown).toBe(false)
  })

  it('item 23: terceiros ausente é tratado como zero', () => {
    const view = invoiceRowView({ totalAmount: 100, ownAmount: 100 })
    expect(view.thirdParty).toBe(0)
    expect(view.showBreakdown).toBe(false)
  })

  it('deriva `own` quando o backend não envia', () => {
    // Fallback: nada é recalculado a partir de transações.
    const view = invoiceRowView({ totalAmount: 100, reimbursable: 30 })
    expect(view.own).toBe(70)
  })

  it('item 8: gross e own decompõem sem sobra', () => {
    const view = invoiceRowView({
      totalAmount: 144.55,
      ownAmount: 56.85,
      reimbursable: 87.7,
    })
    expect(view.own + view.thirdParty).toBeCloseTo(view.gross, 2)
  })
})

describe('Reconciliação header × linhas', () => {
  /** As quatro faturas do cenário real. */
  const FATURAS = [
    { totalAmount: 144.55, ownAmount: 56.85, reimbursable: 87.7 },
    { totalAmount: 748.95, ownAmount: 398.49, reimbursable: 350.46 },
    { totalAmount: 245.59, ownAmount: 245.59, reimbursable: 0 },
    { totalAmount: 186.05, ownAmount: 186.05, reimbursable: 0 },
  ]

  const views = FATURAS.map(invoiceRowView)
  const soma = (pegar: (v: ReturnType<typeof invoiceRowView>) => number) =>
    views.reduce((total, v) => total + pegar(v), 0)

  it('item 17: a soma dos brutos fecha com "Total das faturas"', () => {
    const header = summarizeInvoiceSection({
      totalInvoices: 1325.14,
      netAmount: 886.98,
      totalReimbursable: 438.16,
    })

    expect(soma((v) => v.gross)).toBeCloseTo(header.gross, 2)
  })

  it('item 18: a soma das partes próprias fecha com "sua parte"', () => {
    expect(soma((v) => v.own)).toBeCloseTo(886.98, 2)
  })

  it('item 19: a soma de terceiros fecha com "de outras pessoas"', () => {
    expect(soma((v) => v.thirdParty)).toBeCloseTo(438.16, 2)
  })

  it('item 9: o bruto NÃO é a contribuição ao totalToPay', () => {
    /*
      Mostrar 144,55 na linha é apresentação. O orçamento continua somando
      apenas 56,85 daquela fatura — confundir os dois inflaria o mês em
      R$ 438,16 de dinheiro que é de outras pessoas.
    */
    const [bradesco] = views
    expect(bradesco.gross).not.toBeCloseTo(bradesco.own, 2)
    expect(soma((v) => v.own)).toBeLessThan(soma((v) => v.gross))
  })
})

describe('invoiceRowAriaLabel', () => {
  it('item 27: com terceiros, comunica os três números', () => {
    const view = invoiceRowView({
      totalAmount: 144.55,
      ownAmount: 56.85,
      reimbursable: 87.7,
    })
    const label = invoiceRowAriaLabel(view, 'Bradesco', brl)

    expect(label).toContain('Bradesco')
    expect(label).toContain('Total')
    expect(label).toContain('Sua parte')
    expect(label).toContain('de outras pessoas')
  })

  it('sem terceiros, só o total', () => {
    const view = invoiceRowView({ totalAmount: 245.59, ownAmount: 245.59 })
    const label = invoiceRowAriaLabel(view, 'Santander', brl)

    expect(label).toContain('Total')
    expect(label).not.toContain('Sua parte')
  })
})

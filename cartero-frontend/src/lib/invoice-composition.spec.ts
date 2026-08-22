import { describe, expect, it } from 'vitest'
import { TransactionType } from '@/types'
import type { Transaction } from '@/types'
import {
  filterByCompositionKey,
  invoiceBreakdown,
  invoiceComposition,
  THIRD_PARTY_BUCKET,
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

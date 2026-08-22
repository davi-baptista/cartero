import { describe, expect, it } from 'vitest'
import { TransactionType } from '@/types'
import {
  breakdownExpenses,
  expenseSignedAmount,
  isIncomeTransaction,
  isOwnExpense,
  isThirdPartyExpense,
  sumIncome,
} from './money-semantics'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Vocabulário financeiro central (Fase 10)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Estas funções decidem, em toda a interface, qual número responde a qual
 * pergunta. Uma compra de R$ 300 feita para a Eva é simultaneamente
 * R$ 300 movimentado, R$ 0 de gasto do usuário e R$ 300 a receber — e o erro
 * histórico foi apresentá-los como equivalentes.
 *
 * Até a Fase 10 este módulo era validado só por probes. Os cenários abaixo são
 * os mesmos, agora executáveis.
 */

/** Lançamento mínimo, com os campos que a classificação consulta. */
function tx(overrides: {
  type?: TransactionType
  amount: number
  personId?: string
  isRefund?: boolean
}) {
  return {
    type: overrides.type ?? TransactionType.PIX,
    amount: overrides.amount,
    personId: overrides.personId,
    isRefund: overrides.isRefund,
  }
}

describe('Classificação de um lançamento', () => {
  it('gasto próprio é own, não third-party', () => {
    const own = tx({ amount: 100 })

    expect(isOwnExpense(own)).toBe(true)
    expect(isThirdPartyExpense(own)).toBe(false)
  })

  it('gasto com pessoa é third-party, não own', () => {
    const others = tx({
      type: TransactionType.CREDIT_CARD,
      amount: 300,
      personId: 'eva',
    })

    expect(isThirdPartyExpense(others)).toBe(true)
    expect(isOwnExpense(others)).toBe(false)
  })

  it('receita não é gasto de nenhum tipo', () => {
    const income = tx({ type: TransactionType.INCOME, amount: 1000 })

    expect(isIncomeTransaction(income)).toBe(true)
    expect(isOwnExpense(income)).toBe(false)
    expect(isThirdPartyExpense(income)).toBe(false)
  })

  it('estorno não é receita', () => {
    /**
     * A regra que impede inflar receitas e gastos ao mesmo tempo. Um estorno
     * devolve dinheiro de uma compra: ele ABATE a saída, não cria entrada.
     */
    const refund = tx({ amount: 50, isRefund: true })

    expect(isIncomeTransaction(refund)).toBe(false)
    expect(isOwnExpense(refund)).toBe(false)
  })
})

describe('Efeito sobre um total de gastos', () => {
  it('gasto entra positivo', () => {
    expect(expenseSignedAmount(tx({ amount: 100 }))).toBe(100)
  })

  it('estorno entra negativo', () => {
    expect(expenseSignedAmount(tx({ amount: 50, isRefund: true }))).toBe(-50)
  })

  it('receita não afeta o total de gastos', () => {
    expect(
      expenseSignedAmount(tx({ type: TransactionType.INCOME, amount: 1000 })),
    ).toBe(0)
  })
})

describe('As três leituras de um conjunto', () => {
  /**
   * O cenário canônico: receita 1000, gasto próprio 600, compra de Eva 300,
   * estorno próprio 100.
   */
  const conjunto = [
    tx({ type: TransactionType.INCOME, amount: 1000 }),
    tx({ amount: 600 }),
    tx({ type: TransactionType.CREDIT_CARD, amount: 300, personId: 'eva' }),
    tx({ amount: 100, isRefund: true }),
  ]

  it('sua parte é 500 — o estorno abate', () => {
    expect(breakdownExpenses(conjunto).suaParte).toBe(500)
  })

  it('de outras pessoas é 300', () => {
    expect(breakdownExpenses(conjunto).deOutrasPessoas).toBe(300)
  })

  it('movimentado é a soma das duas leituras', () => {
    const b = breakdownExpenses(conjunto)

    expect(b.movimentado).toBe(800)
    expect(b.movimentado).toBe(b.suaParte + b.deOutrasPessoas)
  })

  it('receitas somam 1000, sem o estorno', () => {
    // 100 de estorno não pode aparecer aqui: senão receita e gasto inflariam
    // juntos e o saldo continuaria "certo" por acidente.
    expect(sumIncome(conjunto)).toBe(1000)
  })

  it('o estorno de terceiro abate a leitura de terceiros', () => {
    /**
     * Combinação bloqueada para novas operações
     * (`REFUND_PERSON_NOT_SUPPORTED`), mas que pode existir em legado. O
     * tratamento é defensivo: abate de onde o gasto entrou, sem crashar.
     */
    const legado = [
      tx({ type: TransactionType.CREDIT_CARD, amount: 300, personId: 'eva' }),
      tx({
        type: TransactionType.CREDIT_CARD,
        amount: 100,
        personId: 'eva',
        isRefund: true,
      }),
    ]

    const b = breakdownExpenses(legado)
    expect(b.deOutrasPessoas).toBe(200)
    expect(b.suaParte).toBe(0)
  })
})

describe('Reconciliação de categorias', () => {
  /**
   * O defeito corrigido na Fase 9C.
   *
   * A agregação descartava categorias com saldo negativo (`amount > 0`), e a
   * soma das linhas exibidas deixava de fechar com o gasto próprio: a tela
   * mostrava R$ 200 enquanto o gasto real era R$ 150. Sumir com a linha
   * escondia justamente o fato interessante — o estorno passou do gasto.
   *
   * Replica a agregação da Visão Geral para provar a invariante.
   */
  function aggregate(
    transactions: ReturnType<typeof tx>[],
    categoryOf: (index: number) => string,
  ) {
    const grouped = new Map<string, number>()

    transactions.forEach((transaction, index) => {
      if (transaction.personId) return
      const signed = expenseSignedAmount(transaction)
      if (signed === 0) return
      const key = categoryOf(index)
      grouped.set(key, (grouped.get(key) ?? 0) + signed)
    })

    const entries = [...grouped.entries()].filter(([, value]) => value !== 0)
    const positiveTotal = entries.reduce(
      (sum, [, value]) => (value > 0 ? sum + value : sum),
      0,
    )

    return {
      rows: entries.map(([id, amount]) => ({
        id,
        amount,
        pct: amount > 0 && positiveTotal > 0 ? (amount / positiveTotal) * 100 : 0,
      })),
      total: entries.reduce((sum, [, value]) => sum + value, 0),
    }
  }

  const cenario = [
    tx({ amount: 300 }), // Restaurantes
    tx({ amount: 350, isRefund: true }), // Restaurantes — estorno maior
    tx({ amount: 200 }), // Mercado
  ]
  const categorias = ['rest', 'rest', 'mercado']

  it('Restaurantes fica -50 e permanece na lista', () => {
    const { rows } = aggregate(cenario, (i) => categorias[i])
    const rest = rows.find((row) => row.id === 'rest')

    expect(rest?.amount).toBe(-50)
  })

  it('Mercado fica 200', () => {
    const { rows } = aggregate(cenario, (i) => categorias[i])

    expect(rows.find((row) => row.id === 'mercado')?.amount).toBe(200)
  })

  it('a soma das categorias fecha com o gasto próprio', () => {
    const { total } = aggregate(cenario, (i) => categorias[i])
    const { suaParte } = breakdownExpenses(cenario)

    expect(total).toBe(150)
    expect(total).toBe(suaParte)
  })

  it('percentuais nunca produzem NaN ou Infinity', () => {
    const { rows } = aggregate(cenario, (i) => categorias[i])

    for (const row of rows) {
      expect(Number.isFinite(row.pct)).toBe(true)
      expect(row.pct).toBeGreaterThanOrEqual(0)
    }
  })

  it('sem gasto nenhum, não há divisão por zero', () => {
    const { rows, total } = aggregate(
      [tx({ type: TransactionType.INCOME, amount: 500 })],
      () => 'i',
    )

    expect(rows).toHaveLength(0)
    expect(total).toBe(0)
  })

  it('compra de terceiro não entra em nenhuma categoria', () => {
    const comTerceiro = [
      tx({ amount: 700 }),
      tx({ type: TransactionType.CREDIT_CARD, amount: 300, personId: 'eva' }),
    ]

    const { total } = aggregate(comTerceiro, (i) => (i === 0 ? 'a' : 'b'))

    // Nunca 1000 (bruto) nem 400 (bruto menos recebível).
    expect(total).toBe(700)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O Extrato é histórico, não competência
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "Histórico do que aconteceu, na data em que aconteceu." A pergunta "quanto
 * sai do bolso neste mês" é do Orçamento — manter as duas na mesma tela
 * convidava a somar universos diferentes.
 *
 * O caso que decidiu a remoção dos cards: uma compra de R$ 122,90 em 5x
 * aparece no Extrato como R$ 122,90 na data em que aconteceu, o que é correto
 * para o histórico. Mas sob um card chamado "Gastos" ela afirmava um
 * desembolso de R$ 122,90 na competência, quando a fatura cobra R$ 24,58 por
 * mês. O número estava certo; o rótulo é que mentia.
 *
 * A suíte não tem DOM, então o alvo aqui é a COMPOSIÇÃO da página.
 */

const PAGE = readFileSync(
  new URL('../app/(dashboard)/transactions/page.tsx', import.meta.url),
  'utf-8',
)

describe('item 1: os três cards saíram', () => {
  it('nenhum rótulo de card agregado permanece', () => {
    /*
      Busca pelos rótulos EXATOS dos cards. "Receita" sozinho continua
      existindo — é o nome do filtro por tipo, que permanece.
    */
    expect(PAGE).not.toContain('>Receitas<')
    expect(PAGE).not.toContain('>Gastos<')
    expect(PAGE).not.toContain('>Saldo<')
  })

  it('o agregado que os alimentava não é mais calculado', () => {
    // `summary` virou código morto ao perder os três consumidores.
    expect(PAGE).not.toContain('const summary = useMemo')
    expect(PAGE).not.toContain('sumIncome')
    expect(PAGE).not.toContain('breakdownExpenses')
  })

  it('item 1: nada foi criado no lugar', () => {
    // Sem "movimentação total", "resumo do período" ou mini-dashboard.
    for (const substituto of [
      'Movimentação',
      'Resumo do período',
      'Saldo líquido',
      'Total do período',
    ]) {
      expect(PAGE).not.toContain(substituto)
    }
  })
})

describe('itens 3, 5 e 6: o resto da tela permanece', () => {
  it('os filtros por tipo continuam, inclusive Receita', () => {
    /*
      Só o card agregado saiu — receitas continuam na lista e no filtro.
    */
    expect(PAGE).toContain('typeFilterValues')
    expect(PAGE).toContain("{ label: 'Todos', value: undefined }")
  })

  it('banco, categoria e busca continuam', () => {
    expect(PAGE).toContain('bankId')
    expect(PAGE).toContain('categoryId')
    expect(PAGE).toContain('search')
  })

  it('a lista de transações continua sendo renderizada', () => {
    expect(PAGE).toContain('{/* Transaction list */}')
    expect(PAGE).toContain('RowSkeleton')
  })

  it('item 4: o parcelamento não foi tocado', () => {
    // Agrupamento e expansão de parcelas seguem como estavam.
    expect(PAGE).toContain('parentId')
  })

  it('os estados de erro e vazio continuam distintos', () => {
    // Falha de API não pode virar "Nenhuma transação".
    expect(PAGE).toContain('QueryError')
  })
})

describe('item 7: a transição para a lista é limpa', () => {
  it('a lista abre com o divisor, sem espaço órfão', () => {
    /*
      Os cards ficavam entre os filtros e a lista. Sem eles, o `gap-6` do
      container leva direto ao `border-t` — nenhum vazio a preencher.
    */
    const trecho = PAGE.slice(
      PAGE.indexOf('{/* Transaction list */}'),
      PAGE.indexOf('{/* Transaction list */}') + 120,
    )
    expect(trecho).toContain('border-t border-border')
  })
})

describe('item 10: a temporalidade do Extrato não mudou', () => {
  it('não adota competência de acerto nem de pagamento', () => {
    /*
      Cada tela mantém a sua; aqui é `Transaction.date`.

      `invoicePeriod` continua existindo e é legítimo: é o parâmetro de URL
      que a Visão Geral usa para o drill-through por categoria, um recorte
      OPCIONAL pedido pelo chamador — não a competência padrão da tela.
    */
    expect(PAGE).not.toContain('paidAtMonth')
    expect(PAGE).not.toContain('dueMonth')
  })
})

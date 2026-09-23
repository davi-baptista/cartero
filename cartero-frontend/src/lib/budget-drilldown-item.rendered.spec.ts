import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BudgetDrilldownItemRow } from '@/components/budget-drilldown-item'
import { BudgetV2DrilldownBucket, type BudgetV2DrilldownItem } from '@/types/budget-v2-drilldown'

function renderTransaction(overrides: Partial<Extract<BudgetV2DrilldownItem, { kind: 'TRANSACTION' }>> = {}) {
  const item: Extract<BudgetV2DrilldownItem, { kind: 'TRANSACTION' }> = {
    kind: 'TRANSACTION' as const,
    id: 'tx-1',
    amount: '10.00',
    eventDate: '2026-09-22T12:00:00.000Z',
    title: 'teste',
    description: null,
    categoryName: 'Alimentação',
    bankName: '__system_receivables__',
    paymentType: 'PIX',
    ...overrides,
  }

  return renderToStaticMarkup(
    createElement(BudgetDrilldownItemRow, {
      bucket: BudgetV2DrilldownBucket.DIRECT_EXPENSES,
      item,
      timeZone: 'America/Sao_Paulo',
    }),
  )
}

describe('BudgetDrilldownItem rendered metadata', () => {
  it('renders human metadata and hides an internal field', () => {
    const html = renderTransaction()

    expect(html).toContain('Alimentação')
    expect(html).toContain('PIX')
    expect(html).toContain('22/09/2026')
    expect(html).not.toContain('__system_receivables__')
    expect(html).not.toMatch(/·\s*·/)
  })

  it('filters multiple internal or empty fragments without blank separators', () => {
    const html = renderTransaction({
      description: null,
      categoryName: '',
      bankName: '__system_bar',
      paymentType: '',
    })

    expect(html).toContain('22/09/2026')
    expect(html).not.toContain('__system_foo')
    expect(html).not.toContain('__system_bar')
    expect(html).not.toMatch(/·\s*·/)
    expect(html).not.toMatch(/>\s*·/)
    expect(html).not.toMatch(/·\s*</)
  })

  it('omits secondary metadata when all optional values are internal or empty', () => {
    const html = renderToStaticMarkup(
      createElement(BudgetDrilldownItemRow, {
        bucket: BudgetV2DrilldownBucket.PERSON_SETTLEMENT_INFLOW,
        item: {
          kind: 'PERSON_SETTLEMENT',
          id: 'settlement-1',
          amount: '10.00',
          eventDate: '2026-09-22T12:00:00.000Z',
          personName: 'teste',
          direction: 'INFLOW',
          paymentType: '__system_foo',
          bankName: '__system_bar',
        },
        timeZone: 'America/Sao_Paulo',
      }),
    )

    expect(html).toContain('22/09/2026')
    expect(html).not.toContain('__system_foo')
    expect(html).not.toContain('__system_bar')
    expect(html).not.toMatch(/·\s*·/)
  })
})

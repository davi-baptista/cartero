import { describe, expect, it } from 'vitest'
import { peopleMonthSummaryStatus } from './person-period-view'

const balance = (overrides: Partial<Parameters<typeof peopleMonthSummaryStatus>[0][number]> = {}) => ({
  overdueReceivablePending: 0,
  overdueDebtPending: 0,
  receivablePending: 0,
  debtPending: 0,
  settledReceivablesCount: 0,
  settledDebtsCount: 0,
  ...overrides,
})

describe('monthly people summary status', () => {
  it('gives overdue obligations precedence on either side', () => {
    expect(peopleMonthSummaryStatus([balance({ overdueDebtPending: 20, debtPending: 20 })])).toEqual({
      label: 'Há valores em atraso', tone: 'text-destructive',
    })
    expect(peopleMonthSummaryStatus([balance({ overdueReceivablePending: 20, receivablePending: 20 })])?.label).toBe('Há valores em atraso')
  })

  it('keeps bilateral net zero open', () => {
    expect(peopleMonthSummaryStatus([balance({ receivablePending: 100, debtPending: 100 })])?.label).toBe('Há valores em aberto')
  })

  it('marks a period settled only when an obligation was resolved', () => {
    expect(peopleMonthSummaryStatus([balance({ settledDebtsCount: 1 })])).toEqual({
      label: 'Tudo quitado', tone: 'font-medium text-paid',
    })
    expect(peopleMonthSummaryStatus([balance()])).toBeNull()
  })
})

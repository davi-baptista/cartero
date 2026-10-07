import { describe, expect, it } from 'vitest'
import { recurringLegacyDestination } from './recurring-route'

describe('legacy recurring route', () => {
  it('moves the legacy income detail to the receipts tab and preserves its id', () => {
    expect(recurringLegacyDestination('income', { incomeRuleId: 'income-1', month: '2026-10' }))
      .toBe('/recurring?incomeRuleId=income-1&month=2026-10&tab=income')
  })

  it('moves the subscription detail to expenses and preserves the canonical detail id', () => {
    expect(recurringLegacyDestination('expenses', { subscriptionId: 'sub-1', filter: ['a', 'b'] }))
      .toBe('/recurring?subscriptionId=sub-1&filter=a&filter=b&tab=expenses')
  })

  it('drops an old tab value and chooses the legacy route tab', () => {
    expect(recurringLegacyDestination('expenses', { tab: 'income', subscriptionId: 'sub-1' }))
      .toBe('/recurring?subscriptionId=sub-1&tab=expenses')
  })
})

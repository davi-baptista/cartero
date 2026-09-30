import { describe, expect, it } from 'vitest'
import type { Receivable, RecurringIncomeRule } from '@/types'
import { recurringIncomeHistoryOccurrences } from './income-presentation'
import { settledIncomeHistory } from './income-history'

const rule: RecurringIncomeRule = {
  id: 'rule-1', userId: 'u-1', title: 'Salário', amount: 5000, frequency: 'MONTHLY', dayOfMonth: 5,
  firstOccurrence: '2026-01', counterpartyName: 'Empresa', isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

const receivable = (overrides: Partial<Receivable> = {}): Receivable => ({
  id: 'r-1', userId: 'u-1', title: 'Salário', debtorName: 'Empresa', amount: 5000,
  occurredAt: '2026-09-05', dueDate: '2026-09-05', isPaid: false,
  incomeClassification: 'INCOME', recurringIncomeRuleId: 'rule-1',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
})

describe('recurring income history', () => {
  it('keeps received occurrences out of the open list', () => {
    expect(recurringIncomeHistoryOccurrences(rule, [
      receivable({ id: 'open', isPaid: false }),
      receivable({ id: 'paid', isPaid: true, paidAt: '2026-09-05T12:00:00.000Z' }),
    ]).map((item) => item.id)).toEqual(['paid'])
  })

  it('orders by effective receipt date, newest first', () => {
    expect(recurringIncomeHistoryOccurrences(rule, [
      receivable({ id: 'older', isPaid: true, paidAt: '2026-08-05T12:00:00.000Z' }),
      receivable({ id: 'newer', isPaid: true, paidAt: '2026-09-05T12:00:00.000Z' }),
      receivable({ id: 'legacy-b', isPaid: true, paidAt: null, dueDate: '2026-06-05' }),
      receivable({ id: 'legacy-a', isPaid: true, paidAt: null, dueDate: '2026-07-05' }),
    ]).map((item) => item.id)).toEqual(['newer', 'older', 'legacy-a', 'legacy-b'])
  })

  it('applies the same legacy eligibility, copy, and ordering as general Income history', () => {
    const items = [
      receivable({ id: 'dated', isPaid: true, paidAt: '2026-09-05T12:00:00.000Z' }),
      receivable({ id: 'legacy', isPaid: true, paidAt: null }),
    ]
    expect(recurringIncomeHistoryOccurrences(rule, items).map(({ id }) => id))
      .toEqual(settledIncomeHistory(items).map(({ id }) => id))
  })
})

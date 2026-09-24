import { describe, expect, it } from 'vitest'
import { isOneOffIncome, nextOpenIncomeOccurrence, recurringIncomeOccurrences } from './income-presentation'
import type { Receivable, RecurringIncomeRule } from '@/types'

const rule: RecurringIncomeRule = { id: 'rule-1', userId: 'user-1', title: 'Salário', amount: 5000, frequency: 'MONTHLY', dayOfMonth: 5, firstOccurrence: '2026-09', isActive: true, createdAt: '', updatedAt: '' }
const occurrence = (id: string, dueDate: string, isPaid = false): Receivable => ({ id, userId: 'user-1', debtorName: 'Empresa', title: 'Salário', amount: 5000, occurredAt: dueDate, dueDate, isPaid, recurringIncomeRuleId: 'rule-1', createdAt: '', updatedAt: '' })

describe('income presentation helpers', () => {
  it('orders related occurrences using the backend due date', () => {
    const rows = recurringIncomeOccurrences(rule, [occurrence('b', '2026-10-05'), occurrence('a', '2026-09-05')])
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('selects the first open occurrence without calculating a date', () => {
    expect(nextOpenIncomeOccurrence([occurrence('a', '2026-09-05', true), occurrence('b', '2026-10-05')])?.id).toBe('b')
  })

  it('keeps one-off income separate from recurring occurrences', () => {
    expect(isOneOffIncome({ ...occurrence('one-off', '2026-11-12'), recurringIncomeRuleId: null, incomeClassification: 'INCOME' })).toBe(true)
    expect(isOneOffIncome(occurrence('recurring', '2026-11-05'))).toBe(false)
  })
})

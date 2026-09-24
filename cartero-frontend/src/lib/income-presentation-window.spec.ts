import { describe, expect, it } from 'vitest'
import { recurringIncomeOccurrencePresentation } from './income-presentation'
import type { Receivable } from '@/types'

const occurrence = (dueDate: string): Receivable => ({
  id: 'r-1',
  userId: 'u-1',
  title: 'Salário',
  debtorName: 'Empresa',
  amount: 5000,
  occurredAt: dueDate,
  dueDate,
  isPaid: false,
  incomeClassification: 'INCOME',
  recurringIncomeRuleId: 'rule-1',
  createdAt: '',
  updatedAt: '',
})

describe('recurring income fifteen-day presentation', () => {
  it.each([
    ['2026-10-10', 'Próximo: 10/10/2026', 'neutral'],
    ['2026-10-09', 'Receber em 15d', 'attention'],
    ['2026-09-25', 'Receber em 1d', 'attention'],
    ['2026-09-24', 'Receber hoje', 'attention'],
    ['2026-09-23', 'Receber atrasado 1d', 'overdue'],
  ] as const)('classifies due date %s', (dueDate, label, tone) => {
    expect(recurringIncomeOccurrencePresentation(occurrence(dueDate), '2026-09-24')).toEqual({ label, tone })
  })
})

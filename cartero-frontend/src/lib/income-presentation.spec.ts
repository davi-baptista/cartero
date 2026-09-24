import { describe, expect, it } from 'vitest'
import { nextOpenIncomeOccurrenceOnOrAfter, openOneOffIncome, openRecurringIncomeOccurrences } from './income-presentation'
import type { Receivable, RecurringIncomeRule } from '@/types'

const receivable = (overrides: Partial<Receivable> = {}): Receivable => ({
  id: 'r-1',
  userId: 'u-1',
  title: 'Salário',
  debtorName: 'Empresa',
  amount: 5000,
  occurredAt: '2026-09-05',
  dueDate: '2026-09-05',
  isPaid: false,
  paidAt: undefined,
  incomeClassification: 'INCOME',
  recurringIncomeRuleId: 'rule-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const rule: RecurringIncomeRule = {
  id: 'rule-1',
  userId: 'u-1',
  title: 'Salário',
  amount: 5000,
  frequency: 'MONTHLY',
  dayOfMonth: 5,
  firstOccurrence: '2026-01',
  counterpartyName: 'Empresa',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('income presentation', () => {
  it('mantém somente renda pontual aberta', () => {
    expect(openOneOffIncome([
      receivable({ id: 'one-off-open', recurringIncomeRuleId: undefined }),
      receivable({ id: 'one-off-paid', recurringIncomeRuleId: undefined, isPaid: true }),
      receivable({ id: 'other', incomeClassification: 'OTHER', recurringIncomeRuleId: undefined }),
    ]).map((item) => item.id)).toEqual(['one-off-open'])
  })

  it('mantém a fonte e oculta ocorrências recorrentes recebidas', () => {
    expect(openRecurringIncomeOccurrences(rule, [
      receivable({ id: 'open', dueDate: '2026-09-05' }),
      receivable({ id: 'paid', dueDate: '2026-08-05', isPaid: true }),
    ]).map((item) => item.id)).toEqual(['open'])
  })

  it('escolhe a primeira ocorrência aberta de hoje ou futura', () => {
    const selected = nextOpenIncomeOccurrenceOnOrAfter([
      receivable({ id: 'overdue', dueDate: '2026-09-20' }),
      receivable({ id: 'future', dueDate: '2026-10-05' }),
      receivable({ id: 'today', dueDate: '2026-09-24' }),
    ], '2026-09-24')

    expect(selected?.id).toBe('today')
  })

  it('ignora vencidas e retorna vazio quando não há ocorrência futura aberta', () => {
    expect(nextOpenIncomeOccurrenceOnOrAfter([
      receivable({ id: 'overdue', dueDate: '2026-09-20' }),
      receivable({ id: 'paid-future', dueDate: '2026-10-05', isPaid: true }),
    ], '2026-09-24')).toBeUndefined()
  })
})

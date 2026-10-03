import { describe, expect, it } from 'vitest'
import { nextOpenIncomeOccurrenceOnOrAfter, openRecurringIncomeOccurrences, recurringIncomeStatusPresentation, splitRecurringIncomeOpenOccurrences } from './income-presentation'
import type { Receivable, RecurringIncomeRule } from '@/types'

const receivable = (overrides: Partial<Receivable> = {}): Receivable => ({
  id: 'r-1', userId: 'u-1', title: 'Salário', debtorName: 'Empresa', amount: 5000,
  occurredAt: '2026-09-05', dueDate: '2026-09-05', isPaid: false, paidAt: undefined,
  incomeClassification: 'INCOME', recurringIncomeRuleId: 'rule-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
})

const rule: RecurringIncomeRule = {
  id: 'rule-1', userId: 'u-1', title: 'Salário', amount: 5000, frequency: 'MONTHLY', dayOfMonth: 5,
  firstOccurrence: '2026-01', counterpartyName: 'Empresa', isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('income presentation', () => {
  it('mantém a fonte e oculta ocorrências recorrentes recebidas', () => {
    expect(openRecurringIncomeOccurrences(rule, [receivable({ id: 'open' }), receivable({ id: 'paid', isPaid: true })]).map((item) => item.id)).toEqual(['open'])
  })
  it('separates four overdue occurrences, one open occurrence, and excludes received rows', () => {
    const occurrences = [
      receivable({ id: 'overdue-1', dueDate: '2026-06-01' }),
      receivable({ id: 'overdue-2', dueDate: '2026-07-01' }),
      receivable({ id: 'overdue-3', dueDate: '2026-08-01' }),
      receivable({ id: 'overdue-4', dueDate: '2026-09-01' }),
      receivable({ id: 'future', dueDate: '2026-09-25' }),
      receivable({ id: 'paid', isPaid: true, dueDate: '2026-09-10' }),
    ]

    const groups = splitRecurringIncomeOpenOccurrences(occurrences, '2026-09-24')
    expect(groups.overdue.map(({ id }) => id)).toEqual([
      'overdue-1', 'overdue-2', 'overdue-3', 'overdue-4',
    ])
    expect(groups.open.map(({ id }) => id)).toEqual(['future'])
    expect([...groups.overdue, ...groups.open].map(({ id }) => id)).toHaveLength(5)
  })
  it('supports empty overdue and open groups without inventing rows', () => {
    const future = splitRecurringIncomeOpenOccurrences([
      receivable({ id: 'future-1', dueDate: '2026-09-25' }),
      receivable({ id: 'future-2', dueDate: '2026-10-01' }),
    ], '2026-09-24')
    const overdue = splitRecurringIncomeOpenOccurrences([
      receivable({ id: 'late-1', dueDate: '2026-09-01' }),
      receivable({ id: 'late-2', dueDate: '2026-09-02' }),
      receivable({ id: 'late-3', dueDate: '2026-09-03' }),
    ], '2026-09-24')

    expect(future.overdue).toHaveLength(0)
    expect(future.open).toHaveLength(2)
    expect(overdue.overdue).toHaveLength(3)
    expect(overdue.open).toHaveLength(0)
  })
  it('escolhe a primeira ocorrência aberta de hoje ou futura', () => {
    const selected = nextOpenIncomeOccurrenceOnOrAfter([
      receivable({ id: 'overdue', dueDate: '2026-09-20' }),
      receivable({ id: 'future', dueDate: '2026-10-05' }),
      receivable({ id: 'today', dueDate: '2026-09-24' }),
    ], '2026-09-24')
    expect(selected?.id).toBe('today')
  })
  it('ignora vencidas quando procura uma ocorrência futura', () => {
    expect(nextOpenIncomeOccurrenceOnOrAfter([receivable({ dueDate: '2026-09-20' }), receivable({ dueDate: '2026-10-05', isPaid: true })], '2026-09-24')).toBeUndefined()
  })
  it('apresenta atraso quando existe ocorrência aberta vencida', () => {
    expect(recurringIncomeStatusPresentation([receivable({ dueDate: '2026-09-20' }), receivable({ id: 'future', dueDate: '2026-10-05' })], '2026-09-24')).toEqual({ label: 'Recebimento em atraso', tone: 'destructive' })
  })
  it.each([
    ['2026-09-29', { label: 'Recebimento próximo', tone: 'pending' }],
    ['2026-09-30', { label: 'Recebimento próximo', tone: 'pending' }],
    ['2026-10-01', { label: 'Tudo em dia', tone: 'success' }],
  ] as const)('respeita a janela civil de 5 dias para %s', (dueDate, expected) => {
    expect(recurringIncomeStatusPresentation([receivable({ dueDate })], '2026-09-25')).toEqual(expected)
  })
})

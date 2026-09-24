import { describe, expect, it } from 'vitest'
import { recurringIncomeFormState, recurringIncomePayload } from './recurring-income-sheet'
import type { RecurringIncomeRule } from '@/types'

const rule = (overrides: Partial<RecurringIncomeRule> = {}): RecurringIncomeRule => ({
  id: 'rule-1', userId: 'user-1', title: 'Salário', amount: 5000, frequency: 'MONTHLY', dayOfMonth: 5,
  firstOccurrence: '2026-09', counterpartyName: 'Empresa', isActive: true, createdAt: '', updatedAt: '', ...overrides,
})

describe('recurring income edit form state', () => {
  it('starts create mode clean', () => {
    expect(recurringIncomeFormState(null)).toEqual({ title: '', amount: 0, dayOfMonth: 1, firstOccurrence: '', counterpartyName: '' })
  })

  it('prefills edit mode and switches cleanly to another rule', () => {
    expect(recurringIncomeFormState(rule())).toMatchObject({ title: 'Salário', amount: 5000, dayOfMonth: 5, counterpartyName: 'Empresa' })
    expect(recurringIncomeFormState(rule({ id: 'rule-2', title: 'Aluguel', amount: 1800, dayOfMonth: 10, counterpartyName: null }))).toMatchObject({ title: 'Aluguel', amount: 1800, dayOfMonth: 10, counterpartyName: '' })
    expect(recurringIncomeFormState(null).title).toBe('')
  })

  it('does not send firstOccurrence while editing', () => {
    const state = { title: 'Salário', amount: 5700, dayOfMonth: 5, firstOccurrence: '2026-09', counterpartyName: 'Empresa' }
    expect(recurringIncomePayload(state, true)).toEqual({ title: 'Salário', amount: 5700, dayOfMonth: 5, counterpartyName: 'Empresa' })
    expect(recurringIncomePayload(state, false)).toEqual({ ...state })
  })
})

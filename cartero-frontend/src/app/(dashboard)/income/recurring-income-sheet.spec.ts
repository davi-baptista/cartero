import { describe, expect, it } from 'vitest'
import { recurringIncomeCompetence, recurringIncomeFormIsValid, recurringIncomeFormState, recurringIncomePayload, recurringIncomePreviewCopy } from './recurring-income-sheet'
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

  it('combines month and year without applying financial rules in the client', () => {
    expect(recurringIncomeCompetence('09', '2025')).toBe('2025-09')
    expect(recurringIncomeCompetence('02', '2027')).toBe('2027-02')
    expect(recurringIncomeCompetence('', '2027')).toBe('')
  })

  it('blocks creation without a complete Renda desde', () => {
    const state = { title: 'Salário', amount: 5000, dayOfMonth: 5, firstOccurrence: '', counterpartyName: '' }

    expect(recurringIncomeFormIsValid(state, false)).toBe(false)
    expect(recurringIncomeFormIsValid({ ...state, firstOccurrence: '2026-09' }, false)).toBe(true)
  })

  it('describes unit amount, timing counts, and total in the preview', () => {
    const copy = recurringIncomePreviewCopy({ firstOccurrence: '2026-09', horizonDate: '2026-10-23', occurrenceCount: 2, overdueCount: 1, upcomingCount: 1, totalAmount: 10000 }, 5000)
    expect({ ...copy, summary: copy.summary.replace(/\u00a0/g, ' '), total: copy.total.replace(/\u00a0/g, ' ') }).toEqual({
      summary: 'Isso vai criar 2 recebimentos de R$ 5.000,00.',
      timing: '1 estará vencido e 1 será o próximo.',
      total: 'Total esperado: R$ 10.000,00.',
    })
  })
})

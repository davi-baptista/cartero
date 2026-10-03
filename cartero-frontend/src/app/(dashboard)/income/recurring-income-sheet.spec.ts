import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recurringIncomeCompetence, recurringIncomeFormIsValid, recurringIncomeFormState, recurringIncomePayload, recurringIncomePreviewCopy } from './recurring-income-sheet'
import type { RecurringIncomeRule } from '@/types'

const sheetSource = readFileSync(new URL('./recurring-income-sheet.tsx', import.meta.url), 'utf-8')

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

  it('describes occurrence count, due items, current month, next date, and total precisely', () => {
    const preview = {
      firstOccurrence: '2026-03', horizonDate: '2026-11-01', occurrenceCount: 9,
      overdueCount: 8, notOverdueCount: 1, currentMonthCount: 1,
      nextOccurrenceDate: '2026-11-01', totalAmount: 45000,
    }
    const copy = recurringIncomePreviewCopy(preview)
    expect(copy.summary).toBe('Isso vai gerar 9 recebimentos.')
    expect(copy.overdue).toBe('8 j\u00e1 estar\u00e3o vencidos')
    expect(copy.currentMonth).toBe('1 neste m\u00eas')
    expect(copy.nextOccurrence).toBe('Pr\u00f3xima ocorr\u00eancia: 1 de novembro.')
    expect(copy.total.replace(/\u00a0/g, ' ')).toBe('Total esperado: R$ 45.000,00.')
    expect(JSON.stringify(copy)).not.toContain('pr\u00f3ximos')
  })

  it('uses singular copy and omits zero-valued metadata', () => {
    const copy = recurringIncomePreviewCopy({
      firstOccurrence: '2026-10', horizonDate: '2026-10-31', occurrenceCount: 1,
      overdueCount: 0, notOverdueCount: 1, currentMonthCount: 0,
      nextOccurrenceDate: null, totalAmount: 1800,
    })
    expect(copy.summary).toBe('Isso vai gerar 1 recebimento.')
    expect(copy.overdue).toBeNull()
    expect(copy.currentMonth).toBeNull()
    expect(copy.nextOccurrence).toBeNull()
  })

  it('shows loading and recoverable error states and blocks create without a successful preview', () => {
    expect(sheetSource).toContain('previewQuery.isLoading')
    expect(sheetSource).toContain('previewQuery.isError')
    expect(sheetSource).toContain('previewQuery.refetch()')
    expect(sheetSource).toContain('!previewQuery.isSuccess || !previewQuery.data')
    expect(sheetSource).toContain('disabled={!valid || isPending || (!editing')
  })

})

import { describe, expect, it } from 'vitest'
import { personOpenBalanceStatusPresentation } from './person-settlement-view'

const open = (dueDate: string, isPaid = false) => ({ dueDate, isPaid })

describe('person open balance status', () => {
  it('prioritizes overdue values over future soon values', () => {
    expect(personOpenBalanceStatusPresentation([
      open('2026-09-01'),
      open('2026-09-06'),
    ], '2026-09-05')).toEqual({ label: 'Valores vencidos', tone: 'destructive' })
  })

  it.each([
    ['2026-09-05', 'Valores vencendo em breve', 'pending'],
    ['2026-09-10', 'Valores vencendo em breve', 'pending'],
    ['2026-09-11', 'Valores em aberto', 'informational'],
    ['2026-12-31', 'Valores em aberto', 'informational'],
  ] as const)('classifies %s with a five-day civil window', (dueDate, label, tone) => {
    expect(personOpenBalanceStatusPresentation([open(dueDate)], '2026-09-05')).toEqual({ label, tone })
  })

  it('returns no open status when every value is paid', () => {
    expect(personOpenBalanceStatusPresentation([open('2026-09-01', true)], '2026-09-05')).toBeNull()
  })

  it('never presents Tudo em dia for a Person open balance', () => {
    const presentation = personOpenBalanceStatusPresentation([open('2026-09-11')], '2026-09-05')

    expect(presentation?.label).not.toBe('Tudo em dia')
  })
})

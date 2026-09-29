import { describe, expect, it } from 'vitest'
import { dueContext } from './person-settlement-view'

describe('person row temporal copy', () => {
  it('does not repeat the overdue status label', () => {
    const item = {
      dueDate: '2026-09-10',
      isPaid: false,
      referenceMonth: { year: 2026, month: 9 },
      dueMonth: { year: 2026, month: 9 },
    }
    expect(dueContext(item, { year: 2026, month: 9 }, '2026-09-11')).toEqual({
      text: 'Venceu em 10/09',
      tone: 'overdue',
    })
  })
})

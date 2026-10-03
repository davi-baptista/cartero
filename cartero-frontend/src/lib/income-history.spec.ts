import { describe, expect, it } from 'vitest'
import type { Receivable } from '@/types'
import { incomeHistoryReceiptDay, incomeHistoryReceiptLabel, settledIncomeHistory } from './income-history'

const item = (id: string, paidAt: string, overrides: Partial<Receivable> = {}): Receivable => ({
  id, userId: 'user-1', title: id, debtorName: 'Origem', amount: 100,
  occurredAt: '2025-01-01', dueDate: '2025-01-01', isPaid: true,
  paidAt, incomeClassification: 'INCOME', createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z', ...overrides,
})

describe('general income history', () => {
  it('merges recurring and punctual receipts, excludes unsettled/non-income rows, and orders paidAt descending', () => {
    const result = settledIncomeHistory([
      item('recurring', '2026-09-10T10:00:00.000Z', { recurringIncomeRuleId: 'rule-1' }),
      item('punctual', '2026-09-11T10:00:00.000Z'),
      item('legacy-no-date', '', { paidAt: null }),
      item('open', '2026-09-12T10:00:00.000Z', { isPaid: false }),
      item('missing-date', '2026-09-01T00:00:00.000Z', { paidAt: undefined }),
      item('other', '2026-09-13T10:00:00.000Z', { incomeClassification: 'OTHER' }),
    ])
    expect(result.map(({ id }) => id)).toEqual(['punctual', 'recurring', 'legacy-no-date', 'missing-date'])
    expect(incomeHistoryReceiptDay(result[2], 'America/Sao_Paulo')).toBeNull()
    expect(incomeHistoryReceiptLabel(result[2], 'America/Sao_Paulo')).toBe('Data de recebimento não registrada')
  })

  it('uses an ID tie-breaker for equal paidAt values', () => {
    expect(settledIncomeHistory([
      item('tie-b', '2026-09-11T10:00:00.000Z'),
      item('tie-a', '2026-09-11T10:00:00.000Z'),
    ]).map(({ id }) => id)).toEqual(['tie-a', 'tie-b'])
  })
})

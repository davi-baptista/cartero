import { describe, expect, it } from 'vitest'
import type { Receivable } from '@/types'
import { INCOME_HISTORY_PAGE_SIZE, incomeHistoryReceiptDay, incomeHistoryReceiptLabel, paginateIncomeHistory, settledIncomeHistory } from './income-history'

const item = (id: string, paidAt: string, overrides: Partial<Receivable> = {}): Receivable => ({
  id, userId: 'user-1', title: id, debtorName: 'Origem', amount: 100,
  occurredAt: '2025-01-01', dueDate: '2025-01-01', isPaid: true,
  paidAt, incomeClassification: 'INCOME', createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z', ...overrides,
})

const receipts = (count: number, start = 0) => Array.from({ length: count }, (_, index) => {
  const offset = start + index
  return item(`receipt-${String(offset).padStart(2, '0')}`, `2026-09-${String(30 - offset).padStart(2, '0')}T12:00:00.000Z`)
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

describe('income history pagination', () => {
  it('uses a five-item page size', () => {
    expect(INCOME_HISTORY_PAGE_SIZE).toBe(5)
  })

  it('returns no rows and no navigation for an empty history', () => {
    expect(paginateIncomeHistory([], 0)).toEqual({ items: [], page: 0, pageCount: 0, hasPagination: false })
  })

  it('five items stay on one page with no navigation', () => {
    const result = paginateIncomeHistory(receipts(5), 0)
    expect(result.items).toHaveLength(5)
    expect(result.pageCount).toBe(1)
    expect(result.hasPagination).toBe(false)
  })

  it('six items create two pages and Next/Previous navigate correctly', () => {
    const items = receipts(6)
    const first = paginateIncomeHistory(items, 0)
    const second = paginateIncomeHistory(items, first.page + 1)
    const back = paginateIncomeHistory(items, second.page - 1)

    expect(first.items.map(({ id }) => id)).toEqual(items.slice(0, 5).map(({ id }) => id))
    expect(second.items.map(({ id }) => id)).toEqual(items.slice(5, 10).map(({ id }) => id))
    expect(back.items.map(({ id }) => id)).toEqual(first.items.map(({ id }) => id))
    expect(second.pageCount).toBe(2)
    expect(first.hasPagination).toBe(true)
  })

  it('preserves paidAt descending order across page boundaries', () => {
    const items = settledIncomeHistory(receipts(12))
    const first = paginateIncomeHistory(items, 0)
    const second = paginateIncomeHistory(items, 1)
    expect(first.items[0].paidAt! > first.items[4].paidAt!).toBe(true)
    expect(first.items[4].paidAt! > second.items[0].paidAt!).toBe(true)
    expect(second.items[0].id).toBe(items[5].id)
  })

  it('clamps to the last valid page after live reversals remove receipts', () => {
    const items = receipts(11)
    const afterReverse = paginateIncomeHistory(items.slice(0, 9), 2)
    expect(afterReverse.page).toBe(1)
    expect(afterReverse.items).toHaveLength(4)
  })

  it('places a newly received item first and recalculates the current page', () => {
    const before = settledIncomeHistory(receipts(6))
    const after = settledIncomeHistory([...receipts(6), item('new-receipt', '2026-09-30T13:00:00.000Z')])
    expect(paginateIncomeHistory(before, 1).items[0].id).toBe('receipt-05')
    expect(paginateIncomeHistory(after, 0).items[0].id).toBe('new-receipt')
    expect(paginateIncomeHistory(after, 1).items[0].id).toBe('receipt-04')
  })
})

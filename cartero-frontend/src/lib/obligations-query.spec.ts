import { describe, expect, it } from 'vitest'
import {
  apiObligationDomain,
  applyObligationSummaryDelta,
  obligationSummaryDelta,
  obligationsSectionKey,
  obligationsOverdueSummaryKey,
  obligationsSummaryKey,
  parseObligationDomain,
} from './obligations-query'
import type { ObligationRow } from '@/services/obligations.service'

const row: ObligationRow = {
  domain: 'RECEIVABLE',
  id: 'r1',
  title: 'Reembolso',
  amount: '125.50',
  description: null,
  personId: 'p1',
  personName: 'Rafael',
  counterpartyName: 'Rafael',
  dueDate: '2026-10-20',
  isResolved: false,
  resolvedAt: null,
  paymentTransactionId: null,
}

describe('obligations query contracts', () => {
  it('maps URL domains to the API contract and defaults invalid values to all', () => {
    expect(parseObligationDomain('receivable')).toBe('receivable')
    expect(parseObligationDomain('debt')).toBe('debt')
    expect(parseObligationDomain('unknown')).toBe('all')
    expect(apiObligationDomain('all')).toBe('ALL')
    expect(apiObligationDomain('receivable')).toBe('RECEIVABLE')
    expect(apiObligationDomain('debt')).toBe('DEBT')
  })

  it('keeps overdue pagination global across month changes', () => {
    const first = obligationsSectionKey({
      section: 'OVERDUE', domain: 'ALL', search: '', month: 10, year: 2026,
    })
    const nextMonth = obligationsSectionKey({
      section: 'OVERDUE', domain: 'ALL', search: '', month: 11, year: 2026,
    })
    expect(first).toEqual(nextMonth)
  })

  it('keys open and history by period and summary without search', () => {
    expect(obligationsSectionKey({
      section: 'OPEN', domain: 'ALL', search: 'busca', month: 10, year: 2026,
    })).not.toEqual(obligationsSectionKey({
      section: 'OPEN', domain: 'ALL', search: 'busca', month: 11, year: 2026,
    }))
    expect(obligationsSectionKey({
      section: 'HISTORY', domain: 'ALL', search: '', month: 10, year: 2026,
    })).toContain('HISTORY')
    expect(obligationsSummaryKey({
      month: 10, year: 2026, domain: 'ALL', personId: 'p1',
    })).toEqual(['obligations', 'summary', 10, 2026, 'ALL', 'p1'])
  })

  it('keeps overdue totals independent of month, search, and page section state', () => {
    expect(obligationsOverdueSummaryKey({ domain: 'ALL', personId: 'p1' })).toEqual([
      'obligations', 'summary-overdue', 'ALL', 'p1',
    ])
    expect(obligationsOverdueSummaryKey({ domain: 'ALL' })).toEqual(
      obligationsOverdueSummaryKey({ domain: 'ALL', personId: undefined }),
    )
  })

  it('optimistically adjusts only in-period, non-overdue unresolved amounts', () => {
    const delta = obligationSummaryDelta(row, true, { month: 10, year: 2026 }, '2026-10-01')
    expect(delta).toBe('-125.50')
    expect(obligationSummaryDelta(row, true, { month: 11, year: 2026 }, '2026-10-01')).toBe('0')
    expect(obligationSummaryDelta({ ...row, dueDate: '2026-10-01' }, true, { month: 10, year: 2026 }, '2026-10-02')).toBe('0')
    expect(applyObligationSummaryDelta({
      overdue: { receivable: '12.50', debt: '4.00', net: '8.50' },
      open: { receivable: '200.00', debt: '80.00', net: '120.00' },
    }, 'RECEIVABLE', delta)).toEqual({
      overdue: { receivable: '12.50', debt: '4.00', net: '8.50' },
      open: { receivable: '74.50', debt: '80.00', net: '-5.50' },
    })
  })

  it('keeps section totals cursor independent and adjusts exact decimal strings', () => {
    const summary = {
      overdue: { receivable: '0', debt: '0', net: '0' },
      open: { receivable: '20000000000000000.10', debt: '80.00', net: '19999999999999920.10' },
    }
    expect(applyObligationSummaryDelta(summary, 'DEBT', '-0.10').open).toEqual({
      receivable: '20000000000000000.10',
      debt: '79.90',
      net: '19999999999999920.20',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OVERVIEW_DETAIL_PARAMS,
  withOverviewDetailParam,
} from './overview-detail-navigation'

const overview = readFileSync(
  resolve(__dirname, '../app/(dashboard)/overview/page.tsx'),
  'utf8',
)
const details = readFileSync(
  resolve(__dirname, '../components/overview-contextual-details.tsx'),
  'utf8',
)
const agenda = readFileSync(resolve(__dirname, './overview-agenda.ts'), 'utf8')

describe('overview contextual detail URL contract', () => {
  it('keeps only one detail identity and preserves unrelated params', () => {
    const next = withOverviewDetailParam(
      'month=9&year=2026&invoiceId=old&personId=old-person',
      'debtId',
      'debt-1',
    )

    expect([...OVERVIEW_DETAIL_PARAMS].filter((param) => next.has(param))).toEqual(['debtId'])
    expect(next.get('debtId')).toBe('debt-1')
    expect(next.get('month')).toBe('9')
    expect(next.get('year')).toBe('2026')
  })

  it('opens through Overview URL state without domain href navigation', () => {
    expect(overview).toContain('onOpenDetail={detail.open}')
    expect(overview).toContain('onView={detailId ? () => onOpenDetail(detailParam, detailId) : undefined}')
    expect(details).toContain('InvoiceDetailsDrawer')
    expect(details).toContain('PersonStatementDrawer')
    expect(details).toContain('DebtDetailDrawer')
    expect(details).toContain('ReceivableDetailDrawer')
  })

  it('keeps grouped person authority separate from individual entity identity', () => {
    expect(overview).toContain('count > 1 && group.personId')
    expect(overview).toContain("'personId'")
    expect(overview).toContain("'debtId'")
    expect(overview).toContain("'receivableId'")
    expect(overview).toContain("group.kind === 'debt'")
    expect(agenda).toContain('entityId: event.entityId')
  })

  it('preserves the canonical calendar source model', () => {
    expect(agenda).toContain('entityId: invoice.id')
    expect(agenda).toContain('entityId: debt.id')
    expect(agenda).toContain('entityId: receivable.id')
    expect(overview).toContain('selectedGroups.visible.map')
    expect(overview).toContain('attentionGroups.visible')
  })
})

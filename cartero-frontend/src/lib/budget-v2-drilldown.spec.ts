import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const config = read('./budget-drilldown-config.ts')
const service = read('../services/budget.service.ts')
const types = read('../types/budget-v2-drilldown.ts')
const page = read('../app/(dashboard)/budget/page.tsx')
const drawer = read('../components/budget-drilldown-drawer.tsx')
const item = read('../components/budget-drilldown-item.tsx')

const buckets = [
  'MANUAL_INCOME',
  'RECEIVABLE_RECEIPTS',
  'PERSON_SETTLEMENT_INFLOW',
  'DIRECT_EXPENSES',
  'DEBT_DIRECT_SETTLEMENTS',
  'INVOICE_SETTLEMENTS',
  'PERSON_SETTLEMENT_DIRECT_OUTFLOW',
  'UPCOMING_RECEIVABLES',
  'UPCOMING_INVOICES',
  'UPCOMING_DEBTS',
  'OVERDUE_RECEIVABLES',
  'OVERDUE_OUTFLOWS',
]

describe('Budget V2 drilldown contract', () => {
  it('defines all backend buckets and item discriminants', () => {
    for (const bucket of buckets) {
      expect(types).toContain(bucket)
      expect(config).toContain(bucket)
    }
    for (const kind of [
      'TRANSACTION',
      'RECEIVABLE_RECEIPT',
      'PERSON_SETTLEMENT',
      'DEBT_SETTLEMENT',
      'INVOICE_SETTLEMENT',
      'RECEIVABLE',
      'INVOICE',
      'DEBT',
    ]) {
      expect(types).toContain(`kind: '${kind}'`)
      expect(item).toContain(`case '${kind}'`)
    }
  })

  it('uses the drilldown endpoint and sends presets only for realized buckets', () => {
    expect(service).toContain("'/budget/v2/drilldown'")
    expect(service).toContain('isRealizedDrilldownBucket(request.bucket)')
    expect(service).toContain('request.preset')
    expect(config).toContain("scope: 'period'")
    expect(config).toContain("scope: 'upcoming'")
    expect(config).toContain("scope: 'overdue'")
  })

  it('maps only non-zero composition and overdue rows to drawer buckets', () => {
    expect(page).toContain('BudgetDrilldownDrawer')
    expect(page).toContain('onRowClick={onRowClick}')
    expect(page).toContain('cursor-pointer')
    expect(page).toContain('<ChevronRight')
    expect(page).toContain('text-sm text-foreground')
    expect(page).toContain('tabular-nums text-foreground')
    expect(page).toContain('text-sm text-muted-foreground')
    expect(page).toContain('type="button"')
    for (const bucket of buckets) expect(page).toContain(bucket)
    expect(page).not.toContain('onClick={onClick}')
  })

  it('keeps drawer scope, pagination order, canonical totals, and retry states', () => {
    expect(drawer).toContain('useInfiniteQuery')
    expect(drawer).toContain('queryKey: [\'budget-v2-drilldown\', activeBucket, preset]')
    expect(drawer).toContain('pageInfo.nextCursor')
    expect(drawer).toContain('fetchNextPage')
    expect(drawer).toContain('pages.flatMap((page) => page.items)')
    expect(drawer).toContain('firstPage.total')
    expect(drawer).toContain('Tentar novamente')
    expect(drawer).not.toContain('.sort(')
    expect(drawer).not.toContain('.reduce(')
  })

  it('uses date-only-safe display helpers without financial arithmetic', () => {
    expect(item).toContain('accountCivilDayOf')
    expect(item).toContain('formatDate')
    expect(item).toContain('formatMonthOfYear')
    expect(drawer).not.toContain(' + ')
    expect(drawer).not.toContain(' - ')
    expect(item).not.toContain('.sort(')
    expect(item).not.toContain('.reduce(')
    expect(item).toContain("!part.includes('__')")
    expect(item).toContain('text-sm font-medium text-foreground')
    expect(item).toContain('text-xs text-muted-foreground')
    expect(item).toContain('values.join(')
    expect(item).not.toContain('ChevronRight')
  })
})

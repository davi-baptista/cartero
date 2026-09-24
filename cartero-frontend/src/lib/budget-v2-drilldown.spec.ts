import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const config = read('./budget-drilldown-config.ts')
const service = read('../services/budget.service.ts')
const types = read('../types/budget-v2-drilldown.ts')
const page = read('../app/(dashboard)/budget/page.tsx')
const drawer = read('../components/budget-drilldown-drawer.tsx')
const item = read('../components/budget-drilldown-item.tsx')
const avatar = read('../components/ui/financial-avatar.tsx')

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
    expect(drawer).toContain('rounded-xl bg-muted/40 p-4')
    expect(drawer).toContain('text-xs font-medium text-muted-foreground')
    expect(drawer).toContain('text-2xl font-semibold tabular-nums text-foreground')
    expect(drawer).toContain('>Movimentações</h3>')
    expect(drawer).toContain("DRILLDOWN_BUCKET_CONFIG[activeBucket!].scope === 'period'")
    expect(drawer).toContain('mt-2 divide-y divide-border/60 px-5')
    expect(drawer).not.toContain('>Recebimentos</h3>')
  })

  it('uses human invoice copy across the Budget row and drawer', () => {
    expect(config).toContain("title: 'Pagamento de faturas'")
    expect(page).toContain("'Pagamento de faturas'")
    expect(config).not.toContain('Faturas pagas')
    expect(page).not.toContain('Faturas pagas')
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
    expect(item).toContain('FinancialListRow')
    expect(item).toContain('meta={secondary}')
    expect(item).toContain('values.join(')
    expect(item).not.toContain('ChevronRight')
    expect(item).toContain('TRANSACTION_TYPE_LABELS')
    expect(item).toContain('paymentTypeLabel')
    expect(item).toContain('FinancialAvatar')
    expect(item).toContain('TRANSACTION_TYPE_ICONS')
    expect(drawer).toContain('divide-y divide-border/60')
    expect(item).toContain('border-b border-border/70')
    expect(item).not.toContain('rounded-full')
  })

  it('covers shared rows, headings, and canonical quick settlement actions', () => {
    expect(item).toContain('FinancialAvatar')
    expect(item).toContain('quickSettlement')
    expect(item).toContain('Marcar como recebido')
    expect(item).toContain('Marcar como paga')
    expect(drawer).toContain('MarkAsPaidDialog')
    expect(drawer).toContain('updateReceivable')
    expect(drawer).toContain('updateDebt')
    expect(drawer).toContain("invalidateQueries({ queryKey: ['budget-v2-drilldown'] })")
    expect(config).toContain('drilldownSectionHeading')
    expect(config).toContain("return 'Em atraso'")
    expect(config).toContain("return 'A receber'")
    expect(config).toContain("return 'A pagar'")
    expect(avatar).toContain('event.stopPropagation()')
    expect(avatar).toContain('disabled={disabled || loading}')
  })

  it('shares the Extrato transaction icon authority', () => {
    const icons = read('./transaction-icons.ts')
    const transactions = read('../app/(dashboard)/transactions/page.tsx')

    expect(transactions).toContain('TRANSACTION_TYPE_ICONS')
    expect(icons).toContain('[TransactionType.INCOME]: TrendingUp')
    expect(icons).toContain('[TransactionType.CREDIT_CARD]: CreditCard')
    expect(icons).toContain('?? Receipt')
  })
})

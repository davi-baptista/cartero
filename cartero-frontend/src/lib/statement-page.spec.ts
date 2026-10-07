import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url),
  'utf-8',
)
const ROWS = readFileSync(
  new URL('../components/ui/financial-list-row.tsx', import.meta.url),
  'utf-8',
)
const SURFACE = readFileSync(
  new URL('../components/ui/financial-drawer-row-surface.ts', import.meta.url),
  'utf-8',
)
const DRAWER_LIST = readFileSync(
  new URL('../components/ui/drawer-section.tsx', import.meta.url),
  'utf-8',
)
const PERSON_DRAWER = readFileSync(
  new URL('../components/person-statement-drawer.tsx', import.meta.url),
  'utf-8',
)
const SHELL = readFileSync(
  new URL('../app/(dashboard)/movements/movements-shell.tsx', import.meta.url),
  'utf-8',
)
const INCOME = readFileSync(
  new URL('../app/(dashboard)/recurring/income-panel.tsx', import.meta.url),
  'utf-8',
)
const MOTION_ROW = readFileSync(
  new URL('../components/ui/motion-row.tsx', import.meta.url),
  'utf-8',
)

const transactionRow = PAGE.slice(
  PAGE.indexOf('function TransactionRow'),
  PAGE.indexOf('/** Compra parcelada', PAGE.indexOf('function TransactionRow')),
)

describe('global movement statement page contract', () => {
  it('uses cursor pages and keys the query by filters, not cursor or month', () => {
    expect(PAGE).toContain('useInfiniteQuery({')
    expect(PAGE).toContain("queryKey: ['movement-statement', statementFilters]")
    expect(PAGE).toContain('queryFn: ({ pageParam })')
    expect(PAGE).toContain('cursor: pageParam')
    expect(PAGE).toContain('getNextPageParam')
    expect(PAGE).not.toContain('useMonthPeriod')
    expect(PAGE).not.toContain('monthBounds')
  })

  it('keeps accumulated pages visible and exposes explicit next-page retry', () => {
    expect(PAGE).toContain('statementQuery.data?.pages.flatMap')
    expect(PAGE).toContain('statementQuery.isFetchNextPageError')
    expect(PAGE).toContain('void statementQuery.fetchNextPage()')
    expect(PAGE).toContain('Tentar novamente')
  })

  it('preserves shared row authorities, category context, and a single trailing date', () => {
    expect(PAGE).toContain('FinancialListRow')
    expect(PAGE).toContain('ROW_AMOUNT_CLASS')
    expect(PAGE).toContain('ROW_TRAILING_META_CLASS')
    expect(PAGE).toContain('buildStatementMetadataSegments({')
    expect(PAGE).toContain('categoryName: tx.category?.name')
    expect(PAGE).toContain('formatDate(tx.date)')
    expect(PAGE).not.toContain('text-income')
    expect(PAGE).not.toContain('text-expense')
  })

  it('retains the existing detail URL navigation', () => {
    expect(PAGE).toContain("useDetailNavigation('transactionId')")
    expect(PAGE).toContain('detail.open(tx.id)')
    expect(PAGE).toContain('onClose={() => detail.close()}')
  })

  it('keeps receipt icons and both signed amounts neutral', () => {
    expect(transactionRow).toContain('tone="neutral"')
    expect(transactionRow).toContain('text-muted-foreground')
    expect(PAGE).toContain('className={ROW_AMOUNT_CLASS}')
    expect(PAGE).toContain('expense ? `−${formatted}` : `+${formatted}`')
    expect(PAGE).not.toContain('TRANSACTION_INCOME_ICON_COLOR')
    expect(PAGE).not.toContain('TRANSACTION_EXPENSE_ICON_COLOR')
  })

  it('uses the shared metadata typography and has no permanent description row', () => {
    expect(ROWS).toContain('ROW_META_CLASS')
    expect(transactionRow).toContain('meta={<StatementTransactionMeta tx={tx} />}')
    expect(transactionRow).not.toContain('belowMeta=')
    expect(transactionRow).not.toContain('tx.description')
  })

  it('keeps one visible date at the shared trailing slot on desktop and mobile', () => {
    expect(transactionRow).toContain('trailing={')
    expect(transactionRow).toContain('trailingCompact={')
    expect(transactionRow.match(/formatDate\(tx\.date\)/g)).toHaveLength(2)
    expect(transactionRow).not.toContain('formatDate(tx.date)</span>\n          <span')
  })

  it('uses shared page rows without drawer insets and preserves Person drawer geometry', () => {
    expect(PAGE).toContain('<FinancialRowList variant="page">')
    expect(PAGE).toContain('variant="page"')
    expect(PAGE).toContain(
      'M5 row authority: FinancialListRow variant page inside FinancialRowList variant page.',
    )
    expect(PERSON_DRAWER).toContain('<DrawerFinancialList inset>')
    expect(DRAWER_LIST).toContain('<FinancialRowList variant="drawer" inset={inset}>')
    expect(DRAWER_LIST).toContain("'divide-y divide-border/60'")
    expect(DRAWER_LIST).toContain("variant === 'drawer' && inset && DRAWER_WIDE_CONTENT_GUTTER")
    expect(SURFACE).toContain('pageInteractive: cn(')
    expect(SURFACE).toContain("'px-0 py-3.5 text-left outline-none transition-colors hover:bg-muted/30'")
    expect(SURFACE).toContain('sm:gap-4 sm:px-2 sm:py-4')
    expect(SURFACE).toContain('pageWithLeadingAction: cn(')
    expect(SURFACE).toContain("'px-0 py-3.5 transition-colors hover:bg-muted/30 sm:gap-4 sm:px-2 sm:py-4'")
    expect(ROWS).toContain("financialDrawerRowSurfaceClass('interactive')")
    expect(ROWS).toContain("financialDrawerRowSurfaceClass('pageInteractive')")
    expect(PAGE).toContain('separator={false}')
    expect(PAGE).not.toContain('<DrawerFinancialList inset>')
    expect(PAGE).not.toContain('surface="inset"')
    expect(PAGE).not.toContain('insetInteractive')
    expect(PAGE).not.toContain('insetStatic')
    expect(PAGE).not.toContain('border-t border-border')
    expect(PAGE).not.toContain('bg-background/40')
    expect(SURFACE).toContain('rounded-lg')
  })

  it('places the create action in the page header, outside the filter toolbar', () => {
    const filterToolbar = PAGE.slice(
      PAGE.indexOf('{/* Filter bar */}'),
      PAGE.indexOf('{/* Type chips */}'),
    )
    expect(PAGE).not.toContain('Nova transaÃ§Ã£o')
    expect(SHELL).toContain('<MovementsAddFlow />')
    expect(SHELL).toContain('flex min-w-0 items-start justify-between gap-1.5')
    expect(SHELL).toContain('min-w-0 flex-1 space-y-1')
    expect(SHELL).toContain('flex shrink-0 justify-end')
    expect(SHELL).toContain('break-words text-2xl')
    expect(filterToolbar).not.toContain('Nova transação')
    expect(PAGE).not.toContain('flex justify-end">')
  })

  it('keeps the title and metadata truncatable while amount and date stay fixed', () => {
    expect(ROWS).toContain('ROW_TITLE_CLASS')
    expect(ROWS).toContain('flex min-w-0 items-center gap-1.5')
    expect(ROWS).toContain('shrink-0 flex-col items-end gap-1')
    expect(ROWS).toContain("trailingCompact ? 'hidden sm:flex' : 'flex'")
    expect(ROWS).toContain('flex shrink-0 sm:hidden')
    expect(PAGE).toContain('className="flex flex-wrap items-center gap-2"')
  })

  it('keeps one shared shell rhythm while compacting statement toolbar spacing', () => {
    expect(PAGE).toContain('className="flex flex-col gap-4"')
    expect(PAGE).toContain('className="flex flex-col gap-2"')
    expect(PAGE).not.toContain('className="border-t border-border"')
    expect(SHELL).toContain('<section className="space-y-4">')
  })

  it('shows the shared divider between the view switch and either view content', () => {
    expect(SHELL).toContain('className="space-y-2"')
    expect(SHELL).toContain('<div className="pt-1">\n            <div aria-hidden className="border-t border-border/60" />\n          </div>')
    expect(SHELL).toMatch(/<div className="pt-2">\{children\}<\/div>\s*<\/section>/)
  })

  it('keeps page rows full width while padding leading and trailing content inside the shared row', () => {
    const history = INCOME.slice(
      INCOME.indexOf('function HistoryOccurrencesList'),
      INCOME.indexOf('export default function IncomePage'),
    )
    const statementRows = PAGE.slice(
      PAGE.indexOf('/* M5 row authority'),
      PAGE.indexOf('{statementQuery.hasNextPage'),
    )
    expect(PAGE).toContain('<FinancialRowList variant="page">')
    expect(statementRows).not.toMatch(/(?:^|[\s'"`])(?:mx|ml|mr|px)-\d/)
    expect(DRAWER_LIST).toContain("variant === 'drawer' && inset && DRAWER_WIDE_CONTENT_GUTTER")
    expect(history).toContain('<DrawerFinancialList>')
    expect(history).not.toContain('<DrawerFinancialList inset>')
    expect(MOTION_ROW).not.toMatch(/(?:^|[\s'"`])(?:mx|ml|mr|px)-\d/)
    expect(SURFACE).toContain('pageInteractive: cn(')
    expect(SURFACE).toContain('group flex w-full min-w-0 cursor-pointer items-center')
    expect(SURFACE).toContain('animatedWrapper: \'rounded-lg\'')
    expect(SURFACE).toContain("'px-0 py-3.5 text-left outline-none transition-colors hover:bg-muted/30'")
    expect(SURFACE).toContain('sm:gap-4 sm:px-2 sm:py-4')
    expect(ROWS).toContain('{leadingAction ? null : leading}')
    expect(ROWS).toContain('{trailing && (')
    expect(PAGE).toContain('trailingCompact={')
  })

  it('matches Income mobile row padding while keeping page desktop and drawer geometry', () => {
    for (const variant of ['interactive', 'pageInteractive']) {
      const variantSource = SURFACE.slice(
        SURFACE.indexOf(`${variant}: cn(`),
        SURFACE.indexOf('),', SURFACE.indexOf(`${variant}: cn(`)) + 2,
      )
      expect(variantSource).toContain('px-0 py-3.5')
      expect(variantSource).toContain('sm:px-2 sm:py-4')
    }
    for (const variant of ['withLeadingAction', 'pageWithLeadingAction']) {
      const variantSource = SURFACE.slice(
        SURFACE.indexOf(`${variant}: cn(`),
        SURFACE.indexOf('),', SURFACE.indexOf(`${variant}: cn(`)) + 2,
      )
      expect(variantSource).toContain('px-0 py-3.5')
      expect(variantSource).toContain('sm:px-2 sm:py-4')
    }
    expect(ROWS).toContain('ROW_META_CLASS')
    expect(ROWS).toContain('trailingCompact ? \'hidden sm:flex\' : \'flex\'')
    expect(ROWS).toContain('flex shrink-0 sm:hidden')
    expect(DRAWER_LIST).toContain('<FinancialRowList variant="drawer" inset={inset}>')
    expect(PERSON_DRAWER).toContain('<DrawerFinancialList inset>')
    expect(INCOME).toContain('<DrawerFinancialList>')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../services/obligations.service.ts', import.meta.url), 'utf8')
const rows = readFileSync(new URL('../components/ui/financial-settlement-row.tsx', import.meta.url), 'utf8')

describe('Movimentações obligations UI contract', () => {
  it('uses the global month period and three independent infinite section queries', () => {
    expect(page).toContain('useMonthPeriod()')
    expect(page.match(/const (?:overdue|open|history)Query = useObligationSectionQuery\(/g)).toHaveLength(3)
    expect(page).toContain('initialPageParam: null as string | null')
    expect(page).toContain('cursor: pageParam ?? undefined')
    expect(page).toContain('query.fetchNextPage()')
    expect(page).toContain("section === 'OVERDUE' ? {} : { month, year }")
  })

  it('keeps search out of the summary request while domain and person affect it', () => {
    const summary = page.slice(page.indexOf('const summaryQuery'), page.indexOf('const overdueQuery'))
    expect(summary).toContain('obligationsSummaryKey({ ...period, domain: apiDomain, personId })')
    expect(summary).toContain('getObligationsSummary({ ...period, domain: apiDomain, personId })')
    expect(summary).not.toContain('search')
    expect(page).toContain('search: search || undefined')
    expect(page).toContain('personId,')
  })

  it('renders all sections, neutral amounts, and one temporal metadata line', () => {
    expect(page).toContain('Indisponível')
    expect(page).not.toContain('Indispon?vel')
    expect(page).toContain("title: 'Em atraso', empty: 'Nenhum valor em atraso.'")
    expect(page).toContain("title: 'Em aberto', empty: 'Nenhum valor em aberto neste período.'")
    expect(page).toContain("title: 'Histórico', empty: 'Nenhum item resolvido neste período.'")
    expect(page).toContain('Venceu em ${shortDate(date)}')
    expect(page).toContain('Vence em ${shortDate(date)}')
    expect(page).toContain('Recebido')
    expect(page).toContain('Pago')
    expect(page).toContain('trailing={<span className={`${ROW_AMOUNT_CLASS} ${ROW_AMOUNT_TONE.neutral}`}>{amount}</span>}')
    expect(page).not.toContain('trailingDate')
    expect(page).toContain("? 'text-destructive'")
    expect(page).toContain("? 'text-pending'")
    expect(page).toContain('variant="page"')
  })

  it('does not infer total section counts from cursor pages', () => {
    expect(service).toContain('pageInfo: { nextCursor: string | null; hasMore: boolean }')
    expect(service).not.toContain('totalCount')
    expect(page).not.toContain('pages.flatMap((page) => page.items).length')
    expect(page).not.toContain('Pendências de todos os meses')
  })

  it('preserves canonical non-nested row actions and detail drawers', () => {
    expect(rows).toContain('leadingAction={')
    expect(rows).toContain('onClick={onToggleStatus}')
    expect(page).toContain('Marcar como recebido')
    expect(page).toContain('Marcar como pago')
    expect(page).toContain('Marcar como pendente')
    expect(page).toContain('<DebtDetailDrawer')
    expect(page).toContain('<ReceivableDetailDrawer')
    expect(page).toContain("useDetailNavigation('debtId')")
    expect(page).toContain("useDetailNavigation('receivableId')")
  })

  it('keeps reversal warning only when a history row has a linked payment transaction', () => {
    const handler = page.match(/const handleSettle = \(row: ObligationRow, section: ObligationSection\) => \{[\s\S]*?\n  \}/)?.[0]
    expect(handler).toBeDefined()
    expect(handler).toContain("if (section === 'HISTORY')")
    expect(handler).toContain('if (row.paymentTransactionId) setUnmarkTarget({ row, section })')
    expect(handler).toContain('else mutation.mutate({ row, sourceSection: section, nextResolved: false })')
  })

  it('moves settled rows live and updates the summary cache before refetch', () => {
    expect(page).toContain('obligationSummaryDelta(')
    expect(page).toContain('applyObligationSummaryDelta(')
    expect(page).toContain('items: page.items.filter((item) => !(item.id === row.id && item.domain === row.domain))')
    expect(page).toContain("await queryClient.invalidateQueries({ queryKey: ['obligations'] })")
  })

  it('keeps the person selector, domain in URL, and accessible search and paging controls', () => {
    expect(page).toContain("updateUrlParam('domain', option.value)")
    expect(page).toContain("updateUrlParam('personId', value || undefined)")
    expect(page).toContain('new URLSearchParams(searchParams.toString())')
    expect(page).toContain('aria-label="Filtrar por pessoa"')
    expect(page).toContain('aria-label="Buscar obrigações"')
    expect(page).toContain('aria-pressed={domain === option.value}')
    expect(page).toContain('Carregar mais')
    expect(page).toContain('role="alert"')
  })
})

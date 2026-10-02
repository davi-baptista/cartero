import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ObligationPage } from '@/services/obligations.service'
import {
  findObligationHighlightRow,
  obligationHighlightHref,
  obligationHighlightPeriod,
  obligationHighlightPeriodDate,
  obligationHighlightSection,
  obligationResolvedCivilDay,
  parseObligationPeriodContext,
  sameObligationPeriod,
} from './obligation-highlight'

const client = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const calendar = readFileSync(new URL('./calendar-events.ts', import.meta.url), 'utf8')
const overview = readFileSync(new URL('./overview-agenda.ts', import.meta.url), 'utf8')
const statement = readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')
const settlementRow = readFileSync(new URL('../components/ui/financial-settlement-row.tsx', import.meta.url), 'utf8')

const pages: ObligationPage[] = [
  {
    items: [{
      domain: 'RECEIVABLE', id: 'r1', title: 'Venda', amount: '25', description: null,
      personId: 'p1', personName: 'Ana', counterpartyName: 'Ana', dueDate: '2026-10-15',
      isResolved: false, resolvedAt: null, paymentTransactionId: null,
    }],
    pageInfo: { nextCursor: 'next', hasMore: true },
  },
  {
    items: [{
      domain: 'DEBT', id: 'd2', title: 'Aluguel', amount: '100', description: null,
      personId: null, personName: null, counterpartyName: 'Imobiliária', dueDate: '2026-10-01',
      isResolved: false, resolvedAt: null, paymentTransactionId: null,
    }],
    pageInfo: { nextCursor: null, hasMore: false },
  },
]

describe('obligations deep-link highlight', () => {
  it('locates first-page receivable and debt rows by both id and domain', () => {
    expect(findObligationHighlightRow(pages, { id: 'r1', domain: 'RECEIVABLE' })?.title).toBe('Venda')
    expect(findObligationHighlightRow(pages, { id: 'd2', domain: 'DEBT' })?.title).toBe('Aluguel')
    expect(findObligationHighlightRow(pages, { id: 'r1', domain: 'DEBT' })).toBeUndefined()
  })

  it('finds a target on a later page without changing the other section queries', () => {
    expect(findObligationHighlightRow(pages, { id: 'd2', domain: 'DEBT' })?.id).toBe('d2')
    expect(client).toContain('highlightSectionQuery.fetchNextPage()')
    expect(client).toContain('const highlightSectionQuery = highlightSection ===')
    expect(client).toContain('findObligationHighlightRow(highlightSectionQuery.data?.pages, highlightTarget)')
    expect(client).toContain('highlightFiltersAligned')
  })

  it('discovers overdue, open, and history sections using entity state and account today', () => {
    expect(obligationHighlightSection({ isPaid: false, dueDate: '2026-10-01' }, '2026-10-02')).toBe('OVERDUE')
    expect(obligationHighlightSection({ isPaid: false, dueDate: '2026-10-02' }, '2026-10-02')).toBe('OPEN')
    expect(obligationHighlightSection({ isPaid: true, dueDate: '2026-08-01' }, '2026-10-02')).toBe('HISTORY')
    expect(client).toContain('accountToday(user.timeZone)')
  })

  it('uses resolution month for history and due month for unresolved items', () => {
    expect(obligationHighlightPeriodDate({ isPaid: false, dueDate: '2026-08-01', resolvedAt: null })).toBe('2026-08-01')
    expect(obligationHighlightPeriodDate({ isPaid: true, dueDate: '2026-08-01', resolvedAt: '2026-10-03' })).toBe('2026-10-03')
    expect(obligationHighlightPeriod('2026-10-03T12:00:00Z')).toEqual({ month: 10, year: 2026 })
  })

  it('uses civil paidAt first and converts only a legacy payment instant by account timezone', () => {
    expect(obligationResolvedCivilDay('2026-11-01T00:00:00.000Z', '2026-11-02T02:30:00.000Z', 'America/Fortaleza'))
      .toBe('2026-11-01')
    expect(obligationResolvedCivilDay(null, '2026-11-01T02:30:00.000Z', 'America/Fortaleza'))
      .toBe('2026-10-31')
    expect(obligationResolvedCivilDay(null, '2026-11-01T03:30:00.000Z', 'America/Fortaleza'))
      .toBe('2026-11-01')
    expect(obligationResolvedCivilDay(null, '2026-11-01T02:30:00.000Z', 'UTC'))
      .toBe('2026-11-01')
  })

  it('accepts explicit month context and discovers the period for an unscoped deep link', () => {
    expect(parseObligationPeriodContext({ month: '10', year: '2026' })).toEqual({ month: 10, year: 2026 })
    expect(parseObligationPeriodContext({ month: null, year: null, endDate: '2026-10-31' })).toEqual({ month: 10, year: 2026 })
    expect(parseObligationPeriodContext({ month: null, year: null })).toBeNull()
    expect(sameObligationPeriod({ month: 10, year: 2026 }, { month: 10, year: 2026 })).toBe(true)
    expect(client).toContain('if (!highlightTarget || !highlightFiltersAligned || !highlightPeriodReady || highlightRow) return')
    expect(client).toContain('incomingPeriod && !highlightId && !sameObligationPeriod(incomingPeriod, period)')
    expect(client).not.toContain('initialHighlightPeriodContext')
    expect(client).toContain('setPeriod(highlightPeriod)')
    expect(client).toContain("next.set('month', month)")
    expect(client).toContain("next.set('year', year)")
    expect(client).toContain("highlightSection !== 'OVERDUE' && highlightPeriod")
  })

  it('lets an explicit highlight target escape incompatible person and search filters', () => {
    expect(client).toContain('if (personId && personId !== highlightTarget.personId)')
    expect(client).toContain("next.delete('personId')")
    expect(client).toContain('if (search) {')
    expect(client).toContain("setSearch('')")
    expect(client).toContain('domainValues.length > 1')
  })

  it('does not open detail from highlight and keeps detail ids on their own authority', () => {
    expect(client).toContain("useDetailNavigation('debtId')")
    expect(client).toContain("useDetailNavigation('receivableId')")
    expect(client).toContain('useHighlight(highlightRow ? highlightTarget?.id : null)')
    expect(client).not.toContain("useDetailNavigation('highlight')")
    expect(client).not.toContain('debtNavigation.open(highlightId)')
    expect(client).not.toContain('receivableNavigation.open(highlightId)')
  })

  it('reuses the Extrato row highlight token and honors its reduced-motion scroll behavior', () => {
    expect(settlementRow).toContain('ROW_HIGHLIGHT_CLASS')
    expect(statement).toContain('ROW_HIGHLIGHT_CLASS')
    expect(client).toContain('highlightRef={highlightRef}')
    expect(readFileSync(new URL('./use-highlight.ts', import.meta.url), 'utf8'))
      .toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
  })

  it('calendar and Overview producers provide target domain and temporal context', () => {
    expect(calendar.match(/obligationHighlightHref\(/g)).toHaveLength(2)
    expect(calendar).toContain("'debt',\n        debt.id")
    expect(calendar).toContain("'receivable',\n        receivable.id")
    expect(overview.match(/obligationHighlightHref\(/g)).toHaveLength(2)
    expect(overview).toContain("'debt', debt.id, debt.dueDate <")
    expect(overview).toContain("'receivable', receivable.id, receivable.dueDate <")
    expect(obligationHighlightHref('debt', 'd1', '2026-10-05'))
      .toBe('/movements/obligations?domain=debt&highlight=d1&month=10&year=2026')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatCurrency } from './formatters'
import { formatObligationSectionNet, isZeroObligationAmount } from './obligations-presentation'

const page = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')

describe('obligations section totals presentation', () => {
  it('formats positive, negative, and zero net totals as one neutral value', () => {
    expect(formatObligationSectionNet('300.00')).toBe(`+${formatCurrency(300)} a receber`)
    expect(formatObligationSectionNet('-250.00')).toBe(`−${formatCurrency(250)} a pagar`)
    expect(formatObligationSectionNet('0.00')).toBe(formatCurrency(0))
    expect(formatObligationSectionNet('invalid')).toBe('Indisponível')
  })

  it('hides only zero totals for empty sections and never adds a history total', () => {
    expect(isZeroObligationAmount('0')).toBe(true)
    expect(isZeroObligationAmount('-0.000')).toBe(true)
    expect(isZeroObligationAmount('0.01')).toBe(false)
    expect(page).toContain('rows.length === 0 && summary !== undefined && isZeroObligationAmount(summary)')
    expect(page).toContain("section !== 'HISTORY'")
  })

  it('keeps the amount on the heading baseline and allows a clean mobile wrap', () => {
    expect(page).toContain('flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1')
    expect(page).toContain('text-right text-xs font-medium sm:text-sm')
    expect(page).toContain('ROW_AMOUNT_TONE.neutral')
  })

  it('uses a compact placeholder or quiet fallback without blocking rows', () => {
    expect(page).toContain('h-4 w-28')
    expect(page).toContain('summaryHasError || summary === undefined')
    expect(page).toContain('>Indisponível</span>')
    expect(page).toContain('query.isLoading ? (')
    expect(page).not.toContain('DrawerSummaryValue')
    expect(page).not.toContain('receivableOpenAmount')
    expect(page).not.toContain('debtOpenAmount')
  })

  it('keeps summary and the three paged sections on separate loading states', () => {
    expect(page.match(/const (?:overdue|open|history)Query = useObligationSectionQuery\(/g)).toHaveLength(3)
    expect(page).toContain('query.isLoading ? (')
    expect(page).toContain("summaryIsLoading={config.section === 'OVERDUE' ? overdueSummaryLoading : summaryQuery.isLoading}")
    expect(page).toContain('enabled: false')
    expect(page).toContain('overdueSummaryQuery.data')
    expect(page).not.toContain('summaryQuery.isLoading ? (')
  })
})

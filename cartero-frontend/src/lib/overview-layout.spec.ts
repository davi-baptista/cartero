import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const overview = readFileSync(
  resolve(__dirname, '../app/(dashboard)/overview/page.tsx'),
  'utf8',
)

describe('overview desktop composition', () => {
  it('keeps calendar, attention, and category surfaces in one responsive layout', () => {
    expect(overview).toContain('lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]')
    expect(overview).toContain('<CalendarSection')
    expect(overview).toContain('<Tabs value={mode}')
    expect(overview).toContain('<TabsTrigger value="attention">')
    expect(overview).not.toContain('<AttentionNowSection')
    expect(overview).toContain('<CategoryBreakdown')
  })

  it('keeps attention links and existing data sources intact', () => {
    expect(overview).toContain('href="/banks"')
    expect(overview).toContain('href={`/debts?endDate=${windowStr}`}')
    expect(overview).toContain('href={`/receivables?endDate=${windowStr}`}')
    expect(overview).toContain("queryKey: ['transactions', { startDate, endDate, invoicePeriod: true }]")
    expect(overview).toContain("queryKey: ['invoices']")
    expect(overview).toContain("queryKey: ['debts']")
    expect(overview).toContain("queryKey: ['receivables']")
  })

  it('keeps the calendar grid structured without an outer nested card', () => {
    expect(overview).toContain('rounded-xl border border-border/60 bg-card/30 p-4 sm:p-5')
    expect(overview).toContain('grid w-full min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]')
    expect(overview).toContain('rounded-t-lg border-b border-border/70 px-1 py-1.5')
    expect(overview).not.toContain('rounded-t-lg border-b border-border/70 bg-muted/20')
    expect(overview).toContain('gap-px overflow-hidden rounded-b-lg bg-border/30')
    expect(overview).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })
})

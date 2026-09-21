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
    expect(overview).toContain('value="attention">Atenção agora</TabsTrigger>')
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
    expect(overview).toContain('rounded-xl border border-border/50 bg-card/20 p-3.5 sm:p-4 lg:mt-0')
    expect(overview).toContain('grid w-full min-w-0 items-start gap-10 lg:gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]')
    expect(overview).toContain('rounded-t-lg border-b border-border/70 px-1 py-1.5')
    expect(overview).not.toContain('rounded-t-lg border-b border-border/70 bg-muted/20')
    expect(overview).toContain('gap-px overflow-hidden rounded-b-lg bg-border/30')
    expect(overview).toContain('bg-muted/25 ring-1 ring-inset ring-border/40 hover:bg-muted/45')
    expect(overview).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })

  it('keeps the contextual switcher compact and the mobile sections breathable', () => {
    expect(overview).toContain('h-7 rounded-md border border-border/40 bg-muted/35 p-0.5')
    expect(overview).toContain('h-6 px-2.5 py-0 text-[11px]')
    expect(overview).toContain('gap-10 lg:gap-8')
    expect(overview).toContain('mt-2 border-t border-border pt-6 sm:mt-0')
  })
})

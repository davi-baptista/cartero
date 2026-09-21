import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const overview = readFileSync(
  resolve(__dirname, '../app/(dashboard)/overview/page.tsx'),
  'utf8',
)
const agenda = readFileSync(resolve(__dirname, './overview-agenda.ts'), 'utf8')

describe('overview desktop composition', () => {
  it('keeps calendar, attention, and category surfaces in one responsive layout', () => {
    expect(overview).toContain('lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]')
    expect(overview).toContain('<CalendarSection')
    expect(overview).toContain('<AgendaSection')
    expect(overview).toContain('Pendências')
    expect(overview).not.toContain('Atenção agora')
    expect(overview).not.toContain('Vencimentos e movimentações com data neste mês')
    expect(overview).toContain('O que pesa no mês, pela fatura em que cada gasto caiu')
    expect(overview).not.toContain('<Tabs')
    expect(overview).not.toContain('<AttentionNowSection')
    expect(overview).toContain('<CategoryBreakdown')
  })

  it('keeps attention links and existing data sources intact', () => {
    expect(agenda).toContain('banks/${invoice.bankId}/invoices?invoiceId=${invoice.id}')
    expect(agenda).toContain('/debts?highlight=${debt.id}')
    expect(agenda).toContain('/receivables?highlight=${receivable.id}')
    expect(overview).toContain("queryKey: ['transactions', { startDate, endDate, invoicePeriod: true }]")
    expect(overview).toContain("queryKey: ['invoices']")
    expect(overview).toContain("queryKey: ['debts']")
    expect(overview).toContain("queryKey: ['receivables']")
  })

  it('keeps the calendar grid structured without an outer nested card', () => {
    expect(overview).toContain('w-full min-w-0 rounded-xl border border-border/50 bg-card/20 p-3 sm:p-3.5 lg:mt-0')
    expect(overview).toContain('grid w-full min-w-0 items-start gap-10 lg:gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]')
    expect(overview).toContain('rounded-t-lg border-b border-border px-1 py-1.5')
    expect(overview).not.toContain('rounded-t-lg border-b border-border/70 bg-muted/20')
    expect(overview).toContain('gap-px overflow-hidden rounded-b-lg bg-border/30')
    expect(overview).toContain('calendarDaySurface({')
    expect(overview).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })

  it('keeps both contextual sections visible with breathing room', () => {
    expect(overview).toContain('selectedGroups.visible.map')
    expect(overview).toContain('attentionGroups.visible')
    expect(overview).toContain('Nenhuma pendência agora.')
    expect(overview).toContain('gap-10 lg:gap-8')
    expect(overview).toContain('mt-2 border-t border-border pt-6 sm:mt-0')
    expect(overview).toContain('gap-2.5 py-2.5 sm:gap-3 sm:py-3')
    expect(overview).toContain('text-sm font-semibold tabular-nums tracking-[-0.02em]')
    expect(overview).toContain('isHistoricalResolved')
    expect(overview).toContain('calendarDayState(events)')
  })

  it('keeps agenda amounts neutral and moves status semantics to copy and icons', () => {
    expect(overview).toContain('text-sm font-semibold tabular-nums tracking-[-0.02em] text-foreground')
    expect(overview).toContain('resolveAgendaPresentation')
    expect(overview).toContain('containerClass={presentation.iconContainerClass}')
    expect(overview).toContain('statusClass={presentation.statusClass}')
    expect(overview).not.toContain("isSettled ? 'bg-receivable/10' : 'bg-destructive/10'")
    expect(overview).not.toContain("isSettled ? 'text-receivable' : 'text-destructive'")
    expect(overview).toContain('flex size-8 shrink-0 items-center justify-center rounded-lg')
    expect(overview).toContain("'size-4'")
    expect(overview).not.toContain('CAL_DIRECTION_AMOUNT')
    expect(overview).not.toContain('directionClass')
  })
})

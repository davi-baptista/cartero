import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OVERVIEW_DETAIL_PARAMS,
  overviewDetailIdentity,
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

  it('treats close and direct URL switches as atomic identities', () => {
    expect(overviewDetailIdentity('month=9&debtId=debt-a')).toEqual({
      param: 'debtId',
      id: 'debt-a',
    })
    expect(overviewDetailIdentity('month=9')).toBeNull()
    expect(overviewDetailIdentity('debtId=debt-a&invoiceId=invoice-b')).toEqual({
      param: 'invoiceId',
      id: 'invoice-b',
    })
  })

  it('opens through Overview URL state without domain href navigation', () => {
    expect(overview).toContain('onOpenDetail={detail.open}')
    expect(overview).toContain('onView={detailId ? () => onOpenDetail(detailParam, detailId) : undefined}')
    expect(details).toContain('InvoiceDetailsDrawer')
    expect(details).toContain('PersonStatementDrawer')
    expect(details).toContain('DebtDetailDrawer')
    expect(details).toContain('ReceivableDetailDrawer')
    expect(details).toContain('key={`invoice:${invoiceId}`}')
    expect(details).toContain("activeParam === 'debtId' && debtId")
  })

  it('keeps grouped person authority separate from individual entity identity', () => {
    expect(overview).toContain('count > 1 && group.personId')
    expect(overview).toContain("'personId'")
    expect(overview).toContain("'debtId'")
    expect(overview).toContain("'receivableId'")
    expect(overview).toContain("group.kind === 'debt'")
    expect(overview).toContain('presentation.statusText')
    expect(overview).toContain('person: User')
    expect(overview).toContain('const dueText = entry.dueDate ? formatDueDate(entry.dueDate, today).toLowerCase() : undefined')
    expect(overview).toContain('const aggregateTiming = count > 1 ? aggregateOpenTiming(group.entries, today) : null')
    expect(overview).toContain('const timingText = aggregateTiming?.text ?? dueText')
    expect(overview).toContain("? entry.status\n        : timingText ?? entry.status")
    expect(agenda).toContain('entityId: event.entityId')
    expect(agenda).toContain('dueDate: event.dueDate')
  })

  it('uses explicit visual spacing and independent expandable agenda sections', () => {
    expect(overview).toContain('inline-flex shrink-0 items-center gap-1 whitespace-nowrap')
    expect(overview).toContain('aria-hidden="true">·</span>')
    expect(overview).toContain('const [selectedDayExpanded, setSelectedDayExpanded]')
    expect(overview).toContain('const [attentionExpanded, setAttentionExpanded]')
    expect(overview).toContain('Ver mais ${overflowCount}')
    expect(overview).toContain('Mostrar menos')
    expect(overview).toContain("'item' : 'itens'")
    expect(overview).toContain("singular: 'pendência'")
    expect(overview).toContain("plural: 'pendências'")
    expect(overview).toContain('selectedGroupsLimited.hiddenItems')
  })

  it('keeps due-today color on status text and overdue emphasis on historical cells', () => {
    expect(overview).toContain('resolveAgendaPresentation')
    expect(overview).toContain('statusClass={presentation.statusClass}')
    expect(overview).toContain('calendarDaySurface({')
    expect(overview).toContain("hasUnresolvedOverdue ? ', possui item vencido' : ''")
    expect(overview).toContain("debt: count === 1 ? 'Dívida' : 'Dívidas'")
  })

  it('keeps the Today empty state compact and intentionally quiet', () => {
    expect(overview).toContain("isTodaySelected ? 'nenhum evento' : 'Nenhum evento neste dia.'")
    expect(overview).toContain('py-1 text-xs text-muted-foreground')
    expect(overview).not.toContain('Nenhum evento hoje.')
  })

  it('preserves the canonical calendar source model', () => {
    expect(agenda).toContain('entityId: invoice.id')
    expect(agenda).toContain('entityId: debt.id')
    expect(agenda).toContain('entityId: receivable.id')
    expect(overview).toContain('selectedGroups.visible.map')
    expect(overview).toContain('attentionGroups.visible')
    expect(overview).toContain("['invoice-due', 'Fatura']")
    expect(overview).toContain("['debt', 'Dívida']")
    expect(overview).toContain("['receivable', 'A Receber']")
    expect(overview).not.toContain("'Saída / vencimento'")
    expect(overview).not.toContain("'Entrada'")
  })
})

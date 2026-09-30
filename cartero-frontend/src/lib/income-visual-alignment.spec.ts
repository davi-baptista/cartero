import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../app/(dashboard)/income/page.tsx', import.meta.url), 'utf-8')
const rows = readFileSync(new URL('../components/ui/financial-list-row.tsx', import.meta.url), 'utf-8')
const settlementRow = readFileSync(new URL('../components/ui/financial-settlement-row.tsx', import.meta.url), 'utf-8')
const persons = readFileSync(new URL('../app/(dashboard)/persons/page.tsx', import.meta.url), 'utf-8')
const avatar = readFileSync(new URL('../components/ui/financial-avatar.tsx', import.meta.url), 'utf-8')
const history = readFileSync(new URL('./income-history.ts', import.meta.url), 'utf-8')

describe('income visual alignment contract', () => {
  it('routes one-off row body to detail and the open avatar to the canonical receive flow', () => {
    expect(page).toContain('onView={onView}')
    expect(page).toContain('<FinancialSettlementRow')
    expect(page).toContain('onToggleStatus={onReceive}')
    expect(page).toContain('onView={() => setSelectedReceivable(item)}')
    expect(page).toContain('onReceive={() => setMarkPaidTarget(item)}')
    expect(page).toContain('settlementMutation.mutate({ id: markPaidTarget.id, isPaid: true, payload })')
    expect(settlementRow).toContain('onToggleStatus')
    expect(rows).toContain('onClick={onView}')
    expect(rows).toContain('<button')
    expect(page).toContain('meta={<span className={presentation.tone === \'overdue\' ? \'text-destructive\' : \'text-muted-foreground\'}>{presentation.label}</span>}')
    expect(page).toContain('trailing={<FinancialRowTrailing amount={formatCurrency(item.amount)} label="A RECEBER" />}')
    expect(page).not.toContain('item.debtorName ||')
    expect(page).toContain('<ReceivableDetailDrawer')
    expect(page).not.toContain('<Check')
    expect(page).not.toContain('CircleDollarSign className="size-5 text-foreground"')
  })

  it('keeps recurring source rows neutral and exposes only the open-occurrence list in the restored sheet', () => {
    expect(page).toContain('Repeat className="size-5 text-muted-foreground"')
    expect(page).toContain('<OpenOccurrencesList')
    expect(page).toContain('occurrences={selectedOccurrences}')
    expect(page).not.toContain('RecurringIncomeDetailDrawer')
    expect(page).toContain('text-xs font-normal tracking-normal text-muted-foreground">/ mês')
    expect(page.indexOf('Editar renda')).toBeLessThan(page.indexOf('Ocorrências em aberto'))
    expect(page).toContain('nextOpenIncomeOccurrenceOnOrAfter')
    expect(page).toContain('trailing={<FinancialRowTrailing amount={<>{formatCurrency(rule.amount)}')
    expect(page).toContain("label={rule.isActive ? 'A RECEBER' : 'ENCERRADA'}")
  })

  it('reuses one shared right-side presentation across Pessoas and Renda', () => {
    expect(rows).toContain('export function FinancialRowTrailing')
    expect(rows).toContain('ROW_TRAILING_LABEL_CLASS')
    expect(persons).toContain('<FinancialRowTrailing amount={formatCurrency(net)}')
    expect(page).toContain('<FinancialRowTrailing amount={formatCurrency(item.amount)}')
    expect(page).toContain('label="A RECEBER"')
  })

  it('keeps the occurrence quick receive action separate from the row action', () => {
    expect(page).toContain('onToggleStatus={() => onReceive(occurrence)}')
    expect(avatar).toContain('event.stopPropagation()')
    expect(page).toContain('statusActionLabel={`Marcar ${occurrence.title} como recebido`}')
    expect(page).toContain('onReceive={(occurrence) => setMarkPaidTarget(occurrence)}')
    expect(page).toContain('<MarkAsPaidDialog')
  })

  it('derives presentation from the account civil day', () => {
    expect(page).toContain('accountToday(user.timeZone)')
    expect(page).toContain('recurringIncomeOccurrencePresentation')
  })

  it('matches Person history geometry and copy', () => {
    expect(page).toContain('<DrawerSectionHeading>Histórico</DrawerSectionHeading>')
    expect(page).toContain('<DrawerFinancialList>')
    expect(page).toContain('<DrawerSectionEmpty inset={false}')
    expect(page).toContain('Nenhum recebimento realizado.')
    expect(page).toContain('recurringIncomeHistoryOccurrences')
    expect(page).toContain('incomeHistoryReceiptLabel(occurrence, timeZone)')
    expect(page).toContain('onView={() => onSelect(occurrence)}')
    expect(page).toContain('onToggleReceived={handleSelectedReceivableToggle}')
    expect(page).toContain('formatSignedCurrency(Number(occurrence.amount), \'in\')')
    expect(page).not.toContain('Vencimento {formatDate')
    expect(page).toContain('resolved\n            onToggleStatus')
  })

  it('renders the merged, paginated general history without period filters', () => {
    expect(page).toContain('settledIncomeHistory(receivables)')
    expect(page).not.toContain('<Select')
    expect(page).not.toContain('historyPeriod')
    expect(page).toContain('paginateIncomeHistory(generalHistory, historyPage)')
    expect(page).toContain('Página anterior do histórico')
    expect(page).toContain('Próxima página do histórico')
    expect(history).toContain('INCOME_HISTORY_PAGE_SIZE = 5')
    expect(history).toContain('b.paidAt.localeCompare(a.paidAt)')
    expect(page).toContain('onToggleStatus={() => handleSelectedReceivableToggle(item)}')
    expect(page).toContain('onView={() => setSelectedReceivable(item)}')
    expect(page).toContain('formatSignedCurrency(Number(item.amount), \'in\')')
    expect(page).toContain('Fonte recorrente')
    expect(page).toContain('Renda pontual')
    expect(page).not.toContain('Nenhum recebimento neste período.')
  })

  it('uses the shared muted history-title token, without an income success-color override', () => {
    expect(settlementRow).toContain('ROW_HISTORY_TITLE_TONE')
    expect(rows).toContain("ROW_HISTORY_TITLE_TONE = 'text-muted-foreground'")
    expect(settlementRow).not.toContain('text-paid')
    expect(page).not.toContain('resolvedTitleTone')
  })

  it('aligns recurring History with Open Occurrences through shared drawer authorities', () => {
    const openList = page.slice(page.indexOf('function OpenOccurrencesList'), page.indexOf('function HistoryOccurrencesList'))
    const historyList = page.slice(page.indexOf('function HistoryOccurrencesList'), page.indexOf('export default function IncomePage'))
    expect(page).toContain('<DrawerSectionTitle title="Ocorrências em aberto"')
    expect(page).toContain('<DrawerSectionHeading>Histórico</DrawerSectionHeading>')
    expect(openList).toContain('<DrawerFinancialList>')
    expect(historyList).toContain('<DrawerFinancialList>')
    expect(openList).not.toContain('<DrawerFinancialList inset>')
    expect(historyList).not.toContain('<DrawerFinancialList inset>')
    expect(historyList).toContain('<DrawerSectionEmpty inset={false}')
    expect(historyList).not.toMatch(/\b(?:mx|px)-\d/)
  })
})

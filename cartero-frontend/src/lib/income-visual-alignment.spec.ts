import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../app/(dashboard)/recurring/income-panel.tsx', import.meta.url), 'utf-8')
const rows = readFileSync(new URL('../components/ui/financial-list-row.tsx', import.meta.url), 'utf-8')
const settlementRow = readFileSync(new URL('../components/ui/financial-settlement-row.tsx', import.meta.url), 'utf-8')
const persons = readFileSync(new URL('../app/(dashboard)/persons/page.tsx', import.meta.url), 'utf-8')
const avatar = readFileSync(new URL('../components/ui/financial-avatar.tsx', import.meta.url), 'utf-8')

describe('income visual alignment contract', () => {
  it('keeps Income focused on recurring sources and embeds creation in the shared drawer', () => {
    expect(page).toContain('createTarget && formHost && footerHost ? createPortal(')
    expect(page).toContain('embedded embeddedFooterHost={footerHost}')
    expect(page).toContain('Nenhuma receita recorrente cadastrada.')
    expect(page).not.toContain('chooserOpen')
    expect(page).not.toContain('Renda pontual')
    expect(page).not.toContain('Recebimentos pontuais')
    expect(page).not.toContain('createReceivable')
    expect(page).not.toContain('oneOffOpen')
    expect(page).not.toContain('<ReceivableSheet mode="income"')
    expect(page).toContain('<ReceivableSheet mode="income-occurrence"')
    expect(page).toContain('<RecurringIncomeSheet')
  })

  it('separates source occurrence groups', () => {
    expect(page).not.toContain('Adicionar renda</span>')
    expect(page).toContain('<DrawerSectionTitle title="Em atraso"')
    expect(page).toContain('<DrawerSectionTitle title="Em aberto"')
    expect(page).toContain('selectedOccurrenceGroups.overdue.length > 0')
    expect(page).toContain('selectedOccurrenceGroups.open.length > 0')
    expect(page).toContain('<DrawerSectionHeading>Hist\u00f3rico</DrawerSectionHeading>')
  })

  it('opens occurrences in the operational canonical detail with canonical delete', () => {
    expect(page).toContain('<ReceivableDetailDrawer receivable={selectedReceivable} mode="operational"')
    expect(page).toContain('onDelete={(item) => setOccurrenceDeleteTarget(item)}')
    expect(page).toContain('onEdit={openReceivableEdit}')
    expect(page).toContain('onToggleReceived={handleSelectedReceivableToggle}')
    expect(page).toContain('onClick={() => openRecurringEdit(selectedRule)}')
    expect(page).toContain('onClick={() => setDeleteTarget(selectedRule)}')
  })

  it('keeps recurring source rows neutral and exposes only the open-occurrence list in the restored sheet', () => {
    expect(page).toContain('Repeat className="size-5 text-muted-foreground"')
    expect(page).toContain('<OpenOccurrencesList')
    expect(page).toContain('occurrences={selectedOccurrenceGroups.overdue}')
    expect(page).toContain('occurrences={selectedOccurrenceGroups.open}')
    expect(page).not.toContain('RecurringIncomeDetailDrawer')
    expect(page).toContain('text-xs font-normal tracking-normal text-muted-foreground">/ mês')
    const drawer = page.slice(page.indexOf('<DrawerSummaryCard inset={false}>'))
    expect(drawer.indexOf('Editar renda')).toBeLessThan(drawer.indexOf('<DrawerSectionTitle title="Em atraso"'))
    expect(page).toContain('nextOpenIncomeOccurrenceOnOrAfter')
    expect(page).toContain('trailing={<FinancialRowTrailing amount={<>{formatCurrency(rule.amount)}')
    expect(page).toContain("label={rule.isActive ? 'A RECEBER' : 'PAUSADA'}")
  })

  it('reuses one shared right-side presentation across Pessoas and Renda', () => {
    expect(rows).toContain('export function FinancialRowTrailing')
    expect(rows).toContain('ROW_TRAILING_LABEL_CLASS')
    expect(persons).toContain('<FinancialRowTrailing amount={formatCurrency(net)}')
    expect(page).toContain('<FinancialRowTrailing amount={formatCurrency(occurrence.amount)}')
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

  it('removes global history while preserving history within a source drawer', () => {
    expect(page).not.toContain('settledIncomeHistory')
    expect(page).not.toContain('paginateIncomeHistory')
    expect(page).not.toContain('generalHistory')
    expect(page).not.toContain('Página anterior do histórico')
    expect(page).not.toContain('Próxima página do histórico')
    expect(page).toContain('recurringIncomeHistoryOccurrences')
    expect(page).toContain('<DrawerSectionHeading>Histórico</DrawerSectionHeading>')
    expect(page).toContain('incomeHistoryReceiptLabel(occurrence, timeZone)')
  })

  it('uses the shared muted history-title token, without an income success-color override', () => {
    expect(settlementRow).toContain('ROW_HISTORY_TITLE_TONE')
    expect(rows).toContain("ROW_HISTORY_TITLE_TONE = 'text-muted-foreground'")
    expect(settlementRow).not.toContain('text-paid')
    expect(page).not.toContain('resolvedTitleTone')
  })

  it('aligns recurring History with Open Occurrences through shared drawer authorities', () => {
    const openList = page.slice(page.indexOf('function OpenOccurrencesList'), page.indexOf('function HistoryOccurrencesList'))
    const historyList = page.slice(page.indexOf('function HistoryOccurrencesList'), page.indexOf('export function IncomePanel'))
    expect(page).toContain('<DrawerSectionTitle title="Em atraso"')
    expect(page).toContain('<DrawerSectionTitle title="Em aberto"')
    expect(page).toContain('<DrawerSectionHeading>Histórico</DrawerSectionHeading>')
    expect(openList).toContain('<DrawerFinancialList>')
    expect(historyList).toContain('<DrawerFinancialList>')
    expect(openList).not.toContain('<DrawerFinancialList inset>')
    expect(historyList).not.toContain('<DrawerFinancialList inset>')
    expect(historyList).toContain('<DrawerSectionEmpty inset={false}')
    expect(historyList).not.toMatch(/\b(?:mx|px)-\d/)
  })
})

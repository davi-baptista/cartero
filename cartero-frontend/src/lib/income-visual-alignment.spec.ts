import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../app/(dashboard)/income/page.tsx', import.meta.url), 'utf-8')
const rows = readFileSync(new URL('../components/ui/financial-list-row.tsx', import.meta.url), 'utf-8')
const persons = readFileSync(new URL('../app/(dashboard)/persons/page.tsx', import.meta.url), 'utf-8')
const avatar = readFileSync(new URL('../components/ui/financial-avatar.tsx', import.meta.url), 'utf-8')

describe('income visual alignment contract', () => {
  it('keeps the one-off avatar empty and reuses the receivable detail flow', () => {
    expect(page).toContain('leadingAction={<FinancialAvatar onClick={onView}')
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
    expect(page).toContain('onClick={() => onReceive(occurrence)}')
    expect(avatar).toContain('event.stopPropagation()')
    expect(page).toContain('ariaLabel={`Marcar ${occurrence.title} como recebido`}')
    expect(page).toContain('onReceive={(occurrence) => setMarkPaidTarget(occurrence)}')
    expect(page).toContain('<MarkAsPaidDialog')
  })

  it('derives presentation from the account civil day', () => {
    expect(page).toContain('accountToday(user.timeZone)')
    expect(page).toContain('recurringIncomeOccurrencePresentation')
  })
})

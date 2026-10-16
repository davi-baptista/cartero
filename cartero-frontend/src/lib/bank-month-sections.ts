import { InvoiceStatus } from '@/types'
import type { BankMonthRow, BankMonthSummary } from '@/lib/bank-invoice-selection'

export type BankMonthSection = 'overdue' | 'open' | 'history' | 'noInvoice'

export const BANK_MONTH_SECTION_TITLE: Record<BankMonthSection, string> = {
  overdue: 'Em atraso',
  open: 'Em aberto',
  history: 'Histórico',
  noInvoice: 'Sem fatura no mês',
}

export const BANK_MONTH_SECTION_ORDER: BankMonthSection[] = [
  'overdue', 'open', 'history', 'noInvoice',
]

export function bankMonthSection(invoice: { status: InvoiceStatus } | null): BankMonthSection {
  if (!invoice) return 'noInvoice'
  if (invoice.status === InvoiceStatus.OVERDUE) return 'overdue'
  if (invoice.status === InvoiceStatus.PAID) return 'history'
  return 'open'
}

export function groupBankMonthRows<T>(rows: BankMonthRow<T>[]) {
  const groups = {
    overdue: [] as BankMonthRow<T>[],
    open: [] as BankMonthRow<T>[],
    history: [] as BankMonthRow<T>[],
    noInvoice: [] as BankMonthRow<T>[],
  }
  const totals = { overdue: 0, open: 0, history: 0 }
  let unpaidOwn = 0
  let unpaidThirdParty = 0

  for (const row of rows) {
    const section = bankMonthSection(row.invoice)
    groups[section].push(row)
    if (section !== 'noInvoice') totals[section] += row.amount
    if (section === 'overdue' || section === 'open') {
      unpaidOwn += row.ownAmount
      unpaidThirdParty += row.reimbursable
    }
  }

  return { groups, totals, unpaidOwn, unpaidThirdParty }
}

/** The final summary line reflects invoice state in the selected month. */
export function bankMonthSummaryStatus(summary: Pick<BankMonthSummary, 'invoiceCount' | 'paidCount' | 'overdueCount'>) {
  if (summary.overdueCount > 0) return { label: 'Há faturas em atraso', tone: 'text-destructive' }
  if (summary.invoiceCount === 0) return { label: 'Nenhuma fatura neste mês', tone: 'text-muted-foreground' }
  if (summary.paidCount === summary.invoiceCount) return { label: 'Tudo pago', tone: 'font-medium text-paid' }
  return { label: 'A pagar nas faturas do mês', tone: 'text-muted-foreground' }
}

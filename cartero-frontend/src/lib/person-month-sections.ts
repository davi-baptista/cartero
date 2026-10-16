export type PersonMonthSection = 'overdue' | 'open' | 'history' | 'empty'

export const PERSON_MONTH_SECTION_TITLE: Record<PersonMonthSection, string> = {
  overdue: 'Em atraso',
  open: 'Em aberto',
  history: 'Histórico',
  empty: 'Sem movimento no período',
}

export const PERSON_MONTH_SECTION_ORDER: PersonMonthSection[] = [
  'overdue', 'open', 'history', 'empty',
]

export interface PersonSectionBalance {
  receivablePending: number
  debtPending: number
  overdueReceivablePending: number
  overdueDebtPending: number
  periodReceivableTotal: number
  periodDebtTotal: number
  settledReceivablesCount: number
  settledDebtsCount: number
}

const EPSILON = 0.005

export function personMonthSection(balance: PersonSectionBalance): PersonMonthSection {
  if (balance.overdueReceivablePending > EPSILON || balance.overdueDebtPending > EPSILON) return 'overdue'
  if (balance.receivablePending > EPSILON || balance.debtPending > EPSILON) return 'open'
  if (
    balance.periodReceivableTotal > EPSILON || balance.periodDebtTotal > EPSILON ||
    balance.settledReceivablesCount > 0 || balance.settledDebtsCount > 0
  ) return 'history'
  return 'empty'
}

export function groupPersonMonthRows<T, B extends PersonSectionBalance>(rows: Array<{ person: T; balance: B }>) {
  const groups = {
    overdue: [] as Array<{ person: T; balance: B }>,
    open: [] as Array<{ person: T; balance: B }>,
    history: [] as Array<{ person: T; balance: B }>,
    empty: [] as Array<{ person: T; balance: B }>,
  }
  const totals = {
    overdue: { receive: 0, pay: 0 },
    open: { receive: 0, pay: 0 },
    history: { receive: 0, pay: 0 },
  }

  for (const row of rows) {
    const section = personMonthSection(row.balance)
    groups[section].push(row)
    if (section === 'overdue' || section === 'open') {
      totals[section].receive += row.balance.receivablePending
      totals[section].pay += row.balance.debtPending
    } else if (section === 'history') {
      totals.history.receive += row.balance.periodReceivableTotal
      totals.history.pay += row.balance.periodDebtTotal
    }
  }

  return { groups, totals }
}

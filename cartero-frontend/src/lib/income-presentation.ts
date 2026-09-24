import type { Receivable, RecurringIncomeRule } from '@/types'
import { formatDate } from '@/lib/formatters'

export type RecurringIncomeOccurrencePresentation = {
  label: string
  tone: 'neutral' | 'attention' | 'overdue'
}

function civilDayDistance(from: string, to: string): number {
  const fromDate = new Date(`${from.slice(0, 10)}T00:00:00`)
  const toDate = new Date(`${to.slice(0, 10)}T00:00:00`)
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000)
}

export function recurringIncomeOccurrencePresentation(
  occurrence: Receivable,
  today: string,
): RecurringIncomeOccurrencePresentation {
  const daysUntilDue = civilDayDistance(today, occurrence.dueDate)

  if (daysUntilDue < 0) return { label: `Receber atrasado ${Math.abs(daysUntilDue)}d`, tone: 'overdue' }
  if (daysUntilDue === 0) return { label: 'Receber hoje', tone: 'attention' }
  if (daysUntilDue <= 15) return { label: `Receber em ${daysUntilDue}d`, tone: 'attention' }
  return { label: `Próximo: ${formatDate(occurrence.dueDate)}`, tone: 'neutral' }
}

/** Display-only helpers: ordering and selection use dates returned by the API. */
export function recurringIncomeOccurrences(rule: RecurringIncomeRule, receivables: Receivable[]) {
  return receivables
    .filter((item) => item.recurringIncomeRuleId === rule.id)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export function nextOpenIncomeOccurrence(occurrences: Receivable[]) {
  return occurrences.find((item) => !item.isPaid)
}

export function nextOpenIncomeOccurrenceOnOrAfter(occurrences: Receivable[], today: string) {
  const civilToday = today.slice(0, 10)
  return occurrences
    .filter((item) => !item.isPaid && item.dueDate.slice(0, 10) >= civilToday)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

export function isOneOffIncome(receivable: Receivable) {
  return receivable.incomeClassification === 'INCOME' && !receivable.recurringIncomeRuleId
}

export function openOneOffIncome(receivables: Receivable[]) {
  return receivables.filter((item) => !item.isPaid && isOneOffIncome(item))
}

export function openRecurringIncomeOccurrences(rule: RecurringIncomeRule, receivables: Receivable[]) {
  return recurringIncomeOccurrences(rule, receivables).filter((item) => !item.isPaid)
}

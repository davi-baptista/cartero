import type { Receivable, RecurringIncomeRule } from '@/types'
import { compareIncomeHistoryItems, isResolvedIncomeHistoryItem } from '@/lib/income-history'
import { formatDate } from '@/lib/formatters'
import { settlementStatus } from '@/lib/settlement-status'

export type RecurringIncomeOccurrencePresentation = {
  label: string
  tone: 'neutral' | 'attention' | 'overdue'
}

export type RecurringIncomeStatusPresentation = {
  label: 'Recebimento em atraso' | 'Recebimento próximo' | 'Tudo em dia'
  tone: 'destructive' | 'pending' | 'success'
}

function civilDayDistance(from: string, to: string): number {
  const fromDate = new Date(`${from.slice(0, 10)}T00:00:00`)
  const toDate = new Date(`${to.slice(0, 10)}T00:00:00`)
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000)
}

export function recurringIncomeStatusPresentation(
  occurrences: Receivable[],
  today: string,
): RecurringIncomeStatusPresentation {
  if (occurrences.some((occurrence) => civilDayDistance(today, occurrence.dueDate) < 0)) {
    return { label: 'Recebimento em atraso', tone: 'destructive' }
  }

  const next = occurrences.find((occurrence) => civilDayDistance(today, occurrence.dueDate) >= 0)
  if (next && civilDayDistance(today, next.dueDate) <= 5) {
    return { label: 'Recebimento próximo', tone: 'pending' }
  }

  return { label: 'Tudo em dia', tone: 'success' }
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

export function openRecurringIncomeOccurrences(rule: RecurringIncomeRule, receivables: Receivable[]) {
  return recurringIncomeOccurrences(rule, receivables).filter((item) => !item.isPaid)
}

export function splitRecurringIncomeOpenOccurrences(
  occurrences: Receivable[],
  today: string,
) {
  return {
    overdue: occurrences.filter((item) => settlementStatus(item, today) === 'overdue'),
    open: occurrences.filter((item) => settlementStatus(item, today) === 'pending'),
  }
}

/** Occorrências recebidas, ordenadas pela data efetiva do recebimento. */
export function recurringIncomeHistoryOccurrences(
  rule: RecurringIncomeRule,
  receivables: Receivable[],
) {
  return recurringIncomeOccurrences(rule, receivables)
    .filter(isResolvedIncomeHistoryItem)
    .sort(compareIncomeHistoryItems)
}

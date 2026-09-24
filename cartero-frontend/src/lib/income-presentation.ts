import type { Receivable, RecurringIncomeRule } from '@/types'

/** Display-only helpers: ordering and selection use dates returned by the API. */
export function recurringIncomeOccurrences(rule: RecurringIncomeRule, receivables: Receivable[]) {
  return receivables
    .filter((item) => item.recurringIncomeRuleId === rule.id)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export function nextOpenIncomeOccurrence(occurrences: Receivable[]) {
  return occurrences.find((item) => !item.isPaid)
}

export function isOneOffIncome(receivable: Receivable) {
  return receivable.incomeClassification === 'INCOME' && !receivable.recurringIncomeRuleId
}

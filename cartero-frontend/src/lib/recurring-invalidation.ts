import type { QueryClient } from '@tanstack/react-query'

const KEYS = {
  income: ['recurring-incomes', 'receivables', 'obligations', 'budget', 'transactions', 'persons'],
  automatic: ['subscriptions', 'transactions', 'invoices', 'bank-invoices', 'budget'],
  manual: ['recurring-expenses', 'debts', 'obligations', 'budget', 'transactions', 'persons'],
} as const

export function invalidateRecurringDependents(queryClient: QueryClient, kind: keyof typeof KEYS) {
  for (const key of KEYS[kind]) void queryClient.invalidateQueries({ queryKey: [key] })
}

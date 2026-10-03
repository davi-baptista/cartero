import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recurringIncomeReconcileKey } from './obligations-query'

const client = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../services/recurring-income.service.ts', import.meta.url), 'utf8')

describe('explicit recurring reconciliation for obligations', () => {
  it('runs once per user and month before OPEN and summary reads', () => {
    expect(client).toContain("section === 'OPEN' && userId")
    expect(client).toContain('queryClient.fetchQuery({')
    expect(client).toContain('staleTime: Infinity')
    expect(client).toContain('return getObligationsSummary')
    expect(api).toContain("'/recurring-incomes/reconcile'")
    expect(recurringIncomeReconcileKey('user-a', { month: 10, year: 2026 })).toEqual([
      'recurring-income-reconcile', 'user-a', 2026, 10,
    ])
  })

  it('does not reconcile OVERDUE, HISTORY, filters, or pagination', () => {
    const sectionQuery = client.slice(client.indexOf('function useObligationSectionQuery'), client.indexOf('function shortDate'))
    expect(sectionQuery).toContain("section === 'OPEN' && userId")
    expect(sectionQuery).toContain('cursor: pageParam ?? undefined')
    expect(sectionQuery).not.toContain('search, domain, personId, month, year }),')
  })
})

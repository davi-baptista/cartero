import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { movementLegacyDestination } from './movement-legacy-redirect'

const dashboardLayout = readFileSync(
  new URL('../app/(dashboard)/layout.tsx', import.meta.url),
  'utf8',
)
const movementsShell = readFileSync(
  new URL('../app/(dashboard)/movements/movements-shell.tsx', import.meta.url),
  'utf8',
)
const movementViewSwitch = readFileSync(
  new URL('./movement-view-switch.ts', import.meta.url),
  'utf8',
)

describe('Movimentações M3 routes and navigation', () => {
  it('redirects the area root to the default statement view', () => {
    const index = readFileSync(new URL('../app/(dashboard)/movements/page.tsx', import.meta.url), 'utf8')
    expect(index).toContain("redirect('/movements/statement')")
    expect(() => readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')).not.toThrow()
    expect(() => readFileSync(new URL('../app/(dashboard)/movements/obligations/page.tsx', import.meta.url), 'utf8')).not.toThrow()
  })

  it('uses real route links with accessible selected state', () => {
    expect(movementsShell).toContain("href: '/movements/statement'")
    expect(movementsShell).toContain("href: '/movements/obligations'")
    expect(movementsShell).toContain("aria-current={active ? 'page' : undefined}")
    expect(movementViewSwitch).toContain('focus-visible:ring-2')
    expect(movementsShell).toContain('const active = pathname === href')
  })

  it('shows the month selector only on obligations routes, from pathname', () => {
    expect(dashboardLayout).toContain("'/movements/obligations'")
    expect(dashboardLayout).not.toContain("'/movements/statement'")
    expect(dashboardLayout).toContain('const scoped =')
    expect(dashboardLayout).not.toContain('setMonthNav')
    expect(dashboardLayout).toContain('<MonthPeriodProvider>')
    expect(dashboardLayout).toContain('{children}')
  })

  it('inherits dashboard page gutters without adding a local width or side margin', () => {
    expect(dashboardLayout).toContain('<main className="min-w-0 p-6">{children}</main>')
    expect(dashboardLayout).toContain('data-slot="dashboard-scroll-viewport"')
    expect(movementsShell).toContain('<section className="space-y-4">')
  })

  it('preserves detail and useful filter params on legacy redirects', () => {
    expect(movementLegacyDestination('transactions', {
      transactionId: 'tx 1', highlight: 'tx 1', categoryId: 'food', type: 'expense',
      group: 'card', invoicePeriod: 'true', startDate: '2026-10-01', endDate: '2026-10-31',
    })).toBe('/movements/statement?transactionId=tx+1&highlight=tx+1&categoryId=food&type=expense&group=card')
    expect(movementLegacyDestination('receivables', {
      receivableId: 'r1', highlight: 'r1', personId: 'p1', endDate: '2026-10-31',
    })).toBe('/movements/obligations?receivableId=r1&highlight=r1&personId=p1&month=10&year=2026&domain=receivable')
    expect(movementLegacyDestination('debts', {
      debtId: 'd1', highlight: 'd1', personId: 'p2',
    })).toBe('/movements/obligations?debtId=d1&highlight=d1&personId=p2&domain=debt')
  })

  it('canonicalizes legacy detail domain from the explicit entity parameter', () => {
    expect(movementLegacyDestination('receivables', { debtId: 'd1', domain: 'receivable' }))
      .toBe('/movements/obligations?debtId=d1&domain=debt')
    expect(movementLegacyDestination('debts', { receivableId: 'r1', domain: 'debt' }))
      .toBe('/movements/obligations?receivableId=r1&domain=receivable')
    expect(movementLegacyDestination('receivables', {
      debtId: 'd1', receivableId: 'r1', domain: ['receivable', 'debt'],
    })).toBe('/movements/obligations?debtId=d1&domain=debt')
  })

  it('maps only a valid legacy endDate to the shared month context and drops date-range residue', () => {
    expect(movementLegacyDestination('debts', {
      startDate: '2026-10-01', endDate: '2026-10-31', month: '9', year: '2026',
    })).toBe('/movements/obligations?month=9&year=2026&domain=debt')
    expect(movementLegacyDestination('debts', { endDate: 'not-a-date' }))
      .toBe('/movements/obligations?domain=debt')
  })

  it('preserves repeated params and accepts a default obligations domain', () => {
    expect(movementLegacyDestination('transactions', { type: ['income', 'expense'] }))
      .toBe('/movements/statement?type=income&type=expense')
    const obligations = readFileSync(
      new URL('../app/(dashboard)/movements/obligations/page.tsx', import.meta.url),
      'utf8',
    )
    const domainAuthority = readFileSync(
      new URL('./obligations-query.ts', import.meta.url),
      'utf8',
    )
    expect(obligations).toContain('<ObligationsClient />')
    expect(domainAuthority).toContain("return value === 'receivable' || value === 'debt' ? value : 'all'")
  })
})

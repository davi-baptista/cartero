import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')
const statement = read('../app/(dashboard)/movements/statement/page.tsx')
const list = read('../components/ui/drawer-section.tsx')
const income = read('../app/(dashboard)/recurring/income-panel.tsx')
const automatic = read('../app/(dashboard)/recurring/subscription-panel.tsx')
const manual = read('../app/(dashboard)/recurring/manual-expense-panel.tsx')
const recurring = read('../app/(dashboard)/recurring/recurring-client.tsx')

describe('Recurring uses the Statement financial row composition', () => {
  it('uses the same list, motion surface, and page row without a grouped outline', () => {
    expect(statement).toContain('<FinancialRowList variant="page">')
    expect(statement).toContain("className={financialDrawerRowSurfaceClass('animatedWrapper')}")
    expect(statement).toMatch(/<FinancialListRow\s+variant="page"/)

    for (const panel of [income, automatic, manual]) {
      expect(panel).toContain('<FinancialRowList variant="page">')
      expect(panel).toContain('separator={false}')
      expect(panel).toContain("className={financialDrawerRowSurfaceClass('animatedWrapper')}")
      expect(panel).toContain('FinancialListRow')
      expect(panel).not.toContain('<FinancialRowList grouped>')
    }
    expect(income).toContain('<FinancialListRow variant="page"')
    expect(automatic).toMatch(/<FinancialListRow\s+variant="page"/)
    expect(manual).toContain('<FinancialListRow variant="page"')
    expect(list).not.toContain('grouped?: boolean')
  })

  it('preserves domain content, compact title spacing, and the approved shell', () => {
    expect(income).toContain("label={rule.isActive ? 'A RECEBER' : 'PAUSADA'}")
    expect(income).toContain("presentation?.tone === 'overdue'")
    expect(automatic).toContain('subscription.nextCharge')
    expect(automatic).toContain('TRANSACTION_TYPE_LABELS[subscription.type]')
    expect(manual).toContain("label={rule.isActive ? 'A PAGAR' : 'PAUSADA'}")
    expect(manual).toContain("late ? 'Em atraso'")
    expect(automatic).toContain('flex flex-col gap-3')
    expect(manual).toContain('flex flex-col gap-3')
    expect(recurring).toContain('mb-3 flex items-start gap-2')
    expect(recurring).toContain('label="Sobre receitas recorrentes"')
    expect(recurring).toContain('label="Sobre despesas recorrentes"')
    expect(recurring).toContain('<Sheet open={open} onOpenChange={handleOpenChange}')
  })
})

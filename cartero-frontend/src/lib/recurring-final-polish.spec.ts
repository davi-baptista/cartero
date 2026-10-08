import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const income = read('../app/(dashboard)/recurring/income-panel.tsx')
const automatic = read('../app/(dashboard)/recurring/subscription-panel.tsx')
const manual = read('../app/(dashboard)/recurring/manual-expense-panel.tsx')

describe('recurring drawer and expense language', () => {
  it('wraps income actions like manual expenses without hiding overflow', () => {
    const incomeActions = income.slice(income.indexOf('Editar renda'), income.indexOf('Próxima ocorrência'))
    expect(incomeActions).toContain('Pausar receita')
    expect(incomeActions).toContain('Excluir receita')
    expect(income).toContain('<div className="flex flex-wrap gap-2">')
    expect(manual).toContain('<div className="flex flex-wrap gap-2">')
    expect(incomeActions).not.toContain('overflow-x-hidden')
  })

  it('uses approved expense section and empty state copy', () => {
    expect(automatic).toContain('Lançamentos automáticos</h2>')
    expect(manual).toContain('Contas com pagamento manual</h2>')
    expect(manual).toContain('Nenhuma conta com pagamento manual cadastrada.')
    expect(manual).toContain('Crie contas recorrentes que ficam em aberto até você marcá-las como pagas.')
  })

  it('puts overdue emphasis on the functional status, leaving future and history rows neutral', () => {
    const incomeOpen = income.slice(income.indexOf('function OpenOccurrencesList'), income.indexOf('function HistoryOccurrencesList'))
    const manualDue = manual.slice(manual.indexOf('function DueRows'), manual.indexOf('export function ManualExpensePanel'))
    expect(incomeOpen).toContain('meta={overdue ? undefined :')
    expect(incomeOpen).toContain('labelTone={overdue ? \'text-destructive\' : undefined}')
    expect(incomeOpen).not.toContain("overdue ? 'Em atraso'")
    expect(manualDue).toContain('labelTone={overdue ? \'text-destructive\' : undefined}')
    expect(manual).toContain('resolved={false} overdue')
    expect(manual).toContain('resolved={false} /></DrawerSectionGroup>')
    expect(manual).toContain('resolved /></DrawerSectionGroup>')
  })
})

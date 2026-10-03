import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(new URL('../app/(dashboard)/movements/movements-shell.tsx', import.meta.url), 'utf8')
const statement = readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')
const obligations = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const filterStyles = readFileSync(new URL('./movement-filter-styles.ts', import.meta.url), 'utf8')
const select = readFileSync(new URL('../components/ui/select.tsx', import.meta.url), 'utf8')
const drawer = readFileSync(new URL('../components/person-statement-drawer.tsx', import.meta.url), 'utf8')
const addFlow = readFileSync(new URL('../app/(dashboard)/movements/movements-add-flow.tsx', import.meta.url), 'utf8')

const componentInvocation = (source: string, name: string) =>
  source.match(new RegExp(`<${name}\\b[\\s\\S]*?\\n\\s*\\/>`))?.[0] ?? ''

describe('Movements shell and obligations presentation parity', () => {
  it('keeps one shell authority for title, subtitle, CTA target, switch, divider, and vertical rhythm', () => {
    expect(shell.match(/<h1 /g)).toHaveLength(1)
    expect(shell.match(/Acompanhe o que aconteceu/g)).toHaveLength(1)
    expect(shell).toContain('<MovementsAddFlow />')
    expect(shell).toContain('<section className="space-y-4">')
    expect(shell).toContain('<div className="space-y-2">')
    expect(shell).toContain('border-t border-border/60')
    expect(shell).not.toContain('statementView')
    expect(addFlow).toContain('<SheetDescription>')
    expect(addFlow).toContain('Adicionar movimenta')
    expect(addFlow).toContain("target: 'expense'")
    expect(addFlow).toContain("target: 'income'")
    expect(addFlow).toContain("target: 'receivable'")
    expect(addFlow).toContain("target: 'debt'")
    expect(addFlow).toContain('onOpenChangeComplete={handleOpenChangeComplete}')
    expect(statement).not.toContain('sheetInitialKind')
    expect(addFlow).toContain('initialKind={activeTarget}')
    expect(componentInvocation(addFlow, 'DebtSheet')).toContain('editTarget={null}')
    expect(componentInvocation(addFlow, 'ReceivableSheet')).toContain('editTarget={null}')
    expect(componentInvocation(obligations, 'DebtSheet')).toContain("open={editTarget?.kind === 'debt'}")
    expect(componentInvocation(obligations, 'ReceivableSheet')).toContain("open={editTarget?.kind === 'receivable'}")
    expect(obligations).toContain("setEditTarget({ kind: 'debt', item })")
    expect(obligations).toContain("setEditTarget({ kind: 'receivable', item })")
  })

  it('uses the same filter chip and input classes in both views', () => {
    expect(statement).toContain('movementFilterChipClass(active)')
    expect(obligations).toContain('movementFilterChipClass(domain === option.value)')
    expect(statement).toContain('MOVEMENT_SEARCH_INPUT_CLASS')
    expect(obligations).toContain('MOVEMENT_SEARCH_INPUT_CLASS')
    expect(filterStyles).toContain('bg-primary/15 text-primary')
    expect(filterStyles).toContain('h-8 pl-8 pr-8 text-sm')
  })

  it('keeps person selection on the shared select primitive dimensions', () => {
    expect(statement).toContain('<SelectTrigger className="w-40"')
    expect(statement).toContain('<SelectTrigger className="w-44"')
    expect(obligations).toContain('<SelectTrigger className="w-full sm:w-56"')
    expect(select).toContain('data-[size=default]:h-8')
    expect(select).toContain('rounded-lg')
  })

  it('removes the internal duplicate title and renders all section empty states through Person authority', () => {
    expect(obligations).not.toContain('<h2 className="text-lg font-semibold tracking-tight">A pagar e receber</h2>')
    expect(obligations).toContain('<DrawerSectionEmpty inset={false} className="py-3 text-left">')
    expect(drawer).toContain('<DrawerSectionEmpty')
    expect(obligations).toContain("title: 'Em atraso', empty: 'Nenhum valor em atraso.'")
    expect(obligations).toContain("title: 'Em aberto', empty: 'Nenhum valor em aberto neste período.'")
    expect(obligations).toContain("title: 'Histórico', empty: 'Nenhum item resolvido neste período.'")
    expect(obligations).not.toContain('Pendências de todos os meses')
  })

  it('preserves responsive shell and all three independent sections', () => {
    expect(shell).toContain('w-full max-w-md')
    expect(shell).toContain('sm:inline-flex')
    expect(obligations).toContain('flex flex-wrap gap-2')
    expect(obligations).toContain('flex-col gap-2 sm:flex-row sm:items-center')
    expect(obligations).toContain('space-y-7')
    const sectionConfig = obligations.split('const SECTION_CONFIG')[1].split('const DOMAIN_OPTIONS')[0]
    expect(sectionConfig.match(/section: '(?:OVERDUE|OPEN|HISTORY)'/g)).toHaveLength(3)
  })
})

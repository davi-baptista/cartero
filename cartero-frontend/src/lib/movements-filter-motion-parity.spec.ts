import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const obligations = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const statement = readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../app/(dashboard)/movements/movements-shell.tsx', import.meta.url), 'utf8')
const motionRow = readFileSync(new URL('../components/ui/motion-row.tsx', import.meta.url), 'utf8')
const viewSwitch = readFileSync(new URL('./movement-view-switch.ts', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

describe('Movements filter and motion parity', () => {
  it('places person/search fields before domain chips on desktop and mobile', () => {
    const fields = obligations.indexOf('aria-label="Filtrar por pessoa"')
    const search = obligations.indexOf('placeholder="Buscar obrigações"')
    const chips = obligations.indexOf('role="group" aria-label="Filtrar por tipo de obrigação"')
    const sections = obligations.indexOf('<div className="space-y-7">')

    expect(fields).toBeGreaterThan(-1)
    expect(fields).toBeLessThan(search)
    expect(search).toBeLessThan(chips)
    expect(chips).toBeLessThan(sections)
    expect(obligations).not.toContain('aria-label={`Resumo de ${period.month}/${period.year}`}')
    expect(obligations).toContain('flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center')
    expect(obligations).toContain('flex flex-col gap-2">')
    expect(obligations).toContain('flex flex-wrap gap-2')
    expect(obligations).toContain('flex min-w-0 flex-col gap-4')
  })

  it('uses the exact statement MotionRow authority for all three obligation sections', () => {
    expect(statement).toContain('import { MotionRow }')
    expect(obligations).toContain('import { MotionRow }')
    expect(obligations).toContain('rows.map((row, index) => {')
    expect(obligations.replace(/\r\n/g, '\n')).toContain('key={rowKey}\n                index={index}\n                separator={false}')
    expect(obligations).toContain("financialDrawerRowSurfaceClass('animatedWrapper')")
    expect(motionRow).toContain('initial={{ opacity: 0, y: 8 }}')
    expect(motionRow).toContain('animate={{ opacity: 1, y: 0 }}')
    expect(motionRow).toContain('duration: 0.24')
    expect(motionRow).toContain('ease: EASE_OUT_EXPO')
    expect(motionRow).toContain('delay: Math.min(index, 12) * 0.04')
    expect(obligations).toContain("section: 'OVERDUE'")
    expect(obligations).toContain("section: 'OPEN'")
    expect(obligations).toContain("section: 'HISTORY'")
  })

  it('animates newly keyed rows on load-more and settlement without changing actions', () => {
    expect(obligations).toContain('query.fetchNextPage()')
    expect(obligations).toContain('key={rowKey}')
    expect(obligations).toContain('onToggleStatus={() => onSettle(row, section)}')
    expect(obligations).toContain('await queryClient.invalidateQueries({ queryKey: [\'obligations\'] })')
    expect(obligations).toContain('items: page.items.filter((item) => !(item.id === row.id && item.domain === row.domain))')
  })

  it('keeps one accessible shared transition authority on real view links', () => {
    expect(shell).toContain('href={href}')
    expect(shell).toContain('aria-current={active ? \'page\' : undefined}')
    expect(shell).toContain('className={movementViewLinkClass(active)}')
    expect(viewSwitch).toContain('focus-visible:ring-2')
    expect(viewSwitch).toContain('transition-colors duration-150 ease-out')
    expect(viewSwitch).toContain('bg-background text-foreground shadow-sm')
    expect(viewSwitch).not.toContain('hover:bg-')
    expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(motionRow).not.toContain('useReducedMotion')
  })
})

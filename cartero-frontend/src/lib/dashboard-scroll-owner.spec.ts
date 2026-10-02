import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8')
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/ui/sidebar.tsx', import.meta.url), 'utf8')
const highlight = readFileSync(new URL('./use-highlight.ts', import.meta.url), 'utf8')
const statement = readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')
const obligations = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const movementsShell = readFileSync(new URL('../app/(dashboard)/movements/movements-shell.tsx', import.meta.url), 'utf8')
const sheet = readFileSync(new URL('../components/ui/sheet.tsx', import.meta.url), 'utf8')
const dialog = readFileSync(new URL('../components/ui/dialog.tsx', import.meta.url), 'utf8')

describe('dashboard scroll owner', () => {
  it('constrains only the dashboard document and gives page scrolling to one viewport', () => {
    expect(layout).toMatch(/data-slot="dashboard-root"[^>]*className="[^"]*h-dvh[^"]*overflow-hidden/)
    expect(layout).toMatch(/data-slot="dashboard-scroll-viewport"\s+className="[^"]*min-h-0[^"]*overflow-y-auto/)
    expect(globalStyles).toMatch(/body:has\(\[data-slot="dashboard-root"\]\)\s*\{[^}]*height: 100dvh;[^}]*min-height: 0;[^}]*overflow: hidden;/)
    expect(layout.indexOf('<header')).toBeGreaterThan(layout.indexOf('data-slot="dashboard-scroll-viewport"'))
    expect(layout.indexOf('<main')).toBeGreaterThan(layout.indexOf('data-slot="dashboard-scroll-viewport"'))
    expect(sidebar).toContain('flex h-full min-h-0 w-full')
  })

  it('keeps header and Movements pages in the shared scrolling surface', () => {
    expect(layout).toContain('<TimezoneMismatchNotice />')
    expect(layout).toContain('<HeaderMonthNav pathname={pathname} />')
    expect(movementsShell).not.toMatch(/overflow-y-auto|overflow-auto|scrollTop\s*=/)
    expect(layout).toContain('{children}')
  })

  it('resets the shared viewport on pathname navigation without resetting query deep links', () => {
    expect(layout).toMatch(/dashboardScrollRef\.current\.scrollTop = 0\s*\}, \[pathname\]\)/)
    expect(layout).not.toContain('window.scrollTo')
    expect(layout).not.toContain('document.documentElement.scrollTop')
  })

  it('lets both statement and obligations highlights reach the dashboard scroll ancestor', () => {
    expect(highlight).toContain('node.scrollIntoView(')
    expect(highlight).not.toContain('window.scrollTo')
    expect(statement).toContain('useHighlight(')
    expect(statement).toContain('timelineRef.current?.scrollIntoView(')
    expect(obligations).toContain('useHighlight(')
  })

  it('keeps Base UI modal roots and shared backdrops enabled', () => {
    expect(sheet).toContain('<SheetPrimitive.Root data-slot="sheet" {...props} />')
    expect(sheet).toContain('<SheetOverlay />')
    expect(dialog).toContain('<DialogPrimitive.Root data-slot="dialog" {...props} />')
    expect(dialog).toContain('<DialogOverlay />')
    expect(sheet + dialog).not.toContain('modal={false}')
  })
})

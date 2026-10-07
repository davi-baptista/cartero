import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { navGroups, getNavigationGroup } from './dashboard-navigation'

const layout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8')

describe('dashboard navigation grouping', () => {
  it('uses the approved taxonomy as one sidebar authority', () => {
    expect(navGroups.map(({ label, items }) => [label, items.map(({ href }) => href)])).toEqual([
      ['Geral', ['/overview', '/movements', '/recurring']],
      ['Acompanhamento', ['/budget', '/commitments']],
      ['Contas', ['/banks', '/persons']],
      ['Organização', ['/categories']],
    ])

    expect(layout).toContain('navGroups.map(')
    expect(layout).toContain('isNavItemActive(href, pathname)')
    expect(layout).toContain('setOpenMobile(false)')
    expect(layout).toContain('getNavigationGroup(pathname)')
  })

  it.each([
    ['/overview', 'Geral'],
    ['/movements', 'Geral'],
    ['/movements/statement', 'Geral'],
    ['/movements/obligations', 'Geral'],
    ['/recurring', 'Geral'],
    ['/recurring?tab=income', 'Geral'],
    ['/recurring?tab=expenses', 'Geral'],
    ['/budget', 'Acompanhamento'],
    ['/commitments', 'Acompanhamento'],
    ['/banks', 'Contas'],
    ['/banks/abc/invoices', 'Contas'],
    ['/persons', 'Contas'],
    ['/persons?personId=abc', 'Contas'],
    ['/categories', 'Organização'],
    ['/profile', undefined],
    ['/banksomething', undefined],
    ['/unknown', undefined],
  ])('%s belongs to %s', (path, group) => {
    expect(getNavigationGroup(path)).toBe(group)
  })

  it('keeps profile separate and the chevron as the sidebar toggle', () => {
    expect(layout).toContain("pathname === '/profile' ? 'Meu perfil' : undefined")
    expect(layout).toContain('onClick={toggleSidebar}')
    expect(layout).toContain("'Recolher menu' : 'Expandir menu'")
    expect(layout).not.toContain('router.back()')
    expect(layout).toContain('hidden truncate text-sm font-medium sm:block')
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { navSections, getNavigationGroup } from './dashboard-navigation'

const layout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8')

describe('dashboard navigation grouping', () => {
  it('uses the approved taxonomy as one sidebar authority', () => {
    expect(navSections.map(({ label, items }) => [label, items.map(({ href }) => href)])).toEqual([
      [undefined, ['/overview']],
      ['Operações', ['/movements', '/recurring']],
      ['Acompanhamento', ['/budget', '/commitments']],
      ['Contas', ['/banks', '/persons']],
      ['Organização', ['/categories']],
    ])
    expect(navSections[0].items[0].label).toBe('Visão Geral')

    expect(layout).toContain('navSections.map(')
    expect(layout).toContain('groupLabel && (')
    expect(layout).toContain('<SidebarGroupLabel>{groupLabel.toLocaleUpperCase(')
    expect(layout).toContain('isNavItemActive(href, pathname)')
    expect(layout).toContain('tooltip={label}')
    expect(layout).toContain('<Icon className="size-4" />')
    expect(layout).toContain('setOpenMobile(false)')
    expect(layout).toContain('getNavigationGroup(pathname)')
    expect(layout).toContain('{currentPageLabel && (')
  })

  it.each([
    ['/overview', undefined],
    ['/movements', 'Operações'],
    ['/movements/statement', 'Operações'],
    ['/movements/obligations', 'Operações'],
    ['/recurring', 'Operações'],
    ['/recurring?tab=income', 'Operações'],
    ['/recurring?tab=expenses', 'Operações'],
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

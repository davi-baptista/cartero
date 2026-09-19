import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const layout = readFileSync(
  resolve(__dirname, '../app/(dashboard)/layout.tsx'),
  'utf8',
)

describe('dashboard navigation grouping', () => {
  it('keeps the approved groups and all primary routes', () => {
    expect(layout).toContain("label: 'GERAL'")
    expect(layout).toContain("label: 'PLANEJAMENTO'")
    expect(layout).toContain("label: 'CONTAS'")
    expect(layout).toContain("label: 'ORGANIZA\\u00c7\\u00c3O'")

    for (const href of [
      '/overview',
      '/budget',
      '/transactions',
      '/subscriptions',
      '/commitments',
      '/banks',
      '/categories',
      '/debts',
      '/receivables',
      '/persons',
    ]) {
      expect(layout).toContain(`href: '${href}'`)
    }

    expect(layout).not.toContain("href: '/profile'")
    expect(layout).toContain('isNavItemActive(href, pathname)')
    expect(layout).toContain('setOpenMobile(false)')
  })

  it('keeps the child invoice route under the Banks active surface', () => {
    expect(layout).toContain('const navItems = [')
    expect(layout).toContain("{ href: '/banks', label: 'Bancos'")
  })
})

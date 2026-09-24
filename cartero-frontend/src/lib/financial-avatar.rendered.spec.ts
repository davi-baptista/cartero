import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { FinancialAvatar } from '@/components/ui/financial-avatar'
import { CreditCard } from 'lucide-react'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('FinancialAvatar', () => {
  it('renders the empty 3D avatar from the canonical shared geometry', () => {
    const html = renderToStaticMarkup(createElement(FinancialAvatar))

    expect(html).toContain('size-10')
    expect(html).toContain('rounded-xl')
    expect(html).toContain('shadow-[var(--action-circle-depth)]')
    expect(html).toContain('ring-1 ring-border/50')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('<svg')
  })

  it('renders the icon inside the same avatar container', () => {
    const html = renderToStaticMarkup(
      createElement(FinancialAvatar, { icon: createElement(CreditCard), tone: 'income' }),
    )

    expect(html).toContain('rounded-xl')
    expect(html).toContain('bg-[var(--color-income-bg)]')
    expect(html).toContain('lucide-credit-card')
  })

  it('exposes click accessibly and stops the click from reaching the row', () => {
    const onClick = vi.fn()
    const element = FinancialAvatar({
      onClick,
      ariaLabel: 'Marcar como recebido',
    }) as ReactElement<{ onClick: (event: { stopPropagation: () => void }) => void }>
    const stopPropagation = vi.fn()
    const html = renderToStaticMarkup(createElement(FinancialAvatar, {
      onClick,
      ariaLabel: 'Marcar como recebido',
    }))

    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Marcar como recebido"')
    element.props.onClick({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('supports disabled and loading states', () => {
    const disabledHtml = renderToStaticMarkup(
      createElement(FinancialAvatar, { onClick: vi.fn(), ariaLabel: 'Ação', disabled: true }),
    )
    const loadingHtml = renderToStaticMarkup(
      createElement(FinancialAvatar, { onClick: vi.fn(), ariaLabel: 'Ação', loading: true }),
    )

    expect(disabledHtml).toContain('disabled=""')
    expect(loadingHtml).toContain('disabled=""')
    expect(loadingHtml).toContain('animate-spin')
    expect(loadingHtml).toContain('aria-label="Ação"')
  })

  it('is used by the approved shared financial surfaces', () => {
    for (const file of [
      '../app/(dashboard)/receivables/page.tsx',
      '../app/(dashboard)/debts/page.tsx',
      '../app/(dashboard)/income/page.tsx',
      '../app/(dashboard)/transactions/page.tsx',
      '../components/person-statement-drawer.tsx',
      '../components/budget-drilldown-item.tsx',
      '../components/ui/status-list-row.tsx',
      '../app/(dashboard)/subscriptions/page.tsx',
    ]) {
      expect(read(file), file).toContain('FinancialAvatar')
    }
  })
})

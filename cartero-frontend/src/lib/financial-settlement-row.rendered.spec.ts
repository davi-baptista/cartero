import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FinancialSettlementRow } from '@/components/ui/financial-settlement-row'

describe('FinancialSettlementRow interaction structure', () => {
  it('keeps the status circle and detail body as sibling controls and mutes resolved titles', () => {
    const html = renderToStaticMarkup(createElement(FinancialSettlementRow, {
      resolved: true,
      onToggleStatus: () => undefined,
      onView: () => undefined,
      ariaLabel: 'Abrir recebimento',
      statusActionLabel: 'Marcar como pendente',
      title: 'Salário',
      meta: 'Recebido em 10/09/2026',
    }))

    expect(html).toContain('Marcar como pendente')
    expect(html).toContain('Salário')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('<button')
    expect((html.match(/<button/g) ?? []).length).toBe(2)
    expect(html).not.toContain('<button><button')
  })
})

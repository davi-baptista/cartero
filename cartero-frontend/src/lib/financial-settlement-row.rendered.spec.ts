import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FinancialSettlementRow } from '@/components/ui/financial-settlement-row'

describe('FinancialSettlementRow interaction structure', () => {
  it('is reused for open and history actions in both recurring domains', () => {
    const income = readFileSync(new URL('../app/(dashboard)/recurring/income-panel.tsx', import.meta.url), 'utf8')
    const manual = readFileSync(new URL('../app/(dashboard)/recurring/manual-expense-panel.tsx', import.meta.url), 'utf8')
    expect(income).toContain('resolved={false}')
    expect(income).toContain('statusActionLabel={`Desfazer recebimento')
    expect(income).toContain('onToggleStatus={() => onReverse(occurrence)}')
    expect(manual).toContain('resolved={resolved}')
    expect(manual).toContain('onToggleStatus={() => onToggle(debt)}')
    expect(manual).toContain('Desfazer pagamento')
  })

  it.each(['open', 'overdue'])(
    'keeps the %s action as an accessible empty circle without a check',
    (state) => {
      const label = state === 'overdue' ? 'Marcar como pago' : 'Marcar como recebido'
      const html = renderToStaticMarkup(createElement(FinancialSettlementRow, {
        resolved: false,
        onToggleStatus: () => undefined,
        onView: () => undefined,
        ariaLabel: 'Abrir obrigação',
        statusActionLabel: label,
        title: 'Obrigação',
      }))

      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain('<button')
      expect(html).not.toContain('lucide-check')
      expect(html).not.toContain('lucide-undo-2')
    },
  )

  it('shows undo on a resolved action while keeping its accessible label', () => {
    const html = renderToStaticMarkup(createElement(FinancialSettlementRow, {
      resolved: true,
      onToggleStatus: () => undefined,
      onView: () => undefined,
      ariaLabel: 'Abrir recebimento',
      statusActionLabel: 'Desfazer recebimento',
      title: 'Salário',
    }))

    expect(html).toContain('aria-label="Desfazer recebimento"')
    expect(html).toContain('lucide-undo-2')
    expect(html).not.toContain('lucide-check')
  })

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

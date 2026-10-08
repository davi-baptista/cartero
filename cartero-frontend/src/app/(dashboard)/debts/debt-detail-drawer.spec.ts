import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Debt } from '@/types'

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ user: { timeZone: 'America/Sao_Paulo' } }),
}))

vi.mock('@/components/ui/detail-drawer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/detail-drawer')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DetailDrawer: ({ title, description, children, footer }: {
      title: ReactNode
      description?: ReactNode
      children: ReactNode
      footer?: ReactNode
    }) => createElement('section', null, createElement('h1', null, title), description, children, footer),
  }
})

import { DebtDetailDrawer } from './debt-detail-drawer'

const debt: Debt = {
  id: 'debt-1',
  userId: 'user-1',
  title: 'Aluguel',
  creditorName: 'Credor legado diferente do título',
  amount: 1000,
  description: 'Descrição da conta recorrente',
  occurredAt: '2026-10-05',
  dueDate: '2026-12-05',
  isAlertEnabled: true,
  isPaid: false,
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
}

function renderDebt(item: Debt) {
  return renderToStaticMarkup(createElement(DebtDetailDrawer, {
    debt: item,
    onOpenChange: vi.fn(),
    onTogglePaid: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }))
}

describe('Debt detail creditor presentation', () => {
  it('hides creditor by recurring origin while preserving title, description, fields and actions', () => {
    const markup = renderDebt({ ...debt, recurringExpenseRuleId: 'rule-1' })
    expect(markup).toContain('Aluguel')
    expect(markup).not.toMatch(/<dt[^>]*>Credor<\/dt>/)
    expect(markup).not.toContain('Credor legado diferente do título')
    for (const label of ['Valor', 'Status', 'Lançada em', 'Vencimento', 'Descrição']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Descrição da conta recorrente')
    for (const action of ['Marcar como paga', 'Editar', 'Excluir']) {
      expect(markup).toContain(action)
    }
  })

  it('keeps creditor visible for a non-recurring Debt', () => {
    const markup = renderDebt({ ...debt, recurringExpenseRuleId: null })
    expect(markup).toMatch(/<dt[^>]*>Credor<\/dt>/)
    expect(markup).toContain('Credor legado diferente do título')
    expect(markup).toContain('Descrição da conta recorrente')
  })
})

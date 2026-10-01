import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/detail-drawer', async () => {
  const React = await import('react')
  return {
    DetailDrawer: ({ title, description, footer, children }: { title: ReactNode; description?: ReactNode; footer?: ReactNode; children: ReactNode }) => React.createElement(
      'section',
      {},
      React.createElement('header', {}, title, description),
      children,
      footer,
    ),
    DetailFooter: ({ children }: { children: ReactNode }) => React.createElement('footer', {}, children),
    DetailRow: ({ label, children }: { label: string; children: ReactNode }) => React.createElement('div', {}, React.createElement('dt', {}, label), React.createElement('dd', {}, children)),
    DETAIL_ACTION_CLASS: '',
  }
})

import { TransactionDetailsDrawer } from '@/components/transaction-details-drawer'
import { TransactionType, type Transaction } from '@/types'

const transaction: Transaction = {
  id: 'tx-receipt-1',
  userId: 'user-1',
  bankId: 'bank-system',
  categoryId: 'category-receipt',
  type: TransactionType.INCOME,
  title: 'Ingresso do show',
  amount: 180,
  date: '2026-09-29T12:00:00.000Z',
  bank: { id: 'bank-system', name: '__system_receivables__', isSystem: true } as Transaction['bank'],
  category: { id: 'category-receipt', name: 'A receber pago', isSystem: true } as Transaction['category'],
  paymentReceivable: { person: { id: 'person-1', name: 'Rafael Lima' } },
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
}

function renderConsumer(withActions: boolean) {
  return renderToStaticMarkup(createElement(TransactionDetailsDrawer, {
    transaction,
    onClose: vi.fn(),
    ...(withActions ? { onEdit: vi.fn(), onDelete: vi.fn() } : {}),
  }))
}

function canonicalBody(markup: string) {
  const amountAndRows = markup.match(/<div class="border-b border-border bg-muted\/20 px-5 py-4">[\s\S]*?<\/dl>/)
  if (!amountAndRows) throw new Error('Canonical transaction detail body was not rendered')
  return amountAndRows[0]
}

describe('canonical transaction detail parity', () => {
  it('renders the same person context and body for Budget and Extrato while keeping actions consumer-owned', () => {
    const budget = renderConsumer(false)
    const extrato = renderConsumer(true)

    expect(budget).toContain('Recebido de')
    expect(extrato).toContain('Recebido de')
    expect(budget).toContain('Rafael Lima')
    expect(extrato).toContain('Rafael Lima')
    expect(canonicalBody(budget)).toBe(canonicalBody(extrato))
    expect(budget).not.toContain('Editar')
    expect(budget).not.toContain('Excluir')
    expect(extrato).toContain('Editar')
    expect(extrato).toContain('Excluir')
  })

  it('keeps the financial title and hides person context for generic income', () => {
    const generic = renderToStaticMarkup(createElement(TransactionDetailsDrawer, {
      transaction: { ...transaction, paymentReceivable: null },
      onClose: vi.fn(),
    }))
    expect(generic).toContain('Ingresso do show')
    expect(generic).not.toContain('Recebido de')
    expect(generic).not.toContain('Rafael Lima')
  })

  it('renders canonical paid-to context for debt payments and tolerates legacy links', () => {
    const debtPayment: Transaction = {
      ...transaction,
      id: 'tx-debt-payment-1',
      type: TransactionType.PIX,
      title: 'Dívida Teste',
      person: undefined,
      paymentReceivable: null,
      paymentDebt: { person: { id: 'person-2', name: 'Mariana Souza' } },
    }
    const budget = renderToStaticMarkup(createElement(TransactionDetailsDrawer, {
      transaction: debtPayment,
      onClose: vi.fn(),
    }))
    const extrato = renderToStaticMarkup(createElement(TransactionDetailsDrawer, {
      transaction: debtPayment,
      onClose: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    }))

    expect(budget).toContain('Dívida Teste')
    expect(budget).toContain('Pago para')
    expect(budget).toContain('Mariana Souza')
    expect(canonicalBody(budget)).toBe(canonicalBody(extrato))
    expect(extrato).toContain('Editar')
    expect(extrato).not.toContain('Devedor')

    const legacy = renderToStaticMarkup(createElement(TransactionDetailsDrawer, {
      transaction: { ...debtPayment, paymentDebt: null },
      onClose: vi.fn(),
    }))
    expect(legacy).toContain('Dívida Teste')
    expect(legacy).not.toContain('Pago para')
  })

  it('does not assign paid-to context to generic expenses or invoice payments', () => {
    for (const type of [TransactionType.PIX, TransactionType.INVOICE_PAYMENT]) {
      const markup = renderToStaticMarkup(createElement(TransactionDetailsDrawer, {
        transaction: {
          ...transaction,
          type,
          person: undefined,
          paymentReceivable: null,
          paymentDebt: null,
        },
        onClose: vi.fn(),
      }))
      expect(markup).not.toContain('Pago para')
    }
  })
})

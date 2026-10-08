import { readFileSync } from 'node:fs'
import { isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { TransactionType, type Transaction } from '@/types'
import { SubscriptionHistoryRow } from './subscription-detail-drawer'

const drawer = readFileSync(new URL('./subscription-detail-drawer.tsx', import.meta.url), 'utf8')
const statement = readFileSync(new URL('../movements/statement/page.tsx', import.meta.url), 'utf8')

const transaction: Transaction = {
  id: 'transaction-1',
  userId: 'user-1',
  bankId: 'bank-1',
  categoryId: 'category-1',
  subscriptionId: 'subscription-1',
  type: TransactionType.PIX,
  title: 'TotalPass',
  amount: 89.9,
  date: '2026-09-30T12:00:00.000Z',
  createdAt: '2026-09-30T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
}

describe('automatic subscription history detail', () => {
  it('renders a muted historical row while keeping its date, amount, metadata and status', () => {
    const element = SubscriptionHistoryRow({ transaction, onOpen: vi.fn() })
    const markup = renderToStaticMarkup(element)

    expect(markup).toContain(formatDate(transaction.date))
    expect(markup).toContain(formatCurrency(transaction.amount))
    expect(markup).toContain('TotalPass')
    expect(markup).toContain('LANÇADA')
    expect(markup).toContain('aria-label="Abrir lançamento em')
    expect(markup).toContain('text-muted-foreground')
    expect(markup).not.toContain('text-pending')
    expect(markup).not.toContain('text-destructive')
  })

  it('opens the full row with its Transaction id', () => {
    const onOpen = vi.fn()
    const element = SubscriptionHistoryRow({ transaction, onOpen })
    expect(isValidElement<{ onView?: () => void }>(element)).toBe(true)
    if (!isValidElement<{ onView?: () => void }>(element)) throw new Error('Missing financial row')
    element.props.onView?.()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(transaction.id)
  })

  it('uses the canonical Transaction detail and keeps the subscription drawer as parent', () => {
    expect(drawer).toContain('getTransactions({ subscriptionId: subscription!.id })')
    expect(drawer).toContain("queryKey: ['transaction', selectedTransactionId]")
    expect(drawer).toContain('getTransaction(selectedTransactionId!)')
    expect(drawer).toContain('subscription?.id === selectedTransaction.subscriptionId')
    expect(drawer).toContain('<TransactionDetailsDrawer')
    expect(drawer).toContain('transaction={selectedTransaction}')
    expect(drawer).toContain('onClose={() => setSelectedTransactionId(null)}')
    expect(drawer).toContain('if (!open) setSelectedTransactionId(null)')
    expect(drawer).toContain('<DrawerFinancialList>')
    expect(statement).toContain('<TransactionDetailsDrawer')
    expect(statement).toContain('fetchById: getTransaction')
  })
})

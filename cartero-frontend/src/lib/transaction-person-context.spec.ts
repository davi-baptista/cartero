import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transactionPersonContext } from '@/lib/transaction-person-context'
import { TransactionType, type Transaction } from '@/types'

const extrato = readFileSync(new URL('../app/(dashboard)/transactions/page.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../components/transaction-details-drawer.tsx', import.meta.url), 'utf8')
const budgetRow = readFileSync(new URL('../components/budget-drilldown-item.tsx', import.meta.url), 'utf8')

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'transaction-1', userId: 'user-1', bankId: 'bank-1', categoryId: 'category-1',
  type: TransactionType.INCOME, title: 'Reembolso de viagem', amount: 42,
  date: '2026-08-01', ...overrides,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
})

describe('transaction receipt person context', () => {
  it('uses the canonical receivable relation and leaves the financial title alone', () => {
    const receipt = transaction({ paymentReceivable: { person: { id: 'person-1', name: 'Rafael Lima' } } })
    expect(transactionPersonContext(receipt)).toEqual({
      direction: 'in', personName: 'Rafael Lima', label: 'recebido de',
    })
    expect(receipt.title).toBe('Reembolso de viagem')
  })

  it('does not assign a person to generic income or non-income transactions', () => {
    expect(transactionPersonContext(transaction({}))).toBeNull()
    expect(transactionPersonContext(transaction({
      type: TransactionType.PIX,
      paymentDebt: { person: { id: 'person-2', name: 'Mariana Souza' } },
    }))).toEqual({ direction: 'out', personName: 'Mariana Souza', label: 'pago para' })
    expect(transactionPersonContext(transaction({ type: TransactionType.PIX }))).toBeNull()
    expect(transactionPersonContext(transaction({
      type: TransactionType.INVOICE_PAYMENT,
      paymentDebt: null,
    }))).toBeNull()
  })

  it('normalizes Budget debt context with the same direction and label', () => {
    expect(transactionPersonContext({ direction: 'out', personName: 'Mariana Souza' })).toEqual({
      direction: 'out', personName: 'Mariana Souza', label: 'pago para',
    })
    expect(transactionPersonContext({ direction: 'out', personName: null })).toBeNull()
  })

  it('uses the normalized context in Extrato, Budget and canonical detail without replacing titles', () => {
    expect(extrato).toContain('title={tx.title}')
    expect(extrato).toContain('transactionPersonContext(tx)')
    expect(extrato).toContain('{personContext.label} {personContext.personName}')
    expect(detail).toContain('transactionPersonContext(transaction)')
    expect(detail).toContain("personContext.direction === 'in' ? 'Recebido de' : 'Pago para'")
    expect(budgetRow).toContain('transactionPersonContext({ direction: \'out\', personName: item.personName })')
    expect(budgetRow).toContain('primary = item.title || item.counterparty')
  })
})

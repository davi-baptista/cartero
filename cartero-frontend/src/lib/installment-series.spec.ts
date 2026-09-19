import { describe, expect, it } from 'vitest'
import { TransactionType, type Transaction } from '@/types'
import { belongsToSeries, installmentMetadata } from './installment-series'

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    userId: 'user-1',
    bankId: 'bank-1',
    categoryId: 'category-1',
    type: TransactionType.INCOME,
    title: 'Periodo de 24(08 a 11/09',
    amount: 100,
    date: '2026-09-18',
    createdAt: '2026-09-18T19:00:00.000Z',
    updatedAt: '2026-09-18T19:00:00.000Z',
    ...overrides,
  }
}

describe('installment-series structural authority', () => {
  it('keeps a new date-like standalone title out of the legacy fallback', () => {
    const tx = transaction()

    expect(installmentMetadata(tx)).toBeNull()
    expect(belongsToSeries(tx)).toBe(false)
  })

  it('keeps a new standalone Aluguel 1/2 out of the legacy fallback', () => {
    const tx = transaction({ title: 'Aluguel 1/2' })

    expect(installmentMetadata(tx)).toBeNull()
    expect(belongsToSeries(tx)).toBe(false)
  })

  it('uses structural metadata after a title edit', () => {
    const tx = transaction({
      title: 'Periodo de 24(08 a 11/09',
      parentId: 'tx-root',
      installmentIndex: 2,
      installmentCount: 9,
    })

    expect(installmentMetadata(tx)).toEqual({
      index: 2,
      count: 9,
      structural: true,
    })
    expect(belongsToSeries(tx)).toBe(true)
  })

  it('does not use title fallback even for pre-cutover rows', () => {
    const tx = transaction({
      title: 'Notebook 2/3',
      createdAt: '2026-09-18T18:59:59.999Z',
    })

    expect(installmentMetadata(tx)).toBeNull()
    expect(belongsToSeries(tx)).toBe(false)
  })
})

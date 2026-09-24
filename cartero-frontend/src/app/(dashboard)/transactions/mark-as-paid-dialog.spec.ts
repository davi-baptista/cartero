import { describe, expect, it } from 'vitest'
import { TransactionType } from '@/types'
import { buildSettlementPayload } from './mark-as-paid-dialog'

describe('settlement payload', () => {
  it('uses INCOME for receivables while preserving date and bank', () => {
    expect(buildSettlementPayload({ kind: 'receivable', createTransaction: true, paymentDate: '2026-09-23', bankId: 'bank-1', type: '' })).toEqual({
      paymentDate: '2026-09-23', paymentBankId: 'bank-1', paymentType: TransactionType.INCOME,
    })
  })

  it('keeps debt payment type behavior unchanged', () => {
    expect(buildSettlementPayload({ kind: 'debt', createTransaction: true, paymentDate: '2026-09-23', bankId: 'bank-1', type: TransactionType.PIX })).toMatchObject({ paymentType: TransactionType.PIX })
  })
})

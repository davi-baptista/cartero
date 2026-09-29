import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { syncSettlementEntity } from './settlement-cache'
import type { Receivable } from '@/types'

const item = (isPaid: boolean): Receivable => ({
  id: 'r-1', userId: 'u-1', title: 'Cobrança', debtorName: 'Pessoa', amount: 100,
  occurredAt: '2026-09-01', dueDate: '2026-09-10', isPaid, paidAt: isPaid ? '2026-09-10' : undefined,
  incomeClassification: 'OTHER', createdAt: '', updatedAt: '',
})

describe('settlement cache synchronization', () => {
  it('updates detail and every matching receivables list without closing the drawer', () => {
    const client = new QueryClient()
    client.setQueryData(['receivable', 'r-1'], item(false))
    client.setQueryData(['receivables', undefined, '2026-09-30'], [item(false)])

    syncSettlementEntity(client, 'receivable', 'r-1', item(true))

    expect(client.getQueryData<Receivable>(['receivable', 'r-1'])?.isPaid).toBe(true)
    expect(client.getQueryData<Receivable[]>(['receivables', undefined, '2026-09-30'])?.[0].isPaid).toBe(true)
  })
})

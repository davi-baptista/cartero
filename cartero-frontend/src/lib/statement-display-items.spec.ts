import { describe, expect, it } from 'vitest'
import { TransactionType, type Transaction } from '@/types'
import { buildStatementDisplayItems } from './statement-display-items'

const installment = (id: string, index: number, parentId?: string): Transaction => ({
  id,
  userId: 'user',
  bankId: 'bank',
  categoryId: 'category',
  parentId,
  installmentIndex: index,
  installmentCount: 3,
  type: TransactionType.CREDIT_CARD,
  title: `Purchase ${index}/3`,
  amount: 100,
  date: '2026-09-10T00:00:00.000Z',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
})

describe('statement grouped purchase identity over accumulated pages', () => {
  it('merges a series split across cursor pages under its original root', () => {
    const pages = [
      [installment('root', 1), {
        ...installment('single', 0),
        title: 'Single',
        installmentIndex: null,
        installmentCount: null,
        date: '2026-09-09',
      }],
      [installment('child-2', 2, 'root'), installment('child-3', 3, 'root')],
    ]
    const result = buildStatementDisplayItems(pages.flat())

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ kind: 'installment', groupId: 'root' })
    expect(result.groups.get('root')?.map(({ id }) => id)).toEqual([
      'root', 'child-2', 'child-3',
    ])
  })

  it('deduplicates transaction identity and does not create a second group row', () => {
    const root = installment('root', 1)
    const result = buildStatementDisplayItems([root, installment('child', 2, 'root'), root])
    expect(result.items.filter(({ kind }) => kind === 'installment')).toHaveLength(1)
    expect(result.groups.get('root')).toHaveLength(2)
  })
})

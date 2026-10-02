import type { Transaction } from '@/types'
import { belongsToSeries, installmentPosition } from '@/lib/installment-series'

export type StatementDisplayItem =
  | { kind: 'single'; tx: Transaction; date: string }
  | { kind: 'installment'; groupId: string; date: string }

export function buildStatementDisplayItems(transactions: readonly Transaction[]) {
  const groups = new Map<string, Transaction[]>()
  const items: StatementDisplayItem[] = []
  const seenTransactions = new Set<string>()

  for (const tx of transactions) {
    if (seenTransactions.has(tx.id)) continue
    seenTransactions.add(tx.id)

    if (!belongsToSeries(tx)) {
      items.push({ kind: 'single', tx, date: tx.date })
      continue
    }

    const groupId = tx.parentId ?? tx.id
    const existing = groups.get(groupId)
    if (existing) {
      existing.push(tx)
    } else {
      groups.set(groupId, [tx])
      items.push({ kind: 'installment', groupId, date: tx.date })
    }
  }

  for (const installments of groups.values()) {
    installments.sort(
      (a, b) => (installmentPosition(a) ?? 0) - (installmentPosition(b) ?? 0),
    )
  }

  return { items, groups }
}

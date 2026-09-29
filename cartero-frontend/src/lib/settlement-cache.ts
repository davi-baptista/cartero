import type { QueryClient } from '@tanstack/react-query'
import type { Debt, Receivable } from '@/types'

type SettlementEntity = Debt | Receivable

/**
 * Faz a resposta da mutation aparecer imediatamente em qualquer lista/detalhe
 * já montado. A invalidação continua necessária para os agregados derivados.
 */
export function syncSettlementEntity(
  queryClient: QueryClient,
  kind: 'debt' | 'receivable',
  id: string,
  result: SettlementEntity | SettlementEntity[],
) {
  const entity = Array.isArray(result) ? result.find((item) => item.id === id) : result
  if (!entity || entity.id !== id) return

  const detailKey = kind === 'debt' ? ['debt', id] : ['receivable', id]
  const listKey = kind === 'debt' ? ['debts'] : ['receivables']

  queryClient.setQueryData(detailKey, entity)
  queryClient.setQueriesData<SettlementEntity[]>({ queryKey: listKey }, (current) =>
    current?.map((item) => (item.id === id ? entity : item)),
  )
}

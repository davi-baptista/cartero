'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DetailAmount, DetailDrawer } from '@/components/ui/detail-drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { getBudgetV2Drilldown } from '@/services/budget.service'
import { formatCurrency } from '@/lib/formatters'
import {
  drilldownContextLabel,
  DRILLDOWN_BUCKET_CONFIG,
} from '@/lib/budget-drilldown-config'
import type { BudgetV2PeriodPreset } from '@/types/budget-v2'
import type { BudgetV2DrilldownBucket } from '@/types/budget-v2-drilldown'
import { BudgetDrilldownItemRow } from './budget-drilldown-item'

function DrawerLoading() {
  return (
    <div className="space-y-3 px-5 py-5" role="status" aria-label="Carregando detalhes">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="flex items-center gap-3" key={index}>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

function DrawerError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Não foi possível carregar os detalhes.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  )
}

export function BudgetDrilldownDrawer({
  bucket,
  preset,
  open,
  onClose,
}: {
  bucket: BudgetV2DrilldownBucket | null
  preset: BudgetV2PeriodPreset
  open: boolean
  onClose: () => void
}) {
  const activeBucket = bucket ?? null
  const query = useInfiniteQuery({
    queryKey: ['budget-v2-drilldown', activeBucket, preset],
    enabled: open && activeBucket !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getBudgetV2Drilldown({
        bucket: activeBucket!,
        ...(DRILLDOWN_BUCKET_CONFIG[activeBucket!].scope === 'period' ? { preset } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor ?? undefined,
  })
  const fetchNextPage = query.fetchNextPage

  if (!activeBucket) return null

  const config = DRILLDOWN_BUCKET_CONFIG[activeBucket]
  const pages = query.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  const firstPage = pages[0]
  const contextLabel = drilldownContextLabel(activeBucket, preset)
  const showPaginationError = query.isFetchNextPageError && items.length > 0

  return (
    <DetailDrawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      title={config.title}
      description={contextLabel}
    >
      {query.isLoading ? (
        <DrawerLoading />
      ) : query.isError ? (
        <DrawerError onRetry={() => void query.refetch()} />
      ) : (
        <>
          {firstPage && (
            <DetailAmount label="Total">
              <p className="text-2xl font-semibold tabular-nums">
                {formatCurrency(Number(firstPage.total))}
              </p>
            </DetailAmount>
          )}
          {items.length > 0 ? (
            <div>
              {items.map((item) => (
                <BudgetDrilldownItemRow
                  bucket={activeBucket}
                  item={item}
                  key={`${item.kind}:${item.id}`}
                  timeZone={firstPage?.context.timeZone ?? 'America/Sao_Paulo'}
                />
              ))}
            </div>
          ) : (
            <p className="px-5 py-8 text-sm text-muted-foreground">Nenhum contribuinte encontrado.</p>
          )}
          {showPaginationError && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-xs text-muted-foreground">Não foi possível carregar mais itens.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void fetchNextPage()}>
                Tentar novamente
              </Button>
            </div>
          )}
          {firstPage?.pageInfo.hasMore && !showPaginationError && (
            <div className="flex justify-center border-t border-border px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {query.isFetchingNextPage ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Carregando…
                  </>
                ) : (
                  'Carregar mais'
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </DetailDrawer>
  )
}

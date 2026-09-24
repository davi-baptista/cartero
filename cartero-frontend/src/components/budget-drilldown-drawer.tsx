'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { MarkAsPaidDialog } from '@/app/(dashboard)/transactions/mark-as-paid-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { getBudgetV2Drilldown } from '@/services/budget.service'
import { updateDebt } from '@/services/debts.service'
import { updateReceivable } from '@/services/receivables.service'
import { getPerson } from '@/services/persons.service'
import { getTransaction } from '@/services/transactions.service'
import { PersonStatementDrawer } from '@/components/person-statement-drawer'
import { TransactionDetailsDrawer } from '@/components/transaction-details-drawer'
import { InvoiceDetailsDrawer } from '@/components/invoice-details-drawer'
import { DebtDetailDrawer } from '@/app/(dashboard)/debts/debt-detail-drawer'
import { ReceivableDetailDrawer } from '@/app/(dashboard)/receivables/receivable-detail-drawer'
import { getDebt } from '@/services/debts.service'
import { getReceivable } from '@/services/receivables.service'
import type { MonthPeriod } from '@/components/month-nav'
import { accountCivilDayOf } from '@/lib/date'
import { formatCurrency } from '@/lib/formatters'
import {
  drilldownContextLabel,
  DRILLDOWN_BUCKET_CONFIG,
  drilldownSectionHeading,
} from '@/lib/budget-drilldown-config'
import type { BudgetV2PeriodPreset } from '@/types/budget-v2'
import type { TransactionType } from '@/types'
import type { BudgetV2DrilldownBucket } from '@/types/budget-v2-drilldown'
import type { BudgetV2DrilldownItem } from '@/types/budget-v2-drilldown'
import { BudgetDrilldownItemRow, type BudgetQuickSettlementTarget } from './budget-drilldown-item'

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
  const queryClient = useQueryClient()
  const [settlementTarget, setSettlementTarget] = useState<BudgetQuickSettlementTarget | null>(null)
  const [selectedPerson, setSelectedPerson] = useState<{
    id: string
    period: MonthPeriod
  } | null>(null)
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<{ id: string; bankId: string } | null>(null)
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null)
  const [selectedReceivableId, setSelectedReceivableId] = useState<string | null>(null)
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
  const personQuery = useQuery({
    queryKey: ['person', selectedPerson?.id],
    queryFn: () => getPerson(selectedPerson!.id),
    enabled: selectedPerson !== null,
    retry: false,
  })
  const transactionQuery = useQuery({
    queryKey: ['transaction', selectedTransactionId],
    queryFn: () => getTransaction(selectedTransactionId!),
    enabled: selectedTransactionId !== null,
    retry: false,
  })
  const debtQuery = useQuery({
    queryKey: ['debt', selectedDebtId],
    queryFn: () => getDebt(selectedDebtId!),
    enabled: selectedDebtId !== null,
    retry: false,
  })
  const receivableQuery = useQuery({
    queryKey: ['receivable', selectedReceivableId],
    queryFn: () => getReceivable(selectedReceivableId!),
    enabled: selectedReceivableId !== null,
    retry: false,
  })
  const settlementMutation = useMutation({
    mutationFn: async ({ target, payload }: {
      target: BudgetQuickSettlementTarget
      payload: { paymentBankId?: string; paymentType?: TransactionType; paymentDate?: string }
    }) => {
      if (target.kind === 'receivable') {
        await updateReceivable(target.id, { isPaid: true, ...payload })
      } else {
        await updateDebt(target.id, { isPaid: true, ...payload })
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['budget-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['budget-v2-drilldown'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
      ])
      setSettlementTarget(null)
      toast.success('Item marcado como resolvido')
    },
    onError: () => toast.error('NÃ£o foi possÃ­vel concluir o acerto.'),
  })

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
            <div className="mx-5 mt-4 rounded-xl bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">Total</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(Number(firstPage.total))}
              </p>
            </div>
          )}
          {items.length > 0 ? (
            <>

                <div className="mx-5 mt-8 hidden">
                  <h3 className="text-sm font-medium">Movimentações</h3>
                </div>
                <div className="mx-5 mt-8">
                  <h3 className="text-sm font-medium">{drilldownSectionHeading(activeBucket)}</h3>
                </div>
              <div className="mt-2 divide-y divide-border/60 px-5">
                {items.map((item) => (
                  <BudgetDrilldownItemRow
                    bucket={activeBucket}
                    item={item}
                    key={`${item.kind}:${item.id}`}
                    timeZone={firstPage?.context.timeZone ?? 'America/Sao_Paulo'}
                    onQuickAction={setSettlementTarget}
                    onView={(item: BudgetV2DrilldownItem) => {
                      if (item.kind === 'TRANSACTION' || item.kind === 'RECEIVABLE_RECEIPT' || item.kind === 'DEBT_SETTLEMENT') {
                        setSelectedTransactionId(item.id)
                        return
                      }
                      if (item.kind === 'INVOICE_SETTLEMENT') {
                        if (item.transactionId) {
                          setSelectedTransactionId(item.transactionId)
                          return
                        }
                        setSelectedInvoice({ id: item.sourceId, bankId: item.bankId })
                        return
                      }
                      if (item.kind === 'INVOICE') {
                        setSelectedInvoice({ id: item.id, bankId: item.bankId })
                        return
                      }
                      if (item.kind === 'DEBT') {
                        setSelectedDebtId(item.id)
                        return
                      }
                      if (item.kind === 'RECEIVABLE') {
                        setSelectedReceivableId(item.id)
                        return
                      }
                      if (item.kind !== 'PERSON_SETTLEMENT') return
                      if (item.settlementTransactionId) {
                        setSelectedTransactionId(item.settlementTransactionId)
                        return
                      }
                      const civilDate = accountCivilDayOf(
                        item.eventDate,
                        firstPage?.context.timeZone ?? 'America/Sao_Paulo',
                      )
                      const [year, month] = civilDate.split('-').map(Number)
                      setSelectedPerson({
                        id: item.personId,
                        period: { month, year },
                      })
                    }}
                    quickActionPending={settlementMutation.isPending}
                  />
                ))}
              </div>
            </>
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
      <MarkAsPaidDialog
        open={settlementTarget !== null}
        kind={settlementTarget?.kind ?? 'receivable'}
        isPending={settlementMutation.isPending}
        onConfirm={(payload) => {
          if (!settlementTarget) return
          settlementMutation.mutate({ target: settlementTarget, payload })
        }}
        onCancel={() => {
          if (!settlementMutation.isPending) setSettlementTarget(null)
        }}
      />
      {selectedPerson && personQuery.data && (
        <PersonStatementDrawer
          person={{
            id: personQuery.data.id,
            name: personQuery.data.name,
            phone: personQuery.data.phone,
          }}
          open
          onClose={() => setSelectedPerson(null)}
          period={selectedPerson.period}
        />
      )}
      {selectedTransactionId && transactionQuery.data && (
        <TransactionDetailsDrawer
          transaction={transactionQuery.data}
          onClose={() => setSelectedTransactionId(null)}
        />
      )}
      {selectedInvoice && (
        <InvoiceDetailsDrawer
          invoiceId={selectedInvoice.id}
          bankId={selectedInvoice.bankId}
          open
          onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedInvoice(null) }}
        />
      )}
      {selectedDebtId && debtQuery.data && (
        <DebtDetailDrawer
          debt={debtQuery.data}
          onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedDebtId(null) }}
          onEdit={() => undefined}
          onDelete={() => undefined}
          onTogglePaid={() => undefined}
          readOnly
        />
      )}
      {selectedReceivableId && receivableQuery.data && (
        <ReceivableDetailDrawer
          receivable={receivableQuery.data}
          onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedReceivableId(null) }}
          onEdit={() => undefined}
          onToggleReceived={() => undefined}
          readOnly
        />
      )}
    </DetailDrawer>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Search, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DrawerSectionEmpty, FinancialRowList } from '@/components/ui/drawer-section'
import { FinancialSettlementRow } from '@/components/ui/financial-settlement-row'
import { MotionRow } from '@/components/ui/motion-row'
import { financialDrawerRowSurfaceClass } from '@/components/ui/financial-drawer-row-surface'
import { ROW_AMOUNT_CLASS, ROW_AMOUNT_TONE, ROW_RESOLVED_TONE } from '@/components/ui/financial-list-row'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { DebtDetailDrawer } from '@/app/(dashboard)/debts/debt-detail-drawer'
import { ReceivableDetailDrawer } from '@/app/(dashboard)/receivables/receivable-detail-drawer'
import { MarkAsPaidDialog } from '@/app/(dashboard)/transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '@/app/(dashboard)/transactions/unmark-paid-warning-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DebtSheet, type DebtFormData } from '@/app/(dashboard)/debts/debt-sheet'
import { ReceivableSheet, type ReceivableFormData } from '@/app/(dashboard)/receivables/receivable-sheet'
import { useMonthPeriod } from '@/components/month-nav'
import { useAuth } from '@/providers/auth-provider'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { accountToday, formatDateValue, parseDateOnly } from '@/lib/date'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useDetailNavigation } from '@/lib/detail-navigation'
import { useDetailEntity } from '@/lib/use-detail-entity'
import {
  apiObligationDomain,
  applyObligationSummaryDelta,
  obligationSummaryDelta,
  obligationsOverdueSummaryKey,
  obligationsSectionKey,
  obligationsSummaryKey,
  parseObligationDomain,
  recurringIncomeReconcileKey,
  type ObligationDomainFilter,
} from '@/lib/obligations-query'
import { syncSettlementEntity } from '@/lib/settlement-cache'
import { timingUrgency } from '@/lib/invoice-timing'
import { movementFilterChipClass, MOVEMENT_SEARCH_INPUT_CLASS } from '@/lib/movement-filter-styles'
import { MovementContextHeading } from '../movement-context-heading'
import { formatObligationSectionNet, isZeroObligationAmount } from '@/lib/obligations-presentation'
import { useHighlight } from '@/lib/use-highlight'
import {
  findObligationHighlightRow,
  obligationHighlightPeriod,
  obligationHighlightPeriodDate,
  obligationResolvedCivilDay,
  obligationHighlightSection,
  parseObligationPeriodContext,
  sameObligationPeriod,
  type ObligationHighlightEntity,
} from '@/lib/obligation-highlight'
import { getPersons } from '@/services/persons.service'
import { deleteDebt, getDebt, updateDebt } from '@/services/debts.service'
import { deleteReceivable, getReceivable, undoAndDeleteRecurringIncomeReceived, updateReceivable } from '@/services/receivables.service'
import { getTransaction } from '@/services/transactions.service'
import {
  getObligations,
  getObligationsSummary,
  type ObligationPage,
  type ObligationRow,
  type ObligationSection,
  type ObligationSummary,
} from '@/services/obligations.service'
import type { Debt, Receivable } from '@/types'
import type { TransactionType } from '@/types'
import { cn } from '@/lib/utils'
import { resolveReceivableDeletePolicy, canDeleteReceivable } from '@/lib/receivable-delete-policy'
import { invalidateTransactionDependents } from '@/lib/transaction-dependent-queries'
import { reconcileRecurringIncomePeriod } from '@/services/recurring-income.service'
import { reconcileRecurringExpensePeriod } from '@/services/recurring-expense.service'

type SettlementPaymentPayload = {
  paymentBankId?: string
  paymentType?: TransactionType
  paymentDate?: string
}

const OBLIGATIONS_QUERY_STALE_TIME = 30_000
const OBLIGATIONS_QUERY_GC_TIME = 10 * 60_000

async function reconcileObligationPeriod(
  queryClient: QueryClient,
  userId: string,
  period: { month: number; year: number },
) {
  const result = await queryClient.fetchQuery({
    queryKey: recurringIncomeReconcileKey(userId, period),
    queryFn: () => reconcileRecurringIncomePeriod(period),
    staleTime: Infinity,
    gcTime: OBLIGATIONS_QUERY_GC_TIME,
  })
  const expenseResult = await queryClient.fetchQuery({
    queryKey: ['recurring-expense-reconcile', userId, period.year, period.month],
    queryFn: () => reconcileRecurringExpensePeriod(period),
    staleTime: Infinity,
    gcTime: OBLIGATIONS_QUERY_GC_TIME,
  })
  const overdueRefreshKey = [
    'recurring-income-overdue-refresh',
    userId,
    period.year,
    period.month,
  ] as const
  if ((result.created > 0 || expenseResult.created > 0) && !queryClient.getQueryData(overdueRefreshKey)) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['debts'] }),
      queryClient.invalidateQueries({ queryKey: ['obligations', 'section'] }),
      queryClient.invalidateQueries({ queryKey: ['obligations', 'summary'] }),
      queryClient.invalidateQueries({
        queryKey: ['obligations', 'section', 'OVERDUE'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['obligations', 'summary-overdue'],
      }),
    ])
    queryClient.setQueryData(overdueRefreshKey, true)
  }
}

const SECTION_CONFIG: Array<{
  section: ObligationSection
  title: string
  empty: string
}> = [
  { section: 'OVERDUE', title: 'Em atraso', empty: 'Nenhum valor em atraso.' },
  { section: 'OPEN', title: 'Em aberto', empty: 'Nenhum valor em aberto neste período.' },
  { section: 'HISTORY', title: 'Histórico', empty: 'Nenhum item resolvido neste período.' },
]

const DOMAIN_OPTIONS: Array<{ value: ObligationDomainFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'receivable', label: 'A receber' },
  { value: 'debt', label: 'Dívidas' },
]

async function resolveHighlightTarget(
  id: string,
  preferredDomain: ObligationDomainFilter,
  timeZone: string | null | undefined,
): Promise<ObligationHighlightEntity> {
  const [debtResult, receivableResult] = await Promise.allSettled([
    getDebt(id),
    getReceivable(id),
  ])
  const debt = debtResult.status === 'fulfilled' ? debtResult.value : null
  const receivable = receivableResult.status === 'fulfilled' ? receivableResult.value : null

  if (debt && receivable) {
    if (preferredDomain === 'debt') return resolveDebtHighlight(debt, timeZone)
    if (preferredDomain === 'receivable') return resolveReceivableHighlight(receivable, timeZone)
    throw new Error('Ambiguous obligation highlight id')
  }
  if (debt) return resolveDebtHighlight(debt, timeZone)
  if (receivable) return resolveReceivableHighlight(receivable, timeZone)
  throw new Error('Obligation highlight target not found')
}

async function resolveDebtHighlight(
  entity: Debt,
  timeZone: string | null | undefined,
): Promise<ObligationHighlightEntity> {
  const paymentDate = !entity.paidAt && entity.paymentTransactionId
    ? await getTransaction(entity.paymentTransactionId).then((transaction) => transaction.date).catch(() => null)
    : null
  return {
    domain: 'DEBT',
    id: entity.id,
    personId: entity.personId ?? null,
    isPaid: entity.isPaid,
    dueDate: entity.dueDate,
    resolvedAt: entity.isPaid ? obligationResolvedCivilDay(entity.paidAt, paymentDate, timeZone) : null,
  }
}

async function resolveReceivableHighlight(
  entity: Receivable,
  timeZone: string | null | undefined,
): Promise<ObligationHighlightEntity> {
  const paymentDate = !entity.paidAt && entity.paymentTransactionId
    ? await getTransaction(entity.paymentTransactionId).then((transaction) => transaction.date).catch(() => null)
    : null
  return {
    domain: 'RECEIVABLE',
    id: entity.id,
    personId: entity.personId ?? null,
    isPaid: entity.isPaid,
    dueDate: entity.dueDate,
    resolvedAt: entity.isPaid ? obligationResolvedCivilDay(entity.paidAt, paymentDate, timeZone) : null,
  }
}

function useObligationSectionQuery({
  section,
  domain,
  search,
  personId,
  month,
  year,
  userId,
}: {
  section: ObligationSection
  domain: ReturnType<typeof apiObligationDomain>
  search: string
  personId?: string
  month: number
  year: number
  userId?: string
}) {
  const queryClient = useQueryClient()
  return useInfiniteQuery({
    queryKey: obligationsSectionKey({ section, domain, search, personId, month, year }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (section === 'OPEN' && userId) {
        await reconcileObligationPeriod(queryClient, userId, { month, year })
      }
      return getObligations({
        section,
        domain,
        search: search || undefined,
        personId,
        ...(section === 'OVERDUE' ? {} : { month, year }),
        cursor: pageParam ?? undefined,
        limit: 30,
      })
    },
    getNextPageParam: (lastPage) => lastPage.pageInfo.hasMore
      ? lastPage.pageInfo.nextCursor ?? undefined
      : undefined,
    enabled: section !== 'OPEN' || Boolean(userId),
    staleTime: OBLIGATIONS_QUERY_STALE_TIME,
    gcTime: OBLIGATIONS_QUERY_GC_TIME,
  })
}

function shortDate(date: string) {
  const [day, month] = formatDate(date).split('/')
  return `${day}/${month}`
}

function ObligationSectionView({
  section,
  title,
  empty,
  query,
  today,
  pendingRowKey,
  highlightedRowKey,
  highlightRef,
  onView,
  onSettle,
  onLoadMore,
  summary,
  summaryIsLoading,
  summaryHasError,
}: {
  section: ObligationSection
  title: string
  empty: string
  query: ReturnType<typeof useObligationSectionQuery>
  today: string
  pendingRowKey: string | null
  highlightedRowKey: string | null
  highlightRef: (node: HTMLElement | null) => void
  onView: (row: ObligationRow) => void
  onSettle: (row: ObligationRow, section: ObligationSection) => void
  onLoadMore: () => void
  summary: string | undefined
  summaryIsLoading: boolean
  summaryHasError: boolean
}) {
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  const showSectionSummary = section !== 'HISTORY' && !(rows.length === 0 && summary !== undefined && isZeroObligationAmount(summary))

  return (
    <section className="space-y-2" aria-labelledby={`obligations-${section.toLowerCase()}`}>
      <h3 id={`obligations-${section.toLowerCase()}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm font-medium">
        <span>{title}</span>
        {showSectionSummary && (
          summaryIsLoading ? (
            <Skeleton className="ml-auto h-4 w-28" aria-label={`Carregando total de ${title.toLocaleLowerCase()}`} />
          ) : summaryHasError || summary === undefined ? (
            <span className="ml-auto text-xs font-normal text-muted-foreground" role="status">Indisponível</span>
          ) : (
            <span className={cn('ml-auto text-right text-xs font-medium sm:text-sm', ROW_AMOUNT_TONE.neutral)}>
              {formatObligationSectionNet(summary)}
            </span>
          )
        )}
      </h3>

      {query.isLoading ? (
        <FinancialRowList variant="page">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-[4.5rem] w-full" />)}
        </FinancialRowList>
      ) : query.error && rows.length === 0 ? (
        <QueryError
          message={`Não foi possível carregar ${title.toLocaleLowerCase()}.`}
          isFetching={query.isFetching}
          onRetry={() => { void query.refetch() }}
        />
      ) : rows.length === 0 ? (
        <DrawerSectionEmpty inset={false} className="py-3 text-left">{empty}</DrawerSectionEmpty>
      ) : (
        <FinancialRowList variant="page">
          {rows.map((row, index) => {
            const rowKey = `${row.domain}:${row.id}`
            const date = section === 'HISTORY' ? row.resolvedAt : row.dueDate
            const temporalLabel = date
              ? section === 'OVERDUE'
                ? `Venceu em ${shortDate(date)}`
                : section === 'OPEN'
                  ? `Vence em ${shortDate(date)}`
                  : `${row.domain === 'RECEIVABLE' ? 'Recebido' : 'Pago'} em ${formatDate(date)}`
              : 'Data não registrada'
            const dueTone = section === 'OVERDUE'
              ? 'text-destructive'
              : section === 'HISTORY'
                ? ROW_RESOLVED_TONE
                : section === 'OPEN' && date && timingUrgency(
                  parseDateOnly(date),
                  parseDateOnly(today),
                ) !== 'later'
                ? 'text-pending'
                : 'text-muted-foreground'
            const counterparty = row.personName ?? row.counterpartyName
            const amount = section === 'HISTORY'
              ? `${row.domain === 'RECEIVABLE' ? '+' : '−'}${formatCurrency(Number(row.amount))}`
              : formatCurrency(Number(row.amount))
            const actionLabel = section === 'HISTORY'
              ? row.domain === 'RECEIVABLE' ? 'Desfazer recebimento' : 'Desfazer pagamento'
              : row.domain === 'RECEIVABLE'
                ? 'Marcar como recebido'
                : 'Marcar como pago'

            return (
              <MotionRow
                key={rowKey}
                index={index}
                separator={false}
                className={financialDrawerRowSurfaceClass('animatedWrapper')}
              >
                <FinancialSettlementRow
                  variant="page"
                  resolved={section === 'HISTORY'}
                  leadingIcon={section === 'HISTORY'
                    ? <Undo2 className="size-4 text-muted-foreground" aria-hidden="true" />
                    : <Check className="size-4 text-muted-foreground" aria-hidden="true" />}
                  onToggleStatus={() => onSettle(row, section)}
                  onView={() => onView(row)}
                  title={row.title}
                  meta={(
                    <>
                      <span className={`shrink-0 whitespace-nowrap ${dueTone}`}>{temporalLabel}</span>
                      {counterparty && (
                        <>
                          <span aria-hidden="true" className="shrink-0">·</span>
                          <span className="min-w-0 truncate">{counterparty}</span>
                        </>
                      )}
                    </>
                  )}
                  trailing={<span className={`${ROW_AMOUNT_CLASS} ${ROW_AMOUNT_TONE.neutral}`}>{amount}</span>}
                  ariaLabel={`Abrir ${row.title}: ${temporalLabel}`}
                  statusActionLabel={`${actionLabel}: ${row.title}`}
                  actionDisabled={pendingRowKey === rowKey}
                  actionLoading={pendingRowKey === rowKey}
                  isHighlighted={highlightedRowKey === rowKey}
                  highlightRef={highlightRef}
                />
              </MotionRow>
            )
          })}
        </FinancialRowList>
      )}

      {query.error && rows.length > 0 && !query.isFetchNextPageError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>Não foi possível atualizar esta seção.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { void query.refetch() }}>
            Tentar novamente
          </Button>
        </div>
      )}
      {query.isFetchNextPageError && (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar mais itens.</p>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={onLoadMore}
          >
            {query.isFetchingNextPage
              ? 'Carregando…'
              : query.isFetchNextPageError ? 'Tentar carregar novamente' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </section>
  )
}

type DetailDeleteTarget =
  | { kind: 'debt'; item: Debt }
  | { kind: 'receivable'; item: Receivable }

type DetailDeleteIntent =
  | { kind: 'confirm'; target: DetailDeleteTarget }

export function ObligationsClient() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { period, setPeriod } = useMonthPeriod()
  const { user } = useAuth()
  const today = user?.timeZone ? accountToday(user.timeZone) : formatDateValue()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 350)
  const [markTarget, setMarkTarget] = useState<{ row: ObligationRow; section: ObligationSection } | null>(null)
  const [unmarkTarget, setUnmarkTarget] = useState<{ row: ObligationRow; section: ObligationSection } | null>(null)
  const [editTarget, setEditTarget] = useState<{ kind: 'debt'; item: Debt } | { kind: 'receivable'; item: Receivable } | null>(null)
  const [deleteIntent, setDeleteIntent] = useState<DetailDeleteIntent | null>(null)
  const debtNavigation = useDetailNavigation('debtId')
  const receivableNavigation = useDetailNavigation('receivableId')
  const normalizedIncomingUrl = useRef<string | null>(null)

  const domain = parseObligationDomain(searchParams.get('domain'))
  const apiDomain = apiObligationDomain(domain)
  const personId = searchParams.get('personId') || undefined
  const highlightId = searchParams.get('highlight')
  const highlightTargetQuery = useQuery({
    queryKey: ['obligations', 'highlight-target', highlightId, user?.timeZone],
    queryFn: () => resolveHighlightTarget(highlightId!, domain, user?.timeZone),
    enabled: Boolean(highlightId),
    retry: false,
  })
  const highlightTarget = highlightTargetQuery.data
  const personQuery = useQuery({ queryKey: ['persons'], queryFn: getPersons })
  const summaryQuery = useQuery({
    queryKey: obligationsSummaryKey({ ...period, domain: apiDomain, personId }),
    queryFn: async () => {
      if (!user?.id) throw new Error('A conta ainda está carregando')
      await reconcileObligationPeriod(queryClient, user.id, period)
      return getObligationsSummary({ ...period, domain: apiDomain, personId })
    },
    enabled: Boolean(user?.id),
    staleTime: OBLIGATIONS_QUERY_STALE_TIME,
    gcTime: OBLIGATIONS_QUERY_GC_TIME,
  })
  const overdueSummaryKey = useMemo(
    () => obligationsOverdueSummaryKey({ domain: apiDomain, personId }),
    [apiDomain, personId],
  )
  const overdueSummaryQuery = useQuery<ObligationSummary['overdue']>({
    queryKey: overdueSummaryKey,
    queryFn: skipToken,
    enabled: false,
    staleTime: OBLIGATIONS_QUERY_STALE_TIME,
    gcTime: OBLIGATIONS_QUERY_GC_TIME,
  })
  useEffect(() => {
    if (!summaryQuery.data) return
    queryClient.setQueryData(overdueSummaryKey, summaryQuery.data.overdue)
  }, [overdueSummaryKey, queryClient, summaryQuery.data])
  const overdueQuery = useObligationSectionQuery({
    section: 'OVERDUE', domain: apiDomain, search: debouncedSearch, personId, userId: user?.id, ...period,
  })
  const openQuery = useObligationSectionQuery({
    section: 'OPEN', domain: apiDomain, search: debouncedSearch, personId, userId: user?.id, ...period,
  })
  const historyQuery = useObligationSectionQuery({
    section: 'HISTORY', domain: apiDomain, search: debouncedSearch, personId, userId: user?.id, ...period,
  })
  useEffect(() => {
    const incomingUrl = `${pathname}?${searchParams.toString()}`
    if (normalizedIncomingUrl.current === incomingUrl) return
    const incomingPeriod = parseObligationPeriodContext({
      month: searchParams.get('month'),
      year: searchParams.get('year'),
      endDate: searchParams.get('endDate'),
    })
    if (!incomingPeriod && !searchParams.has('month') && !searchParams.has('year') && !searchParams.has('endDate')) return
    normalizedIncomingUrl.current = incomingUrl
    if (incomingPeriod && !highlightId && !sameObligationPeriod(incomingPeriod, period)) {
      setPeriod(incomingPeriod)
    }

    const next = new URLSearchParams(searchParams.toString())
    if (highlightId) {
      next.delete('endDate')
    } else {
      next.delete('month')
      next.delete('year')
      next.delete('endDate')
    }
    const query = next.toString()
    if (query !== searchParams.toString()) {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }, [highlightId, pathname, period, router, searchParams, setPeriod])

  const updateUrlParam = (key: 'domain' | 'personId', value: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const mutation = useMutation({
    mutationFn: async ({ row, nextResolved, payload }: {
      row: ObligationRow
      sourceSection: ObligationSection
      nextResolved: boolean
      payload?: SettlementPaymentPayload
    }) => {
      if (row.domain === 'RECEIVABLE') {
        return updateReceivable(row.id, { isPaid: nextResolved, ...(payload ?? {}) })
      }
      return updateDebt(row.id, { isPaid: nextResolved, ...(payload ?? {}) })
    },
    onMutate: async ({ row, sourceSection, nextResolved }) => {
      await queryClient.cancelQueries({ queryKey: ['obligations'] })
      const snapshots = queryClient.getQueriesData({ queryKey: ['obligations'] })
      const today = formatDateValue()

      for (const [queryKey, cached] of snapshots) {
        if (!Array.isArray(queryKey)) continue

        if (queryKey[1] === 'summary' && cached) {
          const [, , month, year, filterDomain, filterPersonId] = queryKey
          if (filterDomain !== 'ALL' && filterDomain !== row.domain) continue
          if (typeof filterPersonId === 'string' && filterPersonId !== row.personId) continue
          const delta = obligationSummaryDelta(
            row,
            nextResolved,
            { month: Number(month), year: Number(year) },
            today,
          )
          queryClient.setQueryData(queryKey, applyObligationSummaryDelta(
            cached as ObligationSummary,
            row.domain,
            delta,
          ))
        }

        if (queryKey[1] === 'section' && queryKey[2] === sourceSection && cached) {
          const infinite = cached as InfiniteData<ObligationPage, string | null>
          queryClient.setQueryData<InfiniteData<ObligationPage, string | null>>(queryKey, {
            ...infinite,
            pages: infinite.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => !(item.id === row.id && item.domain === row.domain)),
            })),
          })
        }
      }

      return { snapshots }
    },
    onError: (_error, _variables, context) => {
      context?.snapshots.forEach(([key, value]) => queryClient.setQueryData(key, value))
      toast.error('Não foi possível atualizar a obrigação.')
    },
    onSuccess: async (result, variables) => {
      const kind = variables.row.domain === 'DEBT' ? 'debt' : 'receivable'
      syncSettlementEntity(queryClient, kind, variables.row.id, result as Debt | Receivable | Array<Debt | Receivable>)
      setMarkTarget(null)
      setUnmarkTarget(null)
      toast.success(variables.nextResolved
        ? variables.row.domain === 'RECEIVABLE' ? 'Recebimento registrado' : 'Pagamento registrado'
        : variables.row.domain === 'RECEIVABLE' ? 'Recebimento desfeito' : 'Pagamento desfeito')
      invalidateTransactionDependents(queryClient, { affectsPerson: Boolean(variables.row.personId) })
      await queryClient.invalidateQueries({ queryKey: ['obligations'] })
    },
  })

  const detailDeleteMutation = useMutation({
    mutationFn: (intent: Extract<DetailDeleteIntent, { kind: 'confirm' }>) => intent.target.kind === 'debt'
      ? deleteDebt(intent.target.item.id)
      : deleteReceivable(intent.target.item.id),
    onSuccess: async (_result, intent) => {
      const target = intent.target
      setDeleteIntent(null)
      if (target.kind === 'debt') debtNavigation.close()
      else receivableNavigation.close()
      invalidateTransactionDependents(queryClient, { affectsPerson: Boolean(target.item.personId) })
      if (target.kind === 'receivable') {
        await queryClient.invalidateQueries({ queryKey: ['receivables'] })
      }
      await queryClient.invalidateQueries({ queryKey: ['obligations'] })
      toast.success(target.kind === 'debt' ? 'Dívida excluída' : 'Recebimento excluído')
    },
    onError: () => toast.error('Não foi possível excluir a obrigação.'),
  })

  const deleteReceivedRecurringMutation = useMutation({
    mutationFn: undoAndDeleteRecurringIncomeReceived,
    onSuccess: async (_result, id) => {
      receivableNavigation.close()
      invalidateTransactionDependents(queryClient, { affectsPerson: false, receivableId: id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['obligations'] }),
      ])
      toast.success('Recebimento desfeito e excluído')
    },
    onError: () => toast.error('Não foi possível desfazer o recebimento e excluir'),
  })

  const detailEditMutation = useMutation({
    mutationFn: async ({ target, data }: {
      target: NonNullable<typeof editTarget>
      data: DebtFormData | ReceivableFormData
    }) => {
      if (target.kind === 'debt') {
        const payload = { ...(data as DebtFormData) }
        delete payload.installments
        await updateDebt(target.item.id, payload)
        return
      }
      const payload = { ...(data as ReceivableFormData) }
      delete payload.installments
      await updateReceivable(target.item.id, payload)
    },
    onSuccess: async (_result, { target }) => {
      setEditTarget(null)
      if (target.kind === 'debt') debtNavigation.close()
      else receivableNavigation.close()
      await queryClient.invalidateQueries({ queryKey: ['obligations'] })
      toast.success(target.kind === 'debt' ? 'Dívida atualizada' : 'Cobrança atualizada')
    },
    onError: () => toast.error('Não foi possível atualizar a obrigação.'),
  })


  const pendingRowKey = mutation.isPending && mutation.variables
    ? `${mutation.variables.row.domain}:${mutation.variables.row.id}`
    : null

  const handleSettle = (row: ObligationRow, section: ObligationSection) => {
    if (section === 'HISTORY') {
      if (row.paymentTransactionId) setUnmarkTarget({ row, section })
      else mutation.mutate({ row, sourceSection: section, nextResolved: false })
      return
    }
    setMarkTarget({ row, section })
  }

  const handleDetailSettle = (item: Debt | Receivable, kind: 'debt' | 'receivable') => {
    const isDebt = kind === 'debt'
    const section: ObligationSection = item.isPaid
      ? 'HISTORY'
      : item.dueDate.slice(0, 10) < today ? 'OVERDUE' : 'OPEN'
    const row: ObligationRow = {
      domain: isDebt ? 'DEBT' : 'RECEIVABLE',
      id: item.id,
      title: item.title,
      amount: String(item.amount),
      description: item.description ?? null,
      personId: item.personId ?? null,
      personName: item.person?.name ?? null,
      counterpartyName: isDebt ? (item as Debt).creditorName : (item as Receivable).debtorName,
      dueDate: item.dueDate,
      isResolved: item.isPaid,
      resolvedAt: item.paidAt ?? null,
      paymentTransactionId: item.paymentTransactionId ?? null,
    }
    handleSettle(row, section)
  }

  const handleDetailDelete = (item: Debt | Receivable, kind: 'debt' | 'receivable') => {
    if (kind === 'debt') {
      setDeleteIntent({ kind: 'confirm', target: { kind, item: item as Debt } })
      return
    }
    const receivable = item as Receivable
    const policy = resolveReceivableDeletePolicy(receivable)
    if (!canDeleteReceivable(policy)) return
    setDeleteIntent({ kind: 'confirm', target: { kind, item: receivable } })
  }

  const handleMarkConfirm = (payload: SettlementPaymentPayload) => {
    if (!markTarget) return
    if (markTarget.row.domain === 'DEBT' && !payload.paymentType) return
    mutation.mutate({
      row: markTarget.row,
      sourceSection: markTarget.section,
      nextResolved: true,
      payload,
    })
  }

  const handleUnmarkConfirm = () => {
    if (!unmarkTarget) return
    mutation.mutate({
      row: unmarkTarget.row,
      sourceSection: unmarkTarget.section,
      nextResolved: false,
    })
  }

  const debtId = debtNavigation.openId
  const receivableId = debtId ? null : receivableNavigation.openId
  const debtDetail = useDetailEntity<Debt>({
    openId: debtId,
    fromList: undefined,
    fetchById: getDebt,
    queryKey: 'debt',
    onNotFound: debtNavigation.close,
  })
  const receivableDetail = useDetailEntity<Receivable>({
    openId: receivableId,
    fromList: undefined,
    fetchById: getReceivable,
    queryKey: 'receivable',
    onNotFound: receivableNavigation.close,
  })

  const highlightSection = highlightTarget
    ? obligationHighlightSection(highlightTarget, today)
    : null
  const highlightPeriod = highlightTarget
    ? obligationHighlightPeriod(obligationHighlightPeriodDate(highlightTarget))
    : null
  useEffect(() => {
    if (!highlightTarget || highlightSection === 'OVERDUE' || !highlightPeriod) return
    if (sameObligationPeriod(period, highlightPeriod)) return
    setPeriod(highlightPeriod)
  }, [highlightPeriod, highlightSection, highlightTarget, period, setPeriod])
  const highlightPeriodReady = highlightSection === 'OVERDUE' || Boolean(
    highlightPeriod && sameObligationPeriod(period, highlightPeriod),
  )
  const highlightFiltersAligned = Boolean(highlightTarget) && !search &&
    (!personId || personId === highlightTarget?.personId) &&
    (domain === 'all' || domain === (highlightTarget?.domain === 'DEBT' ? 'debt' : 'receivable'))
  const highlightSectionQuery = highlightSection === 'OVERDUE'
    ? overdueQuery
    : highlightSection === 'HISTORY'
      ? historyQuery
      : openQuery
  const highlightRow = highlightTarget && highlightPeriodReady
    ? findObligationHighlightRow(highlightSectionQuery.data?.pages, highlightTarget)
    : undefined
  const { highlightedId, highlightRef } = useHighlight(highlightRow ? highlightTarget?.id : null)
  const highlightedRowKey = highlightedId && highlightTarget
    ? `${highlightTarget.domain}:${highlightedId}`
    : null

  useEffect(() => {
    if (highlightTarget) {
      const next = new URLSearchParams(searchParams.toString())
      const targetDomain = highlightTarget.domain === 'DEBT' ? 'debt' : 'receivable'
      const domainValues = searchParams.getAll('domain')
      let changed = false

      if (
        domainValues.length > 1 ||
        (domainValues.length === 1 && domain !== targetDomain && (domain !== 'all' || domainValues[0] !== 'all'))
      ) {
        next.set('domain', domain === 'all' ? 'all' : targetDomain)
        changed = true
      }
      if (personId && personId !== highlightTarget.personId) {
        next.delete('personId')
        changed = true
      }
      if (highlightSection !== 'OVERDUE' && highlightPeriod) {
        const month = String(highlightPeriod.month)
        const year = String(highlightPeriod.year)
        if (
          searchParams.get('month') !== month ||
          searchParams.get('year') !== year ||
          searchParams.getAll('month').length > 1 ||
          searchParams.getAll('year').length > 1 ||
          next.has('endDate')
        ) {
          next.set('month', month)
          next.set('year', year)
          next.delete('endDate')
          changed = true
        }
      }
      if (search) {
        // The explicit deep link takes priority over a local text filter.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSearch('')
      }
      if (changed) {
        const query = next.toString()
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
      }
      return
    }

    const detailDomain = debtDetail.entity ? 'debt' : receivableDetail.entity ? 'receivable' : null
    if (!highlightId && detailDomain && domain !== detailDomain) {
      const next = new URLSearchParams(searchParams.toString())
      next.set('domain', detailDomain)
      if (detailDomain === 'debt') next.delete('receivableId')
      else next.delete('debtId')
      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }, [
    debtDetail.entity,
    domain,
    highlightId,
    highlightPeriod,
    highlightSection,
    highlightTarget,
    pathname,
    personId,
    queryClient,
    receivableDetail.entity,
    router,
    search,
    searchParams,
  ])

  useEffect(() => {
    if (!highlightTarget || !highlightFiltersAligned || !highlightPeriodReady || highlightRow) return
    if (highlightSectionQuery.isFetchingNextPage || highlightSectionQuery.isFetchNextPageError) return
    if (!highlightSectionQuery.hasNextPage) return
    void highlightSectionQuery.fetchNextPage()
  }, [
    highlightPeriodReady,
    highlightFiltersAligned,
    highlightRow,
    highlightSectionQuery,
    highlightTarget,
  ])

  const summary = summaryQuery.data
  const overdueSummary = summary?.overdue ?? overdueSummaryQuery.data
  const overdueSummaryLoading = !overdueSummary && summaryQuery.isLoading
  const overdueSummaryError = !overdueSummary && Boolean(summaryQuery.error && !summaryQuery.isLoading)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MovementContextHeading
        title="A pagar e receber"
        subtitle="Valores que ainda precisam ser pagos ou recebidos."
        explanation="Cadastre contas e cobranças antes de acontecerem, acompanhe os vencimentos e veja o que ainda falta pagar ou receber."
      />
      <div id="obligations-scroll-anchor" className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={personId ?? ''} onValueChange={(value) => updateUrlParam('personId', value || undefined)}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar por pessoa">
            <SelectValue placeholder="Todas as pessoas">
              {personId ? personQuery.data?.find((person) => person.id === personId)?.name ?? 'Pessoa selecionada' : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {(personQuery.data ?? []).map((person) => (
              <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar obrigações"
            className={`w-full ${MOVEMENT_SEARCH_INPUT_CLASS}`}
            aria-label="Buscar obrigações"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {(personId || search) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground sm:self-auto"
            onClick={() => {
              if (personId) updateUrlParam('personId', undefined)
              setSearch('')
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo de obrigação">
        {DOMAIN_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={domain === option.value}
            onClick={() => domain !== option.value && updateUrlParam('domain', option.value)}
            className={movementFilterChipClass(domain === option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      </div>

      <div className="space-y-7">
          {SECTION_CONFIG.map((config) => {
            const query = config.section === 'OVERDUE'
              ? overdueQuery
              : config.section === 'OPEN'
                ? openQuery
                : historyQuery
            return (
              <ObligationSectionView
                key={config.section}
                {...config}
                query={query}
                today={today}
                pendingRowKey={pendingRowKey}
                highlightedRowKey={highlightedRowKey}
                highlightRef={highlightRef}
                onView={(row) => row.domain === 'DEBT'
                  ? debtNavigation.open(row.id)
                  : receivableNavigation.open(row.id)}
                onSettle={handleSettle}
                onLoadMore={() => { void query.fetchNextPage() }}
                summary={config.section === 'OVERDUE' ? overdueSummary?.net : config.section === 'OPEN' ? summary?.open.net : undefined}
                summaryIsLoading={config.section === 'OVERDUE' ? overdueSummaryLoading : summaryQuery.isLoading}
                summaryHasError={config.section === 'OVERDUE' ? overdueSummaryError : Boolean(summaryQuery.error && !summaryQuery.isLoading)}
              />
            )
          })}
      </div>

      <DebtDetailDrawer
        debt={debtDetail.entity}
        mode="operational"
        onOpenChange={(open) => { if (!open) debtNavigation.close() }}
        onEdit={(item) => { setEditTarget({ kind: 'debt', item }); debtNavigation.close() }}
        onDelete={(item) => handleDetailDelete(item, 'debt')}
        onTogglePaid={(item) => handleDetailSettle(item, 'debt')}
      />
      <ReceivableDetailDrawer
        receivable={receivableDetail.entity}
        mode="operational"
        onOpenChange={(open) => { if (!open) receivableNavigation.close() }}
        onEdit={(item) => { setEditTarget({ kind: 'receivable', item }); receivableNavigation.close() }}
        onDelete={(item) => handleDetailDelete(item, 'receivable')}
        onDeleteFlowStart={() => setDeleteIntent(null)}
        onDeleteRecurringReceived={(item) => deleteReceivedRecurringMutation.mutateAsync(item.id)}
        onToggleReceived={(item) => handleDetailSettle(item, 'receivable')}
      />

      <MarkAsPaidDialog
        open={markTarget !== null}
        kind={markTarget?.row.domain === 'DEBT' ? 'debt' : 'receivable'}
        createTransaction
        isPending={mutation.isPending}
        onConfirm={handleMarkConfirm}
        onCancel={() => setMarkTarget(null)}
      />
      <UnmarkPaidWarningDialog
        open={unmarkTarget !== null}
        kind={unmarkTarget?.row.domain === 'DEBT' ? 'debt' : 'receivable'}
        isPending={mutation.isPending}
        onConfirm={handleUnmarkConfirm}
        onCancel={() => setUnmarkTarget(null)}
      />
      <ConfirmDialog
        open={deleteIntent?.kind === 'confirm'}
        title={deleteIntent?.kind === 'confirm' && deleteIntent.target.kind === 'receivable' && deleteIntent.target.item.recurringIncomeRuleId
          ? 'Excluir este recebimento?'
          : deleteIntent?.kind === 'confirm' && deleteIntent.target.item.isPaid ? 'Excluir item do histórico?' : 'Excluir obrigação?'}
        description={deleteIntent?.kind === 'confirm' && deleteIntent.target.kind === 'receivable' && deleteIntent.target.item.recurringIncomeRuleId
          ? 'Essa ocorrência será removida e não será criada novamente para esta competência.'
          : deleteIntent?.kind === 'confirm' && deleteIntent.target.item.paymentTransactionId
          ? deleteIntent.target.kind === 'debt'
            ? 'A dívida e o lançamento financeiro associado ao pagamento serão removidos.'
            : 'A cobrança e o lançamento financeiro associado ao recebimento serão removidos.'
          : deleteIntent?.kind === 'confirm' && deleteIntent.target.item.isPaid
            ? 'Este item do histórico será excluído.'
            : 'Esta obrigação será excluída.'}
        confirmLabel="Excluir"
        isPending={detailDeleteMutation.isPending}
        onCancel={() => setDeleteIntent(null)}
        onConfirm={() => deleteIntent?.kind === 'confirm' && detailDeleteMutation.mutate(deleteIntent)}
      />
      <DebtSheet
        open={editTarget?.kind === 'debt'}
        onOpenChange={(open) => !open && setEditTarget(null)}
        editTarget={editTarget?.kind === 'debt' ? editTarget.item : null}
        editScope={null}
        timeZone={user?.timeZone}
        onSubmit={async (data) => {
          if (editTarget?.kind === 'debt') await detailEditMutation.mutateAsync({ target: editTarget, data })
        }}
      />
      <ReceivableSheet
        open={editTarget?.kind === 'receivable'}
        onOpenChange={(open) => !open && setEditTarget(null)}
        editTarget={editTarget?.kind === 'receivable' ? editTarget.item : null}
        editScope={null}
        timeZone={user?.timeZone}
        onSubmit={async (data) => {
          if (editTarget?.kind === 'receivable') await detailEditMutation.mutateAsync({ target: editTarget, data })
        }}
      />
    </div>
  )
}

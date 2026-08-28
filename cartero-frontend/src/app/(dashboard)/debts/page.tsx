'use client'

import { useState, useMemo, useEffect, useRef, memo } from 'react'
import { AnimatePresence, motion, animate } from 'motion/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, HandCoins, BellOff, Search, X, Repeat2, TriangleAlert, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { monthBounds, periodFromDate, useMonthPeriod } from '@/components/month-nav'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MotionRow } from '@/components/ui/motion-row'
import { DebtSheet, type DebtFormData } from './debt-sheet'
import { InstallmentScopeDialog } from '../transactions/installment-scope-dialog'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '../transactions/unmark-paid-warning-dialog'
import { SettlementDateDialog } from '../transactions/settlement-date-dialog'
import { DebtDetailDrawer } from './debt-detail-drawer'
import {
  FinancialListRow,
  ROW_AMOUNT_CLASS,
  ROW_AMOUNT_TONE,
  ROW_ICON_BG_CLASS,
  ROW_ICON_CLASS,
  ROW_TRAILING_META_CLASS,
} from '@/components/ui/financial-list-row'
import { DeleteLinkedWarningDialog } from '../transactions/delete-linked-warning-dialog'
import {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  updateDebtSettlementDate,
} from '@/services/debts.service'
import { useSearchParams } from 'next/navigation'
import { getPersons } from '@/services/persons.service'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { isOverdue, overdueCountLabel } from '@/lib/settlement-status'
import { SettlementStatusDot } from '@/components/settlement-status-dot'
import { apiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import type { Debt, TransactionType } from '@/types'
import { InstallmentScope } from '@/types'
import { useAuth } from '@/providers/auth-provider'

// ─── Sub-components ──────────────────────────────────────────────────────────

const DebtRow = memo(function DebtRow({
  debt,
  isHighlighted,
  onView,
  onTogglePaid,
}: {
  debt: Debt
  isHighlighted?: boolean
  /** Abre o detalhe. É a ação de TODA a row, menos o círculo. */
  onView: (d: Debt) => void
  /**
   * Alterna pago/pendente pelo círculo de status.
   *
   * Controle próprio, irmão da área que abre o detalhe: quando a row virou
   * um botão único, este alvo foi engolido por ela e parou de responder.
   */
  onTogglePaid: (d: Debt) => void
}) {
  const overdue = isOverdue(debt)
  /* A LINHA inteira — o pulso de destaque precisa incluir o círculo. */
  const rowRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!isHighlighted || !rowRef.current) return
    const el = rowRef.current
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => {
      animate(
        el,
        { backgroundColor: ['rgba(79,124,255,0)', 'rgba(79,124,255,0.12)', 'rgba(79,124,255,0)'] },
        { duration: 2.0, times: [0, 0.10, 1] },
      )
    }, 150)
    return () => clearTimeout(t)
  }, [isHighlighted])

  const amountClass = cn(
    ROW_AMOUNT_CLASS,
    debt.isPaid
      ? cn(ROW_AMOUNT_TONE.muted, 'line-through')
      : overdue
        ? ROW_AMOUNT_TONE.out
        : ROW_AMOUNT_TONE.neutral,
  )

  return (
    <FinancialListRow
      ref={rowRef}
      onView={() => onView(debt)}
      ariaLabel={`Ver detalhes de ${debt.title}`}
      leadingAction={
        /*
          Alvo independente: alterna o estado sem abrir o detalhe.

          É IRMÃO do botão da row, não filho — aninhar um botão dentro de
          outro é HTML inválido e foi exatamente o que quebrou este controle.
          A área de toque é o container inteiro do ícone (40/44px), não o
          ponto colorido.
        */
        <button
          type="button"
          onClick={() => onTogglePaid(debt)}
          aria-label={
            debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'
          }
          title={debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
          className={cn(
            ROW_ICON_CLASS,
            ROW_ICON_BG_CLASS,
            'ring-1 ring-border/50 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          <SettlementStatusDot item={debt} domain="debt" />
        </button>
      }
      title={
        <span className={cn(debt.isPaid && 'text-muted-foreground line-through')}>
          {debt.title}
        </span>
      }
      titleAdornment={
        debt.parentId ? (
          <>
            <Repeat2 aria-hidden="true" className="size-3.5 shrink-0 text-primary/70" />
            <span className="sr-only">Parcelada</span>
          </>
        ) : null
      }
      meta={
        <>
          <span className="truncate">
            {debt.person?.name ?? debt.creditorName}
            {debt.description ? <> · <i>{debt.description}</i></> : ''}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0">em {formatDate(debt.occurredAt)}</span>
          {!debt.isAlertEnabled && (
            <>
              <span aria-hidden="true">·</span>
              <BellOff aria-hidden="true" className="size-3 opacity-50" />
              <span className="sr-only">Alerta desativado</span>
            </>
          )}
        </>
      }
      trailing={
        <>
          <span className={amountClass}>{formatCurrency(debt.amount)}</span>
          {overdue ? (
            <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
              Em atraso · {formatDate(debt.dueDate)}
            </span>
          ) : (
            <span className={ROW_TRAILING_META_CLASS}>{formatDate(debt.dueDate)}</span>
          )}
        </>
      }
      trailingCompact={<span className={amountClass}>{formatCurrency(debt.amount)}</span>}
    />
  )
})

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0">
      <Skeleton className="size-8 shrink-0 rounded-lg ring-1 ring-border/30" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="flex flex-col items-end gap-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

type TabFilter = 'pending' | 'paid'

export default function DebtsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight') ?? undefined
  const endDateParam = searchParams.get('endDate')

  const [tab, setTab] = useState<TabFilter>('pending')
  // Pré-aplicado quando a navegação vem do card de dívidas do orçamento.
  const [personFilter, setPersonFilter] = useState<string | undefined>(
    () => searchParams.get('personId') ?? undefined,
  )

  // O mês vem da barra superior; um `endDate` na URL (vindo da visão geral)
  // alinha o mês global àquele período uma única vez.
  const { period, setPeriod } = useMonthPeriod()
  const urlPeriodApplied = useRef(false)

  useEffect(() => {
    if (urlPeriodApplied.current || !endDateParam) return
    urlPeriodApplied.current = true
    const next = periodFromDate(endDateParam)
    if (next.month !== period.month || next.year !== period.year) setPeriod(next)
  }, [endDateParam, period.month, period.year, setPeriod])

  const { startDate, endDate } = monthBounds(period)
  const [search, setSearch] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  /*
    Dívida cujo detalhe está aberto. A row abre; o drawer administra.

    Guarda o objeto, não o id: a lista pode ser refiltrada enquanto o drawer
    está aberto, e reencontrar por id devolveria `undefined` no meio do uso.
  */
  const [detailTarget, setDetailTarget] = useState<Debt | null>(null)
  const [editDebt, setEditDebt] = useState<Debt | null>(null)
  /** Item cuja data de acerto está sendo corrigida. */
  const [settlementDateItem, setSettlementDateItem] =
    useState<Debt | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{ debt: Debt; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Debt | null>(null)
  const [markPaidTarget, setMarkPaidTarget] = useState<Debt | null>(null)
  const [unmarkPaidTarget, setUnmarkPaidTarget] = useState<Debt | null>(null)
  const [linkedWarningTarget, setLinkedWarningTarget] = useState<Debt | null>(null)

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  // Sem `startDate` na query: o backend devolve tudo até o fim do mês
  // selecionado, e o recorte por mês acontece no cliente — assim dívidas
  // vencidas de meses anteriores continuam visíveis em qualquer mês.
  const {
    data: allDebts,
    isLoading,
    isError,
    isSuccess,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['debts', personFilter, endDate],
    queryFn: () => getDebts({
      personId: personFilter,
      endDate,
    }),
  })

  const debts = useMemo(() => {
    if (!allDebts) return allDebts
    return allDebts.filter((debt) => {
      const due = debt.dueDate.slice(0, 10)
      if (due >= startDate) return true
      // Anterior ao mês selecionado: só continua na lista se ainda estiver em aberto.
      return !debt.isPaid
    })
  }, [allDebts, startDate])

  const createMut = useMutation({
    mutationFn: createDebt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
      /*
        Criar dívida move o Orçamento: entra em `debts.total` e `totalToPay`, e
        — quando tem pessoa — na linha dela em "Acertos com pessoas". Só
        `['debts']` era invalidado, então o card ficava desatualizado até a
        próxima navegação. `update` e `delete` já faziam certo.
      */
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSheetOpen(false)
      toast.success('Dívida criada')
    },
    onError: () => toast.error('Erro ao criar dívida — verifique sua conexão e tente novamente'),
  })

  const updateMut = useMutation({
    mutationFn: ({
      id,
      payload,
      scope,
    }: {
      id: string
      payload: Parameters<typeof updateDebt>[1]
      scope?: InstallmentScope
    }) => updateDebt(id, payload, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSheetOpen(false)
      setEditDebt(null)
      setEditScope(null)
      toast.success('Dívida atualizada')
    },
    onError: () => toast.error('Erro ao salvar — verifique sua conexão e tente novamente'),
  })

  /**
   * Corrige a data real do pagamento de um item já resolvido.
   *
   * Endpoint próprio: o PATCH comum bloqueia edição financeira de item pago,
   * e essa proteção continua. Aqui só a dimensão temporal muda.
   */
  const settlementDateMut = useMutation({
    mutationFn: ({ id, paidAt }: { id: string; paidAt: string }) =>
      updateDebtSettlementDate(id, paidAt),
    onSuccess: () => {
      /*
        `paidAt` e a data da transação-espelho mudaram, e o Orçamento
        reconstrói o histórico por elas — invalidar só a lista deixaria os
        meses anteriores exibindo a pendência que acabou de ser corrigida.
      */
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['person-statement'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      setSettlementDateItem(null)
      toast.success('Data atualizada')
    },
    // O diálogo permanece aberto no erro: fechar sugeriria sucesso.
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Não foi possível atualizar a data')),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope, preserveTransaction }: { id: string; scope?: InstallmentScope; preserveTransaction?: boolean }) =>
      deleteDebt(id, scope, preserveTransaction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      toast.success('Dívida excluída')
    },
    onError: () => toast.error('Erro ao excluir dívida — tente novamente'),
  })

  useEffect(() => {
    if (!highlightId || !debts) return
    const target = debts.find((d) => d.id === highlightId)
    if (target?.isPaid) setTab('paid')
  }, [highlightId, debts])

  const summary = useMemo(() => {
    if (!debts) return { pending: 0, paid: 0, overdueCount: 0 }
    const pending = debts.filter((d) => !d.isPaid).reduce((s, d) => s + Number(d.amount), 0)
    const overdueCount = debts.filter(isOverdue).length
    return { pending, overdueCount }
  }, [debts])

  const filtered = useMemo(() => {
    if (!debts) return []
    let list = debts.filter((d) => (tab === 'pending' ? !d.isPaid : d.isPaid))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.description?.toLowerCase().includes(q) ?? false),
      )
    }
    if (tab === 'pending') {
      list.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    }
    return list
  }, [debts, tab, search])

  /*
    Toda ação disparada pelo drawer o fecha antes de abrir seu próprio
    diálogo: dois overlays empilhados disputariam o foco, e o de baixo
    continuaria mostrando o estado velho depois que a ação terminasse.

    Os handlers abaixo permanecem os MESMOS que a lista já usava — com as
    mesmas guardas. Mover o botão de lugar não muda o que ele pode fazer.
  */
  function closeDetail() {
    setDetailTarget(null)
  }

  function handleEdit(debt: Debt) {
    closeDetail()
    if (debt.parentId) {
      setScopeDialog({ debt, mode: 'edit' })
    } else {
      setEditDebt(debt)
      setEditScope(null)
      setSheetOpen(true)
    }
  }

  function handleDelete(debt: Debt) {
    closeDetail()
    if (debt.paymentTransactionId && !debt.parentId) {
      setLinkedWarningTarget(debt)
      return
    }
    if (debt.parentId) {
      setScopeDialog({ debt, mode: 'delete' })
    } else {
      setDeleteTarget(debt)
    }
  }

  function handleLinkedWarningConfirm() {
    if (linkedWarningTarget) {
      deleteMut.mutate({ id: linkedWarningTarget.id })
      setLinkedWarningTarget(null)
    }
  }

  function handleLinkedWarningDeleteOnly() {
    if (linkedWarningTarget) {
      deleteMut.mutate({ id: linkedWarningTarget.id, preserveTransaction: true })
      setLinkedWarningTarget(null)
    }
  }

  function handleTogglePaid(debt: Debt) {
    closeDetail()
    if (!debt.isPaid) {
      if (user?.createExpenseOnDebtPaid === false) {
        updateMut.mutate({ id: debt.id, payload: { isPaid: true } })
      } else {
        setMarkPaidTarget(debt)
      }
    } else if (debt.paymentTransactionId) {
      setUnmarkPaidTarget(debt)
    } else {
      updateMut.mutate({ id: debt.id, payload: { isPaid: false } })
    }
  }

  function handleMarkPaidConfirm(payload: {
    paymentBankId?: string
    paymentType?: TransactionType
    /*
      A data vinha do diálogo e era descartada aqui — o tipo não a declarava,
      então ela nem chegava à API. O usuário escolhia quando pagou e o sistema
      gravava hoje.
    */
    paymentDate?: string
  }) {
    if (!markPaidTarget) return
    if (!payload.paymentBankId || !payload.paymentType) return
    // `payload` já inclui `paymentDate` — o spread a repassa.
    updateMut.mutate({
      id: markPaidTarget.id,
      payload: { isPaid: true, ...payload },
    })
    setMarkPaidTarget(null)
  }

  function handleUnmarkPaidConfirm() {
    if (!unmarkPaidTarget) return
    updateMut.mutate({
      id: unmarkPaidTarget.id,
      payload: { isPaid: false },
    })
    setUnmarkPaidTarget(null)
  }

  function handleScopeConfirm(scope: InstallmentScope) {
    if (!scopeDialog) return
    if (scopeDialog.mode === 'delete') {
      deleteMut.mutate({ id: scopeDialog.debt.id, scope })
    } else {
      setEditScope(scope)
      setEditDebt(scopeDialog.debt)
      setSheetOpen(true)
    }
    setScopeDialog(null)
  }

  async function handleSheetSubmit(data: DebtFormData, scope: InstallmentScope | null) {
    if (editDebt) {
      const { installments, ...payload } = data
      void installments
      await updateMut.mutateAsync({ id: editDebt.id, payload, scope: scope ?? undefined })
    } else {
      await createMut.mutateAsync(data)
    }
  }

  const tabs: Array<{ value: TabFilter; label: string }> = [
    { value: 'pending', label: 'Pendentes' },
    { value: 'paid', label: 'Pagas' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-destructive">Dívidas</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Controle suas dívidas externas e parcelamentos
            </p>
          </div>
          <Button
            onClick={() => {
              setEditDebt(null)
              setEditScope(null)
              setSheetOpen(true)
            }}
          >
            <Plus className="size-4" />
            Nova dívida
          </Button>
        </div>
        {!isLoading && summary.pending > 0 && (
          <p className="mt-1.5 text-sm">
            <span className="text-muted-foreground">A pagar </span>
            <span className="font-medium tabular-nums tracking-[-0.01em] text-destructive">
              {formatCurrency(summary.pending)}
            </span>
            {summary.overdueCount > 0 && (
              <span className="ml-2 text-xs font-medium text-destructive">
                · {overdueCountLabel(summary.overdueCount, 'debt')}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
          {persons.length > 0 && (
            <Select
              value={personFilter ?? ''}
              onValueChange={(v) => setPersonFilter(v || undefined)}
            >
              <SelectTrigger className="w-40" aria-label="Filtrar por pessoa">
                <SelectValue placeholder="Todas as pessoas">
                  {personFilter ? persons.find((p) => p.id === personFilter)?.name : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {persons.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Search */}
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título ou descrição"
              className="h-8 pl-8 pr-8 text-sm"
              aria-label="Buscar por título ou descrição"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {(personFilter || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPersonFilter(undefined); setSearch('') }}
              className="gap-1 text-muted-foreground"
            >
              <X className="size-3.5" />
              Limpar filtros
            </Button>
          )}
          </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                tab === value
                  ? 'border-transparent bg-primary/15 text-primary'
                  : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Debt list */}
      <div className="border-t border-border">
        {isLoading ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          /*
            Erro é estado próprio, não lista vazia.
            Com a API fora do ar, `isLoading` vira false e os dados ficam
            undefined — a tela dizia "Nenhuma dívida pendente", afirmando ao usuário que ele
            não tem dívidas quando o servidor apenas não respondeu.
          */
          <div
            role="alert"
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
              <TriangleAlert className="size-6 text-destructive/70" aria-hidden />
            </div>
            <p className="text-sm font-medium">
              Não foi possível carregar suas dívidas
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Verifique sua conexão e tente novamente. Seus dados continuam
              salvos.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-5 gap-1.5"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              {isFetching ? 'Carregando…' : 'Tentar novamente'}
            </Button>
          </div>
        ) : isSuccess && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted/50">
              <HandCoins className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {search
                ? 'Nenhuma dívida encontrada'
                : (tab === 'pending' ? 'Nenhuma dívida pendente' : 'Nenhuma dívida paga')}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {search
                ? 'Nenhum resultado para a busca. Tente um termo diferente.'
                : (tab === 'pending'
                    ? 'Cadastre uma nova dívida usando o botão acima.'
                    : 'Dívidas marcadas como pagas aparecerão aqui.')}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {filtered.map((debt, i) => (
                <MotionRow key={debt.id} index={i}>
                  <DebtRow
                    debt={debt}
                    isHighlighted={debt.id === highlightId}
                    onView={setDetailTarget}
                    onTogglePaid={handleTogglePaid}
                  />
                </MotionRow>
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Sheet */}
      <DebtSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) {
            setEditDebt(null)
            setEditScope(null)
          }
        }}
        editTarget={editDebt}
        editScope={editScope}
        onSubmit={handleSheetSubmit}
      />

      {/* Installment scope dialog */}
      <InstallmentScopeDialog
        open={scopeDialog !== null}
        mode={scopeDialog?.mode ?? 'delete'}
        isPending={scopeDialog?.mode === 'delete' ? deleteMut.isPending : updateMut.isPending}
        onConfirm={handleScopeConfirm}
        onCancel={() => setScopeDialog(null)}
        linkedWarning={Boolean(scopeDialog?.debt.paymentTransactionId)}
      />

      {/* Mark as paid — asks for bank + payment type */}
      <MarkAsPaidDialog
        open={markPaidTarget !== null}
        kind="debt"
        createTransaction={user?.createExpenseOnDebtPaid ?? false}
        isPending={updateMut.isPending}
        onConfirm={handleMarkPaidConfirm}
        onCancel={() => setMarkPaidTarget(null)}
      />

      {/* Unmark as paid — warns that the linked transaction will be deleted */}
      <UnmarkPaidWarningDialog
        open={unmarkPaidTarget !== null}
        kind="debt"
        isPending={updateMut.isPending}
        onConfirm={handleUnmarkPaidConfirm}
        onCancel={() => setUnmarkPaidTarget(null)}
      />

      {/* Cascade-delete warning — debt linked to a payment transaction */}
      <DeleteLinkedWarningDialog
        open={linkedWarningTarget !== null}
        kind="debt"
        isPending={deleteMut.isPending}
        onConfirm={handleLinkedWarningConfirm}
        onDeleteOnly={handleLinkedWarningDeleteOnly}
        onCancel={() => setLinkedWarningTarget(null)}
      />

      {/* Delete confirm — non-parcelado */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir dívida</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir{' '}
              <strong className="text-foreground">{deleteTarget?.title}</strong>? Esta ação não pode
              ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMut.mutate({ id: deleteTarget.id })
                  setDeleteTarget(null)
                }
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {settlementDateItem && (
        <SettlementDateDialog
          open
          kind="debt"
          title={settlementDateItem.title}
          amount={Number(settlementDateItem.amount)}
          currentDate={settlementDateItem.paidAt ?? null}
          isPending={settlementDateMut.isPending}
          onConfirm={(paidAt) =>
            settlementDateMut.mutate({ id: settlementDateItem.id, paidAt })
          }
          onCancel={() => setSettlementDateItem(null)}
        />
      )}

      <DebtDetailDrawer
        debt={detailTarget}
        onOpenChange={(open) => !open && setDetailTarget(null)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onTogglePaid={handleTogglePaid}
        onEditSettlementDate={(debt) => {
          setDetailTarget(null)
          setSettlementDateItem(debt)
        }}
      />
    </div>
  )
}

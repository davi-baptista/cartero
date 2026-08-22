'use client'

import { useState, useMemo, useEffect, useRef, memo } from 'react'
import { AnimatePresence, motion, animate } from 'motion/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Check, Undo2, Wallet, Search, MoreVertical, X, Repeat2, TriangleAlert, RotateCcw, Loader2, ShoppingBag } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ReceivableSheet, type ReceivableFormData } from './receivable-sheet'
import { DeleteLinkedWarningDialog } from '../transactions/delete-linked-warning-dialog'
import { InstallmentScopeDialog } from '../transactions/installment-scope-dialog'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '../transactions/unmark-paid-warning-dialog'
import {
  getReceivables,
  createReceivable,
  updateReceivable,
  deleteReceivable,
} from '@/services/receivables.service'
import { useSearchParams } from 'next/navigation'
import { getPersons } from '@/services/persons.service'
import { formatCurrency, formatDate } from '@/lib/formatters'
import Link from 'next/link'
import { isOverdue, overdueCountLabel } from '@/lib/settlement-status'
import { SettlementStatusDot } from '@/components/settlement-status-dot'
import { cn } from '@/lib/utils'
import type { Receivable } from '@/types'
import { InstallmentScope } from '@/types'
import { useAuth } from '@/providers/auth-provider'

// ─── Sub-components ──────────────────────────────────────────────────────────

const ReceivableRow = memo(function ReceivableRow({
  receivable,
  isHighlighted,
  onEdit,
  onDelete,
  onToggleReceived,
}: {
  receivable: Receivable
  isHighlighted?: boolean
  onEdit: (r: Receivable) => void
  onDelete: (r: Receivable) => void
  onToggleReceived: (r: Receivable) => void
}) {
  const overdue = isOverdue(receivable)
  const rowRef = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={rowRef} className="group flex items-center gap-3 px-1 py-3 rounded-lg">
      {/* Status dot — clickable toggle */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        transition={{ duration: 0.1 }}
        onClick={() => onToggleReceived(receivable)}
        aria-label={receivable.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
        title={receivable.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
        className="group/dot flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 ring-1 ring-border/50 transition-colors hover:bg-muted hover:ring-border"
      >
        {receivable.isPaid ? (
          <Undo2 className="size-3.5 text-muted-foreground/50 transition-colors group-hover/dot:text-muted-foreground" />
        ) : (
          <>
            <span className="block group-hover/dot:hidden">
              <SettlementStatusDot item={receivable} domain="receivable" />
            </span>
            <span className="hidden group-hover/dot:block text-muted-foreground">
              <Check className="size-3.5" />
            </span>
          </>
        )}
      </motion.button>

      {/* Title + debtor */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[15px] font-medium leading-tight',
              receivable.isPaid && 'text-muted-foreground line-through',
            )}
          >
            {receivable.title}
          </span>
          {receivable.parentId && (
            <>
              <Repeat2 aria-hidden="true" className="size-3.5 shrink-0 text-primary/70" />
              <span className="sr-only">Parcelado</span>
            </>
          )}
          {/*
            Cobrança gerada por uma compra no cartão.

            Sem essa marca as duas origens ficavam indistinguíveis na lista, e
            o usuário só descobria que o valor era travado ao abrir o
            formulário e não conseguir editá-lo.
          */}
          {receivable.transactionId && (
            <Link
              href={`/transactions?startDate=${receivable.occurredAt.slice(0, 10)}&endDate=${receivable.occurredAt.slice(0, 10)}&highlight=${receivable.transactionId}`}
              onClick={(event) => event.stopPropagation()}
              title="Ver a compra que gerou esta cobrança"
              className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <ShoppingBag aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Ver a compra que gerou esta cobrança</span>
            </Link>
          )}
        </span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{receivable.person?.name ?? receivable.debtorName}{receivable.description ? <> · <i>{receivable.description}</i></> : ''}</span>
          <span>·</span>
          <span className="shrink-0">em {formatDate(receivable.occurredAt)}</span>
        </div>
      </div>

      {/* Amount + due date */}
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span
          className={cn(
            'text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
            receivable.isPaid ? 'text-receivable' : overdue ? 'text-destructive' : '',
          )}
        >
          {formatCurrency(receivable.amount)}
        </span>
        {overdue ? (
          <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
            Em atraso · {formatDate(receivable.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{formatDate(receivable.dueDate)}</span>
        )}
      </div>

      {/* Mobile: amount only */}
      <div className="flex shrink-0 sm:hidden">
        <span
          className={cn(
            'text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
            receivable.isPaid ? 'text-receivable' : overdue ? 'text-destructive' : '',
          )}
        >
          {formatCurrency(receivable.amount)}
        </span>
      </div>

      {/* Desktop hover actions */}
      <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(receivable)}
          aria-label="Editar cobrança"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(receivable)}
          aria-label="Excluir cobrança"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Mobile dropdown */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mais opções"
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onToggleReceived(receivable)}>
              {receivable.isPaid ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
              {receivable.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEdit(receivable)}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(receivable)} className="text-destructive focus:text-destructive">
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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

type TabFilter = 'pending' | 'received'

export default function ReceivablesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight') ?? undefined
  const endDateParam = searchParams.get('endDate')

  const [tab, setTab] = useState<TabFilter>('pending')
  const [personFilter, setPersonFilter] = useState<string | undefined>(undefined)
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
  const [editReceivable, setEditReceivable] = useState<Receivable | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{ receivable: Receivable; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Receivable | null>(null)
  const [linkedWarningTarget, setLinkedWarningTarget] = useState<Receivable | null>(null)
  const [markPaidTarget, setMarkPaidTarget] = useState<Receivable | null>(null)
  const [unmarkPaidTarget, setUnmarkPaidTarget] = useState<Receivable | null>(null)

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  // Sem `startDate` na query: o backend devolve tudo até o fim do mês
  // selecionado, e o recorte por mês acontece no cliente — assim recebíveis
  // vencidos de meses anteriores continuam visíveis em qualquer mês.
  const {
    data: allReceivables,
    isLoading,
    isError,
    isSuccess,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['receivables', personFilter, endDate],
    queryFn: () => getReceivables({
      personId: personFilter,
      endDate,
    }),
  })

  const receivables = useMemo(() => {
    if (!allReceivables) return allReceivables
    return allReceivables.filter((receivable) => {
      const due = receivable.dueDate.slice(0, 10)
      if (due >= startDate) return true
      // Anterior ao mês selecionado: só continua na lista se ainda estiver em aberto.
      return !receivable.isPaid
    })
  }, [allReceivables, startDate])

  const createMut = useMutation({
    mutationFn: createReceivable,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      /*
        Cobrança nova aparece no informativo do Orçamento e, com pessoa, na
        linha dela em "Acertos com pessoas". Sem esta invalidação o card só
        atualizava na navegação seguinte — mesmo caso do lado das dívidas.
      */
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSheetOpen(false)
      toast.success('Cobrança criada')
    },
    onError: () => toast.error('Erro ao criar cobrança — verifique sua conexão e tente novamente'),
  })

  const updateMut = useMutation({
    mutationFn: ({
      id,
      payload,
      scope,
    }: {
      id: string
      payload: Parameters<typeof updateReceivable>[1]
      scope?: InstallmentScope
    }) => updateReceivable(id, payload, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSheetOpen(false)
      setEditReceivable(null)
      setEditScope(null)
      toast.success('Cobrança atualizada')
    },
    onError: () => toast.error('Erro ao salvar — verifique sua conexão e tente novamente'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope, preserveTransaction }: { id: string; scope?: InstallmentScope; preserveTransaction?: boolean }) =>
      deleteReceivable(id, scope, preserveTransaction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      toast.success('Cobrança excluída')
    },
    onError: () => toast.error('Erro ao excluir cobrança — tente novamente'),
  })

  useEffect(() => {
    if (!highlightId || !receivables) return
    const target = receivables.find((r) => r.id === highlightId)
    if (target?.isPaid) setTab('received')
  }, [highlightId, receivables])

  const summary = useMemo(() => {
    if (!receivables) return { pending: 0, overdueCount: 0 }
    const pending = receivables.filter((r) => !r.isPaid).reduce((s, r) => s + Number(r.amount), 0)
    const overdueCount = receivables.filter(isOverdue).length
    return { pending, overdueCount }
  }, [receivables])

  const filtered = useMemo(() => {
    if (!receivables) return []
    let list = receivables.filter((r) => (tab === 'pending' ? !r.isPaid : r.isPaid))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q) ?? false),
      )
    }
    if (tab === 'pending') {
      list.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    }
    return list
  }, [receivables, tab, search])

  function handleEdit(receivable: Receivable) {
    if (receivable.parentId) {
      setScopeDialog({ receivable, mode: 'edit' })
    } else {
      setEditReceivable(receivable)
      setEditScope(null)
      setSheetOpen(true)
    }
  }

  function handleDelete(receivable: Receivable) {
    if ((receivable.transactionId || receivable.paymentTransactionId) && !receivable.parentId) {
      setLinkedWarningTarget(receivable)
      return
    }
    if (receivable.parentId) {
      setScopeDialog({ receivable, mode: 'delete' })
    } else {
      setDeleteTarget(receivable)
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

  function handleToggleReceived(receivable: Receivable) {
    if (!receivable.isPaid) {
      if (user?.createIncomeOnReceivablePaid === false) {
        updateMut.mutate({ id: receivable.id, payload: { isPaid: true } })
      } else {
        setMarkPaidTarget(receivable)
      }
    } else if (receivable.paymentTransactionId) {
      setUnmarkPaidTarget(receivable)
    } else {
      updateMut.mutate({ id: receivable.id, payload: { isPaid: false } })
    }
  }

  function handleMarkPaidConfirm(payload: { paymentDate?: string }) {
    if (!markPaidTarget) return
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
      deleteMut.mutate({ id: scopeDialog.receivable.id, scope })
    } else {
      setEditScope(scope)
      setEditReceivable(scopeDialog.receivable)
      setSheetOpen(true)
    }
    setScopeDialog(null)
  }

  async function handleSheetSubmit(data: ReceivableFormData, scope: InstallmentScope | null) {
    if (editReceivable) {
      const { installments, ...payload } = data
      void installments
      await updateMut.mutateAsync({ id: editReceivable.id, payload, scope: scope ?? undefined })
    } else {
      await createMut.mutateAsync(data)
    }
  }

  const tabs: Array<{ value: TabFilter; label: string }> = [
    { value: 'pending', label: 'A receber' },
    { value: 'received', label: 'Recebidos' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-receivable">A Receber</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Acompanhe cobranças e valores que têm para receber
            </p>
          </div>
          <Button
            onClick={() => {
              setEditReceivable(null)
              setEditScope(null)
              setSheetOpen(true)
            }}
          >
            <Plus className="size-4" />
            Nova cobrança
          </Button>
        </div>
        {!isLoading && summary.pending > 0 && (
          <p className="mt-1.5 text-sm">
            <span className="text-muted-foreground">A receber </span>
            <span className="font-medium tabular-nums tracking-[-0.01em] text-receivable">
              {formatCurrency(summary.pending)}
            </span>
            {summary.overdueCount > 0 && (
              <span className="ml-2 text-xs font-medium text-destructive">
                · {overdueCountLabel(summary.overdueCount, 'receivable')}
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

      {/* Receivable list */}
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
            undefined — a tela dizia "Nada a receber por enquanto", afirmando ao usuário que ele
            não tem cobranças quando o servidor apenas não respondeu.
          */
          <div
            role="alert"
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
              <TriangleAlert className="size-6 text-destructive/70" aria-hidden />
            </div>
            <p className="text-sm font-medium">
              Não foi possível carregar suas cobranças
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
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-receivable/10">
              <Wallet className="size-5 text-receivable/70" />
            </div>
            <p className="text-sm font-medium">
              {search
                ? 'Nenhuma cobrança encontrada'
                : (tab === 'pending' ? 'Nada a receber por enquanto' : 'Nenhum recebimento registrado')}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {search
                ? 'Nenhum resultado para a busca. Tente um termo diferente.'
                : (tab === 'pending'
                    ? 'Crie uma nova cobrança usando o botão acima.'
                    : 'Cobranças marcadas como recebidas aparecerão aqui.')}
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
              {filtered.map((receivable, i) => (
                <MotionRow key={receivable.id} index={i}>
                  <ReceivableRow
                    receivable={receivable}
                    isHighlighted={receivable.id === highlightId}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleReceived={handleToggleReceived}
                  />
                </MotionRow>
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Sheet */}
      <ReceivableSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) {
            setEditReceivable(null)
            setEditScope(null)
          }
        }}
        editTarget={editReceivable}
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
        linkedWarning={Boolean(
          scopeDialog?.receivable.transactionId || scopeDialog?.receivable.paymentTransactionId,
        )}
      />

      {/* Cascade-delete warning — receivable linked to a transaction */}
      <DeleteLinkedWarningDialog
        open={linkedWarningTarget !== null}
        kind="receivable"
        /*
          Cobrança automática nasce de uma compra; cobrança recebida tem
          comprovante. A frase do diálogo precisa dizer qual das duas, senão o
          usuário decide sem saber o que perde.
        */
        link={linkedWarningTarget?.transactionId ? 'purchase' : 'payment'}
        isPending={deleteMut.isPending}
        onConfirm={handleLinkedWarningConfirm}
        onDeleteOnly={handleLinkedWarningDeleteOnly}
        onCancel={() => setLinkedWarningTarget(null)}
      />

      {/* Mark as received — asks for the receipt date */}
      <MarkAsPaidDialog
        open={markPaidTarget !== null}
        kind="receivable"
        createTransaction={user?.createIncomeOnReceivablePaid ?? false}
        isPending={updateMut.isPending}
        onConfirm={handleMarkPaidConfirm}
        onCancel={() => setMarkPaidTarget(null)}
      />

      {/* Unmark as received — warns that the linked transaction will be deleted */}
      <UnmarkPaidWarningDialog
        open={unmarkPaidTarget !== null}
        kind="receivable"
        isPending={updateMut.isPending}
        onConfirm={handleUnmarkPaidConfirm}
        onCancel={() => setUnmarkPaidTarget(null)}
      />

      {/* Delete confirm — non-parcelado */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir cobrança</DialogTitle>
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
    </div>
  )
}

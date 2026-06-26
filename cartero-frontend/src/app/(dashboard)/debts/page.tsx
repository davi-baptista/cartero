'use client'

import { useState, useMemo, useEffect, useRef, memo } from 'react'
import { AnimatePresence, motion, animate } from 'motion/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  Undo2,
  HandCoins,
  BellOff,
  Search,
  MoreVertical,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/ui/date-picker'
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
import { DebtSheet, type DebtFormData } from './debt-sheet'
import { InstallmentScopeDialog } from '../transactions/installment-scope-dialog'
import {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
} from '@/services/debts.service'
import { useSearchParams } from 'next/navigation'
import { getPersons } from '@/services/persons.service'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Debt } from '@/types'
import { InstallmentScope } from '@/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function isOverdue(debt: Debt): boolean {
  if (debt.isPaid) return false
  const today = new Date().toISOString().slice(0, 10)
  return debt.dueDate < today
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusDot({ debt }: { debt: Debt }) {
  if (debt.isPaid)
    return (
      <>
        <span className="size-2.5 rounded-full bg-receivable shrink-0" aria-hidden="true" />
        <span className="sr-only">Pago</span>
      </>
    )
  if (isOverdue(debt))
    return (
      <>
        <span className="relative flex size-2.5 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/50 opacity-75" />
          <span className="size-2.5 rounded-full bg-destructive" />
        </span>
        <span className="sr-only">Vencido</span>
      </>
    )
  return (
    <>
      <span className="size-2.5 rounded-full bg-pending shrink-0" aria-hidden="true" />
      <span className="sr-only">Pendente</span>
    </>
  )
}

const DebtRow = memo(function DebtRow({
  debt,
  isHighlighted,
  onEdit,
  onDelete,
  onTogglePaid,
}: {
  debt: Debt
  isHighlighted?: boolean
  onEdit: (d: Debt) => void
  onDelete: (d: Debt) => void
  onTogglePaid: (d: Debt) => void
}) {
  const overdue = isOverdue(debt)
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
        onClick={() => onTogglePaid(debt)}
        aria-label={debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
        title={debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
        className="group/dot flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 ring-1 ring-border/50 transition-colors hover:bg-muted hover:ring-border"
      >
        {debt.isPaid ? (
          <Undo2 className="size-3.5 text-muted-foreground/50 transition-colors group-hover/dot:text-muted-foreground" />
        ) : (
          <>
            <span className="block group-hover/dot:hidden">
              <StatusDot debt={debt} />
            </span>
            <span className="hidden group-hover/dot:block text-muted-foreground">
              <Check className="size-3.5" />
            </span>
          </>
        )}
      </motion.button>

      {/* Title + creditor */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-[15px] font-medium leading-tight',
            debt.isPaid && 'text-muted-foreground line-through',
          )}
        >
          {debt.title}
        </span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{debt.person?.name ?? debt.creditorName}{debt.description ? <> · <i>{debt.description}</i></> : ''}</span>
          {debt.parentId && (
            <>
              <span>·</span>
              <span className="text-primary/70">parcelado</span>
            </>
          )}
          {!debt.isAlertEnabled && (
            <>
              <span aria-hidden="true">·</span>
              <BellOff aria-hidden="true" className="size-3 opacity-50" />
              <span className="sr-only">Alerta desativado</span>
            </>
          )}
        </div>
      </div>

      {/* Amount + due date */}
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span
          className={cn(
            'text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
            debt.isPaid ? 'text-muted-foreground line-through' : overdue ? 'text-destructive' : '',
          )}
        >
          {formatCurrency(debt.amount)}
        </span>
        {overdue ? (
          <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
            Vencido {formatDate(debt.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{formatDate(debt.dueDate)}</span>
        )}
      </div>

      {/* Mobile: amount only */}
      <div className="flex shrink-0 sm:hidden">
        <span
          className={cn(
            'text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
            debt.isPaid ? 'text-muted-foreground line-through' : overdue ? 'text-destructive' : '',
          )}
        >
          {formatCurrency(debt.amount)}
        </span>
      </div>

      {/* Actions — hover only */}
      <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(debt)}
          aria-label="Editar dívida"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(debt)}
          aria-label="Excluir dívida"
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
            <DropdownMenuItem onClick={() => onTogglePaid(debt)}>
              {debt.isPaid ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
              {debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEdit(debt)}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(debt)} className="text-destructive focus:text-destructive">
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

type TabFilter = 'pending' | 'paid'

export default function DebtsPage() {
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight') ?? undefined
  const endDateParam = searchParams.get('endDate')

  const [tab, setTab] = useState<TabFilter>('pending')
  const [personFilter, setPersonFilter] = useState<string | undefined>(undefined)
  const [startDate, setStartDate] = useState<string | undefined>(undefined)
  const [endDate, setEndDate] = useState<string | undefined>(() => {
    if (endDateParam) return endDateParam
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
  })
  const [search, setSearch] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editDebt, setEditDebt] = useState<Debt | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{ debt: Debt; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Debt | null>(null)

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  const { data: debts, isLoading } = useQuery({
    queryKey: ['debts', personFilter, startDate, endDate],
    queryFn: () => getDebts({
      personId: personFilter,
      startDate,
      endDate,
    }),
  })

  const createMut = useMutation({
    mutationFn: createDebt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
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
      setSheetOpen(false)
      setEditDebt(null)
      setEditScope(null)
      toast.success('Dívida atualizada')
    },
    onError: () => toast.error('Erro ao salvar — verifique sua conexão e tente novamente'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: InstallmentScope }) =>
      deleteDebt(id, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
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

  function handleEdit(debt: Debt) {
    if (debt.parentId) {
      setScopeDialog({ debt, mode: 'edit' })
    } else {
      setEditDebt(debt)
      setEditScope(null)
      setSheetOpen(true)
    }
  }

  function handleDelete(debt: Debt) {
    if (debt.parentId) {
      setScopeDialog({ debt, mode: 'delete' })
    } else {
      setDeleteTarget(debt)
    }
  }

  function handleTogglePaid(debt: Debt) {
    updateMut.mutate({
      id: debt.id,
      payload: { isPaid: !debt.isPaid },
    })
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-destructive">Dívidas</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Controle suas dívidas externas e parcelamentos
          </p>
          {!isLoading && summary.pending > 0 && (
            <p className="mt-1.5 text-sm">
              <span className="text-muted-foreground">A pagar </span>
              <span className="font-medium tabular-nums tracking-[-0.01em] text-destructive">
                {formatCurrency(summary.pending)}
              </span>
              {summary.overdueCount > 0 && (
                <span className="ml-2 text-xs font-medium text-destructive">
                  · {summary.overdueCount} vencida{summary.overdueCount > 1 ? 's' : ''}
                </span>
              )}
            </p>
          )}
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

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36 sm:w-40">
            <DatePicker value={startDate} onChange={setStartDate} placeholder="Data início" />
          </div>
          <div className="w-36 sm:w-40">
            <DatePicker value={endDate} onChange={setEndDate} placeholder="Data fim" />
          </div>
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

          {(startDate || endDate || personFilter || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStartDate(undefined); setEndDate(undefined); setPersonFilter(undefined); setSearch('') }}
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
        ) : filtered.length === 0 ? (
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
                    onEdit={handleEdit}
                    onDelete={handleDelete}
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
        onConfirm={handleScopeConfirm}
        onCancel={() => setScopeDialog(null)}
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
    </div>
  )
}

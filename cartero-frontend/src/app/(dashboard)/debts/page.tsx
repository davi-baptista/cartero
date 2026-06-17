'use client'

import { useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
  MoreVertical,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
    return <span className="size-2.5 rounded-full bg-[oklch(0.600_0.150_145)] shrink-0" />
  if (isOverdue(debt))
    return (
      <span className="relative flex size-2.5 shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/50 opacity-75" />
        <span className="size-2.5 rounded-full bg-destructive" />
      </span>
    )
  return <span className="size-2.5 rounded-full bg-[oklch(0.720_0.150_60)] shrink-0" />
}

function DebtRow({
  debt,
  onEdit,
  onDelete,
  onTogglePaid,
}: {
  debt: Debt
  onEdit: (d: Debt) => void
  onDelete: (d: Debt) => void
  onTogglePaid: (d: Debt) => void
}) {
  const overdue = isOverdue(debt)

  return (
    <div className="group flex items-center gap-3 px-1 py-3">
      {/* Status dot */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        <StatusDot debt={debt} />
      </div>

      {/* Title + creditor */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-sm font-medium leading-tight',
            debt.isPaid && 'text-muted-foreground line-through',
          )}
        >
          {debt.title}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{debt.creditorName}</span>
          {debt.parentId && (
            <>
              <span>·</span>
              <span className="text-primary/70">parcelado</span>
            </>
          )}
          {!debt.isAlertEnabled && (
            <>
              <span>·</span>
              <BellOff className="size-3 opacity-50" />
            </>
          )}
        </div>
      </div>

      {/* Amount + due date */}
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span
          className={cn(
            'font-mono text-base font-semibold tabular-nums tracking-tight',
            debt.isPaid ? 'text-muted-foreground line-through' : 'text-destructive',
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
            'font-mono text-base font-semibold tabular-nums tracking-tight',
            debt.isPaid ? 'text-muted-foreground line-through' : 'text-destructive',
          )}
        >
          {formatCurrency(debt.amount)}
        </span>
      </div>

      {/* Desktop hover actions */}
      <div className="hidden items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
        <motion.div whileTap={{ scale: 0.80 }} transition={{ duration: 0.1 }}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'transition-colors',
              debt.isPaid
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-muted-foreground hover:text-[oklch(0.600_0.150_145)]',
            )}
            onClick={() => onTogglePaid(debt)}
            aria-label={debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
            title={debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
          >
            {debt.isPaid ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
          </Button>
        </motion.div>
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
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0">
      <Skeleton className="size-8 shrink-0 rounded-lg" />
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

  const [tab, setTab] = useState<TabFilter>('pending')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editDebt, setEditDebt] = useState<Debt | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{ debt: Debt; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Debt | null>(null)

  const { data: debts, isLoading } = useQuery({
    queryKey: ['debts'],
    queryFn: getDebts,
  })

  const createMut = useMutation({
    mutationFn: createDebt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
      setSheetOpen(false)
      toast.success('Dívida criada')
    },
    onError: () => toast.error('Erro ao criar dívida'),
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
    onError: () => toast.error('Erro ao atualizar dívida'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: InstallmentScope }) =>
      deleteDebt(id, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] })
      toast.success('Dívida excluída')
    },
    onError: () => toast.error('Erro ao excluir dívida'),
  })

  const summary = useMemo(() => {
    if (!debts) return { pending: 0, paid: 0, overdueCount: 0 }
    const pending = debts.filter((d) => !d.isPaid).reduce((s, d) => s + Number(d.amount), 0)
    const paid = debts.filter((d) => d.isPaid).reduce((s, d) => s + Number(d.amount), 0)
    const overdueCount = debts.filter(isOverdue).length
    return { pending, paid, overdueCount }
  }, [debts])

  const filtered = useMemo(() => {
    if (!debts) return []
    return debts.filter((d) => (tab === 'pending' ? !d.isPaid : d.isPaid))
  }, [debts, tab])

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
      updateMut.mutate({ id: editDebt.id, payload, scope: scope ?? undefined })
    } else {
      createMut.mutate(data)
    }
  }

  const tabs: Array<{ value: TabFilter; label: string }> = [
    { value: 'pending', label: 'Pendentes' },
    { value: 'paid', label: 'Pagas' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dívidas</h1>
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

      {/* Summary strip */}
      {!isLoading && debts && debts.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border pb-4 text-sm">
          <span className="text-muted-foreground">
            A pagar{' '}
            <span className="font-mono font-medium text-destructive">
              {formatCurrency(summary.pending)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Pago{' '}
            <span className="font-mono font-medium text-[oklch(0.600_0.150_145)]">
              {formatCurrency(summary.paid)}
            </span>
          </span>
          {summary.overdueCount > 0 && (
            <span className="font-medium text-destructive">
              {summary.overdueCount} vencida{summary.overdueCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Tab filter */}
      <div className="flex gap-1.5">
        {tabs.map(({ value, label }) => {
          const active = tab === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                active
                  ? 'border-transparent bg-primary/15 text-primary'
                  : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Debt list */}
      <div>
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
              {tab === 'pending' ? 'Nenhuma dívida pendente' : 'Nenhuma dívida paga'}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {tab === 'pending'
                ? 'Cadastre uma nova dívida usando o botão acima.'
                : 'Dívidas marcadas como pagas aparecerão aqui.'}
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

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
  Wallet,
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
import { ReceivableSheet, type ReceivableFormData } from './receivable-sheet'
import { InstallmentScopeDialog } from '../transactions/installment-scope-dialog'
import {
  getReceivables,
  createReceivable,
  updateReceivable,
  deleteReceivable,
} from '@/services/receivables.service'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Receivable } from '@/types'
import { InstallmentScope } from '@/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function isOverdue(r: Receivable): boolean {
  if (r.isPaid) return false
  const today = new Date().toISOString().slice(0, 10)
  return r.dueDate < today
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusDot({ receivable }: { receivable: Receivable }) {
  if (receivable.isPaid)
    return <span className="size-2.5 rounded-full bg-[oklch(0.600_0.150_145)] shrink-0" />
  if (isOverdue(receivable))
    return (
      <span className="relative flex size-2.5 shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[oklch(0.720_0.150_60)]/50 opacity-75" />
        <span className="size-2.5 rounded-full bg-[oklch(0.720_0.150_60)]" />
      </span>
    )
  return <span className="size-2.5 rounded-full bg-primary/60 shrink-0" />
}

function ReceivableRow({
  receivable,
  onEdit,
  onDelete,
  onToggleReceived,
}: {
  receivable: Receivable
  onEdit: (r: Receivable) => void
  onDelete: (r: Receivable) => void
  onToggleReceived: (r: Receivable) => void
}) {
  const overdue = isOverdue(receivable)

  return (
    <div className="group flex items-center gap-3 px-1 py-3">
      {/* Status dot */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        <StatusDot receivable={receivable} />
      </div>

      {/* Title + debtor */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-sm font-medium leading-tight',
            receivable.isPaid && 'text-muted-foreground line-through',
          )}
        >
          {receivable.title}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{receivable.debtorName}</span>
          {receivable.parentId && (
            <>
              <span>·</span>
              <span className="text-primary/70">parcelado</span>
            </>
          )}
        </div>
      </div>

      {/* Amount + due date */}
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span
          className={cn(
            'font-mono text-base font-semibold tabular-nums tracking-tight',
            receivable.isPaid ? 'text-[oklch(0.600_0.150_145)]' : 'text-foreground',
          )}
        >
          {formatCurrency(receivable.amount)}
        </span>
        {overdue ? (
          <span className="inline-flex items-center rounded-full bg-[oklch(0.720_0.150_60)]/15 px-2 py-0.5 text-[11px] font-medium text-[oklch(0.720_0.150_60)]">
            Atrasado {formatDate(receivable.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{formatDate(receivable.dueDate)}</span>
        )}
      </div>

      {/* Mobile: amount only */}
      <div className="flex shrink-0 sm:hidden">
        <span
          className={cn(
            'font-mono text-base font-semibold tabular-nums tracking-tight',
            receivable.isPaid ? 'text-[oklch(0.600_0.150_145)]' : 'text-foreground',
          )}
        >
          {formatCurrency(receivable.amount)}
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
              receivable.isPaid
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-muted-foreground hover:text-[oklch(0.600_0.150_145)]',
            )}
            onClick={() => onToggleReceived(receivable)}
            aria-label={receivable.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
            title={receivable.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
          >
            {receivable.isPaid ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
          </Button>
        </motion.div>
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

type TabFilter = 'pending' | 'received'

export default function ReceivablesPage() {
  const qc = useQueryClient()

  const [tab, setTab] = useState<TabFilter>('pending')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editReceivable, setEditReceivable] = useState<Receivable | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{ receivable: Receivable; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Receivable | null>(null)

  const { data: receivables, isLoading } = useQuery({
    queryKey: ['receivables'],
    queryFn: getReceivables,
  })

  const createMut = useMutation({
    mutationFn: createReceivable,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      setSheetOpen(false)
      toast.success('Cobrança criada')
    },
    onError: () => toast.error('Erro ao criar cobrança'),
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
      setSheetOpen(false)
      setEditReceivable(null)
      setEditScope(null)
      toast.success('Cobrança atualizada')
    },
    onError: () => toast.error('Erro ao atualizar cobrança'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: InstallmentScope }) =>
      deleteReceivable(id, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      toast.success('Cobrança excluída')
    },
    onError: () => toast.error('Erro ao excluir cobrança'),
  })

  const summary = useMemo(() => {
    if (!receivables) return { pending: 0, received: 0 }
    const pending = receivables.filter((r) => !r.isPaid).reduce((s, r) => s + Number(r.amount), 0)
    const received = receivables.filter((r) => r.isPaid).reduce((s, r) => s + Number(r.amount), 0)
    return { pending, received }
  }, [receivables])

  const filtered = useMemo(() => {
    if (!receivables) return []
    return receivables.filter((r) => (tab === 'pending' ? !r.isPaid : r.isPaid))
  }, [receivables, tab])

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
    if (receivable.parentId) {
      setScopeDialog({ receivable, mode: 'delete' })
    } else {
      setDeleteTarget(receivable)
    }
  }

  function handleToggleReceived(receivable: Receivable) {
    updateMut.mutate({
      id: receivable.id,
      payload: { isPaid: !receivable.isPaid },
    })
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
      updateMut.mutate({ id: editReceivable.id, payload, scope: scope ?? undefined })
    } else {
      createMut.mutate(data)
    }
  }

  const tabs: Array<{ value: TabFilter; label: string }> = [
    { value: 'pending', label: 'A receber' },
    { value: 'received', label: 'Recebidos' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">A Receber</h1>
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

      {/* Summary strip */}
      {!isLoading && receivables && receivables.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border pb-4 text-sm">
          <span className="text-muted-foreground">
            A receber{' '}
            <span className="font-mono font-medium text-foreground">
              {formatCurrency(summary.pending)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Recebido{' '}
            <span className="font-mono font-medium text-[oklch(0.600_0.150_145)]">
              {formatCurrency(summary.received)}
            </span>
          </span>
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

      {/* Receivable list */}
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
              <Wallet className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {tab === 'pending' ? 'Nada a receber por enquanto' : 'Nenhum recebimento registrado'}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {tab === 'pending'
                ? 'Crie uma nova cobrança usando o botão acima.'
                : 'Cobranças marcadas como recebidas aparecerão aqui.'}
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
        onConfirm={handleScopeConfirm}
        onCancel={() => setScopeDialog(null)}
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

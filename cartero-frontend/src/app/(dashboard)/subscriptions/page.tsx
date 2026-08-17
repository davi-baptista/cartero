'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Repeat, Pause, Play, MoreVertical } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MotionRow } from '@/components/ui/motion-row'
import { SubscriptionSheet, type SubscriptionFormData } from './subscription-sheet'
import {
  getSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from '@/services/subscriptions.service'
import { formatCurrency, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Subscription } from '@/types'

function SubscriptionRow({
  subscription,
  onEdit,
  onToggle,
  onDelete,
}: {
  subscription: Subscription
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const inactive = !subscription.isActive

  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-3 border-b border-border/60 py-3.5 last:border-b-0 sm:gap-4',
        inactive && 'opacity-55',
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/40 sm:size-11">
        <Repeat className="size-4.5 text-muted-foreground" aria-hidden />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium leading-tight sm:text-[15px]">
            {subscription.title}
          </span>
          {inactive && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Pausada
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
          <span className="shrink-0">Todo dia {subscription.dayOfMonth}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{TRANSACTION_TYPE_LABELS[subscription.type]}</span>
          {subscription.bank && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{subscription.bank.name}</span>
            </>
          )}
        </div>
      </div>

      <span className="shrink-0 text-[15px] font-semibold tabular-nums tracking-[-0.02em] text-destructive">
        −{formatCurrency(Number(subscription.amount))}
      </span>

      {/* Ações — visíveis no hover em desktop, sempre acessíveis no mobile */}
      <div className="flex shrink-0 items-center gap-0.5">
        <div className="hidden gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={inactive ? 'Retomar' : 'Pausar'} title={inactive ? 'Retomar' : 'Pausar'}>
            {inactive ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Editar" title="Editar">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Excluir" title="Excluir" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Ações" />}>
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onToggle}>
              {inactive ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {inactive ? 'Retomar' : 'Pausar'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export default function SubscriptionsPage() {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Subscription | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null)

  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: getSubscriptions,
  })

  /** Mutações em assinatura geram transações — o resto do app precisa saber. */
  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['subscriptions'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['bank-invoices'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
  }

  const createMut = useMutation({
    mutationFn: createSubscription,
    onSuccess: (result) => {
      invalidateAll()
      const criadas = result.generated?.filter((g) => !g.skipped).length ?? 0
      toast.success(
        criadas > 0
          ? `Assinatura criada — ${criadas} lançamento${criadas > 1 ? 's' : ''} gerado${criadas > 1 ? 's' : ''}`
          : 'Assinatura criada',
      )
    },
    onError: () => toast.error('Erro ao criar assinatura — verifique sua conexão e tente novamente'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateSubscription>[1] }) =>
      updateSubscription(id, payload),
    onSuccess: () => {
      invalidateAll()
      toast.success('Assinatura atualizada')
    },
    onError: () => toast.error('Erro ao atualizar assinatura'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteSubscription,
    onSuccess: () => {
      invalidateAll()
      setDeleteTarget(null)
      toast.success('Assinatura excluída')
    },
    onError: () => toast.error('Erro ao excluir assinatura'),
  })

  const monthlyTotal = useMemo(
    () =>
      subscriptions
        .filter((s) => s.isActive)
        .reduce((sum, s) => sum + Number(s.amount), 0),
    [subscriptions],
  )

  const activeCount = subscriptions.filter((s) => s.isActive).length

  async function handleSubmit(data: SubscriptionFormData) {
    if (editTarget) {
      // `startedAt` fica de fora: é imutável, e o backend o ignora de todo modo.
      const { title, bankId, type, amount, description, dayOfMonth } = data
      await updateMut.mutateAsync({
        id: editTarget.id,
        payload: { title, bankId, type, amount, description, dayOfMonth },
      })
    } else {
      await createMut.mutateAsync(data)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assinaturas</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cobranças que se repetem todo mês
            </p>
          </div>
          <Button onClick={() => { setEditTarget(null); setSheetOpen(true) }}>
            <Plus className="size-4" />
            Nova assinatura
          </Button>
        </div>
        {!isLoading && activeCount > 0 && (
          <p className="mt-1.5 text-sm">
            <span className="text-muted-foreground">Por mês </span>
            <span className="font-medium tabular-nums tracking-[-0.01em] text-destructive">
              {formatCurrency(monthlyTotal)}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              · {activeCount} ativa{activeCount > 1 ? 's' : ''}
            </span>
          </p>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border/60 py-3.5">
              <Skeleton className="size-10 shrink-0 rounded-xl sm:size-11" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted/40">
            <Repeat className="size-7 text-muted-foreground" />
          </div>
          <p className="text-base font-semibold">Ainda sem assinaturas</p>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            Cadastre o que você paga todo mês — Netflix, Spotify, academia — e o
            lançamento aparece sozinho na data certa.
          </p>
          <Button className="mt-5" onClick={() => { setEditTarget(null); setSheetOpen(true) }}>
            <Plus className="size-4" />
            Nova assinatura
          </Button>
        </div>
      ) : (
        <div>
          {subscriptions.map((s, i) => (
            <MotionRow key={s.id} index={i}>
              <SubscriptionRow
                subscription={s}
                onEdit={() => { setEditTarget(s); setSheetOpen(true) }}
                onToggle={() =>
                  updateMut.mutate({ id: s.id, payload: { isActive: !s.isActive } })
                }
                onDelete={() => setDeleteTarget(s)}
              />
            </MotionRow>
          ))}
        </div>
      )}

      <SubscriptionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editSubscription={editTarget}
        onSubmit={handleSubmit}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir assinatura</DialogTitle>
            <DialogDescription>
              {deleteTarget?.title} deixa de gerar novos lançamentos. Os que já
              foram criados continuam no extrato.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

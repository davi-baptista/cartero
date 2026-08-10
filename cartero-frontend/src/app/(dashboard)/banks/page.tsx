'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Landmark, ChevronRight, MoreVertical } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MotionRow } from '@/components/ui/motion-row'
import { BankSheet, type BankFormData } from './bank-sheet'
import { getBanks, createBank, updateBank, deleteBank } from '@/services/banks.service'
import { getBankInvoices, getInvoices } from '@/services/invoices.service'
import { formatCurrency } from '@/lib/formatters'
import { getInvoiceCloseDate, getInvoiceDueDate } from '@/lib/invoice-dates'
import { cn } from '@/lib/utils'
import { InvoiceStatus } from '@/types'
import type { Bank } from '@/types'

// ─── Sub-components ───────────────────────────────────────────────────────────

type InvoiceUrgency = 'overdue' | 'closing' | 'open' | 'none'

interface NearestInvoiceInfo {
  amount: number | null
  label: string
  urgency: InvoiceUrgency
}

const NEAREST_INVOICE_TEXT_CLASS: Record<InvoiceUrgency, string> = {
  overdue: 'text-destructive',
  closing: 'text-pending',
  open: 'text-primary',
  none: 'text-receivable',
}

const NEAREST_INVOICE_BADGE_CLASS: Record<InvoiceUrgency, string> = {
  overdue: 'bg-destructive/15 text-destructive',
  closing: 'bg-pending/15 text-pending',
  open: 'bg-primary/10 text-primary',
  none: 'bg-receivable/10 text-receivable',
}

function useNearestInvoice(bank: Bank): NearestInvoiceInfo | null {
  const { data: invoices } = useQuery({
    // Keep this under the bank-invoices prefix so transaction mutations
    // invalidate the amount shown in the bank list immediately.
    queryKey: ['bank-invoices', 'mini', bank.id],
    queryFn: () => getBankInvoices(bank.id),
    staleTime: 5 * 60 * 1000,
  })

  if (!invoices || invoices.length === 0) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const nonEmpty = invoices.filter((i) => Number(i.totalAmount) > 0)
  const overdue = nonEmpty.find((i) => i.status === InvoiceStatus.OVERDUE)
  const closed = nonEmpty.find((i) => i.status === InvoiceStatus.CLOSED)
  const open = nonEmpty.find((i) => i.status === InvoiceStatus.OPEN)

  if (overdue) {
    const due = getInvoiceDueDate(overdue.year, overdue.month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose)
    const daysLate = Math.ceil((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    return {
      amount: Number(overdue.totalAmount),
      label: daysLate > 0 ? `Vencida há ${daysLate}d` : 'Vencida hoje',
      urgency: 'overdue',
    }
  }

  if (closed) {
    const due = getInvoiceDueDate(closed.year, closed.month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose)
    const diff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const label = diff === 0 ? 'Vence hoje' : diff === 1 ? 'Vence amanhã' : diff > 0 ? `Vence em ${diff}d` : `Venceu há ${Math.abs(diff)}d`
    return { amount: Number(closed.totalAmount), label, urgency: 'closing' }
  }

  if (open) {
    const close = getInvoiceCloseDate(open.year, open.month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose)
    const diff = Math.ceil((close.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const label = diff === 0 ? 'Fecha hoje' : diff === 1 ? 'Fecha amanhã' : diff > 0 ? `Fecha em ${diff}d` : `Fechou há ${Math.abs(diff)}d`
    return { amount: Number(open.totalAmount), label, urgency: 'open' }
  }

  return { amount: null, label: 'Em dia', urgency: 'none' }
}

// Status + due countdown — sits next to the bank name, same spot as the invoice-row badge.
function NearestInvoiceBadge({ info }: { info: NearestInvoiceInfo }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        NEAREST_INVOICE_BADGE_CLASS[info.urgency],
      )}
    >
      {info.urgency === 'overdue' && (
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60" />
          <span className="size-1.5 rounded-full bg-destructive" />
        </span>
      )}
      {info.label}
    </span>
  )
}

// The amount alone, standing as the row's primary stat.
function NearestInvoiceAmount({ info }: { info: NearestInvoiceInfo }) {
  if (info.amount == null) return null
  return (
    <span
      className={cn(
        'text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
        NEAREST_INVOICE_TEXT_CLASS[info.urgency],
      )}
    >
      {formatCurrency(info.amount)}
    </span>
  )
}

function BankRow({
  bank,
  onEdit,
  onDelete,
}: {
  bank: Bank
  onEdit: (b: Bank) => void
  onDelete: (b: Bank) => void
}) {
  const initial = bank.name[0]?.toUpperCase() ?? '?'
  const nearest = useNearestInvoice(bank)

  return (
    <div className="group flex items-center gap-4 border-b border-border px-1 py-4 last:border-b-0">
      {/* Monogram */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-[14px] font-semibold text-muted-foreground select-none">
        {initial}
      </div>

      {/* Name + status badge — same pairing as the invoice list rows */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium">{bank.name}</span>
          {nearest && <NearestInvoiceBadge info={nearest} />}
        </div>
      </div>

      {/* Amount alone — the row's primary stat */}
      <div className="shrink-0">
        {nearest && <NearestInvoiceAmount info={nearest} />}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mais opções"
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(bank)}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(bank)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Ver faturas — always visible */}
        <Link
          href={`/banks/${bank.id}/invoices`}
          className={buttonVariants({
            variant: 'ghost',
            size: 'sm',
            className: 'gap-1 text-xs text-muted-foreground hover:text-foreground',
          })}
          title="Ver faturas"
        >
          <span className="hidden sm:inline">Faturas</span>
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-border px-1 py-4 last:border-b-0">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex flex-1 items-center gap-6">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="hidden shrink-0 items-center gap-6 sm:flex">
        <Skeleton className="h-8 w-10" />
        <Skeleton className="h-8 w-10" />
      </div>
      <Skeleton className="h-7 w-20 rounded-md" />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BanksPage() {
  const qc = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editBank, setEditBank] = useState<Bank | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Bank | null>(null)

  const { data: banks, isLoading } = useQuery({
    queryKey: ['banks'],
    queryFn: getBanks,
  })

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => getInvoices(),
  })

  const sortedBanks = useMemo(() => {
    if (!banks) return []

    function priority(bank: Bank) {
      const active = invoices.filter(
        (invoice) =>
          invoice.bankId === bank.id &&
          Number(invoice.totalAmount) > 0 &&
          invoice.status !== InvoiceStatus.PAID,
      )

      const overdueOrClosed = active.filter(
        (invoice) => invoice.status === InvoiceStatus.OVERDUE || invoice.status === InvoiceStatus.CLOSED,
      )

      if (overdueOrClosed.length > 0) {
        const dueDate = Math.min(
          ...overdueOrClosed.map((invoice) =>
            getInvoiceDueDate(invoice.year, invoice.month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose).getTime(),
          ),
        )
        return { group: 0, date: dueDate }
      }

      const open = active.filter((invoice) => invoice.status === InvoiceStatus.OPEN)
      if (open.length > 0) {
        const closeDate = Math.min(
          ...open.map((invoice) =>
            getInvoiceCloseDate(invoice.year, invoice.month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose).getTime(),
          ),
        )
        return { group: 1, date: closeDate }
      }

      return { group: 2, date: Number.POSITIVE_INFINITY }
    }

    return [...banks].sort((a, b) => {
      const aPriority = priority(a)
      const bPriority = priority(b)
      return aPriority.group - bPriority.group || aPriority.date - bPriority.date || a.name.localeCompare(b.name)
    })
  }, [banks, invoices])

  const createMut = useMutation({
    mutationFn: (data: BankFormData) =>
      createBank({
        name: data.name,
        invoiceDueDate: data.invoiceDueDate,
        invoiceDueDaysAfterClose: data.invoiceDueDaysAfterClose,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      setSheetOpen(false)
      toast.success('Banco criado')
    },
    onError: () => toast.error('Erro ao criar banco'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: BankFormData }) =>
      updateBank(id, {
        name: data.name,
        invoiceDueDate: data.invoiceDueDate,
        invoiceDueDaysAfterClose: data.invoiceDueDaysAfterClose,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      setSheetOpen(false)
      setEditBank(null)
      toast.success('Banco atualizado')
    },
    onError: () => toast.error('Erro ao atualizar banco'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteBank,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      toast.success('Banco excluído')
    },
    onError: () => toast.error('Erro ao excluir banco'),
  })

  async function handleSheetSubmit(data: BankFormData) {
    if (editBank) {
      await updateMut.mutateAsync({ id: editBank.id, data })
    } else {
      await createMut.mutateAsync(data)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bancos</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gerencie seus bancos e cartões de crédito
          </p>
        </div>
        <Button
          onClick={() => {
            setEditBank(null)
            setSheetOpen(true)
          }}
        >
          <Plus className="size-4" />
          Novo banco
        </Button>
      </div>

      {/* Bank list */}
      <div className="border-t border-border">
        {isLoading ? (
          <div>
            {Array.from({ length: 4 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : !banks || banks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted/40">
              <Landmark className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-medium">Nenhum banco cadastrado</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Adicione seu primeiro banco para começar a acompanhar faturas e gastos.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => {
                setEditBank(null)
                setSheetOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              Adicionar banco
            </Button>
          </div>
        ) : (
          <div>
            {sortedBanks.map((bank, i) => (
              <MotionRow key={bank.id} index={i}>
                <BankRow
                  bank={bank}
                  onEdit={(b) => {
                    setEditBank(b)
                    setSheetOpen(true)
                  }}
                  onDelete={setDeleteTarget}
                />
              </MotionRow>
            ))}
          </div>
        )}
      </div>

      {/* Sheet */}
      <BankSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditBank(null)
        }}
        editTarget={editBank}
        onSubmit={handleSheetSubmit}
      />

      {/* Delete confirm */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir banco</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong>? Esta ação
              não pode ser desfeita.
              <span className="mt-2 block text-xs text-destructive">
                Todas as transações e faturas vinculadas serão removidas permanentemente.
                {deleteTarget?._count && ` ${deleteTarget._count.transactions} transação(ões) e ${deleteTarget._count.invoices} fatura(s).`}
              </span>
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
                  deleteMut.mutate(deleteTarget.id)
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

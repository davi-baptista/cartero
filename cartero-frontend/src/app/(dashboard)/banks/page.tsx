'use client'

import { useState } from 'react'
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
import { getBankInvoices } from '@/services/invoices.service'
import { formatCurrency } from '@/lib/formatters'
import { InvoiceStatus } from '@/types'
import type { Bank } from '@/types'

// ─── Sub-components ───────────────────────────────────────────────────────────

function InvoicePill({ bank }: { bank: Bank }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: invoices } = useQuery({
    queryKey: ['bank-invoices-mini', bank.id],
    queryFn: () => getBankInvoices(bank.id),
    staleTime: 5 * 60 * 1000,
  })

  if (!invoices || invoices.length === 0) return null

  const overdue = invoices.find((i) => i.status === InvoiceStatus.OVERDUE)
  const closed = invoices.find((i) => i.status === InvoiceStatus.CLOSED)
  const open = invoices.find((i) => i.status === InvoiceStatus.OPEN)

  if (overdue) {
    const due = new Date(overdue.year, overdue.month - 1, bank.invoiceDueDate)
    const daysLate = Math.ceil((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-2.5 py-0.5 text-[11px] font-medium text-destructive">
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60" />
          <span className="size-1.5 rounded-full bg-destructive" />
        </span>
        Vencida {daysLate > 0 ? `há ${daysLate}d` : 'hoje'} · {formatCurrency(overdue.totalAmount)}
      </span>
    )
  }

  if (closed) {
    const due = new Date(closed.year, closed.month - 1, bank.invoiceDueDate)
    const diff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const label = diff <= 0 ? 'Vence hoje' : diff === 1 ? 'Vence amanhã' : `Vence em ${diff}d`
    return (
      <span className="inline-flex items-center rounded-full bg-pending/15 px-2.5 py-0.5 text-[11px] font-medium text-pending">
        {label} · {formatCurrency(closed.totalAmount)}
      </span>
    )
  }

  if (open) {
    const close = new Date(open.year, open.month - 1, bank.invoiceCloseDate)
    const diff = Math.ceil((close.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const label = diff <= 0 ? 'Fecha hoje' : diff === 1 ? 'Fecha amanhã' : `Fecha em ${diff}d`
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
        {label}{open.totalAmount > 0 ? ` · ${formatCurrency(open.totalAmount)}` : ''}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-receivable/10 px-2.5 py-0.5 text-[11px] font-medium text-receivable">
      Em dia
    </span>
  )
}

function DateStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.75rem]">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[22px] font-semibold leading-none tabular-nums">{value}</span>
    </div>
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

  return (
    <div className="group flex items-center gap-4 px-2 py-4">
      {/* Monogram */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-[14px] font-semibold text-muted-foreground select-none">
        {initial}
      </div>

      {/* Name + pill + mobile dates */}
      <div className="min-w-0 flex-1">
        <span className="text-[15px] font-medium">{bank.name}</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <InvoicePill bank={bank} />
          {/* Mobile: dates inline */}
          <div className="flex items-center gap-2 sm:hidden">
            <span className="text-[10px] text-muted-foreground/40" aria-hidden>·</span>
            <span className="text-xs text-muted-foreground">
              Fecha <strong className="font-semibold text-foreground">{bank.invoiceCloseDate}</strong>
            </span>
            <span className="text-[10px] text-muted-foreground/40" aria-hidden>|</span>
            <span className="text-xs text-muted-foreground">
              Vence <strong className="font-semibold text-foreground">{bank.invoiceDueDate}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Desktop: date stats */}
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <DateStat label="Fecha" value={bank.invoiceCloseDate} />
        <div className="h-8 w-px bg-border/60 mx-1" aria-hidden />
        <DateStat label="Vence" value={bank.invoiceDueDate} />
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Desktop hover edit/delete */}
        <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(bank)}
            aria-label="Editar banco"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(bank)}
            aria-label="Excluir banco"
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
        </div>

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
    <div className="flex items-center gap-4 border-b border-border px-2 py-4 last:border-b-0">
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

  const createMut = useMutation({
    mutationFn: (data: BankFormData) =>
      createBank({
        name: data.name,
        invoiceCloseDate: data.invoiceCloseDate,
        invoiceDueDate: data.invoiceDueDate,
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
        invoiceCloseDate: data.invoiceCloseDate,
        invoiceDueDate: data.invoiceDueDate,
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

  function handleSheetSubmit(data: BankFormData) {
    if (editBank) {
      updateMut.mutate({ id: editBank.id, data })
    } else {
      createMut.mutate(data)
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
      <div>
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
            {banks.map((bank, i) => (
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

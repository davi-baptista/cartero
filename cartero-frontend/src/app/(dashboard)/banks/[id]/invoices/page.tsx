'use client'

import { useState } from 'react'
import type React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CreditCard,
  Wallet,
  Receipt,
  FileText,
  TrendingUp,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { MotionRow } from '@/components/ui/motion-row'
import { getBankInvoices, getInvoice, updateInvoiceStatus } from '@/services/invoices.service'
import { getBank } from '@/services/banks.service'
import {
  formatCurrency,
  formatMonthYear,
  isExpense,
} from '@/lib/formatters'
import { parseDateOnly } from '@/lib/date'
import { resolveCategoryIcon } from '@/lib/category-icons'
import type { Invoice, Bank, Transaction } from '@/types'
import { InvoiceStatus, TransactionType } from '@/types'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  [InvoiceStatus.OPEN]: {
    label: 'Aberta',
    className: 'bg-primary/15 text-primary',
  },
  [InvoiceStatus.CLOSED]: {
    label: 'Fechada',
    className: 'bg-amber-500/15 text-amber-400',
  },
  [InvoiceStatus.OVERDUE]: {
    label: 'Vencida',
    className: 'bg-destructive/15 text-destructive',
  },
  [InvoiceStatus.PAID]: {
    label: 'Paga',
    className: 'bg-green-500/15 text-green-500',
  },
}

// Status color primitives used for row highlight and sheet header tint
const STATUS_COLOR: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'oklch(0.640 0.210 272)',
  [InvoiceStatus.CLOSED]: 'oklch(0.750 0.150 80)',
  [InvoiceStatus.OVERDUE]: 'oklch(0.704 0.191 22)',
  [InvoiceStatus.PAID]: 'oklch(0.700 0.170 145)',
}

function statusHeaderStyle(status: InvoiceStatus): React.CSSProperties {
  const c = STATUS_COLOR[status]
  return {
    backgroundColor: `color-mix(in oklch, ${c} 10%, transparent)`,
    borderBottomColor: `color-mix(in oklch, ${c} 22%, transparent)`,
  }
}

function statusRowBg(status: InvoiceStatus): React.CSSProperties {
  const c = STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 7%, transparent)` }
}

const INCOME_COLOR = 'oklch(0.700 0.170 145)'
const EXPENSE_BG = 'oklch(1 0 0 / 5%)'
const INCOME_BG = 'oklch(0.700 0.170 145 / 15%)'
const EXPENSE_ICON_CLR = 'oklch(0.600 0 0)'
const INCOME_ICON_CLR = 'oklch(0.700 0.170 145)'

const TYPE_ICON: Record<TransactionType, LucideIcon> = {
  [TransactionType.INCOME]: TrendingUp,
  [TransactionType.CREDIT_CARD]: CreditCard,
  [TransactionType.DEBIT_CARD]: Wallet,
  [TransactionType.PIX]: Receipt,
  [TransactionType.BOLETO]: FileText,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function calcCloseDate(bank: Bank, month: number, year: number): string {
  return format(new Date(year, month - 1, bank.invoiceCloseDate), "dd 'de' MMMM", { locale: ptBR })
}

function calcDueDate(bank: Bank, month: number, year: number): string {
  return format(new Date(year, month - 1, bank.invoiceDueDate), "dd 'de' MMMM", { locale: ptBR })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const { label, className } = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}

function InvoiceRow({
  invoice,
  bank,
  isSelected,
  onClick,
}: {
  invoice: Invoice
  bank: Bank | undefined
  isSelected: boolean
  onClick: () => void
}) {
  const monthYear = capitalize(formatMonthYear(invoice.month, invoice.year))
  const total = Number(invoice.totalAmount)

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 px-2 py-4 text-left transition-colors hover:bg-muted/30"
      style={isSelected ? statusRowBg(invoice.status) : undefined}
    >
      {/* Month + status + dates */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-medium">{monthYear}</span>
          <StatusBadge status={invoice.status} />
        </div>
        {bank && (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Fecha {calcCloseDate(bank, invoice.month, invoice.year)}</span>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span>Vence {calcDueDate(bank, invoice.month, invoice.year)}</span>
          </div>
        )}
      </div>

      {/* Total */}
      <p
        className={cn(
          'shrink-0 text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
          invoice.status === InvoiceStatus.OVERDUE ? 'text-destructive' : '',
        )}
      >
        {formatCurrency(total)}
      </p>
    </button>
  )
}

function TxRow({ tx }: { tx: Transaction }) {
  const Icon = TYPE_ICON[tx.type]
  const expense = isExpense(tx.type)

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: expense ? EXPENSE_BG : INCOME_BG }}
      >
        <Icon className="size-4" style={{ color: expense ? EXPENSE_ICON_CLR : INCOME_ICON_CLR }} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-tight">{tx.title}</span>
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          {tx.category && (() => {
            const { Icon: CatIcon } = resolveCategoryIcon(tx.category.icon)
            return (
              <span className="flex shrink-0 items-center gap-1">
                <CatIcon
                  className="size-3"
                  style={tx.category.color ? { color: tx.category.color } : undefined}
                />
                <span>{tx.category.name}</span>
              </span>
            )
          })()}
          {tx.description && tx.category && (
            <span aria-hidden className="text-muted-foreground/40">·</span>
          )}
          {tx.description && (
            <span className="truncate italic">{tx.description}</span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <span
          className="text-[14px] font-semibold tabular-nums tracking-[-0.01em]"
          style={{ color: expense ? undefined : INCOME_COLOR }}
        >
          {expense ? `−${formatCurrency(Number(tx.amount))}` : `+${formatCurrency(Number(tx.amount))}`}
        </span>
        {tx.date && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {format(parseDateOnly(tx.date), 'dd/MM', { locale: ptBR })}
          </p>
        )}
      </div>
    </div>
  )
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

function InvoiceDetailSheet({
  invoiceId,
  bankId,
  bank,
  open,
  onOpenChange,
}: {
  invoiceId: string | null
  bankId: string
  bank: Bank | undefined
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => getInvoice(invoiceId!),
    enabled: !!invoiceId,
  })

  const markPaidMut = useMutation({
    mutationFn: () => updateInvoiceStatus(invoiceId!, InvoiceStatus.PAID),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      qc.invalidateQueries({ queryKey: ['bank-invoices', bankId] })
      toast.success('Fatura marcada como paga')
    },
    onError: () => toast.error('Erro ao atualizar fatura'),
  })

  const canMarkPaid =
    invoice &&
    (invoice.status === InvoiceStatus.CLOSED || invoice.status === InvoiceStatus.OVERDUE)
  const monthYear = invoice ? capitalize(formatMonthYear(invoice.month, invoice.year)) : ''
  const total = invoice ? Number(invoice.totalAmount) : 0
  const txCount = invoice?.transactions?.length ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg" showCloseButton>
        {isLoading || !invoice ? (
          <div className="flex flex-1 flex-col gap-5 p-6">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-52" />
            <div className="mt-2 rounded-xl border border-border p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-36" />
            </div>
            <div className="mt-2 space-y-px">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader
              className="border-b px-6 pb-4 pt-6"
              style={statusHeaderStyle(invoice.status)}
            >
              <div className="flex items-center gap-2.5">
                <SheetTitle className="text-xl font-semibold tracking-tight">
                  {monthYear}
                </SheetTitle>
                <StatusBadge status={invoice.status} />
              </div>
              {bank && (
                <SheetDescription className="text-[12px] text-foreground/55">
                  Fecha {calcCloseDate(bank, invoice.month, invoice.year)} · Vence{' '}
                  {calcDueDate(bank, invoice.month, invoice.year)}
                </SheetDescription>
              )}
            </SheetHeader>

            {/* Total + action */}
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-xs text-muted-foreground">Total da fatura</p>
                <p className="mt-1 text-[28px] font-semibold tabular-nums leading-none tracking-[-0.02em]">
                  {formatCurrency(total)}
                </p>
              </div>
              {canMarkPaid && (
                <Button
                  size="sm"
                  onClick={() => markPaidMut.mutate()}
                  disabled={markPaidMut.isPending}
                >
                  {markPaidMut.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Marcar como paga
                </Button>
              )}
            </div>

            {/* Transaction list */}
            <div className="flex-1 overflow-y-auto border-t border-border">
              {txCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-sm font-medium">Nenhuma transação</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Esta fatura não tem transações registradas.
                  </p>
                </div>
              ) : (
                <>
                  <p className="px-4 py-3 text-[11px] text-muted-foreground">
                    {txCount} transaç{txCount === 1 ? 'ão' : 'ões'}
                  </p>
                  {invoice.transactions!.map((tx, i) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.2,
                        delay: Math.min(i, 12) * 0.03,
                        ease: EASE_OUT_EXPO,
                      }}
                      className="border-b border-border last:border-b-0"
                    >
                      <TxRow tx={tx} />
                    </motion.div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BankInvoicesPage() {
  const params = useParams()
  const bankId = params.id as string

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const { data: bank } = useQuery({
    queryKey: ['bank', bankId],
    queryFn: () => getBank(bankId),
  })

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['bank-invoices', bankId],
    queryFn: () => getBankInvoices(bankId),
  })

  const sorted = invoices
    ? [...invoices].sort((a, b) =>
        b.year !== a.year ? b.year - a.year : b.month - a.month,
      )
    : []

  function handleClick(id: string) {
    setSelectedInvoiceId(id)
    setDetailOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/banks"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          aria-label="Voltar para bancos"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {bank ? bank.name : <Skeleton className="inline-block h-7 w-32" />}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Faturas do cartão de crédito</p>
        </div>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(STATUS_CONFIG).map(([status, { label, className }]) => (
          <span
            key={status}
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
              className,
            )}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Invoice list */}
      <div>
        {isLoading ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-border px-2 py-4 last:border-b-0"
              >
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-52" />
                </div>
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted/40">
              <CreditCard className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-medium">Nenhuma fatura encontrada</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              As faturas são criadas automaticamente ao registrar transações de crédito neste banco.
            </p>
          </div>
        ) : (
          <div>
            {sorted.map((invoice, i) => (
              <MotionRow key={invoice.id} index={i}>
                <InvoiceRow
                  invoice={invoice}
                  bank={bank}
                  isSelected={selectedInvoiceId === invoice.id && detailOpen}
                  onClick={() => handleClick(invoice.id)}
                />
              </MotionRow>
            ))}
          </div>
        )}
      </div>

      {/* Detail sheet */}
      <InvoiceDetailSheet
        invoiceId={selectedInvoiceId}
        bankId={bankId}
        bank={bank}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

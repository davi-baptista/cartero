'use client'

import { useState, useMemo } from 'react'
import type React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
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
    className: 'bg-paid/15 text-paid',
  },
}

// Status color primitives used for row highlight and sheet header tint
const STATUS_COLOR: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'var(--primary)',
  [InvoiceStatus.CLOSED]: 'oklch(0.750 0.150 80)', // no token for amber
  [InvoiceStatus.OVERDUE]: 'var(--destructive)',
  [InvoiceStatus.PAID]: 'var(--color-income)',
}


function statusRowBg(status: InvoiceStatus): React.CSSProperties {
  const c = STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 7%, transparent)` }
}

function statusHeaderStyle(status: InvoiceStatus): React.CSSProperties {
  const c = STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 10%, transparent)` }
}


const INCOME_COLOR = 'var(--color-income)'
const EXPENSE_BG = 'var(--color-expense-bg)'
const INCOME_BG = 'var(--color-income-bg)'
const EXPENSE_ICON_CLR = 'var(--color-expense-icon)'
const INCOME_ICON_CLR = 'var(--color-income-icon)'

const TYPE_ICON: Record<TransactionType, LucideIcon> = {
  [TransactionType.INCOME]: TrendingUp,
  [TransactionType.CREDIT_CARD]: CreditCard,
  [TransactionType.DEBIT_CARD]: Wallet,
  [TransactionType.PIX]: Receipt,
  [TransactionType.BOLETO]: FileText,
}

const STATUS_SORT_ORDER: Record<InvoiceStatus, number> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
  [InvoiceStatus.PAID]: 3,
}

const ACTIVE_VISIBLE = 3
const PAID_VISIBLE = 1

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

function ExpandButton({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean
  hiddenCount: number
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex min-h-[44px] w-full items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronDown
        className={cn('size-3.5 shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
        aria-hidden="true"
      />
      {expanded ? 'Ver menos' : `Ver ${hiddenCount} ${hiddenCount === 1 ? 'fatura' : 'faturas'} a mais`}
    </button>
  )
}

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
  isAtual,
  onClick,
}: {
  invoice: Invoice
  bank: Bank | undefined
  isSelected: boolean
  isAtual?: boolean
  onClick: () => void
}) {
  const monthYear = capitalize(formatMonthYear(invoice.month, invoice.year))
  const total = Number(invoice.totalAmount)

  return (
    <button
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`${monthYear} — ${STATUS_CONFIG[invoice.status].label}${isAtual ? ' — Atual' : ''}`}
      className="group flex w-full items-center gap-4 px-2 py-4 text-left transition-colors hover:bg-muted/30"
      style={isSelected ? statusRowBg(invoice.status) : undefined}
    >
      {/* Month + status + dates */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-medium">{monthYear}</span>
          <StatusBadge status={invoice.status} />
          {isAtual && (
            <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
              Atual
            </span>
          )}
        </div>
        {bank && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="shrink-0">Fecha {calcCloseDate(bank, invoice.month, invoice.year)}</span>
            <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
            <span className="shrink-0">Vence {calcDueDate(bank, invoice.month, invoice.year)}</span>
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

      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/70"
      />
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
        <Icon aria-hidden="true" className="size-4" style={{ color: expense ? EXPENSE_ICON_CLR : INCOME_ICON_CLR }} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-tight">{tx.title}</span>
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          {tx.category && (() => {
            const { Icon: CatIcon } = resolveCategoryIcon(tx.category.icon)
            return (
              <span className="flex shrink-0 items-center gap-1">
                <CatIcon
                  aria-hidden="true"
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
            <span className="truncate italic pr-0.5">{tx.description}</span>
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
  const isInstallment = (tx: Transaction) => /\s\d+\/\d+$/.test(tx.title)
  const regularTxs = invoice?.transactions?.filter((tx) => !isInstallment(tx)) ?? []
  const installmentTxs = invoice?.transactions?.filter((tx) => isInstallment(tx)) ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg" showCloseButton>
        {isLoading || !invoice ? (
          <div className="flex flex-1 flex-col">
            <div className="border-b px-6 pb-4 pt-6">
              <Skeleton className="h-7 w-40" />
            </div>
            <div className="border-b px-6 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-36" />
            </div>
            <div className="space-y-px pt-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="border-b px-6 pb-4 pt-6" style={statusHeaderStyle(invoice.status)}>
              <SheetTitle className="text-lg font-semibold tracking-tight">
                {monthYear}
              </SheetTitle>
            </SheetHeader>

            {/* Total + action */}
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-xs text-muted-foreground">Total da fatura</p>
                <p className={cn(
                  'mt-1 text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
                  invoice.status === InvoiceStatus.OVERDUE && 'text-destructive',
                  invoice.status === InvoiceStatus.PAID && 'text-paid',
                )}>
                  {formatCurrency(total)}
                </p>
              </div>
              {canMarkPaid && (
                <Button
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
            <div className="flex-1 overflow-y-auto">
              {txCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted/40">
                    <Receipt className="size-5 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm font-medium">Nenhuma transação</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Esta fatura não tem transações registradas.
                  </p>
                </div>
              ) : (
                <>
                  {regularTxs.length > 0 && (
                    <div>
                      <p className="border-y border-border px-4 py-3 text-[11px] font-medium text-muted-foreground">
                        Transações · {regularTxs.length}
                      </p>
                      {regularTxs.map((tx, i) => (
                        <motion.div
                          key={tx.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.03, ease: EASE_OUT_EXPO }}
                          className="border-b border-border last:border-b-0"
                        >
                          <TxRow tx={tx} />
                        </motion.div>
                      ))}
                    </div>
                  )}
                  {installmentTxs.length > 0 && (
                    <div>
                      <p className="border-y border-border px-4 py-3 text-[11px] font-medium text-muted-foreground">
                        Parcelamentos · {installmentTxs.length}
                      </p>
                      {installmentTxs.map((tx, i) => (
                        <motion.div
                          key={tx.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.03, ease: EASE_OUT_EXPO }}
                          className="border-b border-border last:border-b-0"
                        >
                          <TxRow tx={tx} />
                        </motion.div>
                      ))}
                    </div>
                  )}
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
  const [activeExpanded, setActiveExpanded] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const { data: bank } = useQuery({
    queryKey: ['bank', bankId],
    queryFn: () => getBank(bankId),
  })

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['bank-invoices', bankId],
    queryFn: () => getBankInvoices(bankId),
  })

  const { overdueInvoices, activeInvoices, paidInvoices } = useMemo(() => {
    if (!invoices) return { overdueInvoices: [] as Invoice[], activeInvoices: [] as Invoice[], paidInvoices: [] as Invoice[] }

    const filtered = invoices.filter((i) => Number(i.totalAmount) > 0)

    const overdueInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.OVERDUE)
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))

    const activeInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.CLOSED || i.status === InvoiceStatus.OPEN)
      .sort((a, b) => {
        const sd = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]
        if (sd !== 0) return sd
        return a.year !== b.year ? a.year - b.year : a.month - b.month
      })

    const paidInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.PAID)
      .sort((a, b) => (b.year !== a.year ? b.year - a.year : b.month - a.month))

    return { overdueInvoices, activeInvoices, paidInvoices }
  }, [invoices])

  const isEmpty = overdueInvoices.length === 0 && activeInvoices.length === 0 && paidInvoices.length === 0

  const activeHidden = Math.max(0, activeInvoices.length - ACTIVE_VISIBLE)
  const paidHidden = Math.max(0, paidInvoices.length - PAID_VISIBLE)

  function isAtual(inv: Invoice): boolean {
    if (inv.status !== InvoiceStatus.OPEN || !bank) return false
    const now = new Date()
    const day = now.getDate()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    let targetMonth: number
    let targetYear: number
    if (day > bank.invoiceCloseDate) {
      targetMonth = month === 12 ? 1 : month + 1
      targetYear = month === 12 ? year + 1 : year
    } else {
      targetMonth = month
      targetYear = year
    }
    return inv.month === targetMonth && inv.year === targetYear
  }

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
          {bank ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Fecha dia {bank.invoiceCloseDate} · Vence dia {bank.invoiceDueDate}
            </p>
          ) : (
            <Skeleton className="mt-1.5 h-4 w-40" />
          )}
        </div>
      </div>

      {/* Invoice sections */}
      {isLoading ? (
        <div className="border-t border-border">
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
      ) : isEmpty ? (
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
        <div className="flex flex-col gap-6">
          {/* ── Vencidas ───────────────────────────────────────────────── */}
          {overdueInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-destructive/90">Vencidas</p>
              <div className="border-t border-border">
                {overdueInvoices.map((invoice, i) => (
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
            </div>
          )}

          {/* ── Ativas ─────────────────────────────────────────────────── */}
          {activeInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground/70">Ativas</p>
              <div className="border-t border-border">
                {activeInvoices.slice(0, ACTIVE_VISIBLE).map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={selectedInvoiceId === invoice.id && detailOpen}
                      isAtual={isAtual(invoice)}
                      onClick={() => handleClick(invoice.id)}
                    />
                  </MotionRow>
                ))}
                {activeExpanded &&
                  activeInvoices.slice(ACTIVE_VISIBLE).map((invoice, i) => (
                    <MotionRow key={invoice.id} index={i}>
                      <InvoiceRow
                        invoice={invoice}
                        bank={bank}
                        isSelected={selectedInvoiceId === invoice.id && detailOpen}
                        isAtual={isAtual(invoice)}
                        onClick={() => handleClick(invoice.id)}
                      />
                    </MotionRow>
                  ))}
                {activeHidden > 0 && (
                  <ExpandButton
                    expanded={activeExpanded}
                    hiddenCount={activeHidden}
                    onToggle={() => setActiveExpanded((e) => !e)}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Histórico ──────────────────────────────────────────────── */}
          {paidInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-paid/90">Histórico</p>
              <div className="border-t border-border">
                {paidInvoices.slice(0, PAID_VISIBLE).map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={selectedInvoiceId === invoice.id && detailOpen}
                      onClick={() => handleClick(invoice.id)}
                    />
                  </MotionRow>
                ))}
                {historyExpanded &&
                  paidInvoices.slice(PAID_VISIBLE).map((invoice, i) => (
                    <MotionRow key={invoice.id} index={i}>
                      <InvoiceRow
                        invoice={invoice}
                        bank={bank}
                        isSelected={selectedInvoiceId === invoice.id && detailOpen}
                        onClick={() => handleClick(invoice.id)}
                      />
                    </MotionRow>
                  ))}
                {paidHidden > 0 && (
                  <ExpandButton
                    expanded={historyExpanded}
                    hiddenCount={paidHidden}
                    onToggle={() => setHistoryExpanded((e) => !e)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

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

'use client'

import { useState, useMemo, memo, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  CreditCard,
  HandCoins,
  Wallet,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { getTransactions } from '@/services/transactions.service'
import { getInvoices } from '@/services/invoices.service'
import { getBanks } from '@/services/banks.service'
import { getDebts } from '@/services/debts.service'
import { getReceivables } from '@/services/receivables.service'
import { formatCurrency, formatMonthYear, isExpense } from '@/lib/formatters'
import { parseDateOnly } from '@/lib/date'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { cn } from '@/lib/utils'
import type { Invoice, Debt, Receivable, Bank } from '@/types'
import { InvoiceStatus } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
const ATTENTION_LIMIT = 3
const ATTENTION_DAYS_WINDOW = 7

const INVOICE_STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  [InvoiceStatus.OPEN]: { label: 'Aberta', className: 'bg-primary/15 text-primary' },
  [InvoiceStatus.CLOSED]: { label: 'Fechada', className: 'bg-amber-500/15 text-amber-400' },
  [InvoiceStatus.OVERDUE]: { label: 'Vencida', className: 'bg-destructive/15 text-destructive' },
  [InvoiceStatus.PAID]: { label: 'Paga', className: 'bg-green-500/15 text-green-500' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = new Date(year, month, 0).toISOString().slice(0, 10)
  return { startDate: start, endDate: end }
}

function diffDaysFromToday(dateString: string): number {
  const today = parseDateOnly(new Date().toISOString().slice(0, 10))
  const d = parseDateOnly(dateString)
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDueDate(dateString: string): string {
  const diff = diffDaysFromToday(dateString)
  if (diff < 0) return `Venceu há ${Math.abs(diff)}d`
  if (diff === 0) return 'Vence hoje'
  if (diff === 1) return 'Vence amanhã'
  return `Vence em ${diff} dias`
}

type DueUrgency = 'overdue' | 'urgent' | 'soon' | 'normal'

function getDueUrgency(dateString: string): DueUrgency {
  const diff = diffDaysFromToday(dateString)
  if (diff <= 0) return 'overdue'
  return 'urgent'
}

const DUE_URGENCY_CLASS: Record<DueUrgency, string> = {
  overdue: 'text-destructive',
  urgent: 'text-amber-400',
  soon: 'text-primary',
  normal: 'text-muted-foreground',
}

function computeInvoiceDue(
  invoice: Invoice,
  bank: Bank | undefined,
): { text: string; urgency: DueUrgency; diffDays: number } {
  if (!bank) return { text: '', urgency: 'normal', diffDays: 999 }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const isOpen = invoice.status === InvoiceStatus.OPEN

  if (isOpen) {
    const close = new Date(invoice.year, invoice.month - 1, bank.invoiceCloseDate)
    close.setHours(0, 0, 0, 0)
    const closeDiff = Math.round((close.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (closeDiff >= 0) {
      if (closeDiff === 0) return { text: 'Fecha hoje', urgency: 'overdue', diffDays: closeDiff }
      if (closeDiff === 1) return { text: 'Fecha amanhã', urgency: 'urgent', diffDays: closeDiff }
      return { text: `Fecha em ${closeDiff} dias`, urgency: closeDiff <= 2 ? 'urgent' : 'soon', diffDays: closeDiff }
    }
    // Close date already passed but status still OPEN (cron lag) — fall through to due date
  }

  const due = new Date(invoice.year, invoice.month - 1, bank.invoiceDueDate)
  due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { text: `Venceu há ${-diffDays}d`, urgency: 'overdue', diffDays }
  if (diffDays === 0) return { text: 'Vence hoje', urgency: 'overdue', diffDays }
  if (diffDays === 1) return { text: 'Vence amanhã', urgency: 'urgent', diffDays }
  return { text: `Vence em ${diffDays} dias`, urgency: 'urgent', diffDays }
}

// ─── Month navigator ──────────────────────────────────────────────────────────

function MonthNav({
  year,
  month,
  onPrev,
  onNext,
}: {
  year: number
  month: number
  onPrev: () => void
  onNext: () => void
}) {
  const label = capitalize(formatMonthYear(month, year))
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Mês anterior"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[9.5rem] select-none text-center text-sm font-medium">{label}</span>
      <button
        type="button"
        onClick={onNext}
        aria-label="Próximo mês"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}

// ─── Category breakdown ───────────────────────────────────────────────────────

interface CategoryRowData {
  categoryId: string
  name: string
  color?: string
  icon?: string
  amount: number
  pct: number
}

const CategoryBar = memo(function CategoryBar({
  name,
  color,
  icon,
  amount,
  pct,
  index,
}: CategoryRowData & { index: number }) {
  const { Icon } = resolveCategoryIcon(icon)
  const barColor = color ?? 'oklch(0.640 0.210 272)'

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in oklch, ${barColor} 15%, transparent)` }}
      >
        <Icon
          aria-hidden="true"
          className="size-3.5"
          style={{ color: barColor }}
        />
      </div>

      <span className="w-28 shrink-0 truncate text-sm font-medium">{name}</span>

      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ backgroundColor: barColor }}
          initial={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{
            duration: 0.55,
            ease: EASE_OUT_EXPO,
            delay: index * 0.04,
          }}
        />
      </div>

      <span className="w-[6.5rem] shrink-0 text-right text-sm tabular-nums tracking-[-0.01em]">
        {formatCurrency(amount)}
      </span>

      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {pct.toFixed(0)}%
      </span>
    </div>
  )
})

function CategoryBreakdown({
  rows,
  isLoading,
}: {
  rows: CategoryRowData[]
  isLoading: boolean
}) {
  return (
    <section aria-label="Gastos por categoria">
      <h2 className="mb-4 text-[15px] font-semibold tracking-tight">Gastos por categoria</h2>

      {isLoading ? (
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-1.5 flex-1 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/40">
            <ShoppingBag className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium">Sem gastos no período</p>
          <p className="mt-1 max-w-[24ch] text-xs text-muted-foreground">
            Nenhuma despesa registrada neste mês.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <CategoryBar key={row.categoryId} {...row} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Attention panel ──────────────────────────────────────────────────────────

function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const { label, className } = INVOICE_STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}


function InvoiceAttentionRow({ invoice, banks }: { invoice: Invoice; banks: Bank[] }) {
  const bank = banks.find((b) => b.id === invoice.bankId)
  const monthYear = capitalize(formatMonthYear(invoice.month, invoice.year))
  const total = Number(invoice.totalAmount)
  const { text: dueText, urgency } = computeInvoiceDue(invoice, bank)
  const isOverdue = urgency === 'overdue'

  return (
    <Link
      href={`/banks/${invoice.bankId}/invoices`}
      className="group flex items-center gap-3 py-3"
    >
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg',
          isOverdue ? 'bg-destructive/10' : 'bg-muted/40',
        )}
      >
        <CreditCard
          className={cn('size-3.5', isOverdue ? 'text-destructive' : 'text-muted-foreground')}
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
            {bank?.name ?? 'Banco'}
          </span>
          <InvoiceBadge status={invoice.status} />
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Fatura de {monthYear}</span>
          {dueText && (
            <>
              <span className="text-muted-foreground/40" aria-hidden="true">·</span>
              <span className={DUE_URGENCY_CLASS[urgency]}>{dueText}</span>
            </>
          )}
        </div>
      </div>
      <span
        className={cn(
          'shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]',
          isOverdue ? 'text-destructive' : '',
        )}
      >
        {formatCurrency(total)}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary/60" />
    </Link>
  )
}

function DebtAttentionRow({ debt }: { debt: Debt }) {
  const urgency = getDueUrgency(debt.dueDate)
  const dueText = formatDueDate(debt.dueDate)
  const counterpart = debt.person?.name ?? debt.creditorName

  return (
    <Link href={`/debts?highlight=${debt.id}`} className="group flex items-center gap-3 py-3">
      <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', urgency === 'overdue' ? 'bg-destructive/10' : 'bg-muted/40')}>
        <HandCoins className={cn('size-3.5', urgency === 'overdue' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
          {debt.title}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {counterpart ? `${counterpart} · ` : ''}
          <span className={DUE_URGENCY_CLASS[urgency]}>{dueText}</span>
        </p>
      </div>
      <span className={cn('shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]', urgency === 'overdue' ? 'text-destructive' : '')}>
        {formatCurrency(Number(debt.amount))}
      </span>
    </Link>
  )
}

function ReceivableAttentionRow({ receivable }: { receivable: Receivable }) {
  const urgency = getDueUrgency(receivable.dueDate)
  const dueText = formatDueDate(receivable.dueDate)
  const counterpart = receivable.person?.name ?? receivable.debtorName

  return (
    <Link href={`/receivables?highlight=${receivable.id}`} className="group flex items-center gap-3 py-3">
      <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', urgency === 'overdue' ? 'bg-destructive/10' : 'bg-muted/40')}>
        <Wallet className={cn('size-3.5', urgency === 'overdue' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
          {receivable.title}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {counterpart ? `${counterpart} · ` : ''}
          <span className={DUE_URGENCY_CLASS[urgency]}>{dueText}</span>
        </p>
      </div>
      <span className={cn('shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]', urgency === 'overdue' ? 'text-destructive' : '')}>
        {formatCurrency(Number(receivable.amount))}
      </span>
    </Link>
  )
}

function AttentionSection({
  title,
  icon: Icon,
  href,
  remaining,
  children,
}: {
  title: string
  icon: LucideIcon
  href: string
  remaining: number
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="divide-y divide-border/50">{children}</div>
      {remaining > 0 && (
        <Link
          href={href}
          className="mt-1 flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
          Ver {remaining} {remaining === 1 ? 'item' : 'itens'} a mais
        </Link>
      )}
    </div>
  )
}

function AttentionPanel({
  invoices,
  banks,
  debts,
  debtsTotal,
  receivables,
  receivablesTotal,
  isLoading,
  windowStr,
}: {
  invoices: Invoice[]
  banks: Bank[]
  debts: Debt[]
  debtsTotal: number
  receivables: Receivable[]
  receivablesTotal: number
  isLoading: boolean
  windowStr: string
}) {
  const allEmpty = invoices.length === 0 && debts.length === 0 && receivables.length === 0

  return (
    <section aria-label="Itens que requerem atenção" className="lg:border-l lg:border-border/60 lg:pl-8">
      <h2 className="mb-4 text-[15px] font-semibold tracking-tight">Atenção agora</h2>

      {isLoading ? (
        <div className="space-y-5">
          {[3, 2].map((count, s) => (
            <div key={s} className="space-y-0">
              <Skeleton className="mb-2 h-3 w-16" />
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="size-7 shrink-0 rounded-lg" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : allEmpty ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-receivable/10">
            <CheckCircle2 className="size-5 text-receivable" />
          </div>
          <p className="text-sm font-medium">Tudo em dia</p>
          <p className="mt-1 max-w-[22ch] text-xs text-muted-foreground">
            Nenhum item vence nos próximos {ATTENTION_DAYS_WINDOW} dias.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {invoices.length > 0 && (
            <AttentionSection title="Faturas" icon={CreditCard} href="/banks" remaining={0}>
              {invoices.map((inv) => (
                <InvoiceAttentionRow key={inv.id} invoice={inv} banks={banks} />
              ))}
            </AttentionSection>
          )}

          {debts.length > 0 && (
            <AttentionSection
              title="Dívidas"
              icon={HandCoins}
              href={`/debts?endDate=${windowStr}`}
              remaining={debtsTotal - debts.length}
            >
              {debts.map((d) => (
                <DebtAttentionRow key={d.id} debt={d} />
              ))}
            </AttentionSection>
          )}

          {receivables.length > 0 && (
            <AttentionSection
              title="A receber"
              icon={Wallet}
              href={`/receivables?endDate=${windowStr}`}
              remaining={receivablesTotal - receivables.length}
            >
              {receivables.map((r) => (
                <ReceivableAttentionRow key={r.id} receivable={r} />
              ))}
            </AttentionSection>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  const { startDate, endDate } = useMemo(() => monthRange(year, month), [year, month])

  // ── Queries ──
  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', { startDate, endDate }],
    queryFn: () => getTransactions({ startDate, endDate }),
  })

  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => getInvoices(),
  })

  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: getBanks,
  })

  const { data: debts = [], isLoading: debtLoading } = useQuery({
    queryKey: ['debts'],
    queryFn: () => getDebts(),
  })

  const { data: receivables = [], isLoading: recLoading } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => getReceivables(),
  })

  const attentionLoading = invLoading || debtLoading || recLoading

  // ── Derived data ──
  const categoryRows = useMemo((): CategoryRowData[] => {
    if (!transactions) return []
    const expenseTxs = transactions.filter((t) => isExpense(t.type))
    const grouped = new Map<string, { amount: number; name: string; color?: string; icon?: string }>()

    for (const tx of expenseTxs) {
      const existing = grouped.get(tx.categoryId)
      if (existing) {
        existing.amount += tx.amount
      } else {
        grouped.set(tx.categoryId, {
          amount: tx.amount,
          name: tx.category?.name ?? 'Sem categoria',
          color: tx.category?.color,
          icon: tx.category?.icon,
        })
      }
    }

    const total = Array.from(grouped.values()).reduce((s, v) => s + v.amount, 0)

    return Array.from(grouped.entries())
      .map(([categoryId, { amount, name, color, icon }]) => ({
        categoryId,
        name,
        color,
        icon,
        amount,
        pct: total > 0 ? (amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [transactions])

  // Invoices: OVERDUE always; OPEN if close date ≤7 days; CLOSED if due date ≤7 days
  const attentionInvoices = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    return invoices
      .filter((inv) => {
        if (Number(inv.totalAmount) === 0) return false
        if (inv.status === InvoiceStatus.OVERDUE) return true
        if (inv.status !== InvoiceStatus.OPEN && inv.status !== InvoiceStatus.CLOSED) return false
        const bank = banks.find((b) => b.id === inv.bankId)
        if (!bank) return false
        if (inv.status === InvoiceStatus.OPEN) {
          const close = new Date(inv.year, inv.month - 1, bank.invoiceCloseDate)
          close.setHours(0, 0, 0, 0)
          const closeDiff = Math.round((close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          if (closeDiff >= 0) return closeDiff <= ATTENTION_DAYS_WINDOW
          // Close date passed but still OPEN (cron lag) — check due date
        }
        const due = new Date(inv.year, inv.month - 1, bank.invoiceDueDate)
        due.setHours(0, 0, 0, 0)
        const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return diffDays <= ATTENTION_DAYS_WINDOW
      })
      .sort((a, b) => {
        if (a.status === InvoiceStatus.OVERDUE && b.status !== InvoiceStatus.OVERDUE) return -1
        if (b.status === InvoiceStatus.OVERDUE && a.status !== InvoiceStatus.OVERDUE) return 1
        return b.year !== a.year ? b.year - a.year : b.month - a.month
      })
  }, [invoices, banks])

  // Debts/Receivables: unpaid, due within 7 days (includes overdue), top 3
  const windowStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + ATTENTION_DAYS_WINDOW)
    return d.toISOString().slice(0, 10)
  }, [])

  const pendingDebtsAll = useMemo(
    () =>
      debts
        .filter((d) => !d.isPaid && d.dueDate <= windowStr)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [debts, windowStr],
  )
  const pendingDebts = pendingDebtsAll.slice(0, ATTENTION_LIMIT)

  const pendingReceivablesAll = useMemo(
    () =>
      receivables
        .filter((r) => !r.isPaid && r.dueDate <= windowStr)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [receivables, windowStr],
  )
  const pendingReceivables = pendingReceivablesAll.slice(0, ATTENTION_LIMIT)

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Resumo do seu mês financeiro</p>
        </div>
        <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[3fr_2fr]">
        <CategoryBreakdown rows={categoryRows} isLoading={txLoading} />

        {/* Mobile separator */}
        <div className="border-t border-border lg:hidden" aria-hidden />

        <AttentionPanel
          invoices={attentionInvoices}
          banks={banks}
          debts={pendingDebts}
          debtsTotal={pendingDebtsAll.length}
          receivables={pendingReceivables}
          receivablesTotal={pendingReceivablesAll.length}
          isLoading={attentionLoading}
          windowStr={windowStr}
        />
      </div>
    </div>
  )
}

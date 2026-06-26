'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  PiggyBank,
  ArrowRight,
  AlertCircle,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { getInvoices } from '@/services/invoices.service'
import { useAuth } from '@/providers/auth-provider'
import { formatCurrency, formatMonthYear } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { InvoiceStatus } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  [InvoiceStatus.OPEN]: { label: 'Aberta', className: 'bg-primary/15 text-primary' },
  [InvoiceStatus.CLOSED]: { label: 'Fechada', className: 'bg-amber-500/15 text-amber-400' },
  [InvoiceStatus.OVERDUE]: { label: 'Vencida', className: 'bg-destructive/15 text-destructive' },
  [InvoiceStatus.PAID]: { label: 'Paga', className: 'bg-paid/15 text-paid' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Month nav ────────────────────────────────────────────────────────────────

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
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Mês anterior"
        className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <span className="min-w-[9.5rem] select-none text-center text-sm font-medium">
        {capitalize(formatMonthYear(month, year))}
      </span>
      <button
        type="button"
        onClick={onNext}
        aria-label="Próximo mês"
        className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const { user } = useAuth()
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

  const { data: allInvoices = [], isLoading } = useQuery({
    queryKey: ['invoices', { month, year }],
    queryFn: () => getInvoices({ month, year }),
  })

  const invoices = useMemo(
    () => allInvoices.filter((inv) => Number(inv.totalAmount) > 0),
    [allInvoices],
  )

  const salary = user?.salary != null ? Number(user.salary) : null

  const summary = useMemo(() => {
    const totalAll = invoices.reduce((s, inv) => s + Number(inv.totalAmount), 0)
    const totalPaid = invoices
      .filter((inv) => inv.status === InvoiceStatus.PAID)
      .reduce((s, inv) => s + Number(inv.totalAmount), 0)
    const totalPending = totalAll - totalPaid
    return { totalAll, totalPaid, totalPending }
  }, [invoices])

  const balance = salary != null ? salary - summary.totalAll : null
  const hasMix = summary.totalPaid > 0 && summary.totalPending > 0
  const pct = salary != null && salary > 0 ? (summary.totalAll / salary) * 100 : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orçamento</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Projeção mensal do seu fluxo financeiro
          </p>
        </div>
        <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />
      </div>

      {/* No salary warning */}
      {!salary && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <AlertCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Configure seu salário em{' '}
            <Link
              href="/profile"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Perfil
            </Link>{' '}
            para ver projeções de saldo.
          </p>
        </div>
      )}

      {/* Summary — single block with hierarchy, no identical card grid */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-10 w-52" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="mt-1 h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        ) : salary != null ? (
          <>
            {/* Hero: saldo projetado */}
            <div>
              <p
                className={cn(
                  'text-[38px] font-semibold tabular-nums tracking-[-0.025em] leading-none',
                  balance! < 0 ? 'text-destructive' : 'text-receivable',
                )}
              >
                {formatCurrency(balance!)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {summary.totalAll > 0
                  ? `Saldo de ${formatCurrency(salary)} após ${formatCurrency(summary.totalAll)} em faturas`
                  : `${formatCurrency(salary)} disponível — sem faturas neste mês`}
              </p>
            </div>

            {/* Progress bar */}
            {pct != null && summary.totalAll > 0 && (
              <div>
                <div
                  role="progressbar"
                  aria-valuenow={Math.min(Math.round(pct), 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Percentual do salário comprometido"
                  className="relative h-1.5 overflow-hidden rounded-full bg-muted/50"
                >
                  <div
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out',
                      pct > 100
                        ? 'bg-destructive'
                        : pct > 70
                          ? 'bg-amber-400'
                          : 'bg-receivable',
                    )}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p
                  className={cn(
                    'mt-1.5 text-[11px] tabular-nums',
                    pct > 100
                      ? 'text-destructive'
                      : pct > 70
                        ? 'text-amber-400'
                        : 'text-muted-foreground',
                  )}
                >
                  {pct.toFixed(0)}% do salário comprometido
                  {pct > 100 && ` — ${(pct - 100).toFixed(0)}% acima do limite`}
                </p>
              </div>
            )}

            {/* Paid / pending — inline, without a separate card */}
            {hasMix && (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-medium text-paid">{formatCurrency(summary.totalPaid)} pago</span>
                <span className="mx-1.5 text-muted-foreground/40" aria-hidden>·</span>
                <span className="font-medium">{formatCurrency(summary.totalPending)} a pagar</span>
              </p>
            )}
          </>
        ) : (
          /* No salary — show invoice total only */
          summary.totalAll > 0 && (
            <div>
              <p className="text-[38px] font-semibold tabular-nums tracking-[-0.025em] leading-none text-destructive">
                {formatCurrency(summary.totalAll)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">em faturas neste mês</p>
            </div>
          )
        )}
      </div>

      {/* Invoice list */}
      <div>
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Faturas</h2>

        {isLoading ? (
          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border py-14 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/40">
              <PiggyBank className="size-5 text-muted-foreground/60" aria-hidden />
            </div>
            <p className="text-sm font-medium">Nenhuma fatura neste mês</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sem transações de cartão de crédito no período.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {invoices.map((inv) => {
              const { label, className } = STATUS_CONFIG[inv.status]
              const isPaid = inv.status === InvoiceStatus.PAID
              const isOverdue = inv.status === InvoiceStatus.OVERDUE
              return (
                <Link
                  key={inv.id}
                  href={`/banks/${inv.bankId}/invoices?invoiceId=${inv.id}`}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30"
                >
                  <div
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg',
                      isPaid ? 'bg-paid/10' : isOverdue ? 'bg-destructive/10' : 'bg-muted/40',
                    )}
                  >
                    <CreditCard
                      className={cn(
                        'size-4',
                        isPaid ? 'text-paid' : isOverdue ? 'text-destructive' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
                        {inv.bank?.name ?? 'Banco'}
                      </span>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                          className,
                        )}
                      >
                        {label}
                      </span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]',
                      isPaid ? 'text-paid' : isOverdue ? 'text-destructive' : '',
                    )}
                  >
                    {formatCurrency(Number(inv.totalAmount))}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary/60" aria-hidden />
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  PiggyBank,
  ArrowRight,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { getBudget } from '@/services/budget.service'
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
  const [initialPeriod] = useState(() => {
    const today = new Date()
    return { year: today.getFullYear(), month: today.getMonth() + 1 }
  })
  const [year, setYear] = useState(initialPeriod.year)
  const [month, setMonth] = useState(initialPeriod.month)
  const autoAdvanced = useRef(false)

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  const { data: budget, isLoading } = useQuery({
    queryKey: ['budget', { month, year }],
    queryFn: () => getBudget({ month, year }),
  })

  useEffect(() => {
    if (
      isLoading ||
      !budget ||
      autoAdvanced.current ||
      year !== initialPeriod.year ||
      month !== initialPeriod.month
    ) {
      return
    }

    // Só adianta o mês quando não sobrou nada a pagar — faturas, pagamentos
    // diretos e dívidas incluídos.
    if (budget.totalToPay > 0 && budget.totalPending === 0) {
      autoAdvanced.current = true
      window.setTimeout(() => {
        if (month === 12) {
          setMonth(1)
          setYear((currentYear) => currentYear + 1)
        } else {
          setMonth((currentMonth) => currentMonth + 1)
        }
      }, 0)
    }
  }, [budget, initialPeriod.month, initialPeriod.year, isLoading, month, year])

  const allInvoices = budget?.invoices ?? []

  const invoices = useMemo(
    () => allInvoices.filter((inv) => Number(inv.totalAmount) > 0),
    [allInvoices],
  )

  const salary = budget?.salary ?? null

  const summary = useMemo(
    () => ({
      totalAll: budget?.totalInvoices ?? 0,
      totalReimbursable: budget?.totalReimbursable ?? 0,
      netAmount: budget?.netAmount ?? 0,
      totalDirectPayments: budget?.totalDirectPayments ?? 0,
      totalDebts: budget?.totalDebts ?? 0,
      totalToPay: budget?.totalToPay ?? 0,
      totalPaid: budget?.totalPaid ?? 0,
      totalPending: budget?.totalPending ?? 0,
    }),
    [budget],
  )

  const balance = salary != null ? salary - summary.totalToPay : null
  const hasMix = summary.totalPaid > 0 && summary.totalPending > 0
  const pct =
    salary != null && salary > 0 ? (summary.totalToPay / salary) * 100 : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orçamento</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Quanto sai do seu bolso neste mês
          </p>
        </div>
        <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />
      </div>

      {/* Summary — single block with hierarchy, no identical card grid */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-10 w-52" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="mt-1 h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        ) : (
          <>
            {/* Hero: total a pagar no mês */}
            <div>
              <p className="text-[38px] font-semibold tabular-nums tracking-[-0.025em] leading-none">
                {formatCurrency(summary.totalToPay)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {summary.totalToPay > 0
                  ? 'a pagar neste mês'
                  : 'nada a pagar neste mês'}
              </p>
            </div>

            {/* Paid / pending — inline, without a separate card */}
            {hasMix && (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-medium text-paid">{formatCurrency(summary.totalPaid)} pago</span>
                <span className="mx-1.5 text-muted-foreground/40" aria-hidden>·</span>
                <span className="font-medium">{formatCurrency(summary.totalPending)} a pagar</span>
              </p>
            )}

            {/* Composição do total — mini stat row, no card chrome */}
            {summary.totalToPay > 0 && (
              <div className="flex flex-wrap items-stretch gap-x-5 gap-y-3">
                {summary.netAmount > 0 && (
                  <div>
                    <p className="text-[11px] text-muted-foreground">Faturas</p>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
                      {formatCurrency(summary.netAmount)}
                    </p>
                  </div>
                )}
                {summary.totalDirectPayments > 0 && (
                  <>
                    <div className="w-px shrink-0 bg-border/60" aria-hidden />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Débito, PIX e boleto</p>
                      <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
                        {formatCurrency(summary.totalDirectPayments)}
                      </p>
                    </div>
                  </>
                )}
                {summary.totalDebts > 0 && (
                  <>
                    <div className="w-px shrink-0 bg-border/60" aria-hidden />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Dívidas</p>
                      <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
                        {formatCurrency(summary.totalDebts)}
                      </p>
                    </div>
                  </>
                )}
                {summary.totalReimbursable > 0 && (
                  <>
                    <div className="w-px shrink-0 bg-border/60" aria-hidden />
                    <div>
                      <p className="text-[11px] text-muted-foreground">A receber de terceiros</p>
                      <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-[-0.01em] text-receivable">
                        −{formatCurrency(summary.totalReimbursable)}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Salário — complemento opcional */}
            {salary != null && salary > 0 && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-sm text-muted-foreground">
                  Sobra estimada de{' '}
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      balance! < 0 ? 'text-destructive' : 'text-receivable',
                    )}
                  >
                    {formatCurrency(balance!)}
                  </span>{' '}
                  sobre {formatCurrency(salary)}
                </p>

                {pct != null && summary.totalToPay > 0 && (
                  <div className="mt-2">
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
              </div>
            )}
          </>
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

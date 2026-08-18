'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  CreditCard,
  PiggyBank,
  ArrowRight,
  Wallet,
  HandCoins,
  User,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusListRow, type StatusRowTone } from '@/components/ui/status-list-row'
import { currentPeriod, useMonthPeriod } from '@/components/month-nav'
import { getBudget, getBudgetFocus } from '@/services/budget.service'
import { formatCurrency } from '@/lib/formatters'
import { formatDateValue } from '@/lib/date'
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

type DebtStatus = 'PAID' | 'OVERDUE' | 'PENDING'

/**
 * Mesmo vocabulário visual do card de fatura, aplicado a dívidas: o badge e
 * o ícone compartilham a cor, e `order` define a prioridade de leitura —
 * o que exige ação aparece antes do que já está resolvido.
 */
/**
 * Só o que é específico de dívida (rótulo, badge, ordem). A cor do ícone e do
 * valor vem do `tone`, resolvido pelo mesmo `StatusListRow` que a fatura usa
 * — assim os dois nunca voltam a divergir na paleta.
 */
const DEBT_STATUS_CONFIG: Record<
  DebtStatus,
  { label: string; className: string; tone: StatusRowTone; order: number }
> = {
  OVERDUE: {
    label: 'Vencida',
    className: 'bg-destructive/15 text-destructive',
    tone: 'negative',
    order: 0,
  },
  // Neutro como a fatura "Aberta": o âmbar é reservado para o que já fechou e
  // está esperando pagamento, não para o que ainda nem venceu.
  PENDING: {
    label: 'A pagar',
    className: 'bg-primary/15 text-primary',
    tone: 'neutral',
    order: 1,
  },
  PAID: {
    label: 'Paga',
    className: 'bg-paid/15 text-paid',
    tone: 'positive',
    order: 2,
  },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const [initialPeriod] = useState(currentPeriod)
  // O mês é contexto do app, controlado pela barra superior.
  const { period, setPeriod } = useMonthPeriod()
  const { month, year } = period
  const focusApplied = useRef(false)

  const { data: budget, isLoading } = useQuery({
    queryKey: ['budget', { month, year }],
    queryFn: () => getBudget({ month, year }),
  })

  // O backend resolve em uma consulta qual mês exige atenção — olhando para
  // trás (atrasos) e para frente (próxima pendência).
  // Sob o prefixo `budget` de propósito: pagar uma fatura muda qual mês
  // exige atenção, e as invalidações existentes já usam essa chave.
  const { data: focus } = useQuery({
    queryKey: ['budget', 'focus'],
    queryFn: getBudgetFocus,
  })

  useEffect(() => {
    if (!focus || focusApplied.current) return
    // Só reposiciona na chegada: depois disso o mês é do usuário, e trocá-lo
    // enquanto ele navega seria tirar o controle da mão dele.
    if (year !== initialPeriod.year || month !== initialPeriod.month) {
      focusApplied.current = true
      return
    }
    focusApplied.current = true
    if (focus.month !== month || focus.year !== year) {
      window.setTimeout(() => setPeriod(focus), 0)
    }
  }, [focus, initialPeriod.month, initialPeriod.year, month, year, setPeriod])

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
      debtsCount: budget?.debtsCount ?? 0,
      paidDebtsCount: budget?.paidDebtsCount ?? 0,
      totalToPay: budget?.totalToPay ?? 0,
      totalPaid: budget?.totalPaid ?? 0,
      totalPending: budget?.totalPending ?? 0,
    }),
    [budget],
  )

  const debtBreakdown = budget?.debtBreakdown ?? []

  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const monthStart = `${monthKey}-01`
  const monthEnd = formatDateValue(new Date(year, month, 0))

  const balance = salary != null ? salary - summary.totalToPay : null
  const hasMix = summary.totalPaid > 0 && summary.totalPending > 0
  const pct =
    salary != null && salary > 0 ? (summary.totalToPay / salary) * 100 : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orçamento</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quanto sai do seu bolso neste mês
        </p>
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
              {summary.totalToPay === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">nada a pagar neste mês</p>
              )}
            </div>

            {/* Paid / pending — inline, without a separate card */}
            {hasMix && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-paid">{formatCurrency(summary.totalPaid)} pago</span>
                <span className="mx-1.5 text-muted-foreground/40" aria-hidden>·</span>
                <span className="font-medium">{formatCurrency(summary.totalPending)} a pagar</span>
              </p>
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
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Faturas
            {!isLoading && summary.netAmount > 0 && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                · {formatCurrency(summary.netAmount)}
              </span>
            )}
          </h2>
          {!isLoading && summary.totalReimbursable > 0 && (
            <p className="text-[11px] text-muted-foreground">
              já descontado{' '}
              <span className="font-medium text-receivable">
                {formatCurrency(summary.totalReimbursable)}
              </span>{' '}
              gasto por outra pessoa
            </p>
          )}
        </div>

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
              const tone: StatusRowTone =
                inv.status === InvoiceStatus.PAID
                  ? 'positive'
                  : inv.status === InvoiceStatus.OVERDUE
                    ? 'negative'
                    : 'neutral'
              return (
                <StatusListRow
                  key={inv.id}
                  href={`/banks/${inv.bankId}/invoices?invoiceId=${inv.id}`}
                  icon={CreditCard}
                  tone={tone}
                  title={inv.bank?.name ?? 'Banco'}
                  badge={{ label, className }}
                  amount={Number(inv.totalAmount)}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Dívidas — seção própria, com uma linha por pessoa e por dívida
          avulsa. O que a pessoa te deve já está abatido do valor dela. */}
      {!isLoading && debtBreakdown.length > 0 && (
        <div>
          {/* Mesmo padrão do cabeçalho de Faturas: o valor entra no título,
              em cinza. Sem badge agregado — cada linha já tem o seu. */}
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
            Dívidas
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {formatCurrency(summary.totalDebts)}
            </span>
          </h2>

          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {debtBreakdown.map((item) => {
              const { label, className, tone } = DEBT_STATUS_CONFIG[item.status]
              return (
                <StatusListRow
                  key={`${item.kind}-${item.id ?? item.name}`}
                  // Pessoa abre o extrato dela já no mês visto aqui — é lá que
                  // dívida e recebível aparecem lado a lado, explicando o
                  // valor compensado desta linha.
                  href={
                    item.kind === 'person' && item.id
                      ? `/persons?personId=${item.id}&period=${monthKey}`
                      : `/debts?endDate=${monthEnd}`
                  }
                  icon={item.kind === 'person' ? User : HandCoins}
                  tone={tone}
                  title={item.name}
                  badge={{ label, className }}
                  subtitle={
                    item.offset > 0 && (
                      <>
                        já descontado{' '}
                        <span className="text-receivable">{formatCurrency(item.offset)}</span>{' '}
                        que {item.name} te deve
                      </>
                    )
                  }
                  amount={item.amount}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Outros gastos do mês */}
      {!isLoading && summary.totalDirectPayments > 0 && (
        <div>
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Outros gastos do mês</h2>
          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {summary.totalDirectPayments > 0 && (
              <Link
                href={`/transactions?startDate=${monthStart}&endDate=${monthEnd}&group=direct`}
                className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                  <Wallet className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
                    Débito, PIX e boleto
                  </span>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    Ver no extrato
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]">
                  {formatCurrency(summary.totalDirectPayments)}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary/60" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Layers, Repeat, ArrowRight, CalendarClock } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { getCommitments } from '@/services/commitments.service'
import { formatCurrency, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'

/** "set/26" — compacto o bastante para uma coluna estreita. */
function monthLabel({ month, year }: { month: number; year: number }) {
  const nome = new Date(year, month - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')
  return `${nome}/${String(year).slice(2)}`
}

export default function CommitmentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['commitments'],
    queryFn: getCommitments,
  })

  const installments = data?.installments ?? []
  const subscriptions = data?.subscriptions ?? []
  const forecast = data?.forecast ?? []
  const totals = data?.totals ?? { installmentsRemaining: 0, monthlySubscriptions: 0 }

  const maxForecast = Math.max(1, ...forecast.map((f) => f.total))
  const isEmpty = !isLoading && installments.length === 0 && subscriptions.length === 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compromissos</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          O que já está contratado para os próximos meses
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted/40">
            <CalendarClock className="size-7 text-muted-foreground" />
          </div>
          <p className="text-base font-semibold">Nenhum compromisso fixo</p>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            Compras parceladas em aberto e assinaturas ativas aparecem aqui, com
            o quanto ainda falta de cada uma.
          </p>
        </div>
      ) : (
        <>
          {/* Projeção — o custo fixo mês a mês */}
          {forecast.length > 0 && (
            <div>
              <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
                Custo fixo por mês
              </h2>
              <div className="overflow-hidden rounded-xl border border-border px-4 py-4">
                <div className="flex flex-col gap-2.5">
                  {forecast.map((f) => (
                    <div key={`${f.year}-${f.month}`} className="flex items-center gap-3">
                      <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
                        {monthLabel(f)}
                      </span>
                      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
                        {f.installments > 0 && (
                          <div
                            aria-hidden
                            className="h-full bg-primary/50"
                            style={{ width: `${(f.installments / maxForecast) * 100}%` }}
                          />
                        )}
                        {f.subscriptions > 0 && (
                          <div
                            aria-hidden
                            className="h-full bg-primary/25"
                            style={{ width: `${(f.subscriptions / maxForecast) * 100}%` }}
                          />
                        )}
                      </div>
                      <span className="w-24 shrink-0 text-right text-[13px] font-medium tabular-nums tracking-[-0.01em]">
                        {formatCurrency(f.total)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Legenda — explica as duas faixas da barra */}
                <div className="mt-4 flex items-center gap-4 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary/50" aria-hidden />
                    Parcelas
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary/25" aria-hidden />
                    Assinaturas
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Parcelamentos em aberto */}
          {installments.length > 0 && (
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Parcelamentos em aberto
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  faltam{' '}
                  <span className="font-medium text-foreground">
                    {formatCurrency(totals.installmentsRemaining)}
                  </span>
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
                {installments.map((item) => {
                  const progress = (item.paidCount / item.totalCount) * 100
                  return (
                    <div key={item.id} className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                          <Layers className="size-4 text-muted-foreground" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-[13px] font-medium">
                            {item.title}
                          </span>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {formatCurrency(item.installmentAmount)} ×{' '}
                            {item.totalCount}
                            {item.bankName && ` · ${item.bankName}`}
                            {item.endsAt && ` · até ${monthLabel(item.endsAt)}`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-[13px] font-semibold tabular-nums tracking-[-0.01em]">
                            {formatCurrency(item.remaining)}
                          </span>
                          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                            {item.paidCount}/{item.totalCount} pagas
                          </p>
                        </div>
                      </div>

                      <div
                        role="progressbar"
                        aria-valuenow={Math.round(progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Progresso de ${item.title}`}
                        className="mt-2.5 ml-11 h-1 overflow-hidden rounded-full bg-muted/50"
                      >
                        <div
                          aria-hidden
                          className="h-full rounded-full bg-primary/40"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Assinaturas ativas */}
          {subscriptions.length > 0 && (
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Assinaturas ativas
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {formatCurrency(totals.monthlySubscriptions)}
                  </span>{' '}
                  por mês
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
                {subscriptions.map((s) => (
                  <Link
                    key={s.id}
                    href="/subscriptions"
                    className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                      <Repeat className="size-4 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
                        {s.title}
                      </span>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Todo dia {s.dayOfMonth} · {TRANSACTION_TYPE_LABELS[s.type]}
                        {s.bank && ` · ${s.bank.name}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]">
                      {formatCurrency(Number(s.amount))}
                    </span>
                    <ArrowRight
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary/60',
                      )}
                      aria-hidden
                    />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

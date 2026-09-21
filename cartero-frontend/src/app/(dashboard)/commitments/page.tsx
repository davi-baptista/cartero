'use client'

import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { getCommitments, type ActiveInstallment, type ForecastMonth } from '@/services/commitments.service'
import { formatCurrency } from '@/lib/formatters'
import { cn } from '@/lib/utils'

function monthLabel({ month, year }: { month: number; year: number }) {
  const name = new Date(year, month - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')
  return `${name}/${String(year).slice(2)}`
}

function futureLabel(count: number) {
  return `${count} parcela${count === 1 ? '' : 's'} futura${count === 1 ? '' : 's'}`
}

function outstandingLabel(count: number) {
  return `${count} parcela${count === 1 ? '' : 's'} a pagar`
}

function InstallmentSection({
  title,
  description,
  items,
  total,
  showPerson = false,
  own = false,
}: {
  title: string
  description?: string
  items: ActiveInstallment[]
  total: number
  showPerson?: boolean
  own?: boolean
}) {
  return (
    <div>
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {showPerson ? (
              <>no cartão <span className="font-medium text-foreground">{formatCurrency(total)}</span></>
            ) : (
              <span className="font-medium text-foreground">{formatCurrency(total)} em aberto</span>
            )}
          </span>
        </div>
        {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
      </div>
      <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
        {items.map((item) => {
          const next = own ? item.nextOutstanding : item.nextInstallment
          const progress = next ? Math.min(100, Math.max(0, ((next.index - 1) / item.totalCount) * 100)) : 0
          const positionText = next ? `Próxima ${next.index}/${item.totalCount}` : `${item.totalCount} parcelas no total`

          return (
            <div key={item.id} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="truncate text-[13px] font-medium">{item.title}</span>
                  <p className="mt-0.5 break-words text-[11px] leading-4 text-muted-foreground md:truncate">
                    {next
                      ? `${positionText} · ${formatCurrency(next.amount)} · ${monthLabel(next)}`
                      : positionText}
                  </p>
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground/80">
                    {showPerson && item.personName && `${item.personName} · `}
                    {item.bankName ?? 'Cartão'}
                    {item.endsAt && ` · termina ${monthLabel(item.endsAt)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={cn('text-[13px] font-semibold tabular-nums tracking-[-0.01em]', showPerson && 'text-receivable')}>
                    {formatCurrency(own ? item.outstandingAmount : item.remaining)}
                  </span>
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{own ? outstandingLabel(item.outstandingCount) : futureLabel(item.futureCount)}</p>
                </div>
                <DisclosureChevron />
              </div>
              {next && (
                <>
                  <div aria-hidden className="mt-2.5 ml-11 h-1 overflow-hidden rounded-full bg-muted/50">
                    <div className="h-full rounded-full bg-primary/40" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="sr-only">Posição da série: próxima parcela {next.index} de {item.totalCount}</span>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function forecastDescription(month: ForecastMonth) {
  return `${monthLabel(month)}: ${formatCurrency(month.installments)} em parcelas`
}

export default function CommitmentsPage() {
  const { data, isLoading, isError, isSuccess, isFetching, refetch } = useQuery({
    queryKey: ['commitments'],
    queryFn: getCommitments,
  })
  const installments = data?.installments ?? []
  const othersInstallments = data?.othersInstallments ?? []
  const forecast = data?.forecast ?? []
  const totals = data?.totals ?? { installmentsOutstanding: 0, othersRemaining: 0 }
  const maxForecast = Math.max(1, ...forecast.map((item) => item.installments))
  const isEmpty = isSuccess && installments.length === 0 && othersInstallments.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parcelas</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Acompanhe suas compras parceladas, o que ainda falta pagar e o impacto nos próximos meses.</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-6"><Skeleton className="h-44 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-destructive/10"><TriangleAlert className="size-7 text-destructive/70" aria-hidden /></div>
          <p className="text-[15px] font-medium">Não foi possível carregar suas parcelas</p>
          <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">Verifique sua conexão e tente novamente. Seus dados continuam salvos.</p>
          <Button variant="outline" size="sm" className="mt-5 gap-1.5" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            {isFetching ? 'Carregando…' : 'Tentar novamente'}
          </Button>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted/40"><CalendarClock className="size-7 text-muted-foreground" /></div>
          <p className="text-base font-semibold">Nenhuma parcela ativa</p>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">Compras parceladas com parcelas futuras aparecem aqui.</p>
        </div>
      ) : (
        <>
          {forecast.length > 0 && (
            <div>
              <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Parcelas por mês</h2>
              <div className="overflow-hidden rounded-xl border border-border px-4 py-4">
                <div className="flex flex-col gap-2.5">
                  {forecast.map((item) => (
                    <div key={`${item.year}-${item.month}`} className="flex items-center gap-3">
                      <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{monthLabel(item)}</span>
                      <div aria-hidden className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/50"><div className="h-full bg-primary/50" style={{ width: `${(item.installments / maxForecast) * 100}%` }} /></div>
                      <span className="w-24 shrink-0 text-right text-[13px] font-medium tabular-nums">{formatCurrency(item.installments)}</span>
                      <span className="sr-only">{forecastDescription(item)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {installments.length > 0 && <InstallmentSection title="Parcelas em aberto" description={othersInstallments.length > 0 ? 'Sua parte: o que ainda sai do seu bolso.' : undefined} items={installments} total={totals.installmentsOutstanding} own />}
          {othersInstallments.length > 0 && <InstallmentSection title="Parcelas de outras pessoas" description="Passam pelo seu cartão; o reembolso não é calculado aqui." items={othersInstallments} total={totals.othersRemaining} showPerson />}
        </>
      )}
    </div>
  )
}

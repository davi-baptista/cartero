'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Layers,
  Repeat,
  ArrowRight,
  CalendarClock,
  TriangleAlert,
  RotateCcw,
  Loader2,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  getCommitments,
  type ActiveInstallment,
  type ForecastMonth,
  type SubscriptionOccurrence,
} from '@/services/commitments.service'
import {
  formatCurrency,
  formatDate,
  TRANSACTION_TYPE_LABELS,
} from '@/lib/formatters'
import { cn } from '@/lib/utils'

/** "set/26" — compacto o bastante para uma coluna estreita. */
function monthLabel({ month, year }: { month: number; year: number }) {
  const nome = new Date(year, month - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')
  return `${nome}/${String(year).slice(2)}`
}

function InstallmentSection({
  title,
  description,
  items,
  total,
  showPerson = false,
}: {
  title: string
  description?: string
  items: ActiveInstallment[]
  total: number
  showPerson?: boolean
}) {
  return (
    <div>
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {showPerson ? 'a receber ' : 'faltam '}
            <span className="font-medium text-foreground">{formatCurrency(total)}</span>
          </span>
        </div>
        {description && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
        {items.map((item) => {
          const progress = (item.paidCount / item.totalCount) * 100
          return (
            <div key={item.id} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                  <Layers className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-[13px] font-medium">{item.title}</span>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {showPerson && item.personName && `${item.personName} · `}
                    {formatCurrency(item.installmentAmount)} × {item.totalCount}
                    {item.bankName && ` · ${item.bankName}`}
                    {item.endsAt && ` · até ${monthLabel(item.endsAt)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      'text-[13px] font-semibold tabular-nums tracking-[-0.01em]',
                      showPerson && 'text-receivable',
                    )}
                  >
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
                  className={cn(
                    'h-full rounded-full',
                    showPerson ? 'bg-receivable/40' : 'bg-primary/40',
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Texto da próxima cobrança de uma assinatura.
 *
 * Recebe a ocorrência já calculada pelo backend. Sem ocorrência — o horizonte
 * não alcança, ou a assinatura está bloqueada — cai na regra, que é honesta
 * sobre não saber a data.
 */
function occurrenceLabel(
  occurrence: SubscriptionOccurrence | undefined,
  dayOfMonth: number,
): string {
  if (!occurrence) return `Todo dia ${dayOfMonth}`

  if (occurrence.blocked === 'bank-archived') {
    return 'Banco arquivado — não será cobrada';
  }
  if (occurrence.blocked === 'invoice-paid') {
    return 'Fatura já paga — cobrança será pulada';
  }

  const date = formatDate(occurrence.chargeDate)

  /**
   * No crédito o mês do bolso é a FATURA, e pode não ser o da cobrança: uma
   * assinatura que cobra em 30/08 num cartão já fechado cai em outubro. Quando
   * os dois coincidem, repetir a fatura seria ruído.
   */
  const chargeMonth = occurrence.chargeDate.slice(0, 7)
  const financialMonth = `${occurrence.financialPeriod.year}-${String(occurrence.financialPeriod.month).padStart(2, '0')}`

  return chargeMonth === financialMonth
    ? `Próxima: ${date}`
    : `Próxima: ${date} · fatura ${monthLabel(occurrence.financialPeriod)}`
}

/**
 * Descrição da composição de um mês, para leitor de tela.
 *
 * A barra empilhada mostrava a divisão entre parcelas e assinaturas só por
 * tonalidade e largura — quem não vê ouvia apenas o total. Este texto carrega
 * a mesma informação em palavras, e a barra passa a ser puramente decorativa.
 */
function forecastMonthDescription(month: ForecastMonth): string {
  const parts: string[] = []
  if (month.installments > 0) {
    parts.push(`${formatCurrency(month.installments)} em parcelas`)
  }
  if (month.subscriptions > 0) {
    parts.push(`${formatCurrency(month.subscriptions)} em assinaturas`)
  }

  const label = monthLabel(month)
  if (parts.length === 0) {
    return `${label}: nenhum compromisso`
  }

  return `${label}: ${formatCurrency(month.total)}, sendo ${parts.join(' e ')}`
}

export default function CommitmentsPage() {
  const { data, isLoading, isError, isSuccess, isFetching, refetch } = useQuery({
    queryKey: ['commitments'],
    queryFn: getCommitments,
  })

  const installments = data?.installments ?? []
  const othersInstallments = data?.othersInstallments ?? []
  const subscriptions = data?.subscriptions ?? []
  const forecast = data?.forecast ?? []
  const totals = data?.totals ?? {
    installmentsRemaining: 0,
    othersRemaining: 0,
    monthlySubscriptions: 0,
  }

  const maxForecast = Math.max(1, ...forecast.map((f) => f.total))

  /**
   * Ocorrências por assinatura, para a lista não precisar procurar em array.
   * Uma passada; a projeção já vem resolvida do backend.
   */
  const occurrenceBySubscription = useMemo(
    () =>
      new Map(
        (data?.subscriptionOccurrences ?? []).map((o) => [o.subscriptionId, o]),
      ),
    [data?.subscriptionOccurrences],
  )
  /**
   * Vazio só quando a busca DEU CERTO e não há nada.
   *
   * A condição era `!isLoading` mais arrays vazios — mas um erro também
   * produz arrays vazios (os `?? []` acima), então uma falha do backend
   * renderizava "Nenhum compromisso fixo". O usuário concluía que não tem
   * obrigações futuras quando o servidor apenas não respondeu.
   *
   * `isSuccess` é o que separa "não há nada" de "não sei o que há".
   */
  const isEmpty =
    isSuccess &&
    installments.length === 0 &&
    othersInstallments.length === 0 &&
    subscriptions.length === 0

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
      ) : isError ? (
        /*
          Erro é estado próprio, não lista vazia.
          Fica na página — e não num toast — porque a tela inteira depende
          desta query: um toast desapareceria e deixaria o usuário diante de
          uma página que parece dizer que ele não tem compromisso nenhum.
        */
        <div
          role="alert"
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-destructive/10">
            <TriangleAlert
              className="size-7 text-destructive/70"
              aria-hidden
            />
          </div>
          <p className="text-[15px] font-medium">
            Não foi possível carregar seus compromissos
          </p>
          <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">
            Verifique sua conexão e tente novamente. Seus dados continuam
            salvos.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-5 gap-1.5"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="size-3.5" aria-hidden />
            )}
            {isFetching ? 'Carregando…' : 'Tentar novamente'}
          </Button>
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
                      {/*
                        A barra é decoração: a informação inteira está no texto
                        acessível ao lado. `aria-hidden` no container evita que
                        um leitor de tela anuncie divs vazias, e a composição
                        (quanto é parcela, quanto é assinatura) fica legível
                        para quem não vê as duas tonalidades.

                        Sem `role="progressbar"` de propósito — isto é
                        composição de um total, não progresso rumo a uma meta.
                        A role erraria a semântica só para satisfazer checklist.
                      */}
                      <div
                        aria-hidden
                        className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/50"
                      >
                        {f.installments > 0 && (
                          <div
                            className="h-full bg-primary/50"
                            style={{ width: `${(f.installments / maxForecast) * 100}%` }}
                          />
                        )}
                        {f.subscriptions > 0 && (
                          <div
                            className="h-full bg-primary/25"
                            style={{ width: `${(f.subscriptions / maxForecast) * 100}%` }}
                          />
                        )}
                      </div>
                      <span className="w-24 shrink-0 text-right text-[13px] font-medium tabular-nums tracking-[-0.01em]">
                        {formatCurrency(f.total)}
                      </span>
                      <span className="sr-only">
                        {forecastMonthDescription(f)}
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
          {/* A descrição só faz sentido quando há a seção de terceiros logo
              abaixo para contrastar — sozinha, seria ruído. */}
          {installments.length > 0 && (
            <InstallmentSection
              title="Parcelamentos em aberto"
              description={
                othersInstallments.length > 0
                  ? 'Sua parte: o que ainda sai do seu bolso.'
                  : undefined
              }
              items={installments}
              total={totals.installmentsRemaining}
            />
          )}

          {/* Parcelas de terceiros — passam pelo seu cartão mas voltam
              como recebível, então ficam fora do custo fixo acima. */}
          {othersInstallments.length > 0 && (
            <InstallmentSection
              title="Parcelas de outras pessoas"
              description="Passam pelo seu cartão, mas o valor volta para você — não entram no custo fixo."
              items={othersInstallments}
              total={totals.othersRemaining}
              showPerson
            />
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
                        {TRANSACTION_TYPE_LABELS[s.type]}
                        {s.bank && ` · ${s.bank.name}`}
                        {s.category && ` · ${s.category.name}`}
                      </p>
                      {/*
                        A OCORRÊNCIA concreta, não a regra.
                        "Todo dia 31" descreve a assinatura, mas fevereiro não
                        tem dia 31 — a data real vem do backend, com o clamp já
                        aplicado, e é a mesma que a geração vai usar.
                      */}
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                        {occurrenceLabel(occurrenceBySubscription.get(s.id), s.dayOfMonth)}
                      </p>
                    </div>
                    {/*
                      Sinal de saída, como na linha de assinatura da tela de
                      Assinaturas. A mesma cobrança aparecia vermelha com menos
                      lá e neutra sem sinal aqui.
                    */}
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em] text-destructive">
                      −{formatCurrency(Number(s.amount))}
                    </span>
                    <ArrowRight
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground',
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

'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, PiggyBank, ArrowRight, Wallet, HandCoins, User } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusListRow, type StatusRowTone } from '@/components/ui/status-list-row'
import { currentPeriod, useMonthPeriod } from '@/components/month-nav'
import { getBudget, getBudgetFocus } from '@/services/budget.service'
import { upsertSalary } from '@/services/salary.service'
import { SalaryDialog } from './salary-dialog'
import { formatCurrency, formatMonthYear, formatDate } from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { toast } from 'sonner'
import { bankDisplayName } from '@/lib/bank-display'
import {
  budgetContextLabel,
  openBalanceLabel,
  openCompositionParts,
  openDirection,
  openPriorLabel,
  settlementAriaLabel,
} from '@/lib/people-settlement-view'
import { formatDateValue } from '@/lib/date'
import { cn } from '@/lib/utils'
import { invoiceStatusConfig } from '@/lib/invoice-status'
import { InvoiceStatus } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

// O mapa de status vivia aqui, em `overview` e em `banks/[id]/invoices`, com
// os mesmos rótulos copiados. Agora vem de `@/lib/invoice-status`.

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
    // "Em atraso" é o vocabulário oficial desde a Fase 8A — nunca "Vencida".
    // Esta tela tinha ficado de fora daquela padronização.
    label: 'Em atraso',
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

  const {
    data: budget,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
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

  const qc = useQueryClient()
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false)

  /**
   * Salva a renda a partir do mês selecionado.
   *
   * A invalidação cobre `budget` inteiro (todos os meses em cache) porque uma
   * entrada nova muda a renda derivada de todos os meses seguintes até a
   * próxima entrada — invalidar só o mês editado deixaria os posteriores
   * exibindo o valor antigo.
   *
   * `me` entra na lista porque `User.salary` é sincronizado quando a alteração
   * afeta o mês corrente; o backend decide isso, e aqui só refletimos.
   */
  const salaryMut = useMutation({
    mutationFn: (amount: number) => upsertSalary({ amount, month, year }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['budget'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ])
      setSalaryDialogOpen(false)
      toast.success(`Renda definida a partir de ${formatMonthYear(month, year)}`)
    },
    onError: () => toast.error('Não foi possível salvar a renda'),
  })

  const allInvoices = budget?.invoices ?? []

  const invoices = useMemo(
    () => allInvoices.filter((inv) => Number(inv.totalAmount) > 0),
    [allInvoices],
  )

  /*
    A renda e seus derivados vêm do backend, que resolve a competência.

    Recalcular `salary - totalToPay` aqui criaria uma segunda fórmula, e ela
    divergiria no caso que importa: renda desconhecida. O backend devolve
    `null` justamente para a tela não inventar uma sobra.
  */
  const salary = budget?.salary ?? null
  const salaryKnown = budget?.salaryKnown ?? false
  const salaryEffectiveFrom = budget?.salaryEffectiveFrom ?? null

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

  /*
    Pendências anteriores: dívidas vencidas antes deste mês e ainda abertas
    quando ele começou.

    Antes elas simplesmente não apareciam no Orçamento — o filtro era
    `dueDate` dentro do mês —, então uma dívida vencida em junho desaparecia
    de agosto embora continuasse devida.
  */
  /*
    O cabeçalho de "Dívidas" soma apenas as linhas EXIBIDAS.

    Nem `totalDebts` (que inclui pendências anteriores) nem `dueInMonth` (que
    inclui as dívidas de pessoas, agora mostradas em "Acertos com pessoas")
    servem: o título tem de fechar com as linhas logo abaixo dele.
  */
  const receivableInMonth = budget?.receivables.dueInMonth ?? 0

  /*
    Acertos com pessoas — camada informativa.

    Uma Debt vinculada a uma pessoa aparece AQUI e não na seção genérica de
    Dívidas: mostrar "Mariana R$ 250" nas duas duplicaria visualmente a mesma
    obrigação. Ela continua no `totalToPay`; só a representação muda.
  */
  const peopleSettlements = budget?.peopleSettlements ?? []

  /** Dívidas do mês SEM pessoa — as vinculadas vivem nos acertos. */
  const standaloneDebtRows = debtBreakdown.filter(
    (row) => row.kind !== 'person',
  )

  const priorCarry = budget?.debts.priorCarry ?? 0
  const priorCarryItems = budget?.debts.priorCarryItems ?? []
  /** Pendências anteriores SEM pessoa, pela mesma razão. */
  const standalonePriorItems = priorCarryItems.filter(
    (item) => !item.personId,
  )
  const standalonePriorTotal = standalonePriorItems.reduce(
    (sum, item) => sum + item.amount,
    0,
  )

  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const monthStart = `${monthKey}-01`
  const monthEnd = formatDateValue(new Date(year, month, 0))

  const balance = budget?.remaining ?? null
  const hasMix = summary.totalPaid > 0 && summary.totalPending > 0
  const pct = budget?.committedPct ?? null

  /*
    A entrada aplicável é de um mês anterior: vale dizer de quando, senão o
    usuário não entende por que a renda exibida não é a que ele configurou por
    último.
  */
  const inheritedFrom =
    salaryEffectiveFrom &&
    (salaryEffectiveFrom.year !== year || salaryEffectiveFrom.month !== month)
      ? formatMonthYear(salaryEffectiveFrom.month, salaryEffectiveFrom.year)
      : null

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
        {/*
          Falha de API não pode exibir "R$ 0,00" de comprometimento — seria
          afirmar que o mês está livre.
        */}
        {isError ? (
          <QueryError
            message="Não foi possível carregar o orçamento"
            isFetching={isFetching}
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
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
              {/*
                O total já INCLUI as pendências anteriores. Dizer isso aqui
                evita a leitura de que o mês piorou sozinho.
              */}
              {priorCarry > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Inclui {formatCurrency(priorCarry)} de pendências anteriores
                </p>
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

            {/*
              A Receber no mês — informação, nunca dedução.

              Sem saldo líquido de propósito: um "saldo entre vocês" aqui
              reintroduziria a ambiguidade que a compensação criava, sugerindo
              que o valor a pagar é menor do que é. O que a pessoa te deve
              aparece no extrato dela, lado a lado com o que você deve.
            */}
            {receivableInMonth > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-receivable">
                  {formatCurrency(receivableInMonth)}
                </span>{' '}
                a receber neste mês — não abate o valor acima
              </p>
            )}

            {/*
              Renda desconhecida para o período.

              A migration não inventou histórico: só sabemos o valor a partir
              do mês de adoção. Exibir "R$ 0,00" aqui afirmaria que a pessoa
              não tinha renda, o que é diferente de não sabermos.
            */}
            {!salaryKnown && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-sm text-muted-foreground">
                  Renda não registrada para {formatMonthYear(month, year)}.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2.5 gap-1.5"
                  onClick={() => setSalaryDialogOpen(true)}
                >
                  <Wallet className="size-3.5" aria-hidden />
                  Definir renda
                </Button>
              </div>
            )}

            {/* Renda conhecida e igual a zero: a sobra existe, o percentual não. */}
            {salaryKnown && salary === 0 && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-sm text-muted-foreground">
                  Renda registrada de{' '}
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(0)}
                  </span>{' '}
                  para este período.
                </p>
                <button
                  type="button"
                  onClick={() => setSalaryDialogOpen(true)}
                  className="mt-1.5 text-xs text-primary underline-offset-2 hover:underline"
                >
                  Alterar renda
                </button>
              </div>
            )}

            {/* Salário — complemento opcional */}
            {salaryKnown && salary != null && salary > 0 && (
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
                  {inheritedFrom && (
                    <span className="text-muted-foreground/70">
                      {' '}
                      · renda válida desde {inheritedFrom}
                    </span>
                  )}
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
                              ? 'bg-pending'
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
                            ? 'text-pending'
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
                · {formatCurrency(summary.netAmount)} sua parte
              </span>
            )}
          </h2>
          {!isLoading && summary.totalReimbursable > 0 && (
            <p className="text-[11px] text-muted-foreground">
              já descontado{' '}
              <span className="font-medium text-receivable">
                {formatCurrency(summary.totalReimbursable)}
              </span>{' '}
              de outras pessoas
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
              const { label, className } = invoiceStatusConfig(inv.status)
              const tone: StatusRowTone =
                inv.status === InvoiceStatus.PAID
                  ? 'positive'
                  : inv.status === InvoiceStatus.OVERDUE
                    ? 'negative'
                    : 'neutral'
              // O Orçamento fala de custo pessoal, então o valor em destaque é
              // a sua parte. O bruto continua visível no subtítulo: é ele que
              // o banco vai cobrar, e é o número que aparece em Bancos.
              const reimbursable = inv.reimbursable ?? 0
              const hasOthers = reimbursable > 0
              return (
                <StatusListRow
                  key={inv.id}
                  href={`/banks/${inv.bankId}/invoices?invoiceId=${inv.id}`}
                  icon={CreditCard}
                  tone={tone}
                  title={bankDisplayName(inv.bank, 'Banco')}
                  badge={{ label, className }}
                  subtitle={
                    hasOthers ? (
                      <>
                        Fatura total {formatCurrency(Number(inv.totalAmount))}
                        <span className="mx-1 text-muted-foreground/40" aria-hidden>
                          ·
                        </span>
                        <span className="text-receivable">
                          {formatCurrency(reimbursable)}
                        </span>{' '}
                        de outras pessoas
                      </>
                    ) : undefined
                  }
                  amount={hasOthers ? inv.ownAmount : Number(inv.totalAmount)}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Dívidas — seção própria, com uma linha por pessoa e por dívida
          avulsa. O que a pessoa te deve já está abatido do valor dela. */}      {/*
        ── Acertos com pessoas ──

        Consolida por pessoa o que ela deve e o que se deve a ela NESTA
        competência. Antes o usuário via "R$ 480 a receber" no topo e
        "Mariana R$ 250" em Dívidas, e precisava fazer a conta de cabeça.

        O saldo é INFORMATIVO: nenhuma compensação acontece, e o valor não
        entra em nenhum total. Para quitar de fato, o caminho é o drawer da
        pessoa.
      */}
      {!isLoading && peopleSettlements.length > 0 && (
        <div>
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
            Acertos com pessoas
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {formatMonthYear(month, year)}
            </span>
          </h2>

          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {peopleSettlements.map((person) => {
              /*
                Dois universos, dois rótulos. O módulo `people-settlement-view`
                decide a semântica; aqui só apresentamos (item 31).
              */
              const context = budgetContextLabel(person, formatCurrency)
              const composition = openCompositionParts(person)
              const balance = openBalanceLabel(person, formatCurrency)
              const prior = openPriorLabel(person, formatCurrency)
              const direction = openDirection(person)

              return (
                <Link
                  key={person.personId}
                  href={`/persons?personId=${person.personId}&period=${monthKey}`}
                  aria-label={settlementAriaLabel(
                    person,
                    formatCurrency,
                    formatMonthYear(month, year),
                  )}
                  className="group flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium transition-colors group-hover:text-primary">
                      <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{person.personName}</span>
                    </p>

                    {/*
                      Contexto do ORÇAMENTO — obrigação da competência, mesmo
                      já paga. Sem esta linha, uma dívida quitada sumiria da
                      tela enquanto continua somando em `totalToPay`, e o total
                      deixaria de fechar com o que está visível.
                    */}
                    {context && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        <span className="text-muted-foreground/70">
                          No orçamento de {formatMonthYear(month, year)}
                        </span>
                        <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                          ·
                        </span>
                        <span className="font-medium text-foreground/80">
                          {context}
                        </span>
                      </p>
                    )}

                    {/*
                      Composição do que está EM ABERTO. Some quando o item é
                      quitado — antes esta linha vinha do universo histórico e
                      seguia exibindo "A pagar R$ 200" depois da quitação.
                    */}
                    {composition.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {composition.map((part, index) => (
                          <span key={part.side}>
                            {index > 0 && (
                              <span
                                className="mx-1.5 text-muted-foreground/40"
                                aria-hidden
                              >
                                ·
                              </span>
                            )}
                            {part.side === 'receivable' ? 'A receber' : 'A pagar'}{' '}
                            <span
                              className={cn(
                                'font-medium',
                                part.side === 'receivable'
                                  ? 'text-receivable'
                                  : 'text-destructive',
                              )}
                            >
                              {formatCurrency(part.amount)}
                            </span>
                          </span>
                        ))}
                      </p>
                    )}

                    {/*
                      Explica por que a fatura mostra "R$ 240 de outras pessoas"
                      e o acerto mostra R$ 480: parte passou pelo seu cartão.
                    */}
                    {person.open.automaticReceivable > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {formatCurrency(person.open.automaticReceivable)} vêm de
                        compras no seu cartão
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 sm:text-right">
                    {/*
                      "Saldo em aberto", nunca "Saldo líquido": este número é
                      pendência atual, e o rótulo antigo podia ser lido como
                      obrigação viva quando na verdade era histórico do
                      orçamento.
                    */}
                    <p className="text-[11px] text-muted-foreground">
                      Saldo em aberto
                    </p>
                    <p
                      className={cn(
                        'text-[13px] font-semibold tabular-nums',
                        direction === 'receive' && 'text-receivable',
                        direction === 'pay' && 'text-destructive',
                        direction === 'settled' && 'text-muted-foreground',
                      )}
                    >
                      {balance}
                    </p>
                    {prior && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {prior}
                      </p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}


      {!isLoading && standaloneDebtRows.length > 0 && (
        <div>
          {/* Mesmo padrão do cabeçalho de Faturas: o valor entra no título,
              em cinza. Sem badge agregado — cada linha já tem o seu. */}
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
            Dívidas
            <span className="ml-1.5 font-normal text-muted-foreground">
              ·{' '}
              {formatCurrency(
                standaloneDebtRows.reduce((sum, row) => sum + row.amount, 0),
              )}
            </span>
          </h2>

          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {standaloneDebtRows.map((item) => {
              const { label, className, tone } = DEBT_STATUS_CONFIG[item.status]
              return (
                <StatusListRow
                  key={`${item.kind}-${item.id ?? item.name}`}
                  // Pessoa abre o extrato dela no mês visto aqui, onde dívida
                  // e cobrança aparecem lado a lado.
                  href={
                    item.kind === 'person' && item.id
                      ? `/persons?personId=${item.id}&period=${monthKey}`
                      : `/debts?endDate=${monthEnd}`
                  }
                  icon={item.kind === 'person' ? User : HandCoins}
                  tone={tone}
                  title={item.name}
                  badge={{ label, className }}
                  /*
                    O subtítulo dizia "já descontado R$ X que <pessoa> te
                    deve" — a compensação afirmada na tela. Ela não existe
                    mais: o valor é a dívida íntegra, e o que a pessoa deve
                    aparece na informação de A Receber, sem abater nada.
                  */
                  amount={item.amount}
                />
              )
            })}
          </div>
        </div>
      )}

      {/*
        Pendências anteriores — seção própria.

        Separada de "Dívidas" de propósito: misturá-las faria parecer que
        venceram neste mês. Cada linha mantém o vencimento ORIGINAL.

        Só renderiza quando existe algo: uma seção "Pendências anteriores —
        R$ 0" seria ruído.
      */}
      {!isLoading && standalonePriorItems.length > 0 && (
        <div>
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
            Pendências anteriores
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {formatCurrency(standalonePriorTotal)}
            </span>
          </h2>
          <p className="mb-3 -mt-1.5 text-xs text-muted-foreground">
            Venceram antes deste mês e ainda estavam abertas quando ele começou.
          </p>

          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {standalonePriorItems.map((item, index) => (
              <StatusListRow
                key={`${item.title}-${item.dueDate}-${index}`}
                href={
                  item.personId
                    ? `/persons?personId=${item.personId}`
                    : `/debts?endDate=${monthEnd}`
                }
                icon={item.personId ? User : HandCoins}
                tone={item.paidInMonth ? 'positive' : 'negative'}
                title={item.title}
                badge={
                  item.paidInMonth
                    ? { label: 'Paga', className: DEBT_STATUS_CONFIG.PAID.className }
                    : { label: 'Em atraso', className: DEBT_STATUS_CONFIG.OVERDUE.className }
                }
                subtitle={
                  <>
                    venceu em {formatDate(item.dueDate)}
                    {item.personName ? ` · ${item.personName}` : ''}
                  </>
                }
                amount={item.amount}
              />
            ))}
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

      <SalaryDialog
        open={salaryDialogOpen}
        month={month}
        year={year}
        currentAmount={salaryKnown ? salary : null}
        isPending={salaryMut.isPending}
        onConfirm={(amount) => salaryMut.mutate(amount)}
        onCancel={() => setSalaryDialogOpen(false)}
      />
    </div>
  )
}

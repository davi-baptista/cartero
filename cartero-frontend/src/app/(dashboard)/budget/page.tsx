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
import { SalaryHistorySheet } from './salary-history-sheet'
import { formatCurrency, formatMonthYear, formatDate } from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { toast } from 'sonner'
import { bankDisplayName } from '@/lib/bank-display'
import {
  summarizePeopleSettlements,
  summaryAriaLabel,
  summaryBalanceLabel,
  summaryCompositionParts,
  summaryDirection,
  shouldRenderPeopleSettlement,
  peopleRowView,
  peopleRowStatusLabel,
  peopleRowAriaLabel,
} from '@/lib/people-settlement-view'
import { formatDateValue } from '@/lib/date'
import { cn } from '@/lib/utils'
import { invoiceStatusConfig } from '@/lib/invoice-status'
import {
  invoiceSectionParts,
  summarizeInvoiceSection,
} from '@/lib/invoice-composition'
import { InvoiceStatus } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

// O mapa de status vivia aqui, em `overview` e em `banks/[id]/invoices`, com
// os mesmos rótulos copiados. Agora vem de `@/lib/invoice-status`.

/**
 * Composição de cabeçalho compartilhada por "Faturas" e "Acertos com pessoas".
 *
 * As duas seções são irmãs: título + resumo à esquerda, informação
 * complementar à direita, lista logo abaixo. Antes cada uma tinha o próprio
 * conjunto de classes e, embora as duas usassem `mb-3`, a distância até a
 * lista divergia — o lado direito de Acertos empilha rótulo e valor
 * (`sm:block`), deixando o cabeçalho mais alto que o de Faturas, que era de
 * uma linha só.
 *
 * Centralizar aqui é o que impede a divergência de voltar: mudar o spacing de
 * uma seção passa obrigatoriamente pela outra.
 */
const SECTION_HEADER_CLASS =
  'mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3'

const SECTION_TITLE_CLASS = 'text-[15px] font-semibold tracking-tight'

/** Bloco à direita: rótulo muted + valor. Empilha no desktop, inline no mobile. */
const SECTION_ASIDE_CLASS =
  'text-[11px] text-muted-foreground sm:shrink-0 sm:text-right'

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
  const [historyOpen, setHistoryOpen] = useState(false)

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
        // A renda vigente exibida no Perfil também muda.
        qc.invalidateQueries({ queryKey: ['salary'] }),
        // E o histórico ganha (ou atualiza) a entrada desta competência.
        qc.invalidateQueries({ queryKey: ['salary-history'] }),
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
  /*
    Acertos com pessoas — camada informativa.

    Uma Debt vinculada a uma pessoa aparece AQUI e não na seção genérica de
    Dívidas: mostrar "Mariana R$ 250" nas duas duplicaria visualmente a mesma
    obrigação. Ela continua no `totalToPay`; só a representação muda.
  */
  const peopleSettlements = budget?.peopleSettlements ?? []

  /*
    Resumo da seção, agregado sobre as MESMAS pessoas renderizadas abaixo.

    Não usa `receivables.dueInMonth`: aquele total tem outro recorte (inclui
    cobrança sem pessoa) e o cabeçalho passaria a divergir da lista. A soma é
    de `open.receivableTotal`/`open.debtTotal`, que já contêm mês + anteriores
    em aberto — somar `prior*` de novo contaria em dobro.
  */
  /*
    Sem `useMemo`: `peopleSettlements` é um array novo a cada render (vem de
    `budget?.x ?? []`), então a memo nunca acertaria — só adicionaria uma
    dependência instável. Somar meia dúzia de números é mais barato que isso.
  */
  /*
    Defesa do frontend: pessoa sem contribuição ao orçamento E sem nada em
    aberto não tem o que dizer nesta competência. O backend já filtra por
    movimentação; isto impede a linha vazia mesmo se aquilo mudar.
  */
  const visiblePeople = peopleSettlements.filter(shouldRenderPeopleSettlement)

  const peopleSummary = summarizePeopleSettlements(visiblePeople)
  /*
    Resumo da seção Faturas — mesma anatomia do de pessoas. O bruto vem do
    agregado consolidado do backend, não de soma no JSX.
  */
  const invoiceSummary = summarizeInvoiceSection({
    totalInvoices: summary.totalAll,
    netAmount: summary.netAmount,
    totalReimbursable: summary.totalReimbursable,
  })
  const invoiceParts = invoiceSectionParts(invoiceSummary)

  const peopleSummaryParts = summaryCompositionParts(peopleSummary)
  const peopleSummaryBalance = summaryBalanceLabel(peopleSummary, formatCurrency)
  const peopleSummaryDirection = summaryDirection(peopleSummary)
  const peopleSummaryAria = summaryAriaLabel(peopleSummary, formatCurrency)

  /** Dívidas do mês SEM pessoa — as vinculadas vivem nos acertos. */
  const standaloneDebtRows = debtBreakdown.filter(
    (row) => row.kind !== 'person',
  )

  /*
    Dois eventos distintos, nunca somados numa frase só: o que ainda está
    aberto agora e o que foi efetivamente pago nesta competência.
  */
  const currentOpenPrior = budget?.debts.currentOpenPrior ?? 0
  const priorPaidInMonth = budget?.debts.paidInMonth ?? 0
  const priorCarryItems = budget?.debts.priorItems ?? []
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
    Rótulo acessível da barra de renda.

    A barra sozinha comunica por posição, e `aria-valuenow` é travado em 100%
    para não emitir valor inválido — então quem usa leitor de tela perderia
    tanto o estouro quanto o dinheiro livre. O texto carrega os três fatos:
    percentual REAL, renda total e quanto sobra (ou quanto excedeu).
  */
  const salaryProgressLabel = useMemo(() => {
    if (salary == null || pct == null) return 'Percentual da renda comprometido'

    const consumo = `${pct.toFixed(0)}% da renda de ${formatCurrency(salary)} comprometido`
    if (balance == null) return consumo

    return balance < 0
      ? `${consumo}, ${formatCurrency(Math.abs(balance))} acima da renda`
      : `${consumo}, ${formatCurrency(balance)} livres`
  }, [salary, pct, balance])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orçamento</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Planeje o que precisa sair do seu bolso neste mês
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
              {/*
                Label da MÉTRICA, não da página. O subtítulo acima descreve o
                que a tela faz; esta linha nomeia o número logo abaixo.
              */}
              <p className="text-sm text-muted-foreground">
                Total a pagar no mês
              </p>
              {/*
                Neutro de propósito — nunca `text-destructive`. O número não é
                erro nem atraso: é o custo normal da competência.
              */}
              <p className="mt-1 text-[38px] font-semibold tabular-nums tracking-[-0.025em] leading-none">
                {formatCurrency(summary.totalToPay)}
              </p>
              {summary.totalToPay === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">nada a pagar neste mês</p>
              ) : (
                /*
                  Diz o que COMPÕE o número, e só isso.

                  A frase "valores a receber não reduzem este total" saiu daqui:
                  explicar uma ausência ao lado da métrica principal misturava
                  duas seções e deixava a leitura ambígua. A independência entre
                  os dois universos é assunto de "Acertos com pessoas", onde os
                  valores a receber de fato aparecem.
                */
                <p className="mt-2 text-xs text-muted-foreground">
                  Inclui sua parte das faturas, pagamentos e dívidas.
                </p>
              )}
              {/*
                O total já INCLUI as pendências anteriores. Dizer isso aqui
                evita a leitura de que o mês piorou sozinho.
              */}
              {currentOpenPrior > 0 && (
                /* `mt-0.5` agrupa com a linha acima: as duas descrevem a mesma
                   composição, não dois avisos independentes. */
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Inclui {formatCurrency(currentOpenPrior)} de pendências
                  anteriores em aberto
                </p>
              )}
              {/*
                Duas microcopies curtas em vez de uma frase somando os dois:
                "em aberto" e "paga neste mês" são estados diferentes, e
                juntá-los num número só esconderia qual é qual.
              */}
              {priorPaidInMonth > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Inclui {formatCurrency(priorPaidInMonth)} de pendências
                  anteriores pagas neste mês
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
              ── Renda do mês ──

              Um bloco visual só, no lugar de três variações de frase. A barra
              e o salário à direita já explicam a relação, então "Sobra
              estimada de X sobre Y" virou redundância textual.

              "renda válida desde <mês>" saiu daqui: o dado continua correto e
              continua no fluxo de Histórico salarial, mas competia por
              atenção no topo sem mudar nenhuma decisão.
            */}
            {/*
              Delimitado pelos DOIS lados, com o mesmo divisor.

              A linha de baixo encerra o bloco: sem ela, "Renda do mês" e
              "Faturas" liam como uma seção contínua. O `py-4` mantém o
              respiro simétrico — a barra e os textos não encostam nas linhas.
            */}
            <div className="border-y border-border/60 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-muted-foreground">Renda do mês</p>
                {/*
                  Ação terciária: corrigir uma competência cadastrada errada é
                  raro, e não deve ter o peso de uma seção. Fica aqui porque
                  vale nos três estados de renda — inclusive desconhecida,
                  já que pode haver entrada em outro mês.
                */}
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Histórico salarial
                </button>
              </div>

              {/*
                Renda desconhecida: a migration não inventou histórico, e
                exibir "R$ 0,00" afirmaria que a pessoa não tinha renda — o
                que é diferente de não sabermos.
              */}
              {!salaryKnown && (
                <div className="mt-2">
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

              {/* Renda zero: a sobra existe, o percentual não. */}
              {salaryKnown && salary === 0 && (
                <div className="mt-2">
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

              {salaryKnown && salary != null && salary > 0 && (
                <div className="mt-2">
                  {/*
                    A barra representa UTILIZAÇÃO, não algo positivo — por isso
                    a cor primária, e não verde. O âmbar e o vermelho entram só
                    quando o comprometimento aperta ou estoura.
                  */}
                  <div className="flex items-center gap-3">
                    <div
                      role="progressbar"
                      aria-valuenow={Math.min(Math.round(pct ?? 0), 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={salaryProgressLabel}
                      className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50"
                    >
                      <div
                        aria-hidden
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out',
                          pct != null && pct > 100
                            ? 'bg-destructive'
                            : pct != null && pct > 70
                              ? 'bg-pending'
                              : 'bg-primary',
                        )}
                        /* Clamp em 100%: width acima disso é inválida. */
                        style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                      />
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatCurrency(salary)}
                    </p>
                  </div>

                  <div className="mt-1.5 flex items-baseline justify-between gap-3">
                    {/*
                      O percentual continua REAL mesmo com a barra travada em
                      100%: travar o texto junto esconderia o estouro.
                    */}
                    <p
                      className={cn(
                        'text-[11px] tabular-nums',
                        pct != null && pct > 100
                          ? 'text-destructive'
                          : pct != null && pct > 70
                            ? 'text-pending'
                            : 'text-muted-foreground',
                      )}
                    >
                      {pct != null ? `${pct.toFixed(0)}% comprometido` : ' '}
                    </p>
                    {/*
                      Sobra positiva é conquista (verde); estouro não vira
                      "-R$ X livres", que seria contraditório — vira
                      "R$ X acima da renda".
                    */}
                    {balance != null && (
                      <p
                        className={cn(
                          'shrink-0 text-[13px] font-semibold tabular-nums',
                          balance < 0 ? 'text-destructive' : 'text-receivable',
                        )}
                      >
                        {balance < 0
                          ? `${formatCurrency(Math.abs(balance))} acima da renda`
                          : `${formatCurrency(balance)} livres`}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Invoice list */}
      <div>
        {/*
          Mesma composição de spacing do cabeçalho de Acertos com pessoas
          (SECTION_HEADER_CLASS): as duas seções são irmãs, e um `mb-*`
          divergente escondido num dos wrappers reabriria a diferença.
        */}
        <div className={SECTION_HEADER_CLASS}>
          <h2 className={SECTION_TITLE_CLASS}>
            Faturas
            {/*
              Composição no mesmo padrão de "a receber · a pagar" dos acertos.
              Antes a parcela de terceiros era "já descontado R$ X de outras
              pessoas" à direita, que deixava ambíguo se o número tinha sido
              somado ou subtraído do valor ao lado.
            */}
            {!isLoading &&
              invoiceParts.map((part) => (
                <span
                  key={part.kind}
                  className="font-normal text-muted-foreground"
                >
                  <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                    ·
                  </span>
                  <span
                    className={cn(
                      'font-medium',
                      part.kind === 'thirdParty' && 'text-receivable',
                    )}
                  >
                    {formatCurrency(part.amount)}
                  </span>{' '}
                  {part.kind === 'own' ? 'sua parte' : 'de outras pessoas'}
                </span>
              ))}
          </h2>

          {/*
            O BRUTO das faturas — o que os bancos cobram. Vem de
            `totalInvoices`, o agregado que o backend já consolida e do qual
            `netAmount` é derivado (`totalInvoices - totalReimbursable`), então
            o cabeçalho fecha com as faturas listadas por construção.

            Neutro de propósito: não é `totalToPay` (que ainda soma pagamentos
            diretos, dívidas e pendências anteriores) nem valor a receber.
          */}
          {!isLoading && invoiceSummary.gross > 0 && (
            <p
              className={SECTION_ASIDE_CLASS}
              aria-label={`Total das faturas, ${formatCurrency(invoiceSummary.gross)}`}
            >
              <span className="sm:block">Total das faturas</span>
              <span className="mx-1.5 text-muted-foreground/40 sm:hidden" aria-hidden>
                ·
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(invoiceSummary.gross)}
              </span>
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
      {!isLoading && visiblePeople.length > 0 && (
        <div>
          {/*
            Mesma anatomia do cabeçalho de Faturas: título + resumo da seção à
            esquerda, informação complementar à direita, lista logo abaixo.

            A competência saiu do título — o seletor global da página já a
            exibe, e repeti-la aqui não acrescentava nada. "neste mês" também
            não serve: o universo em aberto pode carregar pendências
            anteriores, então a frase seria imprecisa além de redundante.
          */}
          <div className={SECTION_HEADER_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              Acertos com pessoas
              {peopleSummaryParts.length > 0 && (
                <span className="font-normal text-muted-foreground">
                  {peopleSummaryParts.map((part) => (
                    <span key={part.side}>
                      <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                        ·
                      </span>
                      <span
                        className={cn(
                          'font-medium',
                          part.side === 'receivable'
                            ? 'text-receivable'
                            : 'text-destructive',
                        )}
                      >
                        {formatCurrency(part.amount)}
                      </span>{' '}
                      {part.side === 'receivable' ? 'a receber' : 'a pagar'}
                    </span>
                  ))}
                </span>
              )}
            </h2>

            {/*
              O saldo é consolidado INFORMATIVO da relação com pessoas: não
              abate `totalToPay` nem qualquer obrigação (Fase 9B).
            */}
            <p className={SECTION_ASIDE_CLASS} aria-label={peopleSummaryAria}>
              <span className="sm:block">Saldo em aberto</span>
              <span className="mx-1.5 text-muted-foreground/40 sm:hidden" aria-hidden>
                ·
              </span>
              <span
                className={cn(
                  'font-medium tabular-nums',
                  peopleSummaryDirection === 'receive' && 'text-receivable',
                  peopleSummaryDirection === 'pay' && 'text-destructive',
                )}
              >
                {peopleSummaryBalance}
              </span>
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
            {visiblePeople.map((person) => {
              /*
                Mesma anatomia das Faturas, pelo mesmo componente: ícone
                tonal, nome, badge de estado, valor e seta.

                Os rótulos "Saldo em aberto" / "Nada em aberto" saíram de cada
                linha — a badge comunica o estado e o cabeçalho da seção já dá
                o contexto. Repeti-los em toda linha era o que deixava a
                tabela verbosa.
              */
              const view = peopleRowView(person, formatCurrency)
              const quitado = view.status === 'settled'

              return (
                <StatusListRow
                  key={person.personId}
                  href={`/persons?personId=${person.personId}&period=${monthKey}`}
                  icon={User}
                  tone={
                    quitado
                      ? 'positive'
                      : view.direction === 'out'
                        ? 'negative'
                        : 'neutral'
                  }
                  title={person.personName}
                  badge={{
                    label: peopleRowStatusLabel(view.status),
                    className: quitado
                      ? 'bg-paid/15 text-paid'
                      : 'bg-primary/15 text-primary',
                  }}
                  subtitle={
                    view.metadata.length > 0 ? (
                      <span aria-label={peopleRowAriaLabel(person, formatCurrency)}>
                        {view.metadata.join(' · ')}
                      </span>
                    ) : undefined
                  }
                  amount={quitado ? view.amount : Math.abs(view.amount)}
                />
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

      <SalaryHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} />

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

'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Users, Loader2, TriangleAlert, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContextHeading } from '@/components/ui/context-heading'
import { Skeleton } from '@/components/ui/skeleton'
import { periodFromDate, useMonthPeriod } from '@/components/month-nav'
import { MotionRow } from '@/components/ui/motion-row'
import { financialDrawerRowSurfaceClass } from '@/components/ui/financial-drawer-row-surface'
import { FinancialRowList } from '@/components/ui/drawer-section'
import {
  FinancialListRow,
  FinancialRowTrailing,
  ROW_AMOUNT_TONE,
  ROW_ICON_BG_CLASS,
  ROW_ICON_CLASS,
  ROW_INACTIVE_TRAILING_CLASS,
} from '@/components/ui/financial-list-row'
import { nextItemLabel } from '@/lib/person-next-item'
import {
  personRowsCycle,
  sortPersonRowsForMonth,
} from '@/lib/person-month-order'
import { PERSON_MONTH_SECTION_ORDER, PERSON_MONTH_SECTION_TITLE, groupPersonMonthRows } from '@/lib/person-month-sections'
import {
  PERSON_ROW_LABEL,
  PERSON_ROW_TONE,
  personCompactBalanceLabel,
  personSectionNetLabel,
  personAmountTone,
  personRowAmount,
  personRowStatus,
  peopleMonthSummaryStatus,
  rowLabelDirection,
  rowSubtext,
  rowSubtextTone,
} from '@/lib/person-period-view'
import { formatCurrency, formatMonthOfYear } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import {
} from '@/services/debts.service'
import {
  getPersons,
  getPerson,
  getPersonsMonthlySummary,
  createPerson,
} from '@/services/persons.service'
import { detailHref, liveLocation } from '@/lib/detail-navigation'
import { useDetailEntity } from '@/lib/use-detail-entity'
import {
} from '@/services/receivables.service'
import {
} from '@/lib/person-settlement-view'
import {
} from '@/lib/person-statement'
import { PersonStatementDrawer } from '@/components/person-statement-drawer'
import { PersonFormSheet } from '@/components/person-form-sheet'
import { accountToday } from '@/lib/date'
import { resolvePersonTargetId } from '@/lib/person-detail-state'
import { useAuth } from '@/providers/auth-provider'

// ─── Statement sheet ─────────────────────────────────────────────────────────

/**
 * Uma linha de pendência ou de histórico no extrato da pessoa.
 *
 * As duas listas (cobranças e dívidas) tinham blocos JSX quase idênticos
 * repetidos inline, divergindo só no sinal, na cor e nos rótulos de ação.
 */



// ─── Person form sheet ────────────────────────────────────────────────────────

const VAZIO = {
  netBalance: 0,
  receivablePending: 0,
  debtPending: 0,
  overdueReceivablePending: 0,
  overdueDebtPending: 0,
  overdueNextItem: null,
  periodReceivableTotal: 0,
  periodDebtTotal: 0,
  settledReceivablesCount: 0,
  settledDebtsCount: 0,
  nextItem: null,
  settledAt: null,
} as const

export default function PersonsPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const today = useMemo(() => accountToday(user?.timeZone ?? null), [user?.timeZone])
  const searchParams = useSearchParams()
  const periodParam = searchParams.get('period')

  const [formOpen, setFormOpen] = useState(false)

  /*
    ══════════════════════════════════════════════════════════════════════
    A pessoa aberta vive na URL — mas `personId` NÃO é detail param global
    ══════════════════════════════════════════════════════════════════════

    O mesmo nome tem dois significados no Cartero. AQUI ele identifica o
    extrato aberto; em Dívidas ele FILTRA a lista por contraparte. Pôr
    `personId` em `DETAIL_PARAMS` faria a foundation apagá-lo ao abrir uma
    dívida — o filtro sumiria sozinho, e a O4.1 validou justamente o
    contrário.

    Por isso a navegação daqui é local, sem `useDetailNavigation`. É o mesmo
    caminho que o Orçamento já seguia para os drawers de pessoa e fatura:
    exclusividade contextual, decidida pela rota que conhece a semântica.

    O resto do contrato é idêntico ao das outras cinco entidades — abrir com
    `push` (o Voltar precisa fechar), fechar com `replace` (senão o Voltar
    logo após fechar reabriria o que o usuário dispensou), `scroll: false`
    nos dois, e todos os demais params preservados.
  */
  const router = useRouter()
  const pathname = usePathname()
  /*
    Espelho local, SEM effect: a UI fecha sem depender de o router propagar a
    troca de query numa rota estática.

    Contadores de INTENÇÃO, não a query fechada: reabrir a mesma pessoa produz
    uma query idêntica à guardada, e a versão anterior mantinha o drawer
    fechado — enquanto abrir outra funcionava. O que distingue um fechamento é
    o momento.
  */
  /*
    O espelho guarda QUEM foi dispensado, não um contador global: um cleanup
    de id inválido fecha sem abertura correspondente, e um contador engoliria
    a próxima abertura legítima.
  */
  const [dispensa, setDispensa] = useState<{
    id: string | null
    geracao: number
  } | null>(null)
  const [pedidos, setPedidos] = useState(0)
  const personIdParam = searchParams.get('personId')
  const [pendingPersonId, setPendingPersonId] = useState<string | null>(null)
  const [observedPersonId, setObservedPersonId] = useState(personIdParam)

  if (observedPersonId !== personIdParam) {
    setObservedPersonId(personIdParam)
    if (pendingPersonId === personIdParam) setPendingPersonId(null)
  }

  const openPersonId = resolvePersonTargetId(
    personIdParam,
    pendingPersonId,
    dispensa?.id ?? null,
    dispensa?.geracao ?? -1,
    pedidos,
  )

  const openPerson = (id: string) => {
    setPendingPersonId(id)
    setPedidos((n) => n + 1)
    const next = new URLSearchParams(searchParams.toString())
    next.set('personId', id)
    router.push(detailHref(pathname, next), { scroll: false })
  }

  const closePerson = () => {
    setPendingPersonId(null)
    /*
      `replaceState`, não `router.replace`: `/persons` é rota ESTÁTICA, e uma
      troca só de query aponta para a mesma entrada do cache do App Router —
      o Next descarta a atualização, a URL não muda e o drawer fica preso.
      Era o bug do link direto. Mesma correção de `useDetailNavigation`.
    */
    const atual = liveLocation({
      path: pathname,
      search: searchParams.toString(),
    })
    const next = new URLSearchParams(atual.search)
    if (!next.has('personId')) return
    next.delete('personId')

    setDispensa({
      id: new URLSearchParams(atual.search).get('personId'),
      geracao: pedidos,
    })

    if (typeof window !== 'undefined') {
      window.history.replaceState(
        window.history.state,
        '',
        detailHref(atual.path, next),
      )
    } else {
      router.replace(detailHref(atual.path, next), { scroll: false })
    }
  }

  /*
    ── A competência é GLOBAL ──

    A mesma de Extrato, Orçamento, Dívidas e A Receber: quem governa é a barra
    superior, e o seletor aparece lá porque `/persons` entrou em
    `MONTH_SCOPED_ROUTES`.

    A versão anterior mantinha um `useState` próprio aqui, com um `MonthNav`
    dentro do conteúdo. Funcionava, mas criava uma segunda linha do tempo:
    escolher agosto no Extrato e navegar para Pessoas caía no mês corrente de
    novo, porque eram dois estados para a mesma pergunta.

    Sem cópia local: a página LÊ a fonte canônica direto, e o drawer recebe
    exatamente esse valor.
  */
  const { period, setPeriod } = useMonthPeriod()

  /*
    `?period=YYYY-MM` continua honrado — o Orçamento linka para cá levando a
    competência que o usuário estava analisando.

    Ele APLICA à fonte global em vez de alimentar um estado paralelo, e só na
    chegada: reaplicar a cada render devolveria o usuário ao mês da URL toda
    vez que ele tentasse navegar. Mesmo padrão do Extrato.
  */
  const urlPeriodApplied = useRef(false)

  useEffect(() => {
    if (urlPeriodApplied.current) return
    if (!periodParam) return
    urlPeriodApplied.current = true
    const next = periodFromDate(`${periodParam}-01`)
    if (next.month !== period.month || next.year !== period.year) setPeriod(next)
  }, [periodParam, period.month, period.year, setPeriod])

  /*
    Saldos do mês, em UMA requisição para a lista inteira.

    Chave por competência: trocar de mês busca o mês novo sem descartar o
    anterior do cache.
  */
  const {
    data: balances,
    isLoading: balancesLoading,
    isError: balancesError,
    isFetching: balancesFetching,
    refetch: refetchBalances,
  } = useQuery({
    queryKey: ['persons', 'monthly-summary', period],
    queryFn: () => getPersonsMonthlySummary(period),
  })

  const {
    data: persons = [],
    isLoading,
    isError,
    isSuccess,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  /*
    A pessoa do extrato, resolvida a partir do id da URL.

    Isto substitui o efeito de chegada que copiava o param para um
    `statementPerson` local e marcava `openedFromUrl` para nunca mais olhar.
    Aquilo abria o extrato UMA vez: o param virava semente e parava de
    mandar, então Voltar não fechava, refresh perdia a pessoa e clicar numa
    linha não escrevia a URL.

    A lista já carregada resolve o clique sem requisição; a busca por id
    cobre link direto e refresh. Id que não resolve limpa o param.
  */
  const { entity: statementPerson } = useDetailEntity({
    openId: openPersonId,
    fromList: persons.find((p) => p.id === openPersonId),
    fetchById: getPerson,
    queryKey: 'person',
    onNotFound: closePerson,
  })

  const createMut = useMutation({
    mutationFn: ({ name, phone }: { name: string; phone: string }) =>
      createPerson({ name, phone: phone || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      setFormOpen(false)
      toast.success('Pessoa criada')
    },
    onError: () => toast.error('Erro ao criar pessoa — tente novamente'),
  })

  async function handleFormSubmit(name: string, phone: string) {
    await createMut.mutateAsync({ name, phone })
  }

  /* Acesso por id — a lista de contatos e a de saldos vêm de queries distintas. */
  const balanceById = useMemo(
    () => new Map((balances ?? []).map((b) => [b.id, b])),
    [balances],
  )

  /**
   * A lista, por importância.
   *
   * `GET /persons` não define `orderBy`, então a ordem vinha do Postgres —
   * sem contrato. Na prática quem tinha "R$ 0,00 · SEM SALDO" aparecia antes
   * de quem tinha cobrança atrasada.
   *
   * O join com os saldos acontece aqui porque a urgência vive neles: o
   * contato sozinho não sabe quando algo vence. `nextItem` é o MESMO campo
   * que produz o subtexto da row — ordenar por outro faria a lista parecer
   * embaralhada.
   */
  const orderedPersons = useMemo(() => {
    if (balancesLoading) return persons

    /*
      ── A ordem depende do mês ──

      No corrente/futuro a pergunta é "quem precisa da minha atenção?" e a
      resposta é urgência. Num mês encerrado nada mais vai vencer, e essa
      pergunta não tem resposta: a lista caía em ordem alfabética. O passado
      pergunta "quem movimentou mais dinheiro?".

      O ciclo vem de `monthCycleOf`, o mesmo helper de Bancos.
    */
    return sortPersonRowsForMonth(
      persons.map((person) => {
        const balance = balanceById.get(person.id) ?? VAZIO
        return {
          ...person,
          netBalance: balance.netBalance,
          nextItem: balance.nextItem,
          receivablePending: balance.receivablePending,
          debtPending: balance.debtPending,
          periodReceivableTotal: balance.periodReceivableTotal,
          periodDebtTotal: balance.periodDebtTotal,
          settledReceivablesCount: balance.settledReceivablesCount,
          settledDebtsCount: balance.settledDebtsCount,
        }
      }),
      personRowsCycle(period, today),
      today,
    )
  }, [persons, balanceById, balancesLoading, period, today])

  const personSections = useMemo(
    () => groupPersonMonthRows(orderedPersons.map((person) => ({
      person,
      balance: balanceById.get(person.id) ?? VAZIO,
    }))),
    [orderedPersons, balanceById],
  )

  /* O topo agrega os dois lados em aberto do lote mensal, sem compensá-los. */
  const summary = useMemo(() => {
    let openToReceive = 0
    let openToPay = 0

    for (const b of balances ?? []) {
      openToReceive += b.receivablePending
      openToPay += b.debtPending
    }

    return { openToReceive, openToPay }
  }, [balances])
  const summaryStatus = peopleMonthSummaryStatus(balances ?? [])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ContextHeading
          className="min-w-min flex-1"
          level={1}
          title="Pessoas"
          description="Contatos vinculados a dívidas e cobranças"
          infoLabel="Sobre Pessoas"
          infoContent="Vincule pessoas a valores a pagar e a receber. Abra uma pessoa para acompanhar pendências e o histórico relacionado ao mês."
        />
        <Button
          className="shrink-0"
          onClick={() => {
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" />
          Nova pessoa
        </Button>
      </div>

      <div>
        <p className="text-[11px] font-medium text-muted-foreground">
          Valores em aberto com pessoas de {formatMonthOfYear(period.month, period.year)}
        </p>
        {balancesLoading ? (
          <Skeleton className="mt-1.5 h-7 w-32" />
        ) : balancesError ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Não foi possível calcular os saldos do mês.
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="text-[11px] text-muted-foreground">A receber em aberto</p>
                <p className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{formatCurrency(summary.openToReceive)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">A pagar em aberto</p>
                <p className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{formatCurrency(summary.openToPay)}</p>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Saldo líquido em aberto: {summary.openToReceive - summary.openToPay >= 0 ? '+' : '−'}{formatCurrency(Math.abs(summary.openToReceive - summary.openToPay))}
            </p>
            {summaryStatus && <p className={cn('mt-0.5 text-[11px]', summaryStatus.tone)}>{summaryStatus.label}</p>}
          </>
        )}
      </div>

      {/* List */}
      <div>
        {isLoading || balancesLoading ? (
          <div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                /* Mesma geometria da row real — senão a lista salta ao carregar. */
                className="flex items-center gap-3 border-b border-border py-3.5 last:border-b-0 sm:gap-4 sm:px-2 sm:py-4"
              >
                <Skeleton className="size-10 shrink-0 rounded-xl sm:size-11 sm:rounded-2xl" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : isError || balancesError ? (
          /*
            Erro não é lista vazia.

            Sem este ramo, a API fora do ar mostrava "Nenhuma pessoa
            cadastrada" — o app afirmando que o usuário não tem contatos
            quando só não conseguiu buscá-los.
          */
          <div
            role="alert"
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-destructive/10">
              <TriangleAlert className="size-5 text-destructive/70" aria-hidden />
            </div>
            <p className="text-sm font-medium">
              {balancesError ? 'Não foi possível carregar os saldos do mês' : 'Não foi possível carregar as pessoas'}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Verifique sua conexão e tente novamente.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-5 gap-1.5"
              disabled={isFetching || balancesFetching}
              onClick={() => { void refetch(); void refetchBalances() }}
            >
              {isFetching || balancesFetching ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              {isFetching || balancesFetching ? 'Carregando…' : 'Tentar novamente'}
            </Button>
          </div>
        ) : isSuccess && persons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted/50">
              <Users className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Nenhuma pessoa cadastrada</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Cadastre contatos para vincular dívidas e cobranças a pessoas específicas.
            </p>
          </div>
        ) : (
          <div className="space-y-6 pt-2 pb-5">
            {PERSON_MONTH_SECTION_ORDER.filter((section) => personSections.groups[section].length > 0).map((section) => (
              <section key={section} className="space-y-2" aria-labelledby={`persons-${section}`}>
                <h2 id={`persons-${section}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm font-medium">
                  <span>{PERSON_MONTH_SECTION_TITLE[section]}</span>
                  {section !== 'empty' && (
                    <span className={cn('ml-auto text-right text-xs font-medium sm:text-sm', ROW_AMOUNT_TONE.neutral)}>
                      {personSectionNetLabel(personSections.totals[section].receive, personSections.totals[section].pay, section === 'history' ? 'history' : 'open')}
                    </span>
                  )}
                </h2>
                <FinancialRowList variant="page" spaced>
                    {personSections.groups[section].map(({ person, balance }, i) => {

              /*
                ── O valor depende do MODO ──

                ACTIVE  → outstanding: "quanto ainda falta acertar"
                SETTLED → histórico:   "qual foi o saldo do mês"

                A fase anterior exibia sempre o histórico, para não perder o
                valor do mês quando tudo era quitado. Certo no fim, cedo demais
                no meio: com R$ 500 a receber e R$ 300 já recebidos, a row
                seguia dizendo R$ 500 quando o número útil era R$ 200.

                O rótulo histórico (RECEBIDO/PAGO/SALDO) sinaliza
                a troca de base, senão quitar o último item faria o valor SUBIR
                e pareceria bug.
              */
              const status = personRowStatus(balance)
              const net = personRowAmount(balance)
              const displayItem = section === 'overdue' ? balance.overdueNextItem : balance.nextItem
              const rowReceive = section === 'history' ? balance.periodReceivableTotal : balance.receivablePending
              const rowPay = section === 'history' ? balance.periodDebtTotal : balance.debtPending

              /*
                Resolvido não tem subtexto.

                A versão anterior trocava o prazo por "Recebido" — mas o
                trailing já diz RECEBIDO, e a row repetia o mesmo estado duas
                vezes. Omitir é o certo: o prazo de uma pendência inexistente
                seria falso, e repetir a conclusão não informa.
              */
              const proximoAcerto = rowSubtext(
                status,
                /*
                  O verbo sai do STATUS: uma row bilateral net-zero diz
                  `Acertar em 7d`, não `Receber`/`Pagar` — o trailing acabou de
                  afirmar que nenhum lado manda. A DATA continua a do item mais
                  urgente, escolhida pela policy de sempre.
                */
                nextItemLabel(
                  displayItem,
                  today,
                  section === 'overdue' ? displayItem?.direction : rowLabelDirection(status, displayItem),
                ),
                balance.settledAt,
              )
              /*
                O tom segue o ESTADO da row, não só o prazo.

                Resolvido usa o verde de conclusão — o mesmo do trailing e o
                mesmo que Bancos aplica ao "Venceu em" de uma fatura paga.
                Antes saía neutro, e a row ficava meio-concluída: "Quitado em
                18/08" em cinza ao lado de `PAGO` em verde.

                Aberto mantém a régua canônica de urgência (vermelho no
                atraso, âmbar em ≤7 dias, neutro no resto).
              */
              const prazoTone = rowSubtextTone(status, displayItem)

              /*
                ── O valor é NEUTRO ──

                Era verde/vermelho pela direção do dinheiro. Mas verde já
                significa "resolvido" no resto do produto, e um recebível em
                aberto saía da mesma cor de um já recebido — dois estados que
                pedem ações opostas.

                A direção fica no rótulo compacto sob o valor. Mesmo princípio
                de Bancos, onde o valor da fatura não tem cor e o status carrega
                o significado.
              */
              /*
                O tom vem do MODO, não do valor.

                Era `Math.abs(net) <= 0.005`: uma pessoa com R$ 200 abertos de
                cada lado exibe R$ 0,00 e saía cinza, visualmente igual a quem
                nunca teve relação nenhuma. Só ausência é muted.
              */
              const tone = ROW_AMOUNT_TONE[personAmountTone(status)]

              const label = PERSON_ROW_LABEL[status]
              const labelTone = PERSON_ROW_TONE[status]
              const isEmpty = !balancesLoading && !balancesError && status === 'empty'
              const compactLabel = isEmpty ? label : personCompactBalanceLabel(rowReceive, rowPay, section === 'history' ? 'history' : 'open')

              return (
              <MotionRow key={person.id} index={i} separator={false} className={financialDrawerRowSurfaceClass('animatedWrapper')}>
                <div className="group relative">
                  <FinancialListRow
                    variant="page"
                    onView={() => openPerson(person.id)}
                    ariaLabel={`Ver extrato de ${person.name}`}
                    leading={
                      /*
                        A inicial escala junto com o container, como o glyph
                        do Extrato (`size-4.5 sm:size-5`). Era `text-sm` fixo:
                        no desktop o container cresce para 44px e a letra
                        ficava pequena dentro dele.
                      */
                      <div
                        className={cn(
                          ROW_ICON_CLASS,
                          ROW_ICON_BG_CLASS,
                          'text-sm font-semibold sm:text-[15px]',
                        )}
                      >
                        {person.name[0].toUpperCase()}
                      </div>
                    }
                    title={person.name}
                    /*
                      O próximo acerto, quando existe.

                      A linha dizia quanto e não dizia quando: uma cobrança
                      vencida há três dias ficava idêntica a outra que só vence
                      no fim do mês. `null` é resultado legítimo — pessoa sem
                      pendência fica sem subtexto, em vez de exibir "Sem
                      pendências", que ocupa a linha para não dizer nada.
                    */
                    meta={
                      proximoAcerto ? (
                        <span
                          className={cn(
                            'truncate',
                            /*
                              Atraso em vermelho, prazo curto em âmbar, o resto
                              muted — a régua de `timingUrgency`, não uma
                              escolha local.
                            */
                            prazoTone,
                          )}
                        >
                          {proximoAcerto}
                        </span>
                      ) : null
                    }
                    trailing={
                      /*
                        Sem valor enquanto os saldos não chegaram: mostrar
                        R$ 0,00 e trocar depois afirmaria um fato que ainda
                        não sabemos — o mesmo flicker corrigido em Bancos.
                      */
                      balancesLoading ? (
                        <Skeleton className="h-5 w-20" />
                      ) : isEmpty ? (
                        <span className={ROW_INACTIVE_TRAILING_CLASS}>
                          {label}
                        </span>
                      ) : (
                        <FinancialRowTrailing amount={formatCurrency(net)} label={compactLabel} amountTone={tone} labelTone={labelTone} />
                      )
                    }
                  />

                </div>
              </MotionRow>
              )
                    })}
                </FinancialRowList>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Person form sheet */}
      <PersonFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editTarget={null}
        onSubmit={handleFormSubmit}
      />

      {/*
        Remonta ao trocar de pessoa (e ao fechar): as tarefas do extrato —
        quitar pendências, marcar item como pago — vivem dentro do drawer,
        que é router-agnostic e não reporta "tarefa aberta" para cá. Sem a
        `key`, o Voltar tiraria o `personId` da URL e o diálogo continuaria
        sobre a lista, preso a uma pessoa que já não está aberta.
      */}
      <PersonStatementDrawer
        key={openPersonId ?? 'none'}
        person={statementPerson}
        open={openPersonId !== null}
        onClose={closePerson}
        period={period}
      />

    </div>
  )
}

'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Users, Loader2, MoreVertical, TriangleAlert, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { periodFromDate, useMonthPeriod } from '@/components/month-nav'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MotionRow } from '@/components/ui/motion-row'
import {
  FinancialListRow,
  ROW_AMOUNT_CLASS,
  ROW_AMOUNT_TONE,
  ROW_ICON_BG_CLASS,
  ROW_TRAILING_LABEL_CLASS,
  ROW_ICON_CLASS,
} from '@/components/ui/financial-list-row'
import { nextItemLabel } from '@/lib/person-next-item'
import {
  personRowsCycle,
  sortPersonRowsForMonth,
} from '@/lib/person-month-order'
import { personsSummaryLines } from '@/lib/persons-summary-text'
import {
  hasOpenObligation,
  hasPeriodActivity,
  PERSON_ROW_LABEL,
  PERSON_ROW_TONE,
  personAmountTone,
  personRowAmount,
  personRowStatus,
  rowSubtext,
  rowSubtextTone,
} from '@/lib/person-period-view'
import { formatCurrency } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
} from '@/services/debts.service'
import {
  getPersons,
  getPerson,
  getPersonsMonthlySummary,
  createPerson,
  updatePerson,
  deletePerson,
} from '@/services/persons.service'
import { detailHref } from '@/lib/detail-navigation'
import { useDetailEntity } from '@/lib/use-detail-entity'
import {
} from '@/services/receivables.service'
import {
} from '@/lib/person-settlement-view'
import {
} from '@/lib/person-statement'
import { PersonStatementDrawer } from '@/components/person-statement-drawer'
import type { Person } from '@/types'

// ─── Statement sheet ─────────────────────────────────────────────────────────

/**
 * Uma linha de pendência ou de histórico no extrato da pessoa.
 *
 * As duas listas (cobranças e dívidas) tinham blocos JSX quase idênticos
 * repetidos inline, divergindo só no sinal, na cor e nos rótulos de ação.
 */



// ─── Person form sheet ────────────────────────────────────────────────────────

function PersonFormSheet({
  open,
  onOpenChange,
  editTarget,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editTarget: Person | null
  onSubmit: (name: string, phone: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editTarget?.name ?? '')
      setPhone(editTarget?.phone ?? '')
    }
  }, [open, editTarget])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(name.trim(), phone.trim())
      setName('')
      setPhone('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        Largura e scroll alinhados aos outros drawers (`sm:max-w-md`).

        Com `sm:max-w-sm` e um form sem `overflow-y-auto`, em notebook o
        conteúdo empurrava o footer para fora da área visível — o botão de
        salvar ficava inalcançável.
      */}
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{editTarget ? 'Editar pessoa' : 'Nova pessoa'}</SheetTitle>
          <SheetDescription>
            {editTarget ? 'Atualize o nome.' : 'Cadastre um contato para vincular dívidas e cobranças.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="person-form"
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              placeholder="Ex: Fabricio, Maria..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">WhatsApp (opcional)</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="Ex: (85) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Inclua o DDD. O código do Brasil (+55) será adicionado automaticamente.
            </p>
          </div>
        </form>

        <SheetFooter className="shrink-0 border-t border-border/60 px-6 pb-6 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" form="person-form" disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {editTarget ? 'Salvar' : 'Criar pessoa'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Balanço neutro para contato sem linha no lote.
 *
 * Acontece enquanto os saldos carregam, e para quem foi criado depois da
 * resposta. Zerar tudo é o estado honesto: nada foi movimentado que saibamos.
 */
const VAZIO = {
  netBalance: 0,
  /* Nada em aberto dos dois lados — é o que faz a row cair em EMPTY. */
  receivablePending: 0,
  debtPending: 0,
  periodReceivableTotal: 0,
  periodDebtTotal: 0,
  settledReceivablesCount: 0,
  settledDebtsCount: 0,
  nextItem: null,
  /* Sem movimento, nada terminou: não há data de conclusão a afirmar. */
  settledAt: null,
} as const

export default function PersonsPage() {
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const periodParam = searchParams.get('period')

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Person | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null)

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
  const openPersonId = searchParams.get('personId')

  const openPerson = (id: string) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set('personId', id)
    router.push(detailHref(pathname, next), { scroll: false })
  }

  const closePerson = () => {
    if (!openPersonId) return
    const next = new URLSearchParams(searchParams.toString())
    next.delete('personId')
    router.replace(detailHref(pathname, next), { scroll: false })
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

  const updateMut = useMutation({
    mutationFn: ({ id, name, phone }: { id: string; name: string; phone: string }) =>
      updatePerson(id, { name, phone: phone || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      setFormOpen(false)
      setEditTarget(null)
      toast.success('Pessoa atualizada')
    },
    onError: () => toast.error('Erro ao salvar — tente novamente'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePerson(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      toast.success('Pessoa removida')
    },
    onError: () => toast.error('Erro ao remover — tente novamente'),
  })

  async function handleFormSubmit(name: string, phone: string) {
    if (editTarget) {
      await updateMut.mutateAsync({ id: editTarget.id, name, phone })
    } else {
      await createMut.mutateAsync({ name, phone })
    }
  }

  function handleEdit(person: Person) {
    setEditTarget(person)
    setFormOpen(true)
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
      personRowsCycle(period),
    )
  }, [persons, balanceById, balancesLoading, period])

  /*
    ── O resumo sai das MESMAS linhas ──

    Derivado no cliente, não pedido ao backend: todas as rows já chegaram
    completas na mesma resposta, então somá-las é determinístico e um segundo
    contrato só criaria uma fonte a mais para divergir.

    Positivo entra em "a receber", negativo em "a pagar" pelo valor absoluto,
    zero não move nada. É agregação VISUAL — não compensa pessoas entre si,
    não quita e não escreve nada.
  */
  const summary = useMemo(() => {
    /*
      ══════════════════════════════════════════════════════════════════════
      O resumo segue o MESMO modo da lista
      ══════════════════════════════════════════════════════════════════════

      ACTIVE  → outstanding: "quanto ainda falta acertar no mês"
      SETTLED → histórico:   "quanto o mês movimentou"

      Somava sempre o histórico, então uma competência com R$ 500 a receber e
      R$ 300 já recebidos anunciava R$ 500 — o mesmo desencontro que a row
      tinha. E media pendência por `Math.abs(netBalance)`, que é zero quando
      há R$ 200 abertos de cada lado.

      Os totais por LADO, não pelo líquido de cada pessoa: quem tem R$ 500 a
      receber e R$ 200 a pagar contribui com os dois números, não com R$ 300
      num deles.
    */
    let outstandingReceber = 0
    let outstandingPagar = 0
    let historicoReceber = 0
    let historicoPagar = 0
    let comPendencia = 0
    let comMovimento = 0

    for (const b of balances ?? []) {
      outstandingReceber += b.receivablePending
      outstandingPagar += b.debtPending
      historicoReceber += b.periodReceivableTotal
      historicoPagar += b.periodDebtTotal
      if (hasOpenObligation(b)) comPendencia += 1
      if (hasPeriodActivity(b)) comMovimento += 1
    }

    /*
      Uma pendência em qualquer pessoa mantém o resumo em ACTIVE: o mês só
      terminou de ser acertado quando ninguém tem nada aberto.
    */
    const ativo = comPendencia > 0
    const toReceive = ativo ? outstandingReceber : historicoReceber
    const toPay = ativo ? outstandingPagar : historicoPagar

    return {
      toReceive,
      toPay,
      net: toReceive - toPay,
      /*
        A contagem, não a soma dos líquidos: R$ 200 de cada lado dá líquido
        zero com duas obrigações vivas, e "Tudo em dia" ali seria falso.
      */
      outstanding: comPendencia,
      /* Distingue "nenhum movimento" de "tudo resolvido". */
      comMovimento,
    }
  }, [balances])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pessoas</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Contatos vinculados a dívidas e cobranças
          </p>
        </div>
        <Button
          onClick={() => {
            setEditTarget(null)
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" />
          Nova pessoa
        </Button>
      </div>

      {/*
        Resumo do mês.

        O seletor mensal NÃO vive aqui: ele está na barra superior, com o das
        outras páginas mensais. O `sm:flex-row sm:justify-between` que este
        bloco tinha existia só para acomodá-lo ao lado — sem ele, o resumo
        ocupa a própria linha.
      */}
      <div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Saldo com pessoas
          </p>
          {/*
            "Saldo" sozinho seria confundido com saldo bancário; o rótulo diz
            de qual universo estamos falando.
          */}
          {balancesLoading ? (
            <Skeleton className="mt-1.5 h-7 w-32" />
          ) : balancesError ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Não foi possível calcular os saldos do mês.
            </p>
          ) : (
            <>
              {/*
                Neutro, como o total de Bancos.

                Era verde quando positivo e vermelho quando negativo — direção
                do dinheiro pela cor. Mas a direção já está no sinal do número
                e nos componentes abaixo, e o verde ficava indistinguível do
                verde de "tudo resolvido".
              */}
              <p className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
                {formatCurrency(summary.net)}
              </p>
              {personsSummaryLines(summary).map((linha) => (
                <p
                  key={linha.kind}
                  className={cn(
                    'mt-0.5 text-[11px]',
                    /*
                      Só a conclusão ganha cor — o mesmo `text-paid` e o mesmo
                      "Tudo em dia" que Bancos usa. A composição é informação
                      estrutural e fica muted, sem semântica direcional.
                    */
                    linha.kind === 'settled'
                      ? 'font-medium text-paid'
                      : 'text-muted-foreground',
                  )}
                >
                  {linha.text}
                </p>
              ))}
            </>
          )}
        </div>

      </div>

      {/* List */}
      <div className="border-t border-border">
        {isLoading ? (
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
        ) : isError ? (
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
              Não foi possível carregar as pessoas
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Verifique sua conexão e tente novamente.
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
          <div>
            {orderedPersons.map((person, i) => {
              const balance = balanceById.get(person.id) ?? VAZIO

              /*
                ── O valor depende do MODO ──

                ACTIVE  → outstanding: "quanto ainda falta acertar"
                SETTLED → histórico:   "qual foi o saldo do mês"

                A fase anterior exibia sempre o histórico, para não perder o
                valor do mês quando tudo era quitado. Certo no fim, cedo demais
                no meio: com R$ 500 a receber e R$ 300 já recebidos, a row
                seguia dizendo R$ 500 quando o número útil era R$ 200.

                A troca é sinalizada pelo trailing (`SALDO FINAL`), senão
                quitar o último item faria o valor SUBIR e pareceria bug.
              */
              const status = personRowStatus(balance)
              const net = personRowAmount(balance)

              /*
                Resolvido não tem subtexto.

                A versão anterior trocava o prazo por "Recebido" — mas o
                trailing já diz RECEBIDO, e a row repetia o mesmo estado duas
                vezes. Omitir é o certo: o prazo de uma pendência inexistente
                seria falso, e repetir a conclusão não informa.
              */
              const proximoAcerto = rowSubtext(
                status,
                nextItemLabel(balance.nextItem),
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
              const prazoTone = rowSubtextTone(status, balance.nextItem)

              /*
                ── O valor é NEUTRO ──

                Era verde/vermelho pela direção do dinheiro. Mas verde já
                significa "resolvido" no resto do produto, e um recebível em
                aberto saía da mesma cor de um já recebido — dois estados que
                pedem ações opostas.

                A direção continua dita pelo sinal do valor e pelo texto do
                trailing. Mesmo princípio de Bancos, onde o valor da fatura não
                tem cor e o status carrega o significado.
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

              return (
              <MotionRow key={person.id} index={i}>
                {/*
                  Row e kebab são IRMÃOS, no padrão de Bancos: aninhar um
                  `button` dentro de outro é HTML inválido e quebra teclado.
                  O menu se sobrepõe à direita.

                  Editar/Excluir de Pessoa continuam onde estavam — mover
                  essas ações para um drawer não faz parte desta tarefa.
                */}
                <div className="group relative border-b border-border last:border-b-0">
                  <FinancialListRow
                    onView={() => openPerson(person.id)}
                    ariaLabel={`Ver extrato de ${person.name}`}
                    /* Espaço à direita para o kebab sobreposto não cobrir o valor. */
                    className="pr-10 sm:pr-12"
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
                          'text-sm font-semibold text-muted-foreground sm:text-[15px]',
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
                      ) : (
                        <>
                          <span className={cn(ROW_AMOUNT_CLASS, tone)}>
                            {formatCurrency(net)}
                          </span>
                          <span className={cn(ROW_TRAILING_LABEL_CLASS, labelTone)}>
                            {label}
                          </span>
                        </>
                      )
                    }
                  />

                  <div className="absolute top-1/2 right-1 -translate-y-1/2">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={`Mais opções de ${person.name}`}
                      >
                        <MoreVertical className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(person)}>
                          <Pencil className="size-3.5" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(person)} className="text-destructive focus:text-destructive">
                          <Trash2 className="size-3.5" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </MotionRow>
              )
            })}
          </div>
        )}
      </div>

      {/* Person form sheet */}
      <PersonFormSheet
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditTarget(null)
        }}
        editTarget={editTarget}
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

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover pessoa</DialogTitle>
            {/*
              A cópia diz o que de fato acontece.

              O FK `personId` é `ON DELETE SET NULL` em Debt, Receivable e
              Transaction, e o nome da contraparte foi gravado em
              `creditorName`/`debtorName` na criação — então os registros
              sobrevivem E continuam legíveis. Por isso a exclusão é permitida
              mesmo com pendências: ela encerra o cadastro do contato, não os
              compromissos.
            */}
            <DialogDescription>
              Remover{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong>{' '}
              apaga apenas o contato. As dívidas, cobranças e transações
              continuam no histórico, com o nome dela preservado — nenhum valor
              é excluído.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMut.mutate(deleteTarget.id)
                  setDeleteTarget(null)
                }
              }}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

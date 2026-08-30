'use client'

import { useState, useMemo, useEffect } from 'react'
import type React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, Pencil, Plus, ArrowLeft, ChevronDown, CreditCard, Loader2, Archive, ArchiveRestore } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import {
} from '@/components/ui/sheet'
import {
} from '@/components/ui/dialog'
import { MotionRow } from '@/components/ui/motion-row'
import {
} from '@/components/ui/dropdown-menu'
import {
} from '@/services/transactions.service'
import { apiErrorMessage } from '@/lib/api-error'
import {
  getBankInvoices,
  getInvoice,
} from '@/services/invoices.service'
import { useDetailNavigation } from '@/lib/detail-navigation'
import { useDetailEntity } from '@/lib/use-detail-entity'
import { getBank, restoreBank } from '@/services/banks.service'
import {
  formatCurrency,
  formatMonthYear,
} from '@/lib/formatters'
import {
} from '@/lib/invoice-composition'
import { getInvoiceCloseDate, parseInvoiceDate } from '@/lib/invoice-dates'
import {
  INVOICE_STATUS_COLOR,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_SORT_ORDER,
  invoiceStatusConfig,
} from '@/lib/invoice-status'
import type { Invoice, Bank } from '@/types'
import { InvoiceStatus, TransactionType} from '@/types'
import { InvoiceDetailsDrawer } from '@/components/invoice-details-drawer'
import { TransactionSheet, type TransactionFormData } from '@/app/(dashboard)/transactions/transaction-sheet'
import { createTransaction } from '@/services/transactions.service'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { BankSheet, type BankFormData } from '../../bank-sheet'
import { updateBank, archiveBank, deleteBank } from '@/services/banks.service'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

// Rótulo, cor e ordem de status vêm de `@/lib/invoice-status`. Este arquivo
// mantinha a terceira cópia do mapa, mais um `oklch` de âmbar fixo cujo
// comentário afirmava não existir token — quando `--pending` já era esse token.

function statusRowBg(status: InvoiceStatus): React.CSSProperties {
  const c = INVOICE_STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 7%, transparent)` }
}





const ACTIVE_VISIBLE = 3
const PAID_VISIBLE = 1

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Datas de uma fatura REAL, direto do que ela guarda.
 *
 * Antes eram derivadas de `bank.invoiceDueDate` + intervalo, o que fazia as
 * datas de uma fatura paga mudarem quando o cartão era reconfigurado. Agora a
 * fatura é a fonte de verdade e o banco não participa.
 */
function calcCloseDate(invoice: Invoice): string {
  return format(parseInvoiceDate(invoice.closeDate), "dd 'de' MMMM", {
    locale: ptBR,
  })
}

function calcDueDate(invoice: Invoice): string {
  return format(parseInvoiceDate(invoice.dueDate), "dd 'de' MMMM", {
    locale: ptBR,
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ExpandButton({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean
  hiddenCount: number
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex min-h-[44px] w-full items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronDown
        className={cn('size-3.5 shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
        aria-hidden="true"
      />
      {expanded ? 'Ver menos' : `Ver ${hiddenCount} ${hiddenCount === 1 ? 'fatura' : 'faturas'} a mais`}
    </button>
  )
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const { label, className } = invoiceStatusConfig(status)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}

function InvoiceRow({
  invoice,
  bank,
  isSelected,
  isAtual,
  onClick,
}: {
  invoice: Invoice
  bank: Bank | undefined
  isSelected: boolean
  isAtual?: boolean
  onClick: () => void
}) {
  const monthYear = capitalize(formatMonthYear(invoice.month, invoice.year))
  const total = Number(invoice.totalAmount)

  return (
    <button
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`${monthYear} — ${INVOICE_STATUS_LABEL[invoice.status]}${isAtual ? ' — Atual' : ''}`}
      /*
        A fatura ATUAL ganha o mesmo tratamento translúcido do item
        selecionado — `color-mix` a 7%, o padrão que a lista já usa. Um azul
        sólido destoaria; o fundo discreto só diz "é esta aqui".

        Selecionado tem precedência: enquanto o drawer está aberto, a linha
        aberta é a que precisa se distinguir.
      */
      className={cn(
        'group flex w-full items-center gap-4 py-4 text-left transition-colors',
        /*
          A fatura ATUAL é destacada SEM sair do grid.

          A versão anterior usava `mx-1 px-3`: o conteúdo começava a 16px da
          borda enquanto as outras linhas começavam a 8px, e o card parecia
          deslocado para dentro — alinhado com a segunda linha do texto, não
          com a primeira.

          Agora o `px-2` é o mesmo das demais e o destaque vem por FUNDO,
          BORDA e SOMBRA, que não deslocam conteúdo. `-mx-px` compensa
          exatamente a largura da borda, mantendo o texto na mesma coluna
          vertical de todas as linhas.
        */
        'px-2',
        /*
          ── O flicker ao clicar ──

          A condição era `isAtual && !isSelected`. Ao clicar, `isSelected`
          virava true, a fatura atual PERDIA raio, borda e sombra, e caía no
          fundo quadrado de `statusRowBg` — o flash de outro shape por um
          instante.

          Agora a geometria do card pertence a `isAtual` e não depende da
          seleção: raio, borda e recuo permanecem em todos os estados. Só o
          FUNDO reage ao clique, e a transição fica suave porque nada muda de
          forma.
        */
        /*
          O destaque cobre a ROW INTEIRA — mês, badges, datas, valor e seta
          estão todos dentro deste mesmo `<button>`, então o fundo alcança as
          duas extremidades sem nenhum wrapper extra.

          `-mx-px` compensa exatamente a largura da borda: o conteúdo fica na
          mesma coluna vertical das linhas comuns, e as margens esquerda e
          direita ficam simétricas.
        */
        isAtual &&
          '-mx-px rounded-xl border border-primary/40 shadow-md shadow-primary/10',
        /*
          Respiro externo: a fatura atual salta um pouco mais da lista sem
          quebrar o grid — o recuo horizontal continua o mesmo das demais.
        */
        isAtual && 'my-2',
        /*
          Fundo mais presente que antes (12% contra 6%), mas ainda
          translúcido: a fatura atual precisa saltar aos olhos sem virar um
          bloco pesado.

          Todos os estados — normal, hover, aberta — usam o MESMO azul, só
          variando a intensidade. Nada muda de forma, então não há flicker ao
          clicar.
        */
        isAtual
          ? isSelected
            ? 'bg-primary/20'
            : 'bg-primary/[0.12] hover:bg-primary/[0.16]'
          : 'hover:bg-muted/30',
      )}
      /*
        `statusRowBg` só para as linhas COMUNS: na fatura atual ele
        sobrescreveria o fundo translúcido e traria de volta o visual
        quadrado que o card evita.
      */
      style={isSelected && !isAtual ? statusRowBg(invoice.status) : undefined}
    >
      {/* Month + status + dates */}
      <div className="min-w-0 flex-1">
        {/*
          `gap-x-1.5` aproxima as badges do mês: elas qualificam a fatura, e
          o espaço maior as fazia parecer elementos soltos ao lado.
        */}
        {/*
          Entrelinha PADRÃO de volta.

          A tentativa anterior apertou `leading-tight` no título de 15px para
          simular proximidade — mas aqui a leitura pede respiro: são três
          elementos na linha 1 (mês e duas badges) e uma linha de datas
          abaixo. Comprimir a tipografia deixava o bloco denso demais.

          `gap-x-1.5` fica: aproxima as badges do mês sem mexer no vertical.
        */}
        <div className="flex flex-wrap items-center gap-y-1 gap-x-1.5">
          <span className="shrink-0 text-[15px] font-medium">{monthYear}</span>
          <StatusBadge status={invoice.status} />
          {isAtual && (
            /*
              Clara e neutra, destacando-se do badge de status ao lado.

              Translúcida em azul ela se dissolvia no fundo do card — as duas
              badges viravam a mesma mancha. O contraste alto é o que faz
              "Atual" ser lida de relance, que é a função dela.
            */
            <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background">
              Atual
            </span>
          )}
          {/* Junto do título, como em Bancos — o valor fica sozinho à direita. */}
          <DisclosureChevron />
        </div>
        {bank && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="shrink-0">Fecha {calcCloseDate(invoice)}</span>
            <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
            <span className="shrink-0">Vence {calcDueDate(invoice)}</span>
          </div>
        )}
      </div>

      {/* Total */}
      <p
        className={cn(
          'shrink-0 text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
          invoice.status === InvoiceStatus.OVERDUE ? 'text-destructive' : '',
        )}
      >
        {formatCurrency(total)}
      </p>

    </button>
  )
}



/** Categorias mostradas antes de agrupar o resto em "Outras". */


/**
 * Fatias da COMPOSIÇÃO da fatura.
 *
 * Agrupa por categoria própria, e joga toda transação com pessoa vinculada num
 * bucket virtual "De outras pessoas" — ver `invoice-composition.ts`.
 *
 * Antes agrupava tudo pela Category persistida, então uma fatura com R$ 96,50
 * de lazer próprio e um jantar de R$ 240 da Mariana exibia "Lazer R$ 336,50",
 * sugerindo que os R$ 240 eram gasto pessoal de lazer. A responsabilidade
 * econômica é uma dimensão separada da categoria, e o bucket a torna visível
 * sem tocar na Category do banco.
 */



// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BankInvoicesPage() {
  const qc = useQueryClient()
  const params = useParams()
  const router = useRouter()
  const bankId = params.id as string

  /* Criação a partir do estado vazio — o banco já vem do contexto. */
  const [createOpen, setCreateOpen] = useState(false)

  /*
    ── Gerenciamento do banco ──

    Estado e mutations vivem aqui porque o menu vive aqui. `BankSheet` e
    `ConfirmDialog` são os MESMOS componentes usados na listagem — o
    formulário e a confirmação não foram reimplementados.
  */
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const invalidateBank = () => {
    qc.invalidateQueries({ queryKey: ['banks'] })
    qc.invalidateQueries({ queryKey: ['bank', bankId] })
  }

  const updateBankMut = useMutation({
    mutationFn: (data: BankFormData) => updateBank(bankId, data),
    onSuccess: () => {
      invalidateBank()
      setEditOpen(false)
      toast.success('Banco atualizado')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao atualizar banco')),
  })

  const archiveMut = useMutation({
    mutationFn: () => archiveBank(bankId),
    onSuccess: () => {
      invalidateBank()
      setArchiveOpen(false)
      toast.success('Banco arquivado')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao arquivar banco')),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteBank(bankId),
    onSuccess: () => {
      invalidateBank()
      toast.success('Banco excluído')
      /*
        O banco deixou de existir: ficar nesta página deixaria a tela presa
        num registro inexistente. Volta para a listagem, que é a superfície
        válida mais próxima.
      */
      router.push('/banks')
    },
    /*
      Banco com histórico volta com BANK_HAS_HISTORY e uma mensagem que já
      explica o bloqueio — o diálogo fica aberto para o usuário ler.
    */
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao excluir banco')),
  })

  const createTxMut = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      // As mesmas chaves que o drawer invalida: a fatura nasce deste lançamento.
      qc.invalidateQueries({ queryKey: ['bank-invoices', bankId] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setCreateOpen(false)
      toast.success('Transação criada')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Não foi possível criar a transação')),
  })
  /*
    A identidade da fatura aberta vem da URL.

    Antes o `?invoiceId=` era só SEMENTE de chegada: um efeito o copiava para
    `selectedInvoiceId` e a partir dali o param não mandava mais nada. Clicar
    numa fatura não escrevia a URL, então não havia link direto para o painel,
    o refresh perdia o que estava aberto e o Voltar saía da página.
  */
  const detail = useDetailNavigation('invoiceId')

  const [activeExpanded, setActiveExpanded] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const { data: bank } = useQuery({
    queryKey: ['bank', bankId],
    queryFn: () => getBank(bankId),
  })

  /**
   * Restaurar daqui: quem chega numa fatura de um cartão encerrado e decide
   * voltar a usá-lo não deveria ter de navegar até a lista de bancos.
   *
   * Invalida `['banks']` inteiro — o prefixo cobre a lista de ativos, a de
   * arquivados e os selects de lançamento.
   */
  const restoreMut = useMutation({
    mutationFn: restoreBank,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      qc.invalidateQueries({ queryKey: ['bank', bankId] })
      toast.success('Banco restaurado')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao restaurar banco')),
  })


  const {
    data: invoices,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['bank-invoices', bankId],
    queryFn: () => getBankInvoices(bankId),
  })

  const { overdueInvoices, activeInvoices, paidInvoices } = useMemo(() => {
    if (!invoices) return { overdueInvoices: [] as Invoice[], activeInvoices: [] as Invoice[], paidInvoices: [] as Invoice[] }

    const filtered = invoices.filter((i) => Number(i.totalAmount) > 0)

    const overdueInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.OVERDUE)
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))

    const activeInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.CLOSED || i.status === InvoiceStatus.OPEN)
      .sort((a, b) => {
        const sd = INVOICE_STATUS_SORT_ORDER[a.status] - INVOICE_STATUS_SORT_ORDER[b.status]
        if (sd !== 0) return sd
        return a.year !== b.year ? a.year - b.year : a.month - b.month
      })

    const paidInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.PAID)
      .sort((a, b) => (b.year !== a.year ? b.year - a.year : b.month - a.month))

    return { overdueInvoices, activeInvoices, paidInvoices }
  }, [invoices])

  const isEmpty = overdueInvoices.length === 0 && activeInvoices.length === 0 && paidInvoices.length === 0

  /*
    Revela a seção onde a fatura aberta está.

    Este efeito NÃO abre mais o painel — quem manda nisso é a URL. Ele resolve
    só o problema visual: a lista mostra 3 ativas e 1 paga por padrão, e uma
    fatura fora desse corte ficaria com o painel aberto e a linha invisível
    atrás dele. Expandir é estado de apresentação, não identidade.
  */
  useEffect(() => {
    if (!detail.openId || !invoices) return
    const inv = invoices.find((i) => i.id === detail.openId)
    if (!inv) return
    if (inv.status === InvoiceStatus.PAID) {
      const idx = paidInvoices.findIndex((i) => i.id === detail.openId)
      if (idx >= PAID_VISIBLE) setHistoryExpanded(true)
    } else if (inv.status === InvoiceStatus.OPEN || inv.status === InvoiceStatus.CLOSED) {
      const idx = activeInvoices.findIndex((i) => i.id === detail.openId)
      if (idx >= ACTIVE_VISIBLE) setActiveExpanded(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.openId, invoices])

  /*
    A lista já carregada resolve o clique sem requisição; a busca por id cobre
    link direto e refresh. Id que não resolve limpa o param em vez de deixar o
    painel vazio.

    O drawer busca a fatura completa por conta própria (com transações); esta
    resolução existe para VALIDAR que o id aponta para algo real.
  */
  useDetailEntity({
    openId: detail.openId,
    fromList: invoices?.find((i) => i.id === detail.openId),
    fetchById: getInvoice,
    queryKey: 'invoice',
    onNotFound: detail.close,
  })

  const activeHidden = Math.max(0, activeInvoices.length - ACTIVE_VISIBLE)
  const paidHidden = Math.max(0, paidInvoices.length - PAID_VISIBLE)

  /**
   * A fatura da competência corrente — a que recebe uma compra feita hoje.
   *
   * Uso PROSPECTIVO legítimo: a pergunta é "qual competência estaria aberta
   * agora", que depende da configuração vigente do cartão e não das datas de
   * nenhuma fatura em particular. As datas exibidas de cada fatura continuam
   * vindo dela própria.
   */
  function isAtual(inv: Invoice): boolean {
    if (inv.status !== InvoiceStatus.OPEN || !bank) return false
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    const close = getInvoiceCloseDate(year, month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose)
    const afterClose = now >= close
    const targetMonth = afterClose ? (month === 12 ? 1 : month + 1) : month
    const targetYear = afterClose && month === 12 ? year + 1 : year
    return inv.month === targetMonth && inv.year === targetYear
  }

  function handleClick(id: string) {
    detail.open(id)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/banks"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          aria-label="Voltar para bancos"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {bank ? bank.name : <Skeleton className="inline-block h-7 w-32" />}
            </h1>
            {/* Discreto: a tela continua sendo sobre as faturas, e um banco
                arquivado ainda pode ter a última delas em aberto. */}
            {bank?.isArchived && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Archive className="size-3" aria-hidden />
                Arquivado
              </span>
            )}

            {/*
              Gerenciamento do banco, agora AQUI.

              Saiu do kebab da listagem, que disputava largura com o valor e o
              rótulo "Fatura atual" no mobile. A lista identifica e navega; a
              página do banco gerencia — cada superfície com um papel.

              `>` entra no banco, o lápis administra o banco já aberto: são
              semânticas distintas e por isso ícones distintos.
            */}
            {bank && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label={`Gerenciar ${bank.name}`}
                >
                  <Pencil className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil className="size-3.5" />
                    Editar banco
                  </DropdownMenuItem>
                  {/*
                    Com histórico o backend recusa a exclusão, então oferecer
                    "Excluir" ali empurraria o usuário para um erro. A mesma
                    distinção que a listagem fazia — preservada, não recriada.
                  */}
                  {bank.canDelete === false ? (
                    <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                      <Archive className="size-3.5" />
                      Arquivar banco
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Excluir banco
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {bank ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Vence dia {bank.invoiceDueDate} · fecha {bank.invoiceDueDaysAfterClose ?? 7} dias antes
            </p>
          ) : (
            <Skeleton className="mt-1.5 h-4 w-40" />
          )}
          {bank?.isArchived && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              Não aparece em novos lançamentos. As faturas continuam
              acompanhando os prazos normalmente.
            </p>
          )}
        </div>

        {bank?.isArchived && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={restoreMut.isPending}
            onClick={() => restoreMut.mutate(bank.id)}
          >
            {restoreMut.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <ArchiveRestore className="size-3.5" aria-hidden />
            )}
            Restaurar
          </Button>
        )}
      </div>

      {/* Invoice sections */}
      {/* Falha de API não pode virar "Nenhuma fatura encontrada". */}
      {isError ? (
        <QueryError
          message="Não foi possível carregar as faturas"
          isFetching={isFetching}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="border-t border-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border px-2 py-4 last:border-b-0"
            >
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted/40">
            <CreditCard className="size-6 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium">Nenhuma fatura encontrada</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            As faturas são criadas automaticamente ao registrar transações de crédito neste banco.
          </p>
          {/*
            O texto explicava o que fazer sem oferecer o caminho. O banco já
            é conhecido aqui, então o formulário abre com ele preenchido —
            mesmo `TransactionSheet` do resto do app, via `createDefaults`.
          */}
          <Button className="mt-5 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Nova transação
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── Em atraso ──────────────────────────────────────────────── */}
          {overdueInvoices.length > 0 && (
            <div>
              {/*
                "Em atraso" é o vocabulário oficial desde a Fase 6A. Esta
                seção tinha ficado fora da padronização e ainda dizia
                "Vencidas" — a mesma palavra que os badges já não usam.
              */}
              <p className="mb-2 text-[11px] font-medium text-destructive/90">Em atraso</p>
              <div className="border-t border-border">
                {overdueInvoices.map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={detail.openId === invoice.id}
                      onClick={() => handleClick(invoice.id)}
                    />
                  </MotionRow>
                ))}
              </div>
            </div>
          )}

          {/* ── Em aberto (fechadas e abertas; vencidas têm seção própria) ── */}
          {activeInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground/70">Faturas em aberto</p>
              <div className="border-t border-border">
                {activeInvoices.slice(0, ACTIVE_VISIBLE).map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={detail.openId === invoice.id}
                      isAtual={isAtual(invoice)}
                      onClick={() => handleClick(invoice.id)}
                    />
                  </MotionRow>
                ))}
                {activeExpanded &&
                  activeInvoices.slice(ACTIVE_VISIBLE).map((invoice, i) => (
                    <MotionRow key={invoice.id} index={i}>
                      <InvoiceRow
                        invoice={invoice}
                        bank={bank}
                        isSelected={detail.openId === invoice.id}
                        isAtual={isAtual(invoice)}
                        onClick={() => handleClick(invoice.id)}
                      />
                    </MotionRow>
                  ))}
                {activeHidden > 0 && (
                  <ExpandButton
                    expanded={activeExpanded}
                    hiddenCount={activeHidden}
                    onToggle={() => setActiveExpanded((e) => !e)}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Histórico ──────────────────────────────────────────────── */}
          {paidInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-paid/90">Histórico</p>
              <div className="border-t border-border">
                {paidInvoices.slice(0, PAID_VISIBLE).map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={detail.openId === invoice.id}
                      onClick={() => handleClick(invoice.id)}
                    />
                  </MotionRow>
                ))}
                {historyExpanded &&
                  paidInvoices.slice(PAID_VISIBLE).map((invoice, i) => (
                    <MotionRow key={invoice.id} index={i}>
                      <InvoiceRow
                        invoice={invoice}
                        bank={bank}
                        isSelected={detail.openId === invoice.id}
                        onClick={() => handleClick(invoice.id)}
                      />
                    </MotionRow>
                  ))}
                {paidHidden > 0 && (
                  <ExpandButton
                    expanded={historyExpanded}
                    hiddenCount={paidHidden}
                    onToggle={() => setHistoryExpanded((e) => !e)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail sheet */}
      {/*
        ── Por que `key` e não um task anchor ──

        As tarefas desta fatura (reabrir, editar lançamento, escopo de
        parcelamento, confirmar exclusão) vivem DENTRO do drawer, que é
        router-agnostic e não expõe nenhum sinal de "tarefa aberta" para cá.
        Sem isso, o Voltar tirava o `invoiceId` da URL, o painel fechava — e o
        diálogo de reabrir continuava sobre a lista, ancorado a uma fatura que
        já não estava aberta.

        Remontar por id resolve os dois casos de uma vez: quando o id sai
        (Voltar, X) ou troca por outro, o componente é recriado e todo estado
        transiente morre junto. Ensinar o drawer a falar de rota só para
        reportar isso quebraria a separação que O4.1/O4.2 preservaram.
      */}
      <InvoiceDetailsDrawer
        key={detail.openId ?? 'none'}
        invoiceId={detail.openId}
        bankId={bankId}
        open={detail.openId !== null}
        onOpenChange={(open) => !open && detail.close()}
      />
      {/*
        Mesmos componentes da listagem: `BankSheet` e `ConfirmDialog`. O
        formulário de edição e a confirmação destrutiva não foram
        reimplementados — só passaram a ter um segundo consumidor.
      */}
      {bank && (
        <BankSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          editTarget={bank}
          onSubmit={async (data) => {
            await updateBankMut.mutateAsync(data)
          }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Excluir banco"
        description={
          <>
            Tem certeza que deseja excluir{' '}
            <strong className="text-foreground">{bank?.name}</strong>? Esta
            ação não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir"
        variant="destructive"
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMut.mutate()}
      />

      {/*
        Arquivar diz o que PRESERVA, não só o que muda — a mesma redação da
        listagem, porque a dúvida de quem clica é a mesma.
      */}
      <ConfirmDialog
        open={archiveOpen}
        title={`Arquivar ${bank?.name ?? 'banco'}?`}
        description={
          <>
            Ele deixará de aparecer em novos lançamentos. Seu histórico,
            faturas e parcelas existentes serão preservados.
            <span className="mt-2 block text-xs">
              As faturas continuam fechando, vencendo e podendo ser pagas — e
              você pode restaurá-lo quando quiser.
            </span>
          </>
        }
        confirmLabel="Arquivar"
        isPending={archiveMut.isPending}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => archiveMut.mutate()}
      />

      {/*
        Mesmo formulário usado em Transações e no drawer da fatura — o banco
        chega preenchido e o tipo já é crédito, que é o que gera fatura.
      */}
      <TransactionSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        editTarget={null}
        onSubmit={async (data: TransactionFormData) => {
          await createTxMut.mutateAsync(data)
        }}
        createDefaults={{ bankId, type: TransactionType.CREDIT_CARD }}
      />

    </div>
  )
}

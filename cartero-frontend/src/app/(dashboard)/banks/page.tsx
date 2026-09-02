'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Landmark, ChevronRight, MoreVertical, Archive, ArchiveRestore, Pencil, ReceiptText } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MotionRow } from '@/components/ui/motion-row'
import { BankSheet, type BankFormData } from './bank-sheet'
import { BillingConfigDialog } from './billing-config-dialog'
import {
  getBanks,
  createBank,
  updateBank,
  deleteBank,
  archiveBank,
  restoreBank,
  previewBillingConfig,
} from '@/services/banks.service'
import { getInvoices } from '@/services/invoices.service'
import { formatCurrency, formatMonthYear } from '@/lib/formatters'
import { apiErrorMessage } from '@/lib/api-error'
import {
  FinancialListRow,
  ROW_AMOUNT_CLASS,
  ROW_ICON_BG_CLASS,
  ROW_TRAILING_LABEL_CLASS,
  ROW_ICON_CLASS,
} from '@/components/ui/financial-list-row'
import { cn } from '@/lib/utils'
import { InvoiceStatus, type Bank, type Invoice } from '@/types'
import { invoiceTimingClass, invoiceTimingLabel } from '@/lib/invoice-timing'
import {
  bankMonthSummaryLines,
  CYCLE_LABEL,
  monthCycleOf,
  type MonthCycle,
} from '@/lib/bank-month-summary-lines'
import {
  BANK_TRAILING_LABEL,
  BANK_TRAILING_TONE,
  bankTrailingState,
  banksForPeriod,
  summarizeBankMonth,
} from '@/lib/bank-invoice-selection'
import {
  currentPeriod,
  useMonthPeriod,
  type MonthPeriod,
} from '@/components/month-nav'
import { useDetailNavigation } from '@/lib/detail-navigation'
import { InvoiceDetailsDrawer } from '@/components/invoice-details-drawer'

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Rótulo do ciclo, prefixando a linha de pendência do resumo.
 *
 * Azul porque é CONTEXTO, não estado financeiro: os tons de valor
 * (âmbar, vermelho, verde) já significam prazo e resolução, e reusar um deles
 * aqui sugeriria que o mês em si é urgente ou resolvido. `text-primary` é a
 * cor que o design system reserva para orientação.
 *
 * Mês passado não recebe rótulo — `CYCLE_LABEL.past` é `null`.
 */
function CycleLabel({ cycle }: { cycle: MonthCycle }) {
  const label = CYCLE_LABEL[cycle]
  if (!label) return null

  return (
    <>
      <span className="font-medium text-primary">{label}</span>
      <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
        ·
      </span>
    </>
  )
}

// The amount alone, standing as the row's primary stat.
function MonthInvoiceAmount({ amount }: { amount: number }) {
  /*
    Tipografia canônica do `FinancialListRow`, em cor NEUTRA.

    O valor seguia `INVOICE_STATUS_TEXT`, que o pintava conforme o status —
    azul em fatura aberta, o caso mais comum. Mas o status já é dito pela
    badge ao lado do nome, e dois elementos comunicando a mesma coisa faziam
    o número competir com ela em vez de ser lido como o dado principal da
    linha. Neutro, ele se lê como valor.

    A cor vem do consumidor, pelo slot `trailing` — `ROW_AMOUNT_CLASS`
    continua sem opinião sobre cor, então Extrato, Dívidas e A Receber
    mantêm as delas.
  */
  return <span className={ROW_AMOUNT_CLASS}>{formatCurrency(amount)}</span>
}

/**
 * Quanto da fatura é do usuário. O valor principal continua bruto — esta tela
 * responde "quanto o cartão vai cobrar" —, então a divisão entra como apoio.
 */
function BankRow({
  bank,
  invoice,
  amount,
  period,
  onOpenInvoice,
  onEdit,
  onArchive,
  onDelete,
  isArchiving,
}: {
  bank: Bank
  /** A fatura DESTA competência, ou `null` quando o mês não teve fatura. */
  invoice: Invoice | null
  amount: number
  period: MonthPeriod
  onOpenInvoice: (invoiceId: string) => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  isArchiving: boolean
}) {
  const router = useRouter()
  const initial = bank.name[0]?.toUpperCase() ?? '?'
  const monthLabel = formatMonthYear(period.month, period.year)
  const trailingState = bankTrailingState(invoice)

  /*
    Rótulo completo para leitor de tela: a metadata visual é compacta, mas a
    informação não pode depender do que coube na tela.
  */
  const ariaLabel = invoice
    ? `Abrir fatura de ${monthLabel} do ${bank.name}. ${formatCurrency(amount)}.`
    : `${bank.name} não tem fatura em ${monthLabel}.`

  return (
    /*
      ── Row inteira clicável, no padrão de Pessoas ──

      O menu é IRMÃO da row, não filho: aninhar `button` dentro de `a`/`button`
      é HTML inválido e quebra teclado. A sobreposição resolve sem isso.
    */
    <div className="group relative border-b border-border last:border-b-0">
      <FinancialListRow
        /*
          Click abre o DETALHE da fatura, não uma página intermediária.

          Antes a row levava a `/banks/:id/invoices`, e de lá o usuário abria a
          fatura — dois níveis para chegar ao mesmo lugar. Com o mês no topo, a
          fatura que interessa já está determinada, então a página do meio
          deixou de ter o que decidir.

          Sem fatura no mês não há detalhe a abrir: `onView` fica ausente e a
          row não finge ser clicável.
        */
        onView={invoice ? () => onOpenInvoice(invoice.id) : undefined}
        ariaLabel={ariaLabel}
        /* Espaço à direita para o kebab sobreposto não cobrir o valor. */
        className="pr-10 sm:pr-12"
        leading={
          <div className={cn(ROW_ICON_CLASS, ROW_ICON_BG_CLASS, 'text-sm font-semibold text-muted-foreground select-none')}>
            {initial}
          </div>
        }
        title={bank.name}
        /* A badge qualifica o banco, então acompanha o nome — nunca a coluna
           de valores. Com nome longo quem cede espaço é o texto. */
        /*
          Sem badge ao lado do nome.

          Ela disputava largura com o título e o chevron, e no mobile fazia
          "Porto Seguro" truncar em "Porto Seg...". O estado não sumiu: desceu
          para o trailing, onde a coluna já é estreita por natureza e não
          compete com o nome.
        */
        meta={
          invoice ? (
            /*
              A cor vem da URGÊNCIA, não do status: "Fecha amanhã" e "Fecha em
              12d" saíam no mesmo cinza, e o prazo — a razão de a lista existir
              — só aparecia para quem lesse o número.

              Só as pontas ganham cor (atrasado, ≤2 dias). O que não é urgente
              continua muted: pintar tudo encheria a lista de tons sem
              hierarquia.
            */
            /*
              Fatura paga tinge o prazo de verde também.

              "Venceu em 10/09" saía cinza ao lado de "PAGA" em verde, e os
              dois falam do MESMO fato resolvido. Com a cor compartilhada, a
              linha inteira se lê como concluída de relance — sem inventar
              tom: é o mesmo `text-paid` do trailing.
            */
            <span
              className={cn(
                'truncate',
                invoice.status === InvoiceStatus.PAID
                  ? BANK_TRAILING_TONE.paid
                  : invoiceTimingClass(invoice),
              )}
            >
              {invoiceTimingLabel(invoice)}
            </span>
          ) : null
        }
        /*
          Duas perguntas, dois lugares: a esquerda diz o que ACONTECE ("Fecha
          amanhã"), o trailing diz o ESTADO ("Aberta").

          O rótulo antes repetia a competência — "SETEMBRO 2026" em toda row,
          logo abaixo de um seletor que já diz Setembro 2026. Informação que o
          usuário lê uma vez e depois só ocupa espaço.
        */
        trailing={
          invoice ? (
            <>
              <MonthInvoiceAmount amount={amount} />
              {/*
                O trailing diz em que CICLO a fatura está, não o status interno.

                `ABERTA` em azul competia com "Fecha amanhã" em âmbar: duas
                mensagens coloridas na mesma row, e a urgência perdia espaço
                para um estado que o subtexto já explicava melhor. Só `PAGA` e
                `VENCIDA` mantêm cor — são os fatos que mudam o que o usuário
                faz.

                O VALOR fica neutro de propósito: colori-lo junto do status
                faria os dois competirem pela mesma informação.
              */}
              <span
                className={cn(
                  ROW_TRAILING_LABEL_CLASS,
                  BANK_TRAILING_TONE[trailingState],
                )}
              >
                {BANK_TRAILING_LABEL[trailingState]}
              </span>
            </>
          ) : (
            /*
              Sem valor: "R$ 0,00" afirmaria uma fatura de valor zero, que é
              outra coisa — o mês pode ter tido gasto nenhum, mas a fatura
              existir.
            */
            /*
              Cinza, e não um tom de estado: o mês sem fatura não é bom nem
              ruim. Verde sugeriria "em dia", âmbar sugeriria pendência — e
              nenhuma das duas coisas aconteceu.
            */
            <span
              className={cn(
                ROW_TRAILING_LABEL_CLASS,
                BANK_TRAILING_TONE.noInvoice,
              )}
            >
              {BANK_TRAILING_LABEL.noInvoice}
            </span>
          )
        }
      />

      {/*
        Gestão do BANCO, separada do conteúdo financeiro do mês — a mesma
        divisão que Pessoas usa. Sobreposto à direita, irmão da row.
      */}
      <div className="absolute top-1/2 right-1 -translate-y-1/2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Mais opções de ${bank.name}`}
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            {/*
              O histórico completo do cartão continua existindo: a rota
              dedicada não foi removida, só deixou de ser o caminho obrigatório
              para chegar a uma fatura.
            */}
            <DropdownMenuItem onClick={() => router.push(`/banks/${bank.id}/invoices`)}>
              <ReceiptText className="size-3.5" />
              Ver todas as faturas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArchive} disabled={isArchiving}>
              <Archive className="size-3.5" />
              Arquivar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}


function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-border px-1 py-4 last:border-b-0">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex flex-1 items-center gap-6">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="hidden shrink-0 items-center gap-6 sm:flex">
        <Skeleton className="h-8 w-10" />
        <Skeleton className="h-8 w-10" />
      </div>
      <Skeleton className="h-7 w-20 rounded-md" />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Linha de um banco arquivado.
 *
 * Mostra o que ainda importa — nome, o que existe de histórico — e a ação de
 * restaurar. Esconder o histórico só porque a conta foi encerrada seria perder
 * justamente o motivo de arquivar em vez de excluir. Sem consulta de faturas
 * aqui: a lista de arquivados não precisa do valor da próxima fatura, e uma
 * query por linha seria N+1 por nada.
 */
function ArchivedBankRow({
  bank,
  onRestore,
  onDelete,
  isRestoring,
}: {
  bank: Bank
  onRestore: (b: Bank) => void
  onDelete: (b: Bank) => void
  isRestoring: boolean
}) {
  const initial = bank.name[0]?.toUpperCase() ?? '?'
  const counts = bank._count
  const history: string[] = []
  if (counts?.transactions) {
    history.push(
      `${counts.transactions} ${counts.transactions === 1 ? 'transação' : 'transações'}`,
    )
  }
  if (counts?.invoices) {
    history.push(
      `${counts.invoices} ${counts.invoices === 1 ? 'fatura' : 'faturas'}`,
    )
  }
  if (counts?.subscriptions) {
    history.push(
      `${counts.subscriptions} ${counts.subscriptions === 1 ? 'assinatura' : 'assinaturas'}`,
    )
  }

  return (
    <div className="flex items-center gap-4 border-b border-border px-1 py-4 last:border-b-0">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/25 text-sm font-semibold text-muted-foreground/60 select-none">
        {initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium text-muted-foreground">
            {bank.name}
          </span>
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Arquivado
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
          {history.length > 0
            ? `${history.join(' · ')} preservadas`
            : 'Não aparece em novos lançamentos'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          disabled={isRestoring}
          onClick={() => onRestore(bank)}
        >
          <ArchiveRestore className="size-3.5" />
          Restaurar
        </Button>

        {/* Arquivar não é caminho para excluir: um banco com histórico
            continua indelével, e o backend recusa. O item só aparece para o
            que realmente está vazio. */}
        {bank.canDelete !== false && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Mais opções"
            >
              <MoreVertical className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onDelete(bank)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Link
          href={`/banks/${bank.id}/invoices`}
          className={buttonVariants({
            variant: 'ghost',
            size: 'sm',
            className: 'gap-1 text-xs text-muted-foreground hover:text-foreground',
          })}
          title="Ver faturas"
        >
          <span className="hidden sm:inline">Faturas</span>
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

export default function BanksPage() {
  const qc = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editBank, setEditBank] = useState<Bank | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Bank | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Bank | null>(null)
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  /**
   * Edição pendente de confirmação, quando o ciclo muda.
   *
   * Guardada aqui para que o dialog possa pedir a prévia com o payload exato
   * que o save vai usar — projeção e gravação partem do mesmo dado.
   */
  const [billingConfirm, setBillingConfirm] = useState<{
    bank: Bank
    data: BankFormData
  } | null>(null)

  const {
    data: banks,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['banks'],
    queryFn: () => getBanks(),
  })

  /**
   * Arquivados, carregados sempre.
   *
   * A tentação era usar `enabled: tab === 'archived'` para poupar a
   * requisição — mas a aba só aparece se existir algum arquivado, e essa
   * informação vem justamente desta query. Adiá-la fecharia um ciclo: sem a
   * lista a aba não aparece, sem a aba a lista nunca carrega.
   *
   * O custo é baixo: são poucos registros por usuário, e a resposta fica em
   * cache junto com a lista de ativos.
   */
  const { data: archivedBanks, isLoading: archivedLoading } = useQuery({
    queryKey: ['banks', 'ARCHIVED'],
    queryFn: () => getBanks('ARCHIVED'),
  })

  /*
    As faturas decidem a ORDEM da lista, não só os números exibidos.

    `isLoading` é lido junto com o das contas porque uma lista renderizada
    sem elas sai em ordem de API — todos os bancos caem na mesma prioridade
    por falta de `selection` — e reordena quando a resposta chega. Era esse o
    piscar de ~1s ao entrar na página.
  */
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => getInvoices(),
  })

  /**
   * Bancos ordenados por urgência, cada um com a sua fatura já resolvida.
   *
   * Uma passada: a seleção acontece antes do `.sort()`, e o mesmo resultado
   * alimenta posição, valor, status, prazo e rateio. A versão anterior
   * refiltrava a lista de faturas dentro do comparador e usava uma segunda
   * fonte para os números exibidos.
   */
  /*
    O mês é contexto do app (`MonthPeriodProvider`), o mesmo que governa
    Orçamento, Extrato, Dívidas, A Receber e Pessoas. Bancos passou a
    participar dele em vez de manter estado próprio.
  */
  const { period } = useMonthPeriod()

  /** Identidade de URL do detalhe, a mesma foundation da O4.3. */
  const detail = useDetailNavigation('invoiceId')

  /**
   * Bancos com a fatura da competência exibida.
   *
   * Uma passada sobre `['invoices']`, que a página já carregava — nenhuma
   * requisição por banco. A ordenação por urgência saiu: num mês fechado não
   * há urgência a comunicar, e reordenar por status faria as rows saltarem de
   * lugar a cada troca de período.
   */
  const bankRows = useMemo(
    () => banksForPeriod(banks ?? [], invoices, period),
    [banks, invoices, period],
  )

  const monthSummary = useMemo(() => summarizeBankMonth(bankRows), [bankRows])

  /*
    A fatura aberta precisa pertencer ao mês exibido.

    Sem isto, trocar setembro → agosto deixaria o painel mostrando a fatura de
    setembro sobre uma lista de agosto — duas competências na mesma tela, sem
    dizer qual é qual.
  */
  const openInvoiceBankId =
    bankRows.find((row) => row.invoice?.id === detail.openId)?.bank.id ?? null

  const openInvoiceBelongsToPeriod =
    detail.openId !== null && openInvoiceBankId !== null

  useEffect(() => {
    if (detail.openId !== null && !invoicesLoading && !openInvoiceBelongsToPeriod) {
      detail.close()
    }
  }, [detail, invoicesLoading, openInvoiceBelongsToPeriod])

  /**
   * Impacto da alteração de ciclo, só quando há uma edição pendente.
   *
   * Vem do backend para não duplicar a regra: quem decide quais faturas são
   * elegíveis é o mesmo plano que o save executa.
   */
  const { data: billingPreview, isFetching: billingPreviewLoading } = useQuery({
    queryKey: [
      'bank-billing-preview',
      billingConfirm?.bank.id,
      billingConfirm?.data.invoiceDueDate,
      billingConfirm?.data.invoiceDueDaysAfterClose,
    ],
    queryFn: () =>
      previewBillingConfig(billingConfirm!.bank.id, {
        invoiceDueDate: billingConfirm!.data.invoiceDueDate,
        invoiceDueDaysAfterClose: billingConfirm!.data.invoiceDueDaysAfterClose,
      }),
    enabled: billingConfirm !== null,
  })

  const createMut = useMutation({
    mutationFn: (data: BankFormData) =>
      createBank({
        name: data.name,
        invoiceDueDate: data.invoiceDueDate,
        invoiceDueDaysAfterClose: data.invoiceDueDaysAfterClose,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      setSheetOpen(false)
      toast.success('Banco criado')
    },
    onError: () => toast.error('Erro ao criar banco'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: BankFormData }) =>
      updateBank(id, {
        name: data.name,
        invoiceDueDate: data.invoiceDueDate,
        invoiceDueDaysAfterClose: data.invoiceDueDaysAfterClose,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      // As datas das faturas em aberto podem ter mudado, e com elas o prazo e
      // a ordem da lista. Sem isto a tela mostraria o calendário antigo.
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      setSheetOpen(false)
      setEditBank(null)
      setBillingConfirm(null)
      toast.success('Banco atualizado')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao atualizar banco')),
  })

  /**
   * Invalidação compartilhada por arquivar, restaurar e excluir.
   *
   * As duas listas (`['banks']` e `['banks','ARCHIVED']`) mudam em conjunto:
   * arquivar tira de uma e põe na outra. Os selects de lançamento também
   * derivam de `['banks']`, então o banco arquivado desaparece deles sem
   * recarregar a página.
   */
  function invalidateBankLists() {
    qc.invalidateQueries({ queryKey: ['banks'] })
  }

  const archiveMut = useMutation({
    mutationFn: archiveBank,
    onSuccess: (_data, id) => {
      invalidateBankLists()
      const name = banks?.find((bank) => bank.id === id)?.name
      toast.success(name ? `${name} arquivado` : 'Banco arquivado')
      setArchiveTarget(null)
    },
    // Assinatura ativa volta com BANK_HAS_ACTIVE_SUBSCRIPTIONS e uma mensagem
    // que já diz o que fazer — pausar ou mover a assinatura.
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao arquivar banco')),
  })

  const restoreMut = useMutation({
    mutationFn: restoreBank,
    onSuccess: (_data, id) => {
      invalidateBankLists()
      const name = archivedBanks?.find((bank) => bank.id === id)?.name
      toast.success(name ? `${name} restaurado` : 'Banco restaurado')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao restaurar banco')),
  })

  const deleteMut = useMutation({
    mutationFn: deleteBank,
    onSuccess: () => {
      invalidateBankLists()
      toast.success('Banco excluído')
      setDeleteTarget(null)
    },
    // Banco com histórico volta com BANK_HAS_HISTORY e uma mensagem que já
    // explica o bloqueio. O diálogo fica aberto para o usuário ler.
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao excluir banco')),
  })

  /**
   * Se o banco tem histórico — e portanto se a ação é arquivar ou excluir.
   *
   * Vem de `canDelete`, calculado pelo backend com a MESMA condição de
   * `remove`. A versão anterior recontava aqui a partir de `_count` e deixava
   * assinaturas de fora, então a UI oferecia "Excluir" para um banco com
   * assinatura e o servidor recusava depois do clique.
   */
  const targetHasHistory =
    deleteTarget != null && deleteTarget.canDelete === false

  async function handleSheetSubmit(data: BankFormData) {
    if (!editBank) {
      await createMut.mutateAsync(data)
      return
    }

    /**
     * Mexer no ciclo pede confirmação; mudar só o nome, não.
     *
     * A comparação é com a configuração atual do banco — abrir um dialog para
     * uma edição que não altera datas seria atrito sem informação. Se o ciclo
     * mudou mas nenhuma fatura em aberto é afetada, o próprio dialog reporta
     * isso via `scheduleUnchanged`/`affectedCount` e o usuário confirma uma vez.
     */
    const cycleChanged =
      data.invoiceDueDate !== editBank.invoiceDueDate ||
      data.invoiceDueDaysAfterClose !== editBank.invoiceDueDaysAfterClose

    if (cycleChanged) {
      setBillingConfirm({ bank: editBank, data })
      setSheetOpen(false)
      return
    }

    await updateMut.mutateAsync({ id: editBank.id, data })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bancos</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gerencie seus bancos e cartões de crédito
          </p>
        </div>
        <Button
          onClick={() => {
            setEditBank(null)
            setSheetOpen(true)
          }}
        >
          <Plus className="size-4" />
          Novo banco
        </Button>
      </div>

      {/*
        Resumo da competência, no lugar que Pessoas usa para "Saldo com
        pessoas".

        O total inclui as faturas PAGAS: elas pertencem ao ciclo, e tirá-las
        faria o número encolher sozinho quando o usuário pagasse — como se o
        gasto não tivesse existido. "Quanto ainda falta" é outra pergunta, e
        aparece na linha de apoio em vez de disputar o mesmo número.
      */}
      {tab === 'active' && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Faturas de {formatMonthYear(period.month, period.year)}
          </p>
          {invoicesLoading || isLoading ? (
            <Skeleton className="mt-1.5 h-7 w-32" />
          ) : (
            <>
              <p className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
                {formatCurrency(monthSummary.total)}
              </p>
              {/*
                Cada linha só aparece quando acrescenta um fato que o total
                não conta. A regra vive em `bankMonthSummaryLines`, para o
                resumo não voltar a repetir o número de cima.

                Duas linhas no máximo: acima disso o bloco começa a competir
                com a lista, que é o conteúdo principal da tela.
              */}
              {bankMonthSummaryLines(
                monthSummary,
                monthCycleOf(period, currentPeriod()),
              ).map((linha) => {
                if (linha.kind === 'composition') {
                  return (
                    <p
                      key={linha.kind}
                      className="mt-0.5 text-[11px] text-muted-foreground"
                    >
                      {linha.parts.map((part, i) => (
                        <span key={part.kind}>
                          {i > 0 && (
                            <span
                              className="mx-1.5 text-muted-foreground/40"
                              aria-hidden
                            >
                              ·
                            </span>
                          )}
                          {/*
                            Verde só em "de outras pessoas" — o mesmo tom que o
                            Orçamento usa para o dinheiro que volta.
                          */}
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
                    </p>
                  )
                }

                if (linha.kind === 'remaining') {
                  return (
                    <p
                      key={linha.kind}
                      className="mt-0.5 text-[11px] text-muted-foreground"
                    >
                      <CycleLabel cycle={linha.cycle} />
                      {/*
                        Neutro: pendência é o estado normal de um mês em curso,
                        e o âmbar fica reservado ao prazo nas rows.
                      */}
                      Faltam{' '}
                      <span className="font-medium">
                        {formatCurrency(linha.amount)}
                      </span>{' '}
                      para quitar
                    </p>
                  )
                }

                if (linha.kind === 'settled') {
                  return (
                    <p key={linha.kind} className="mt-0.5 text-[11px]">
                      <span className="font-medium text-paid">{linha.text}</span>
                    </p>
                  )
                }

                return (
                  <p
                    key={linha.kind}
                    className="mt-0.5 text-[11px] text-muted-foreground"
                  >
                    {linha.kind === 'count' && <CycleLabel cycle={linha.cycle} />}
                    {linha.text}
                  </p>
                )
              })}
            </>
          )}
        </div>
      )}

      {/*
        Abas discretas, não uma seção permanente.
        Quem nunca arquivou nada não deve carregar uma área vazia na tela; a
        aba "Arquivados" só aparece quando existe pelo menos um, ou quando o
        usuário já está olhando para ela.
      */}
      {(tab === 'archived' || (archivedBanks?.length ?? 0) > 0) && (
        <div
          role="tablist"
          aria-label="Filtrar bancos"
          className="flex items-center gap-1 border-b border-border pb-0"
        >
          {(
            [
              ['active', 'Ativos'],
              ['archived', 'Arquivados'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === value
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Bank list */}
      <div
        className={cn(
          'border-border',
          tab === 'archived' || (archivedBanks?.length ?? 0) > 0
            ? ''
            : 'border-t',
        )}
      >
        {tab === 'archived' ? (
          archivedLoading ? (
            <div>
              {Array.from({ length: 2 }).map((_, i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          ) : !archivedBanks || archivedBanks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/40">
                <Archive className="size-5 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium">Nenhum banco arquivado</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Ao encerrar um cartão ou conta, arquive-o para tirá-lo dos novos
                lançamentos sem perder o histórico.
              </p>
            </div>
          ) : (
            <div>
              {archivedBanks.map((bank, i) => (
                <MotionRow key={bank.id} index={i}>
                  <ArchivedBankRow
                    bank={bank}
                    onRestore={(b) => restoreMut.mutate(b.id)}
                    onDelete={setDeleteTarget}
                    isRestoring={restoreMut.isPending}
                  />
                </MotionRow>
              ))}
            </div>
          )
        ) : isError ? (
          /* Falha de API não pode virar "Nenhum banco cadastrado". */
          <QueryError
            message="Não foi possível carregar seus bancos"
            isFetching={isFetching}
            onRetry={() => void refetch()}
          />
        ) : /*
          Espera as DUAS respostas: sem as faturas a ordem seria provisória, e
          o usuário veria a lista se reorganizar sozinha.

          O skeleton é o mesmo de sempre — nenhum delay artificial foi
          acrescentado. Ele só passou a cobrir o dado que a ordenação exige.
        */
        isLoading || invoicesLoading ? (
          <div>
            {Array.from({ length: 4 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : !banks || banks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted/40">
              <Landmark className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-medium">Nenhum banco cadastrado</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Adicione seu primeiro banco para começar a acompanhar faturas e gastos.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => {
                setEditBank(null)
                setSheetOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              Adicionar banco
            </Button>
          </div>
        ) : (
          <div>
            {bankRows.map(({ bank, invoice, amount }, i) => (
              <MotionRow key={bank.id} index={i}>
                {/*
                  Row e kebab dividem o trabalho, como em Pessoas: a linha
                  mostra o mês e abre a fatura; o menu administra o BANCO.

                  As ações voltaram para cá porque viviam na página do banco —
                  que deixou de ser o caminho principal quando o click passou a
                  abrir o detalhe direto. Sem isso, editar um cartão exigiria
                  descobrir uma rota que a interface não oferece mais.
                */}
                <BankRow
                  bank={bank}
                  invoice={invoice}
                  amount={amount}
                  period={period}
                  onOpenInvoice={detail.open}
                  onEdit={() => setEditBank(bank)}
                  onArchive={() => archiveMut.mutate(bank.id)}
                  onDelete={() => setDeleteTarget(bank)}
                  isArchiving={archiveMut.isPending}
                />
              </MotionRow>
            ))}
          </div>
        )}
      </div>

      {/*
        O MESMO drawer da página do banco — não uma segunda versão.

        `key` pelo id: quando ele sai (Voltar, X) ou troca por outra fatura, o
        componente é recriado e todo estado transiente morre junto, em vez de
        vazar de uma fatura para a seguinte.
      */}
      <InvoiceDetailsDrawer
        key={detail.openId ?? 'none'}
        invoiceId={detail.openId}
        bankId={openInvoiceBankId ?? ''}
        open={detail.openId !== null && openInvoiceBankId !== null}
        onOpenChange={(open) => !open && detail.close()}
      />

      {/*
        Impacto da mudança de ciclo. Um único dialog: escolhe, vê o que muda,
        confirma. Substitui o aviso genérico que a fase anterior mostrava
        dentro do formulário e que já não descreve o comportamento.
      */}
      <BillingConfigDialog
        open={billingConfirm !== null}
        bankName={billingConfirm?.bank.name ?? 'banco'}
        preview={billingPreview}
        isLoading={billingPreviewLoading && !billingPreview}
        isPending={updateMut.isPending}
        onCancel={() => setBillingConfirm(null)}
        onConfirm={() => {
          if (!billingConfirm) return
          updateMut.mutate({
            id: billingConfirm.bank.id,
            data: billingConfirm.data,
          })
        }}
      />

      {/* Sheet */}
      <BankSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditBank(null)
        }}
        editTarget={editBank}
        onSubmit={handleSheetSubmit}
      />

      {/* Delete confirm — só chega aqui banco sem histórico */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir banco"
        description={
          targetHasHistory ? (
            // Fallback de corrida: o menu já oferece Arquivar quando há
            // histórico, então isto só aparece se algo foi criado no banco
            // entre o carregamento da lista e o clique.
            <>
              <strong className="text-foreground">{deleteTarget?.name}</strong>{' '}
              passou a ter histórico financeiro e não pode mais ser excluído.
              <span className="mt-2 block text-xs">
                Use <strong className="text-foreground">Arquivar</strong> para
                tirá-lo dos novos lançamentos sem perder o histórico.
              </span>
            </>
          ) : (
            <>
              Tem certeza que deseja excluir{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong>?
              Esta ação não pode ser desfeita.
            </>
          )
        }
        confirmLabel={targetHasHistory ? 'Entendi' : 'Excluir'}
        variant={targetHasHistory ? 'default' : 'destructive'}
        cancelLabel={targetHasHistory ? 'Fechar' : 'Cancelar'}
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (targetHasHistory) {
            setDeleteTarget(null)
            return
          }
          if (deleteTarget) deleteMut.mutate(deleteTarget.id)
        }}
      />

      {/*
        Arquivar precisa dizer o que PRESERVA, não só o que muda.
        "O banco será arquivado" não responde à dúvida real de quem clica:
        as faturas somem? as parcelas são canceladas? A descrição responde
        antes de a pergunta ser feita.
      */}
      <ConfirmDialog
        open={archiveTarget !== null}
        title={`Arquivar ${archiveTarget?.name ?? 'banco'}?`}
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
        cancelLabel="Cancelar"
        isPending={archiveMut.isPending}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) archiveMut.mutate(archiveTarget.id)
        }}
      />
    </div>
  )
}

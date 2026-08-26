'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Landmark, ChevronRight, MoreVertical, Archive, ArchiveRestore } from 'lucide-react'
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
import { formatCurrency } from '@/lib/formatters'
import { apiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { InvoiceStatus } from '@/types'
import type { Bank } from '@/types'
import {
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TEXT,
} from '@/lib/invoice-status'
import { formatCloseTiming, formatDueTiming } from '@/lib/invoice-timing'
import {
  orderBanksByUrgency,
  type BankInvoiceSelection,
} from '@/lib/bank-invoice-selection'

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Estado da fatura, com o prazo ao lado.
 *
 * O badge carrega o estado — "Fechada", "Em atraso" —, o mesmo vocabulário das
 * outras telas. O prazo vem depois, em texto secundário: "Fechada · vence em
 * 5d". Antes o badge dizia só "Vence em 5d", e quem olhava a lista de bancos e
 * o detalhe da fatura via dois nomes para o mesmo estado.
 */
function NearestInvoiceBadge({
  info,
}: {
  info: BankInvoiceSelection | null
}) {
  if (info === null) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-receivable/10 px-2 py-0.5 text-[11px] font-medium text-receivable">
        Em dia
      </span>
    )
  }

  const isOverdue = info.status === InvoiceStatus.OVERDUE

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
          INVOICE_STATUS_BADGE[info.status],
        )}
      >
        {isOverdue && (
          <span className="relative flex size-1.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60" />
            <span className="size-1.5 rounded-full bg-destructive" />
          </span>
        )}
        {INVOICE_STATUS_LABEL[info.status]}
      </span>
      {/*
        Prazo só no desktop.

        No mobile ele levava `truncate` e concorria com a metadata financeira
        na mesma faixa — "Fecha em 3 di…" é informação pela metade, que é
        justamente o que o padrão evita. A data completa está no detalhe do
        banco.

        A data vem do registro PERSISTIDO da fatura selecionada — o mesmo que
        define a posição do banco na lista.
      */}
      <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
        {info.status === InvoiceStatus.OPEN
          ? formatCloseTiming(info.referenceDate, undefined, 'short')
          : formatDueTiming(info.referenceDate, undefined, 'short')}
      </span>
    </span>
  )
}

// The amount alone, standing as the row's primary stat.
function NearestInvoiceAmount({
  info,
}: {
  info: BankInvoiceSelection | null
}) {
  if (info === null) return null
  return (
    <span
      className={cn(
        'text-[17px] font-semibold tabular-nums tracking-[-0.02em]',
        INVOICE_STATUS_TEXT[info.status],
      )}
    >
      {formatCurrency(info.amount)}
    </span>
  )
}

/**
 * Quanto da fatura é do usuário. O valor principal continua bruto — esta tela
 * responde "quanto o cartão vai cobrar" —, então a divisão entra como apoio.
 */
function BankRow({
  bank,
  nearest,
  onEdit,
  onDelete,
  onArchive,
}: {
  bank: Bank
  /**
   * Fatura que representa o banco. Vem de fora, já resolvida: era uma query
   * por linha (`['bank-invoices','mini',id]`) cuja regra de seleção divergia
   * da usada para ordenar — o card podia ser posicionado por uma fatura e
   * exibir os números de outra.
   */
  nearest: BankInvoiceSelection | null
  onEdit: (b: Bank) => void
  onDelete: (b: Bank) => void
  onArchive: (b: Bank) => void
}) {
  const initial = bank.name[0]?.toUpperCase() ?? '?'

  /*
    Rótulo completo para leitor de tela: a metadata visual é compacta, mas a
    informação não pode depender do que coube na tela.
  */
  const ariaLabel =
    nearest !== null
      ? `Abrir detalhes do ${bank.name}. Próxima fatura ${formatCurrency(nearest.amount)}.`
      : `Abrir detalhes do ${bank.name}.`

  return (
    /*
      ── Row inteira clicável, no padrão de Pessoas ──

      Antes era uma `div` inerte com QUATRO blocos disputando a linha: nome,
      valor com rótulo, `⋮` e um link "Faturas" separado. No mobile as três
      caixas `shrink-0` espremiam a coluna do nome, e `⋮` ao lado de `>`
      fazia os dois parecerem ações concorrentes.

      Agora: a row é um `Link` que ocupa a linha inteira, e o menu é IRMÃO
      dele — não filho. Aninhar `button` dentro de `a` é HTML inválido e
      quebra teclado; a sobreposição resolve sem isso.
    */
    <div className="group relative border-b border-border last:border-b-0">
      <Link
        href={`/banks/${bank.id}/invoices`}
        aria-label={ariaLabel}
        className="flex min-h-[68px] flex-col justify-center gap-1 py-3 pl-1 pr-12 transition-colors hover:bg-muted/30 active:bg-muted/50"
      >
        {/* FAIXA 1 — identidade, chevron e valor. */}
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-sm font-semibold text-muted-foreground select-none">
            {initial}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="truncate text-[15px] font-medium">
              {bank.name}
            </span>
            {/*
              Chevron junto do NOME, não no canto: ele é affordance de
              "esta linha abre", não um botão. Decorativo — o `aria-label`
              do Link já anuncia a ação.
            */}
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary/60"
              aria-hidden
            />
          </div>

          <NearestInvoiceAmount info={nearest} />
        </div>

        {/*
          FAIXA 2 — só o status.

          A composição financeira (sua parte / de outras pessoas) saiu: ela
          vive no detalhe da fatura, e repeti-la aqui punha dois números a
          competir com o valor principal. Prazos de fechamento e vencimento
          saíram pelo mesmo motivo — a lista identifica, o detalhe explica.

          O status fica porque é identidade operacional do banco, não
          composição: é ele que diz se há algo exigindo atenção.
        */}
        <div className="flex items-center pl-13 text-[11px] leading-tight">
          <NearestInvoiceBadge info={nearest} />
        </div>
      </Link>

      {/*
        Menu sobreposto à direita, fora do Link.

        `stopPropagation` no wrapper impede que o toque no `⋮` navegue: o
        menu é ação secundária, a row é navegação.
      */}
      <div
        className="absolute right-0 top-1/2 -translate-y-1/2"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Ações do ${bank.name}`}
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(bank)}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            {/* Com histórico a exclusão é sempre recusada pelo backend, então
                oferecer "Excluir" ali seria empurrar o usuário para um erro.
                Um cadastro criado por engano, sem nada ligado, continua
                podendo ser apagado — ninguém precisa arquivar um typo. */}
            {bank.canDelete === false ? (
              <DropdownMenuItem onClick={() => onArchive(bank)}>
                <Archive className="size-3.5" />
                Arquivar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => onDelete(bank)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Excluir
              </DropdownMenuItem>
            )}
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

  const { data: invoices = [] } = useQuery({
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
  const bankRows = useMemo(
    () => orderBanksByUrgency(banks ?? [], invoices),
    [banks, invoices],
  )

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
        ) : isLoading ? (
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
            {bankRows.map(({ bank, selection }, i) => (
              <MotionRow key={bank.id} index={i}>
                <BankRow
                  bank={bank}
                  nearest={selection}
                  onEdit={(b) => {
                    setEditBank(b)
                    setSheetOpen(true)
                  }}
                  onDelete={setDeleteTarget}
                  onArchive={setArchiveTarget}
                />
              </MotionRow>
            ))}
          </div>
        )}
      </div>

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

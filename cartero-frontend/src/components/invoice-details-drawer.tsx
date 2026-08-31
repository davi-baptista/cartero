'use client'

import { useState, useMemo } from 'react'
import type React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, CreditCard, Wallet, Receipt, FileText, TrendingUp, CheckCircle2, Loader2, Undo2, Plus, Pencil, Trash2, MoreVertical, Users } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import { TransactionSheet, type TransactionFormData } from '@/app/(dashboard)/transactions/transaction-sheet'
import { InstallmentScopeDialog } from '@/app/(dashboard)/transactions/installment-scope-dialog'
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  deleteOpenInstallments,
  previewDeleteTransaction,
  type PreviewUpdatePayload,
  type TransactionDeletePreview,
} from '@/services/transactions.service'
import { InstallmentDeleteDialog } from '@/app/(dashboard)/transactions/installment-delete-dialog'
import { deleteSuccessMessage } from '@/lib/installment-delete-copy'
import { belongsToSeries } from '@/lib/installment-series'
import {
  API_ERROR_CODES,
  apiErrorDetail,
  apiErrorMessage,
  isApiErrorCode,
} from '@/lib/api-error'
import { isAxiosError } from 'axios'
import {
  getInvoice,
  updateInvoiceStatus,
  reopenInvoice,
} from '@/services/invoices.service'
import {
  formatCurrency,
  formatMonthYear,
  isExpense,
} from '@/lib/formatters'
import {
  filterByCompositionKey,
  invoiceBreakdown,
  invoiceComposition,
} from '@/lib/invoice-composition'
import { parseDateOnly, formatDateValue } from '@/lib/date'
import { resolveCategoryIcon } from '@/lib/category-icons'
import {
  INVOICE_STATUS_COLOR,
} from '@/lib/invoice-status'
import { invalidateInvoiceDependents } from '@/lib/invoice-dependent-queries'
import {
  invalidateTransactionDependents,
  transactionAffectsPerson,
} from '@/lib/transaction-dependent-queries'
import {
  openDeleteDialogKey,
  scopeDialogKey,
} from '@/lib/transaction-dialog-keys'
import type { Transaction } from '@/types'
import { InvoiceStatus, TransactionType, InstallmentScope } from '@/types'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

function statusHeaderStyle(status: InvoiceStatus): React.CSSProperties {
  const c = INVOICE_STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 10%, transparent)` }
}

const CATEGORY_CHART_LIMIT = 5

const EXPENSE_BG = 'var(--color-expense-bg)'

const TYPE_ICON: Record<TransactionType, LucideIcon> = {
  [TransactionType.INCOME]: TrendingUp,
  [TransactionType.CREDIT_CARD]: CreditCard,
  [TransactionType.DEBIT_CARD]: Wallet,
  [TransactionType.PIX]: Receipt,
  [TransactionType.BOLETO]: FileText,
}

const INCOME_COLOR = 'var(--color-income)'

const INCOME_BG = 'var(--color-income-bg)'

const INCOME_ICON_CLR = 'var(--color-income-icon)'

const EXPENSE_ICON_CLR = 'var(--color-expense-icon)'

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

interface CategorySlice {
  key: string
  name: string
  color: string | null
  icon: string | null
  amount: number
  pct: number
  /** `true` no bucket virtual "De outras pessoas". */
  isThirdParty: boolean
}

function buildCategorySlices(
  transactions: Transaction[] | undefined,
  expanded = false,
): { slices: CategorySlice[]; hiddenCount: number } {
  const ranked = invoiceComposition(transactions ?? [])
  if (ranked.length === 0) return { slices: [], hiddenCount: 0 }

  const hiddenCount = Math.max(0, ranked.length - CATEGORY_CHART_LIMIT)
  const visible = expanded ? [...ranked] : ranked.slice(0, CATEGORY_CHART_LIMIT)

  // Proporção relativa à maior fatia: a barra compara linhas entre si, não
  // contra o total da fatura. A escala vem do ranking inteiro, para as barras
  // não mudarem de tamanho ao expandir.
  const max = ranked[0].amount
  return {
    slices: visible.map((entry) => ({
      ...entry,
      pct: (entry.amount / max) * 100,
    })),
    hiddenCount,
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Drawer de detalhe da fatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Vivia dentro da página de faturas do banco, o que obrigava o Orçamento a
 * NAVEGAR para Bancos só para consultar uma fatura — e o usuário perdia a
 * competência ao fechar.
 *
 * Extraído sem reescrever: já recebia `invoiceId` + `bankId` e resolvia as
 * próprias queries. `CategoryChart` e `TxRow` vieram junto porque só ele os
 * usa. Existe UMA implementação, consumida por Bancos e pelo Orçamento.
 */

function TxRow({
  tx,
  onEdit,
  onDelete,
}: {
  tx: Transaction
  /** Ausentes quando a fatura está paga — nada nela pode ser alterado. */
  onEdit?: (tx: Transaction) => void
  onDelete?: (tx: Transaction) => void
}) {
  const Icon = TYPE_ICON[tx.type]
  const expense = isExpense(tx.type, tx.isRefund)
  const editable = Boolean(onEdit && onDelete)

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: expense ? EXPENSE_BG : INCOME_BG }}
      >
        <Icon aria-hidden="true" className="size-4" style={{ color: expense ? EXPENSE_ICON_CLR : INCOME_ICON_CLR }} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-tight">{tx.title}</span>
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          {tx.category && (() => {
            const { Icon: CatIcon } = resolveCategoryIcon(tx.category.icon)
            return (
              <span className="flex shrink-0 items-center gap-1">
                <CatIcon
                  aria-hidden="true"
                  className="size-3"
                  style={tx.category.color ? { color: tx.category.color } : undefined}
                />
                <span>{tx.category.name}</span>
              </span>
            )
          })()}
          {tx.description && tx.category && (
            <span aria-hidden className="text-muted-foreground/40">·</span>
          )}
          {tx.description && (
            <span className="truncate italic pr-0.5">{tx.description}</span>
          )}
          {tx.person && (tx.category ?? tx.description) && (
            <span aria-hidden className="text-muted-foreground/40">·</span>
          )}
          {tx.person && (
            <span className="truncate shrink-0 text-receivable">
              a receber de {tx.person.name}
            </span>
          )}
        </div>
      </div>

      <div className={cn('shrink-0 text-right', editable && '-mr-1')}>
        <span
          className="text-sm font-semibold tabular-nums tracking-[-0.01em]"
          style={{ color: expense ? undefined : INCOME_COLOR }}
        >
          {expense ? `−${formatCurrency(Number(tx.amount))}` : `+${formatCurrency(Number(tx.amount))}`}
        </span>
        {tx.date && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {format(parseDateOnly(tx.date), 'dd/MM', { locale: ptBR })}
          </p>
        )}
      </div>

      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label={`Ações de ${tx.title}`}
              />
            }
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit!(tx)}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete!(tx)} className="text-destructive">
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function CategoryChart({
  transactions,
  selectedCategory,
  onSelectCategory,
}: {
  transactions: Transaction[] | undefined
  selectedCategory: string | null
  onSelectCategory: (key: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { slices, hiddenCount } = useMemo(
    () => buildCategorySlices(transactions, expanded),
    [transactions, expanded],
  )
  if (slices.length === 0) return null

  return (
    <section
      aria-label="Composição da fatura"
      className="border-t border-border px-6 py-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium text-muted-foreground">
          Composição da fatura
        </h3>
        {selectedCategory && (
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Limpar filtro
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {slices.map((slice, i) => {
          /*
            O bucket de terceiros não é uma Category: usa ícone de pessoas e o
            token `receivable`, o mesmo de "de outras pessoas" no cabeçalho.
            O nome da linha já diz o que é — a cor é reforço, não a informação.
          */
          const { Icon } = slice.isThirdParty
            ? { Icon: Users }
            : resolveCategoryIcon(slice.icon)
          const color = slice.isThirdParty
            ? 'var(--receivable)'
            : (slice.color ?? 'oklch(0.640 0.210 272)')
          const active = selectedCategory === slice.key
          return (
            <button
              key={slice.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectCategory(active ? null : slice.key)}
              className={cn(
                '-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40',
                active && 'bg-muted/60',
                // Uma categoria selecionada apaga as demais, para a lista
                // abaixo e o gráfico contarem a mesma história.
                selectedCategory && !active && 'opacity-40',
              )}
            >
              <div
                className="flex size-6 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)` }}
              >
                <Icon aria-hidden="true" className="size-3" style={{ color }} />
              </div>
              <span className="w-24 shrink-0 truncate text-[11px]">{slice.name}</span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ backgroundColor: color }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${slice.pct}%` }}
                  transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: i * 0.05 }}
                />
              </div>
              <span className="shrink-0 text-[11px] font-medium tabular-nums tracking-[-0.01em]">
                {formatCurrency(slice.amount)}
              </span>
            </button>
          )
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
          {expanded
            ? 'Ver menos'
            : `Ver mais ${hiddenCount} ${hiddenCount === 1 ? 'categoria' : 'categorias'}`}
        </button>
      )}
    </section>
  )
}

export function InvoiceDetailsDrawer({
  invoiceId,
  bankId,
  open,
  onOpenChange,
}: {
  invoiceId: string | null
  bankId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [reopenConfirm, setReopenConfirm] = useState(false)
  const [txSheetOpen, setTxSheetOpen] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{
    tx: Transaction
    mode: 'edit' | 'delete'
  } | null>(null)
  /** Alterações preenchidas, aguardando a escolha de escopo. */
  const [pendingEdit, setPendingEdit] = useState<{
    tx: Transaction
    payload: Parameters<typeof updateTransaction>[1]
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)

  /* Exclusão das parcelas em aberto — mesmo fluxo do Extrato. */
  const [openDeleteTarget, setOpenDeleteTarget] = useState<Transaction | null>(
    null,
  )
  const [refreshedDeletePreview, setRefreshedDeletePreview] =
    useState<TransactionDeletePreview | null>(null)
  const [openDeleteError, setOpenDeleteError] = useState<string | null>(null)
  /**
   * Categoria escolhida no gráfico — recorta a lista abaixo. Guarda junto a
   * fatura a que pertence, para o filtro não vazar ao trocar de fatura.
   */
  const [categoryFilter, setCategoryFilter] = useState<{
    invoiceId: string
    key: string
  } | null>(null)
  const selectedCategory =
    categoryFilter && categoryFilter.invoiceId === invoiceId ? categoryFilter.key : null

  function handleSelectCategory(key: string | null) {
    setCategoryFilter(key && invoiceId ? { invoiceId, key } : null)
  }

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => getInvoice(invoiceId!),
    enabled: !!invoiceId,
  })

  const markPaidMut = useMutation({
    mutationFn: () => updateInvoiceStatus(invoiceId!, InvoiceStatus.PAID),
    onSuccess: () => {
      /*
        Pagar muda `Invoice.status`, e disso dependem o orçamento e a
        capability de exclusão que A Receber e o extrato da pessoa carregam.
        A lista era menor aqui do que em reabrir — as duas mexem no mesmo fato.
      */
      invalidateInvoiceDependents(qc, { invoiceId, bankId })
      toast.success('Fatura marcada como paga')
    },
    onError: () => toast.error('Erro ao atualizar fatura'),
  })

  const reopenMut = useMutation({
    mutationFn: () => reopenInvoice(invoiceId!),
    onSuccess: () => {
      /* Reabrir devolve a compra ao estado excluível — mesma dependência. */
      invalidateInvoiceDependents(qc, { invoiceId, bankId })
      setReopenConfirm(false)
      toast.success('Fatura reaberta')
    },
    onError: () => toast.error('Erro ao reabrir fatura'),
  })

  /** Toda escrita na fatura muda o total dela — o resto do app precisa saber. */
  /**
   * Delega à política compartilhada, acrescentando o que só este painel sabe.
   *
   * A lista local anterior esquecia `invoices` e `receivables`, que o Extrato
   * invalidava — a mesma operação deixava telas diferentes em estados
   * diferentes dependendo de onde foi disparada.
   */
  function invalidateAfterTxChange(affectsPerson = false) {
    invalidateTransactionDependents(qc, { invoiceId, bankId, affectsPerson })
  }

  const createTxMut = useMutation({
    mutationFn: createTransaction,
    onSuccess: (_data, variables) => {
      invalidateAfterTxChange(transactionAffectsPerson(null, variables.personId))
      toast.success('Transação criada')
    },
    onError: (error) => {
      const message = isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : undefined
      toast.error(message ?? 'Erro ao criar transação')
    },
  })

  const updateTxMut = useMutation({
    mutationFn: ({
      id,
      payload,
      scope,
    }: {
      id: string
      payload: Parameters<typeof updateTransaction>[1]
      scope?: InstallmentScope
      previousPersonId?: string | null
    }) => updateTransaction(id, payload, scope),
    onSuccess: (_data, variables) => {
      invalidateAfterTxChange(
        transactionAffectsPerson(
          variables.previousPersonId,
          variables.payload.personId,
        ),
      )
      // O save pode partir do formulário ou do diálogo de escopo; fechar os
      // dois aqui evita deixar um deles aberto sobre a lista já atualizada.
      setTxSheetOpen(false)
      setEditTx(null)
      setScopeDialog(null)
      setPendingEdit(null)
      toast.success('Transação atualizada')
    },
    onError: (error, variables) => {
      // A confirmação de fatura fechada é pedida no diálogo; aqui só resta a
      // corrida (a fatura fechou entre a prévia e o save).
      if (
        isApiErrorCode(error, API_ERROR_CODES.CLOSED_INVOICE_REASSIGNMENT) &&
        !variables.payload.confirmReopenClosedInvoice
      ) {
        toast.error('A fatura foi fechada enquanto você editava. Revise e salve novamente.')
        setScopeDialog(null)
        setPendingEdit(null)
        return
      }
      toast.error(apiErrorMessage(error, 'Erro ao atualizar transação'))
    },
  })

  /**
   * Exclusão das parcelas em aberto, a partir do painel da fatura.
   *
   * O resultado da execução é a autoridade; a prévia exibida apenas informou.
   * Não há detalhe de transação para fechar aqui — este painel é da FATURA,
   * e a exclusão de parcelas não muda qual fatura está aberta.
   */
  const openDeleteMut = useMutation({
    mutationFn: ({
      id,
      expectedDeletableIds,
    }: {
      id: string
      expectedDeletableIds: string[]
    }) => deleteOpenInstallments(id, expectedDeletableIds),
    onSuccess: (result) => {
      /* A execução informa quantas cobranças saíram — resposta precisa. */
      invalidateAfterTxChange(result.receivablesRemoved > 0)

      setOpenDeleteTarget(null)
      setRefreshedDeletePreview(null)
      setOpenDeleteError(null)
      toast.success(deleteSuccessMessage(result.deletedCount))
    },
    onError: async (error) => {
      const conjuntoMudou = isApiErrorCode(
        error,
        API_ERROR_CODES.DELETE_SET_CHANGED,
      )
      const nadaAExcluir = isApiErrorCode(
        error,
        API_ERROR_CODES.NO_DELETABLE_INSTALLMENTS,
      )

      if (conjuntoMudou || nadaAExcluir) {
        /* A recusa carrega o plano recalculado — nenhuma requisição extra. */
        const embutida = apiErrorDetail<TransactionDeletePreview>(
          error,
          'preview',
        )
        if (embutida) {
          setRefreshedDeletePreview(embutida)
          setOpenDeleteError(null)
          return
        }

        /* Fallback defensivo para um backend anterior. Uma tentativa só. */
        const id = openDeleteTarget?.id
        if (id) {
          try {
            setRefreshedDeletePreview(await previewDeleteTransaction(id))
            setOpenDeleteError(null)
            return
          } catch {
            /* A prévia também falhou; usa a mensagem do próprio 409. */
          }
        }
        setOpenDeleteError(
          apiErrorMessage(error, 'A situação das parcelas mudou.'),
        )
        return
      }

      setOpenDeleteError(
        apiErrorMessage(
          error,
          'Não foi possível excluir as parcelas. Tente novamente.',
        ),
      )
    },
  })

  const deleteTxMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: InstallmentScope }) =>
      deleteTransaction(id, scope),
    onSuccess: () => {
      invalidateAfterTxChange()
      setDeleteTarget(null)
      setScopeDialog(null)
      toast.success('Transação excluída')
    },
    onError: (error) => {
      const message = isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : undefined
      toast.error(message ?? 'Erro ao excluir transação')
    },
  })

  const canMarkPaid =
    invoice &&
    (invoice.status === InvoiceStatus.CLOSED || invoice.status === InvoiceStatus.OVERDUE)
  const isPaid = invoice?.status === InvoiceStatus.PAID
  /** Fatura paga é imutável: o total registrado tem de refletir o que foi pago. */
  const canEditTransactions = Boolean(invoice) && !isPaid

  /**
   * Criar a partir da fatura já define banco e tipo.
   *
   * A data cai no meio do mês que alimenta esta fatura — o anterior ao do
   * vencimento. Usar o dia do fechamento colocava a data na borda da janela,
   * e ajustá-la um dia para frente mandava o lançamento para a fatura
   * seguinte. Um dia no miolo do mês é inequívoco e fácil de editar.
   */
  const createDefaults = useMemo(() => {
    if (!invoice) return undefined
    const period = new Date(invoice.year, invoice.month - 2, 15)
    return {
      bankId: invoice.bankId,
      type: TransactionType.CREDIT_CARD,
      date: formatDateValue(period),
    }
  }, [invoice])

  /**
   * Editar abre o formulário direto, como na página de transações.
   *
   * O escopo passou para depois do submit: só com as alterações em mãos o
   * diálogo consegue dizer quantas parcelas cada opção atinge e em quanto.
   */
  function handleEditTx(tx: Transaction) {
    setEditTx(tx)
    setTxSheetOpen(true)
  }

  /*
    Mesma política do Extrato: compra parcelada não escolhe escopo, o servidor
    diz o que ainda pode sair. Duas interpretações da mesma regra em telas
    diferentes é como a divergência começa.
  */
  function handleDeleteTx(tx: Transaction) {
    if (belongsToSeries(tx)) {
      setOpenDeleteTarget(tx)
      return
    }
    setDeleteTarget(tx)
  }

  function handleScopeConfirm(
    scope: InstallmentScope,
    confirmClosedInvoice: boolean,
  ) {
    if (!scopeDialog) return
    const { tx, mode } = scopeDialog

    if (mode === 'delete') {
      deleteTxMut.mutate({ id: tx.id, scope })
      return
    }

    if (!pendingEdit) return
    updateTxMut.mutate({
      id: pendingEdit.tx.id,
      previousPersonId: pendingEdit.tx.personId,
      payload: confirmClosedInvoice
        ? { ...pendingEdit.payload, confirmReopenClosedInvoice: true }
        : pendingEdit.payload,
      scope,
    })
  }

  async function handleTxSubmit(data: TransactionFormData) {
    if (!editTx) {
      await createTxMut.mutateAsync(data)
      setTxSheetOpen(false)
      return
    }

    // Parcelamento: escopo e impacto são resolvidos no diálogo.
    if (belongsToSeries(editTx)) {
      setPendingEdit({ tx: editTx, payload: data })
      setScopeDialog({ tx: editTx, mode: 'edit' })
      setTxSheetOpen(false)
      return
    }

    await updateTxMut.mutateAsync({
      id: editTx.id,
      payload: data,
      previousPersonId: editTx.personId,
    })
    setTxSheetOpen(false)
    setEditTx(null)
  }
  const monthYear = invoice ? capitalize(formatMonthYear(invoice.month, invoice.year)) : ''
  const total = invoice ? Number(invoice.totalAmount) : 0
  const txCount = invoice?.transactions?.length ?? 0
  // Parte do total que já tem dono (pessoa vinculada) — o resto é o que
  // efetivamente sai do seu bolso.
  //
  // A soma passa pelo vocabulário central para respeitar estornos: antes ela
  // somava `amount` de toda transação com pessoa, então o estorno de uma
  // compra de terceiro AUMENTAVA "de outras pessoas" e reduzia "sua parte" —
  // o inverso do correto.
  /*
    `own` é derivado de `gross - others`, não somado em paralelo.

    O cabeçalho exibia "R$ NaN sua parte": a API serializa `Decimal` como
    string, e a soma concatenava texto. A conversão agora acontece na borda
    (`invoices.service.ts`), e o helper ainda normaliza defensivamente.
  */
  const { own: ownTotal, others: reimbursableTotal } = invoiceBreakdown(
    invoice?.totalAmount ?? 0,
    invoice?.transactions ?? [],
  )
  const installmentNumber = (tx: Transaction) => {
    const match = tx.title.match(/\s(\d+)\/\d+$/)
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
  }
  /**
   * Uma lista só, por data decrescente. Como toda parcela guarda a data da
   * compra, as de meses anteriores afundam sozinhas e a parcela do próprio
   * mês aparece junto das outras compras — sem precisar separar em seções.
   */
  const txs =
    invoice?.transactions
      ?.slice()
      /*
        O filtro segue a MESMA regra do agrupamento: o bucket mostra quem tem
        pessoa; uma categoria mostra só as próprias. Filtrar por categoria e
        incluir a transação de terceiro contradiria a composição acima.
      */
      .filter((tx) => filterByCompositionKey([tx], selectedCategory).length > 0)
      .sort(
        (a, b) =>
          parseDateOnly(b.date).getTime() - parseDateOnly(a.date).getTime() ||
          installmentNumber(a) - installmentNumber(b) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ) ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg" showCloseButton>
        {isLoading || !invoice ? (
          <div className="flex flex-1 flex-col">
            <div className="border-b px-6 pb-4 pt-6">
              <Skeleton className="h-7 w-40" />
            </div>
            <div className="border-b px-6 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-36" />
            </div>
            <div className="space-y-px pt-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="border-b px-6 pb-4 pt-6" style={statusHeaderStyle(invoice.status)}>
              <SheetTitle className="text-lg font-semibold tracking-tight">
                {monthYear}
              </SheetTitle>
            </SheetHeader>

            {/* Total + action */}
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-xs text-muted-foreground">Total da fatura</p>
                <p className={cn(
                  'mt-1 text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
                  invoice.status === InvoiceStatus.OVERDUE && 'text-destructive',
                  invoice.status === InvoiceStatus.PAID && 'text-paid',
                )}>
                  {formatCurrency(total)}
                </p>
                {reimbursableTotal > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className="text-foreground/80">{formatCurrency(ownTotal)}</span> sua parte ·{' '}
                    <span className="text-receivable">{formatCurrency(reimbursableTotal)}</span> de outras pessoas
                  </p>
                )}
              </div>
              {canMarkPaid && (
                <Button
                  onClick={() => markPaidMut.mutate()}
                  disabled={markPaidMut.isPending}
                >
                  {markPaidMut.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Marcar como paga
                </Button>
              )}
              {isPaid && (
                <Button
                  variant="outline"
                  onClick={() => setReopenConfirm(true)}
                  disabled={reopenMut.isPending}
                >
                  {reopenMut.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="size-3.5" />
                  )}
                  Reabrir
                </Button>
              )}
            </div>

            <CategoryChart
              transactions={invoice.transactions}
              selectedCategory={selectedCategory}
              onSelectCategory={handleSelectCategory}
            />

            {/* Transaction list */}
            <div className="flex-1 overflow-y-auto">
              {txs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted/40">
                    <Receipt className="size-5 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm font-medium">Nenhuma transação</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedCategory
                      ? 'Nenhuma transação nesta categoria.'
                      : 'Esta fatura não tem transações registradas.'}
                  </p>
                  {/* Sem o cabeçalho da lista, o botão precisa existir aqui —
                      é justamente quando ele é mais útil. */}
                  {canEditTransactions && !selectedCategory && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        setEditTx(null)
                        setTxSheetOpen(true)
                      }}
                    >
                      <Plus className="size-3.5" />
                      Adicionar transação
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {/* O botão fica no cabeçalho da lista: é uma ação sobre ela,
                      e uma faixa própria custava espaço num painel estreito. */}
                  {/* Altura fixa: sem ela a faixa encolhe quando o botão não
                      aparece, e o cabeçalho muda de tamanho entre uma fatura
                      paga e uma aberta. */}
                  <div className="flex h-11 items-center justify-between gap-2 border-y border-border pl-4 pr-2">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Transações · {txs.length}
                      {selectedCategory && ` de ${txCount}`}
                    </p>
                    {canEditTransactions && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditTx(null)
                            setTxSheetOpen(true)
                        }}
                      >
                        <Plus className="size-3.5" />
                        Adicionar
                      </Button>
                    )}
                  </div>
                  {txs.map((tx, i) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.03, ease: EASE_OUT_EXPO }}
                      className="border-b border-border last:border-b-0"
                    >
                      <TxRow
                        tx={tx}
                        onEdit={canEditTransactions ? handleEditTx : undefined}
                        onDelete={canEditTransactions ? handleDeleteTx : undefined}
                      />
                    </motion.div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>

      <Dialog open={reopenConfirm} onOpenChange={setReopenConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir fatura</DialogTitle>
            <DialogDescription>
              A fatura deixa de constar como paga e volta ao estado que a data
              dela determina. Use isso quando precisar editar um lançamento —
              depois é só marcar como paga de novo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenConfirm(false)}>
              Cancelar
            </Button>
            <Button onClick={() => reopenMut.mutate()} disabled={reopenMut.isPending}>
              {reopenMut.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Reabrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransactionSheet
        open={txSheetOpen}
        onOpenChange={(open) => {
          setTxSheetOpen(open)
          if (!open) setEditTx(null)
        }}
        editTarget={editTx}
        onSubmit={handleTxSubmit}
        createDefaults={createDefaults}
      />

      {/* `siblings` são as transações desta fatura. Como cada parcela cai numa
          fatura diferente, a série chega quase sempre incompleta — o diálogo
          detecta isso e apresenta os números como piso, não como total. Na
          edição o impacto exato vem da prévia do servidor. */}
      {/* Exclusão de compra parcelada — o mesmo diálogo do Extrato. */}
      <InstallmentDeleteDialog
        /*
          O prefixo distingue este diálogo do de escopo, que é IRMÃO e fica
          montado junto: com a mesma sentinela nos dois, o estado ocioso lhes
          dava a MESMA key e o React reclamava de chave duplicada.
        */
        key={openDeleteDialogKey(openDeleteTarget?.id)}
        open={openDeleteTarget !== null}
        transactionId={openDeleteTarget?.id ?? null}
        isPending={openDeleteMut.isPending}
        refreshedPreview={refreshedDeletePreview}
        executionError={openDeleteError}
        onConfirm={(expectedDeletableIds) => {
          if (!openDeleteTarget) return
          setOpenDeleteError(null)
          openDeleteMut.mutate({
            id: openDeleteTarget.id,
            expectedDeletableIds,
          })
        }}
        onCancel={() => {
          setOpenDeleteTarget(null)
          setRefreshedDeletePreview(null)
          setOpenDeleteError(null)
        }}
      />

      <InstallmentScopeDialog
        // Remonta por operação — escopo inicial limpo sem efeito de reset.
        key={scopeDialogKey(
          scopeDialog && {
            mode: scopeDialog.mode,
            transactionId: scopeDialog.tx.id,
          },
        )}
        open={scopeDialog !== null}
        mode={scopeDialog?.mode ?? 'delete'}
        transaction={scopeDialog?.tx ?? null}
        siblings={invoice?.transactions ?? []}
        pendingChanges={
          scopeDialog?.mode === 'edit' && pendingEdit
            ? (pendingEdit.payload as PreviewUpdatePayload)
            : null
        }
        isPending={
          scopeDialog?.mode === 'delete'
            ? deleteTxMut.isPending
            : updateTxMut.isPending
        }
        onConfirm={handleScopeConfirm}
        onCancel={() => {
          setScopeDialog(null)
          setPendingEdit(null)
        }}
        linkedWarning={Boolean(scopeDialog?.tx.personId)}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir transação</DialogTitle>
            <DialogDescription>
              {deleteTarget?.title} será removida da fatura e o total será
              recalculado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTxMut.isPending}
              onClick={() =>
                deleteTarget && deleteTxMut.mutate({ id: deleteTarget.id })
              }
            >
              {deleteTxMut.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}

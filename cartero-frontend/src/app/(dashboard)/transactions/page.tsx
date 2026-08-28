'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  CreditCard,
  Wallet,
  Receipt,
  FileText,
  TrendingUp,
  Search,
  X,
  Repeat,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { monthBounds, periodFromDate, useMonthPeriod } from '@/components/month-nav'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MotionRow } from '@/components/ui/motion-row'
import { TransactionSheet, type TransactionFormData } from './transaction-sheet'
import { InstallmentScopeDialog } from './installment-scope-dialog'
import type { PreviewUpdatePayload } from '@/services/transactions.service'
import { belongsToSeries as belongsToInstallmentSeries } from '@/lib/installment-series'
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '@/services/transactions.service'
import { getBanks } from '@/services/banks.service'
import { getCategories } from '@/services/categories.service'
import { formatCurrency, formatDate, isExpense, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { bankDisplayName } from '@/lib/bank-display'
import { API_ERROR_CODES, apiErrorMessage, apiErrorStatus, isApiErrorCode } from '@/lib/api-error'
import { resolveCategoryIcon } from '@/lib/category-icons'
import {
  FinancialListRow,
  ROW_AMOUNT_CLASS,
  ROW_AMOUNT_TONE,
  ROW_ICON_CLASS,
  ROW_TRAILING_META_CLASS,
} from '@/components/ui/financial-list-row'
import { cn } from '@/lib/utils'
import { useHighlight } from '@/lib/use-highlight'
import type { Transaction } from '@/types'
import { TransactionType, InstallmentScope } from '@/types'

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_ICON: Record<TransactionType, LucideIcon> = {
  [TransactionType.INCOME]: TrendingUp,
  [TransactionType.CREDIT_CARD]: CreditCard,
  [TransactionType.DEBIT_CARD]: Wallet,
  [TransactionType.PIX]: Receipt,
  [TransactionType.BOLETO]: FileText,
}

// Grupos de tipo combinados para navegação vinda de outras telas.
type TypeGroup = 'direct'
const TYPE_GROUPS: Record<TypeGroup, TransactionType[]> = {
  direct: [TransactionType.DEBIT_CARD, TransactionType.PIX, TransactionType.BOLETO],
}

const INCOME_BG = 'var(--color-income-bg)'
const EXPENSE_BG = 'var(--color-expense-bg)'
const EXPENSE_ICON_CLR = 'var(--color-expense-icon)'
const INCOME_COLOR = 'var(--color-income)'

const INVOICE_MONTHS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
]

function formatInvoicePeriod(invoice?: Transaction['invoice']) {
  if (!invoice) return null
  return `${INVOICE_MONTHS[invoice.month - 1] ?? invoice.month}/${invoice.year}`
}


/** Total de parcelas da compra, lido do sufixo "x/y" do título. */
function getInstallmentCount(tx: Transaction): number | null {
  const match = tx.title.match(/\s\d+\/(\d+)$/)
  return match ? Number(match[1]) : null
}

/** Título sem o sufixo de parcela — "Notebook 1/10" vira "Notebook". */
function stripInstallmentSuffix(title: string): string {
  return title.replace(/\s\d+\/\d+$/, '')
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/**
 * O valor da row, na escala e nas cores canônicas.
 *
 * Tinha uma variante `size="sm"` (`text-sm font-medium`) usada só no bloco
 * mobile: no celular — onde a lista é mais consultada — o valor do Extrato
 * aparecia menor e mais fraco que o das outras telas. A variante saiu; o
 * tamanho agora é um só.
 *
 * A cor da entrada também vinha de `--color-income`, um verde mais claro e
 * saturado que o `text-receivable` das demais listas. Passou a usar o token
 * compartilhado.
 */
function AmountDisplay({ amount, type, isRefund = false }: { amount: number; type: TransactionType; isRefund?: boolean }) {
  const expense = isExpense(type, isRefund)
  const formatted = formatCurrency(amount)
  return (
    <span
      className={cn(
        ROW_AMOUNT_CLASS,
        expense ? ROW_AMOUNT_TONE.out : ROW_AMOUNT_TONE.in,
      )}
    >
      {expense ? `−${formatted}` : `+${formatted}`}
    </span>
  )
}

function TransactionRow({
  tx,
  onView,
  isHighlighted,
  highlightRef,
}: {
  tx: Transaction
  onView: (tx: Transaction) => void
  /** Alvo do `?highlight=` — recebe destaque temporário. */
  isHighlighted?: boolean
  highlightRef?: (node: HTMLElement | null) => void
}) {
  const Icon = TYPE_ICON[tx.type]
  const visibleBank = tx.bank?.isSystem ? undefined : tx.bank

  return (
    <FinancialListRow
      ref={isHighlighted ? highlightRef : undefined}
      onView={() => onView(tx)}
      ariaLabel={`Ver detalhes de ${tx.title}`}
      /*
        Destaque discreto e temporário. Um anel permanente seria lido como
        status do lançamento; este apaga sozinho depois de alguns segundos.
      */
      className={cn(isHighlighted && 'bg-primary/10 ring-2 ring-primary/40')}
      leading={
        <div
          className={ROW_ICON_CLASS}
          style={{ backgroundColor: isExpense(tx.type, tx.isRefund) ? EXPENSE_BG : INCOME_BG }}
        >
          <Icon aria-hidden="true" className="size-4.5 sm:size-5" style={{ color: isExpense(tx.type, tx.isRefund) ? EXPENSE_ICON_CLR : INCOME_COLOR }} />
        </div>
      }
      title={tx.title}
      meta={
        <>
          <span className="shrink-0">{TRANSACTION_TYPE_LABELS[tx.type]}</span>
          {tx.isRefund && <span className="shrink-0 text-primary">· reembolso</span>}
          {visibleBank && <span aria-hidden>·</span>}
          {visibleBank && <span className="truncate">{visibleBank.name}</span>}
          {tx.invoice && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 text-muted-foreground/70">
                fatura {formatInvoicePeriod(tx.invoice)}
              </span>
            </>
          )}
          {/* O nome sozinho era indistinguível do banco na mesma linha —
              "Eva" e "Nubank" liam igual. O rótulo diz a relação. */}
          {tx.person && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate text-receivable">
                a receber de {tx.person.name}
              </span>
            </>
          )}
          {tx.subscriptionId && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex shrink-0 items-center gap-1">
                <Repeat className="size-3" aria-hidden />
                assinatura
              </span>
            </>
          )}
        </>
      }
      /* Só no desktop: no celular a metadata acima já ocupa a largura útil. */
      belowMeta={
        tx.description ? (
          <p className="hidden truncate text-xs text-muted-foreground/60 sm:block">
            {tx.description}
          </p>
        ) : null
      }
      trailing={
        <>
          <AmountDisplay amount={tx.amount} type={tx.type} isRefund={tx.isRefund} />
          <span className={ROW_TRAILING_META_CLASS}>{formatDate(tx.date)}</span>
        </>
      }
      trailingCompact={
        <AmountDisplay amount={tx.amount} type={tx.type} isRefund={tx.isRefund} />
      }
    />
  )
}

/**
 * Compra parcelada como um item só: mostra o valor total no dia da compra e
 * revela as parcelas individuais ao expandir.
 */
const VISIBLE_INSTALLMENTS = 3

function InstallmentGroup({
  root,
  installments,
  onView,
  highlightedId,
}: {
  root: Transaction
  installments: Transaction[]
  onView: (tx: Transaction) => void
  highlightedId?: string | null
}) {
  /*
    Quando o destaque aponta para uma parcela escondida, o grupo já abre
    expandido.

    Destacar só o container deixaria o usuário olhando para a série sem ver a
    parcela que ele pediu — o link aponta para uma parcela específica.
  */
  const highlightedIndex = highlightedId
    ? installments.findIndex((tx) => tx.id === highlightedId)
    : -1
  const [showAll, setShowAll] = useState(
    highlightedIndex >= VISIBLE_INSTALLMENTS,
  )
  const Icon = TYPE_ICON[root.type]
  const visibleBank = root.bank?.isSystem ? undefined : root.bank
  const count = getInstallmentCount(root) ?? installments.length
  const total = installments.reduce((sum, tx) => sum + tx.amount, 0)
  const baseTitle = stripInstallmentSuffix(root.title)

  const visible = showAll ? installments : installments.slice(0, VISIBLE_INSTALLMENTS)
  const hiddenCount = installments.length - visible.length

  return (
    <div>
      <FinancialListRow
        onView={() => onView(root)}
        ariaLabel={`Ver detalhes de ${baseTitle}`}
        leading={
          <div className={ROW_ICON_CLASS} style={{ backgroundColor: EXPENSE_BG }}>
            <Icon aria-hidden="true" className="size-4.5 sm:size-5" style={{ color: EXPENSE_ICON_CLR }} />
          </div>
        }
        title={baseTitle}
        titleAdornment={
          <span className="shrink-0 text-[11px] font-medium text-primary/70">{count}x</span>
        }
        meta={
          <>
            <span className="shrink-0">{TRANSACTION_TYPE_LABELS[root.type]}</span>
            {visibleBank && <span aria-hidden>·</span>}
            {visibleBank && <span className="truncate">{visibleBank.name}</span>}
            {root.person && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate text-receivable">
                  a receber de {root.person.name}
                </span>
              </>
            )}
          </>
        }
        trailing={
          <>
            <AmountDisplay amount={total} type={root.type} isRefund={root.isRefund} />
            <span className={ROW_TRAILING_META_CLASS}>{formatDate(root.date)}</span>
          </>
        }
        trailingCompact={
          <AmountDisplay amount={total} type={root.type} isRefund={root.isRefund} />
        }
      />

      {/* Parcelas — subordinadas ao item, sempre visíveis */}
      <div className="ml-5 border-l border-border/50 pl-1 sm:ml-7 sm:pl-2">
        {visible.map((tx) => (
          <InstallmentRow key={tx.id} tx={tx} onView={onView} />
        ))}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="px-2 py-2 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Ver todas as {installments.length} parcelas
          </button>
        )}
      </div>
    </div>
  )
}

/** Parcela individual dentro de um grupo — discreta, subordinada ao item pai. */
function InstallmentRow({
  tx,
  onView,
}: {
  tx: Transaction
  onView: (tx: Transaction) => void
}) {
  const label = tx.title.match(/\s(\d+\/\d+)$/)?.[1] ?? tx.title

  return (
    <button
      type="button"
      onClick={() => onView(tx)}
      className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50"
      aria-label={`Ver detalhes da parcela ${label}`}
    >
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{label}</span>
      {tx.invoice && (
        <span className="truncate text-[11px] text-muted-foreground/60">
          fatura {formatInvoicePeriod(tx.invoice)}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatCurrency(tx.amount)}
      </span>
    </button>
  )
}

function TransactionDetailsDialog({
  transaction,
  siblings,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  transaction: Transaction | null
  /**
   * Transações já carregadas na tela, usadas para somar a série de um
   * parcelamento. Evita uma requisição só para mostrar o total.
   */
  siblings: Transaction[]
  onOpenChange: (open: boolean) => void
  onEdit: (tx: Transaction) => void
  onDelete: (tx: Transaction) => void
}) {
  if (!transaction) return null

  const categoryIcon = transaction.category
    ? resolveCategoryIcon(transaction.category.icon).Icon
    : null
  const CategoryIcon = categoryIcon
  const installment = Boolean(transaction.parentId) || /\s\d+\/\d+$/.test(transaction.title)

  /**
   * Posição na série e total da compra.
   *
   * A série é agrupada por `parentId ?? id` — metadado estrutural, não o
   * título. A posição ainda vem do sufixo porque é o único lugar onde ela
   * existe hoje; a substituição definitiva da regex é fase estrutural.
   *
   * O total é a SOMA das parcelas presentes, nunca valor × quantidade: séries
   * podem ter centavos diferentes entre parcelas. Fica `null` quando a lista
   * carregada não contém a série inteira, para não exibir um total parcial
   * como se fosse o da compra.
   */
  const seriesInfo = (() => {
    if (!installment) return null

    const declared = transaction.title.match(/\s\d+\/(\d+)$/)
    const count = declared ? Number(declared[1]) : null
    const position = transaction.title.match(/\s(\d+)\/\d+$/)?.[1]
    const rootId = transaction.parentId ?? transaction.id
    const series = siblings.filter(
      (tx) => (tx.parentId ?? tx.id) === rootId,
    )

    const complete = count !== null && series.length === count
    return {
      position: position ?? '?',
      count: count ?? series.length,
      total: complete
        ? series.reduce((sum, tx) => sum + tx.amount, 0)
        : null,
    }
  })()

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-0 max-h-[88dvh] max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-2xl p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
        <DialogHeader className="border-b border-border px-5 py-5 pr-12">
          <DialogTitle className="text-lg leading-snug">{transaction.title}</DialogTitle>
          <DialogDescription>
            {TRANSACTION_TYPE_LABELS[transaction.type]} · {formatDate(transaction.date)}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border bg-muted/20 px-5 py-4">
          {/* "Valor pago" não descrevia um estorno nem uma parcela; o rótulo
              agora diz exatamente qual valor é este. */}
          <p className="text-xs font-medium text-muted-foreground">
            {installment ? 'Valor desta parcela' : 'Valor'}
          </p>
          <div className="mt-1">
            <AmountDisplay amount={transaction.amount} type={transaction.type} isRefund={transaction.isRefund} />
          </div>
          {transaction.isRefund && (
            <p className="mt-1 text-[11px] text-primary">
              Estorno — reduz o total da fatura
            </p>
          )}
        </div>

        <dl className="divide-y divide-border px-5">
          <DetailRow label="Natureza">
            {transaction.type === TransactionType.INCOME ? 'Receita' : 'Gasto'}
          </DetailRow>
          {transaction.type !== TransactionType.INCOME && (
            <DetailRow label="Forma de pagamento">
              {TRANSACTION_TYPE_LABELS[transaction.type]}
            </DetailRow>
          )}
          <DetailRow label="Banco">
            {bankDisplayName(transaction.bank)}
          </DetailRow>
          <DetailRow label="Categoria">
            <span className="flex min-w-0 items-center justify-end gap-1.5">
              {CategoryIcon && (
                <CategoryIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                  style={transaction.category?.color ? { color: transaction.category.color } : undefined}
                />
              )}
              <span className="truncate">{transaction.category?.name ?? 'Não informada'}</span>
            </span>
          </DetailRow>
          {/* Relação explícita: "Eva" sozinho não dizia o que ela é nesta
              compra. */}
          {transaction.person && (
            <DetailRow label="Cobrança">
              <span className="text-receivable">
                A receber de {transaction.person.name}
              </span>
            </DetailRow>
          )}
          {installment && (
            <DetailRow label="Parcelamento">
              {seriesInfo
                ? `Parcela ${seriesInfo.position} de ${seriesInfo.count}`
                : 'Parcelado'}
            </DetailRow>
          )}
          {/* Total da compra pela SOMA real das parcelas — nunca valor × N,
              porque a série pode ter centavos diferentes entre parcelas. */}
          {seriesInfo && seriesInfo.total !== null && (
            <DetailRow label="Total da compra">
              <span className="tabular-nums">
                {formatCurrency(seriesInfo.total)}
              </span>
              <span className="ml-1 text-muted-foreground">
                · {seriesInfo.count} parcelas
              </span>
            </DetailRow>
          )}
          {transaction.invoice && (
            <DetailRow label="Fatura">
              {formatInvoicePeriod(transaction.invoice)}
            </DetailRow>
          )}
          {transaction.description && (
            <DetailRow label="Descrição">
              <span className="whitespace-pre-wrap">{transaction.description}</span>
            </DetailRow>
          )}
        </dl>

        <div className="flex gap-2 border-t border-border px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            variant="outline"
            className="h-11 flex-1 sm:h-9"
            onClick={() => onEdit(transaction)}
          >
            <Pencil className="size-4" />
            Editar
          </Button>
          <Button
            variant="destructive"
            className="h-11 flex-1 sm:h-9"
            onClick={() => onDelete(transaction)}
          >
            <Trash2 className="size-4" />
            Excluir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-border px-2 py-4 last:border-b-0">
      <Skeleton className="size-11 shrink-0 rounded-2xl" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}

// O mês selecionado é navegação, não filtro — só conta o que restringe a lista
// dentro daquele mês.
function hasActiveFilters(f: Omit<FilterState, 'startDate' | 'endDate'>): boolean {
  return !!(f.bankId || f.categoryId || f.type)
}

// ─── Filter state type ────────────────────────────────────────────────────────

interface FilterState {
  startDate?: string
  endDate?: string
  bankId?: string
  categoryId?: string
  type?: TransactionType
  invoicePeriod?: boolean
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const qc = useQueryClient()
  const searchParams = useSearchParams()

  // ── State ──
  // O mês é contexto do app (barra superior). Quando a navegação vem de outra
  // tela com um intervalo na URL, alinhamos o mês global àquele intervalo.
  const { period, setPeriod } = useMonthPeriod()
  const urlPeriodApplied = useRef(false)

  useEffect(() => {
    if (urlPeriodApplied.current) return
    const spDate = searchParams.get('startDate') ?? searchParams.get('endDate')
    if (!spDate) return
    urlPeriodApplied.current = true
    const next = periodFromDate(spDate)
    if (next.month !== period.month || next.year !== period.year) setPeriod(next)
  }, [searchParams, period.month, period.year, setPeriod])

  /*
    `?highlight=<transactionId>` — chegada a partir de "Ver a compra".

    Só navegação: a lista continua filtrada por ownership no backend, e um id
    que não esteja nos dados carregados simplesmente não destaca nada.
  */
  const { highlightedId, highlightRef } = useHighlight(
    searchParams.get('highlight'),
  )

  const [filters, setFilters] = useState<Omit<FilterState, 'startDate' | 'endDate'>>(() => {
    const spCategory = searchParams.get('categoryId')
    const spType = searchParams.get('type')
    const spTypeValid = spType && Object.values(TransactionType).includes(spType as TransactionType)
      ? (spType as TransactionType)
      : undefined
    return {
      categoryId: spCategory ?? undefined,
      type: spTypeValid,
      // Preserva a competência de fatura quando a navegação vem de uma tela
      // que soma por vencimento — senão a lista mostraria itens diferentes
      // do número que foi clicado.
      invoicePeriod: searchParams.get('invoicePeriod') === 'true' || undefined,
    }
  })
  const [bankFilter, setBankFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('categoryId') ?? '')
  const [search, setSearch] = useState('')
  // Grupo de tipos combinados vindo de navegação externa (ex: Orçamento →
  // "Débito, PIX e boleto"). Filtro client-side, não passa pelo backend.
  const [typeGroup, setTypeGroup] = useState<TypeGroup | undefined>(
    () => (searchParams.get('group') as TypeGroup | null) === 'direct' ? 'direct' : undefined,
  )

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [detailsTx, setDetailsTx] = useState<Transaction | null>(null)

  const [scopeDialog, setScopeDialog] = useState<{ tx: Transaction; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  /**
   * Alterações já preenchidas, aguardando a escolha de escopo.
   *
   * Guardadas aqui para que o diálogo possa pedir a prévia ao servidor com o
   * payload exato que o save usará — projeção e gravação partem do mesmo dado.
   */
  const [pendingEdit, setPendingEdit] = useState<{
    tx: Transaction
    payload: Parameters<typeof updateTransaction>[1]
  } | null>(null)

  const queryFilters = useMemo<FilterState>(
    () => ({ ...filters, ...monthBounds(period) }),
    [filters, period],
  )

  // ── Queries ──
  const {
    data: transactions,
    isLoading: txLoading,
    isError: txError,
    isFetching: txFetching,
    refetch: refetchTx,
  } = useQuery({
    queryKey: ['transactions', queryFilters],
    queryFn: () => getTransactions(queryFilters),
  })

  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: () => getBanks(),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  })

  // ── Mutations ──
  const createMut = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSheetOpen(false)
      toast.success('Transação criada')
    },
    onError: () => toast.error('Não foi possível criar a transação. Tente novamente.'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload, scope }: { id: string; payload: Parameters<typeof updateTransaction>[1]; scope?: InstallmentScope }) =>
      updateTransaction(id, payload, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSheetOpen(false)
      setEditTx(null)
      setScopeDialog(null)
      setPendingEdit(null)
      toast.success('Transação atualizada')
    },
    onError: (err, variables) => {
      /**
       * A confirmação de fatura fechada normalmente já foi dada no diálogo de
       * escopo, que a pede antes de salvar. Este caminho cobre a corrida: a
       * fatura fechou entre a prévia e o save. Reenviar aqui com o aceite
       * embutido resolve sem abrir um segundo diálogo sobre o primeiro.
       */
      if (isApiErrorCode(err, API_ERROR_CODES.CLOSED_INVOICE_REASSIGNMENT)) {
        if (variables.payload.confirmReopenClosedInvoice) {
          toast.error(
            apiErrorMessage(err, 'A fatura foi fechada. Tente salvar novamente.'),
          )
          return
        }
        toast.error('A fatura foi fechada enquanto você editava. Revise e salve novamente.')
        setScopeDialog(null)
        setPendingEdit(null)
        return
      }
      if (apiErrorStatus(err) === 403) {
        toast.error('Não é possível editar transações de faturas já pagas.')
        return
      }
      // As recusas de integridade (recebível já pago, por exemplo) vêm com
      // mensagem própria explicando o que fazer — mostrá-la é mais útil que
      // "Não foi possível salvar".
      toast.error(
        apiErrorMessage(err, 'Não foi possível salvar as alterações. Tente novamente.'),
      )
    },
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: InstallmentScope; hasPerson?: boolean }) =>
      deleteTransaction(id, scope),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['bank-invoices'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setDeleteTarget(null)
      setScopeDialog(null)
      toast.success(
        variables.hasPerson
          ? 'Transação excluída — o recebível vinculado também foi removido'
          : 'Transação excluída',
      )
    },
    // Recusas como "esta transação registra o pagamento de uma dívida" trazem
    // a instrução do que fazer; o genérico deixaria o usuário sem saída.
    onError: (err) =>
      toast.error(
        apiErrorMessage(err, 'Não foi possível excluir a transação. Tente novamente.'),
      ),
  })

  // ── Client-side search filter ──
  const filteredTransactions = useMemo(() => {
    if (!transactions) return undefined
    let result = transactions
    if (typeGroup) {
      const allowed = TYPE_GROUPS[typeGroup]
      result = result.filter((tx) => allowed.includes(tx.type))
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (tx) =>
          tx.title.toLowerCase().includes(q) ||
          (tx.description?.toLowerCase().includes(q) ?? false),
      )
    }
    return result
  }, [transactions, search, typeGroup])

  /**
   * Cada compra parcelada vira um item único, ancorado na data da compra e
   * carregando todas as suas parcelas. O restante entra como transação avulsa.
   */
  const displayItems = useMemo(() => {
    if (!filteredTransactions) return undefined

    const groups = new Map<string, Transaction[]>()
    const items: Array<
      { kind: 'single'; tx: Transaction } | { kind: 'installment'; groupId: string }
    > = []

    for (const tx of filteredTransactions) {
      // A primeira parcela é a raiz da série e tem parentId nulo — ela se
      // identifica pelo próprio id, senão viraria um item solto.
      const isInstallment = Boolean(tx.parentId) || /\s\d+\/\d+$/.test(tx.title)
      if (!isInstallment) {
        items.push({ kind: 'single', tx })
        continue
      }

      const groupId = tx.parentId ?? tx.id
      const existing = groups.get(groupId)
      if (existing) {
        existing.push(tx)
      } else {
        groups.set(groupId, [tx])
        items.push({ kind: 'installment', groupId })
      }
    }

    // Ordena as parcelas de cada grupo por número (1/10, 2/10, …).
    for (const list of groups.values()) {
      list.sort((a, b) => {
        const na = Number(a.title.match(/\s(\d+)\/\d+$/)?.[1] ?? 0)
        const nb = Number(b.title.match(/\s(\d+)\/\d+$/)?.[1] ?? 0)
        return na - nb
      })
    }

    return { items, groups }
  }, [filteredTransactions])

  // ── Summary ──
  // ── Handlers ──
  /**
   * Editar abre o formulário direto, mesmo em parcelamento.
   *
   * O escopo é decidido no submit, não antes: só com as alterações em mãos o
   * diálogo consegue dizer o que cada escopo faria. Perguntar primeiro exigia
   * escolher entre "esta" e "todas" sem saber o que estava mudando.
   */
  function handleEdit(tx: Transaction) {
    setDetailsTx(null)
    setEditTx(tx)
    setSheetOpen(true)
  }

  function handleDelete(tx: Transaction) {
    setDetailsTx(null)
    if (belongsToInstallmentSeries(tx)) {
      setScopeDialog({ tx, mode: 'delete' })
    } else {
      setDeleteTarget(tx)
    }
  }

  /** Monta o payload de update a partir do formulário. */
  function buildUpdatePayload(tx: Transaction, data: TransactionFormData) {
    const { installments, title, personId, ...rest } = data
    void installments
    // Em parcelamento o título é derivado da série ("Nome x/y"); o backend
    // ignora alterações nele, e mandá-lo daria a impressão de que pegou.
    const payload = tx.parentId ? rest : { ...rest, title }
    return {
      ...payload,
      personId: data.type === TransactionType.CREDIT_CARD ? (personId ?? null) : null,
    }
  }

  async function handleSheetSubmit(data: TransactionFormData) {
    if (!editTx) {
      await createMut.mutateAsync(data)
      return
    }

    const payload = buildUpdatePayload(editTx, data)

    // Parcelamento: o escopo e o impacto são resolvidos no diálogo, que já
    // recebe as alterações pendentes para projetá-las.
    if (belongsToInstallmentSeries(editTx)) {
      setPendingEdit({ tx: editTx, payload })
      setScopeDialog({ tx: editTx, mode: 'edit' })
      setSheetOpen(false)
      return
    }

    await updateMut.mutateAsync({ id: editTx.id, payload })
  }

  /** Confirmação do diálogo de escopo — para edição e exclusão. */
  function handleScopeConfirm(scope: InstallmentScope, confirmClosedInvoice: boolean) {
    if (!scopeDialog) return

    if (scopeDialog.mode === 'delete') {
      deleteMut.mutate({
        id: scopeDialog.tx.id,
        scope,
        hasPerson: Boolean(scopeDialog.tx.personId),
      })
      return
    }

    if (!pendingEdit) return
    updateMut.mutate({
      id: pendingEdit.tx.id,
      // O aceite da fatura fechada já foi dado no próprio diálogo; enviá-lo
      // junto evita o segundo diálogo que antes surgia depois do erro.
      payload: confirmClosedInvoice
        ? { ...pendingEdit.payload, confirmReopenClosedInvoice: true }
        : pendingEdit.payload,
      scope,
    })
  }

  function setTypeFilter(type: TransactionType | undefined) {
    setFilters((f) => ({ ...f, type }))
  }

  function setBankFilterValue(val: string | null) {
    const v = val ?? ''
    setBankFilter(v)
    setFilters((f) => ({ ...f, bankId: v || undefined }))
  }

  function setCategoryFilterValue(val: string | null) {
    const v = val ?? ''
    setCategoryFilter(v)
    setFilters((f) => ({ ...f, categoryId: v || undefined }))
  }

  function clearFilters() {
    setFilters({})
    setBankFilter('')
    setCategoryFilter('')
    setSearch('')
    setTypeGroup(undefined)
  }

  const typeFilterValues: Array<{ label: string; value: TransactionType | undefined }> = [
    { label: 'Todos', value: undefined },
    ...Object.values(TransactionType).map((t) => ({ label: TRANSACTION_TYPE_LABELS[t], value: t })),
  ]

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extrato</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Histórico do que aconteceu, na data em que aconteceu
          </p>
        </div>
        <Button onClick={() => { setEditTx(null); setSheetOpen(true) }}>
          <Plus className="size-4" />
          Nova transação
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Bank select */}
          <Select value={bankFilter} onValueChange={setBankFilterValue}>
            <SelectTrigger className="w-40" aria-label="Filtrar por banco">
              <SelectValue placeholder="Todos os bancos">
                {bankFilter ? (banks.find((b) => b.id === bankFilter)?.name ?? undefined) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent side="bottom" alignItemWithTrigger={false}>
              {banks.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category select */}
          <Select value={categoryFilter} onValueChange={setCategoryFilterValue}>
            <SelectTrigger className="w-44" aria-label="Filtrar por categoria">
              <SelectValue placeholder="Todas as categorias">
                {categoryFilter ? (categories.find((c) => c.id === categoryFilter)?.name ?? undefined) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent side="bottom" alignItemWithTrigger={false}>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    {(() => {
                      const { Icon } = resolveCategoryIcon(c.icon)
                      return (
                        <Icon
                          className="size-3.5 shrink-0"
                          style={c.color ? { color: c.color } : undefined}
                        />
                      )
                    })()}
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título ou descrição"
              className="h-8 pl-8 pr-8 text-sm"
              aria-label="Buscar por título ou descrição"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Clear filters */}
          {(hasActiveFilters(filters) || !!search || !!typeGroup) && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
              <X className="size-3.5" />
              Limpar filtros
            </Button>
          )}
        </div>

        {/* Type chips */}
        <div className="flex flex-wrap gap-2">
          {typeFilterValues.map(({ label, value }) => {
            const active = filters.type === value
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => setTypeFilter(value)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-transparent bg-primary/15 text-primary'
                    : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/*
        ── Os cards de Receitas, Gastos e Saldo saíram ──

        O Extrato responde "o que aconteceu, na data em que aconteceu". A
        pergunta "quanto sai do bolso neste mês" é do Orçamento, e manter as
        duas na mesma tela convidava a somar universos diferentes.

        O caso que decidiu: uma compra de R$ 122,90 em 5x aparece aqui como
        R$ 122,90 na data em que aconteceu — correto para o histórico. Mas
        sob um card chamado "Gastos" ela afirmava que R$ 122,90 saíram do
        bolso naquela competência, quando o desembolso é de R$ 24,58 por
        fatura. O número estava certo; o rótulo é que mentia.

        Nada foi movido para outro lugar: o Orçamento já responde isso.
      */}

      {/* Transaction list */}
      <div className="border-t border-border">
        {/* Erro é estado próprio: sem isso a falha caía em "Nenhuma transação". */}
        {txError ? (
          <QueryError
            message="Não foi possível carregar o extrato"
            isFetching={txFetching}
            onRetry={() => void refetchTx()}
          />
        ) : txLoading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}
          </div>
        ) : !displayItems || displayItems.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted/40">
              <TrendingUp className="size-7 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">
              {(hasActiveFilters(filters) || search || typeGroup) ? 'Nenhuma transação encontrada' : 'Ainda sem transações'}
            </p>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
              {(hasActiveFilters(filters) || search || typeGroup)
                ? 'Nenhuma transação corresponde aos filtros aplicados. Tente ajustá-los ou limpar a busca.'
                : 'Crie sua primeira transação para começar a acompanhar seus gastos e receitas.'}
            </p>
            {!hasActiveFilters(filters) && !search && !typeGroup && (
              <Button
                className="mt-5"
                onClick={() => { setEditTx(null); setSheetOpen(true) }}
              >
                <Plus className="size-4" />
                Nova transação
              </Button>
            )}
          </div>
        ) : (
          <div>
            {displayItems.items.map((item, i) => {
              if (item.kind === 'single') {
                return (
                  <MotionRow key={item.tx.id} index={i}>
                    <TransactionRow
                      tx={item.tx}
                      onView={setDetailsTx}
                      isHighlighted={item.tx.id === highlightedId}
                      highlightRef={highlightRef}
                    />
                  </MotionRow>
                )
              }

              const installments = displayItems.groups.get(item.groupId) ?? []
              const root = installments[0]
              if (!root) return null

              return (
                <MotionRow key={item.groupId} index={i}>
                  <InstallmentGroup
                    root={root}
                    installments={installments}
                    onView={setDetailsTx}
                    highlightedId={highlightedId}
                  />
                </MotionRow>
              )
            })}
          </div>
        )}
      </div>

      {/* Sheets & Dialogs */}
      <TransactionDetailsDialog
        transaction={detailsTx}
        siblings={transactions ?? []}
        onOpenChange={(open) => {
          if (!open) setDetailsTx(null)
        }}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <TransactionSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTx(null)
        }}
        editTarget={editTx}
        onSubmit={handleSheetSubmit}
      />

      {/* Escopo, impacto e confirmação num só lugar — inclusive o aceite de
          fatura fechada, que antes era um diálogo separado abrindo por cima
          deste depois do save falhar. */}
      <InstallmentScopeDialog
        // Remonta por operação: o escopo volta a "Apenas esta" a cada abertura,
        // sem um efeito de reset (que a regra `set-state-in-effect` proíbe, com
        // razão — era estado derivado disfarçado de sincronização).
        key={scopeDialog ? `${scopeDialog.mode}:${scopeDialog.tx.id}` : 'none'}
        open={scopeDialog !== null}
        mode={scopeDialog?.mode ?? 'delete'}
        transaction={scopeDialog?.tx ?? null}
        siblings={transactions ?? []}
        pendingChanges={
          scopeDialog?.mode === 'edit' && pendingEdit
            ? (pendingEdit.payload as PreviewUpdatePayload)
            : null
        }
        isPending={scopeDialog?.mode === 'delete' ? deleteMut.isPending : updateMut.isPending}
        onConfirm={handleScopeConfirm}
        onCancel={() => {
          setScopeDialog(null)
          setPendingEdit(null)
        }}
        linkedWarning={Boolean(scopeDialog?.tx.personId)}
      />

      {/* Simple delete confirm for non-parcelado */}
      {/* O impacto real entra na confirmação: uma compra de terceiro leva a
          cobrança junto, e o diálogo fica aberto até a resposta para que uma
          recusa do servidor apareça no contexto da ação. */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir transação"
        description={
          <>
            Tem certeza que deseja excluir{' '}
            <strong className="text-foreground">{deleteTarget?.title}</strong>?
            Esta ação não pode ser desfeita.
            {deleteTarget?.person && (
              <span className="mt-2 block text-xs">
                Também será removido o valor a receber de{' '}
                <span className="text-receivable">
                  {deleteTarget.person.name}
                </span>
                .
              </span>
            )}
          </>
        }
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate({
              id: deleteTarget.id,
              hasPerson: Boolean(deleteTarget.personId),
            })
          }
        }}
      />
    </div>
  )
}

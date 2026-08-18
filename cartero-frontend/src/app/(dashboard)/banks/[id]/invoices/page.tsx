'use client'

import { useState, useMemo, useEffect } from 'react'
import type React from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  CreditCard,
  Wallet,
  Receipt,
  FileText,
  TrendingUp,
  CheckCircle2,
  Loader2,
  Undo2,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
} from 'lucide-react'
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
import { MotionRow } from '@/components/ui/motion-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TransactionSheet, type TransactionFormData } from '../../../transactions/transaction-sheet'
import { InstallmentScopeDialog } from '../../../transactions/installment-scope-dialog'
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '@/services/transactions.service'
import { isAxiosError } from 'axios'
import {
  getBankInvoices,
  getInvoice,
  updateInvoiceStatus,
  reopenInvoice,
} from '@/services/invoices.service'
import { getBank } from '@/services/banks.service'
import {
  formatCurrency,
  formatMonthYear,
  isExpense,
} from '@/lib/formatters'
import { parseDateOnly, formatDateValue } from '@/lib/date'
import { getInvoiceCloseDate, getInvoiceDueDate } from '@/lib/invoice-dates'
import { resolveCategoryIcon } from '@/lib/category-icons'
import type { Invoice, Bank, Transaction } from '@/types'
import { InvoiceStatus, TransactionType, InstallmentScope } from '@/types'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  [InvoiceStatus.OPEN]: {
    label: 'Aberta',
    className: 'bg-primary/15 text-primary',
  },
  [InvoiceStatus.CLOSED]: {
    label: 'Fechada',
    className: 'bg-amber-500/15 text-amber-400',
  },
  [InvoiceStatus.OVERDUE]: {
    label: 'Vencida',
    className: 'bg-destructive/15 text-destructive',
  },
  [InvoiceStatus.PAID]: {
    label: 'Paga',
    className: 'bg-paid/15 text-paid',
  },
}

// Status color primitives used for row highlight and sheet header tint
const STATUS_COLOR: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'var(--primary)',
  [InvoiceStatus.CLOSED]: 'oklch(0.750 0.150 80)', // no token for amber
  [InvoiceStatus.OVERDUE]: 'var(--destructive)',
  [InvoiceStatus.PAID]: 'var(--color-income)',
}


function statusRowBg(status: InvoiceStatus): React.CSSProperties {
  const c = STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 7%, transparent)` }
}

function statusHeaderStyle(status: InvoiceStatus): React.CSSProperties {
  const c = STATUS_COLOR[status]
  return { backgroundColor: `color-mix(in oklch, ${c} 10%, transparent)` }
}


const INCOME_COLOR = 'var(--color-income)'
const EXPENSE_BG = 'var(--color-expense-bg)'
const INCOME_BG = 'var(--color-income-bg)'
const EXPENSE_ICON_CLR = 'var(--color-expense-icon)'
const INCOME_ICON_CLR = 'var(--color-income-icon)'

const TYPE_ICON: Record<TransactionType, LucideIcon> = {
  [TransactionType.INCOME]: TrendingUp,
  [TransactionType.CREDIT_CARD]: CreditCard,
  [TransactionType.DEBIT_CARD]: Wallet,
  [TransactionType.PIX]: Receipt,
  [TransactionType.BOLETO]: FileText,
}

const STATUS_SORT_ORDER: Record<InvoiceStatus, number> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
  [InvoiceStatus.PAID]: 3,
}

const ACTIVE_VISIBLE = 3
const PAID_VISIBLE = 1

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function calcCloseDate(bank: Bank, month: number, year: number): string {
  return format(getInvoiceCloseDate(year, month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose), "dd 'de' MMMM", { locale: ptBR })
}

function calcDueDate(bank: Bank, month: number, year: number): string {
  return format(getInvoiceDueDate(year, month, bank.invoiceDueDate, bank.invoiceDueDaysAfterClose), "dd 'de' MMMM", { locale: ptBR })
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
  const { label, className } = STATUS_CONFIG[status]
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
      aria-label={`${monthYear} — ${STATUS_CONFIG[invoice.status].label}${isAtual ? ' — Atual' : ''}`}
      className="group flex w-full items-center gap-4 px-2 py-4 text-left transition-colors hover:bg-muted/30"
      style={isSelected ? statusRowBg(invoice.status) : undefined}
    >
      {/* Month + status + dates */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-y-1 gap-x-2">
          <span className="shrink-0 text-[15px] font-medium">{monthYear}</span>
          <StatusBadge status={invoice.status} />
          {isAtual && (
            <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
              Atual
            </span>
          )}
        </div>
        {bank && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="shrink-0">Fecha {calcCloseDate(bank, invoice.month, invoice.year)}</span>
            <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
            <span className="shrink-0">Vence {calcDueDate(bank, invoice.month, invoice.year)}</span>
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

      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/70"
      />
    </button>
  )
}

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
            <span className="truncate shrink-0">{tx.person.name}</span>
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

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

/** Categorias mostradas antes de agrupar o resto em "Outras". */
const CATEGORY_CHART_LIMIT = 5

interface CategorySlice {
  key: string
  name: string
  color: string | null
  icon: string | null
  amount: number
  pct: number
}

/**
 * Gastos por categoria da fatura. Estornos abatem a própria categoria — sem
 * isso um reembolso inflaria o gasto em vez de reduzi-lo.
 */
function buildCategorySlices(
  transactions: Transaction[] | undefined,
  expanded = false,
): { slices: CategorySlice[]; hiddenCount: number } {
  if (!transactions?.length) return { slices: [], hiddenCount: 0 }

  const totals = new Map<string, { name: string; color: string | null; icon: string | null; amount: number }>()

  for (const tx of transactions) {
    if (tx.type === TransactionType.INCOME) continue
    const key = tx.categoryId ?? 'sem-categoria'
    const entry = totals.get(key) ?? {
      name: tx.category?.name ?? 'Sem categoria',
      color: tx.category?.color ?? null,
      icon: tx.category?.icon ?? null,
      amount: 0,
    }
    entry.amount += tx.isRefund ? -Number(tx.amount) : Number(tx.amount)
    totals.set(key, entry)
  }

  // Uma categoria que ficou negativa ou zerada não é "gasto" — some do gráfico.
  const ranked = [...totals.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  if (ranked.length === 0) return { slices: [], hiddenCount: 0 }

  const hiddenCount = Math.max(0, ranked.length - CATEGORY_CHART_LIMIT)
  const visible = expanded ? [...ranked] : ranked.slice(0, CATEGORY_CHART_LIMIT)

  // Proporção relativa à maior fatia: a barra compara categorias entre si,
  // não contra o total da fatura. A escala vem sempre do ranking inteiro,
  // para as barras não mudarem de tamanho ao expandir.
  const max = ranked[0].amount
  return {
    slices: visible.map((entry) => ({ ...entry, pct: (entry.amount / max) * 100 })),
    hiddenCount,
  }
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
      aria-label="Gastos por categoria nesta fatura"
      className="border-t border-border px-6 py-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium text-muted-foreground">
          Maiores gastos por categoria
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
          const { Icon } = resolveCategoryIcon(slice.icon)
          const color = slice.color ?? 'oklch(0.640 0.210 272)'
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

function InvoiceDetailSheet({
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
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{
    tx: Transaction
    mode: 'edit' | 'delete'
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
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
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      qc.invalidateQueries({ queryKey: ['bank-invoices', bankId] })
      toast.success('Fatura marcada como paga')
    },
    onError: () => toast.error('Erro ao atualizar fatura'),
  })

  const reopenMut = useMutation({
    mutationFn: () => reopenInvoice(invoiceId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      qc.invalidateQueries({ queryKey: ['bank-invoices', bankId] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setReopenConfirm(false)
      toast.success('Fatura reaberta')
    },
    onError: () => toast.error('Erro ao reabrir fatura'),
  })

  /** Toda escrita na fatura muda o total dela — o resto do app precisa saber. */
  function invalidateAfterTxChange() {
    qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
    qc.invalidateQueries({ queryKey: ['bank-invoices', bankId] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
  }

  const createTxMut = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      invalidateAfterTxChange()
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
    }) => updateTransaction(id, payload, scope),
    onSuccess: () => {
      invalidateAfterTxChange()
      toast.success('Transação atualizada')
    },
    onError: (error) => {
      const message = isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : undefined
      toast.error(message ?? 'Erro ao atualizar transação')
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

  function handleEditTx(tx: Transaction) {
    // Parcela de uma série: o usuário escolhe se altera uma, as próximas ou todas.
    if (tx.parentId || /\s\d+\/\d+$/.test(tx.title)) {
      setScopeDialog({ tx, mode: 'edit' })
      return
    }
    setEditTx(tx)
    setEditScope(null)
    setTxSheetOpen(true)
  }

  function handleDeleteTx(tx: Transaction) {
    if (tx.parentId || /\s\d+\/\d+$/.test(tx.title)) {
      setScopeDialog({ tx, mode: 'delete' })
      return
    }
    setDeleteTarget(tx)
  }

  function handleScopeConfirm(scope: InstallmentScope) {
    if (!scopeDialog) return
    const { tx, mode } = scopeDialog
    if (mode === 'delete') {
      deleteTxMut.mutate({ id: tx.id, scope })
      return
    }
    setEditTx(tx)
    setEditScope(scope)
    setScopeDialog(null)
    setTxSheetOpen(true)
  }

  async function handleTxSubmit(
    data: TransactionFormData,
    scope: InstallmentScope | null,
  ) {
    if (editTx) {
      await updateTxMut.mutateAsync({
        id: editTx.id,
        payload: data,
        scope: scope ?? undefined,
      })
    } else {
      await createTxMut.mutateAsync(data)
    }
    setTxSheetOpen(false)
    setEditTx(null)
    setEditScope(null)
  }
  const monthYear = invoice ? capitalize(formatMonthYear(invoice.month, invoice.year)) : ''
  const total = invoice ? Number(invoice.totalAmount) : 0
  const txCount = invoice?.transactions?.length ?? 0
  // Reembolsável: parte do total que já tem dono (pessoa vinculada) — o
  // resto é o que efetivamente sai do seu bolso.
  const reimbursableTotal = (invoice?.transactions ?? []).reduce(
    (sum, tx) => sum + (tx.personId ? Number(tx.amount) : 0),
    0,
  )
  const ownTotal = total - reimbursableTotal
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
      .filter(
        (tx) =>
          !selectedCategory || (tx.categoryId ?? 'sem-categoria') === selectedCategory,
      )
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
                    <span className="text-foreground/80">{formatCurrency(ownTotal)}</span> seu ·{' '}
                    <span className="text-receivable">{formatCurrency(reimbursableTotal)}</span> de outros
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
                        setEditScope(null)
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
                          setEditScope(null)
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
          if (!open) {
            setEditTx(null)
            setEditScope(null)
          }
        }}
        editTarget={editTx}
        editScope={editScope}
        onSubmit={handleTxSubmit}
        createDefaults={createDefaults}
      />

      <InstallmentScopeDialog
        open={scopeDialog !== null}
        mode={scopeDialog?.mode ?? 'delete'}
        onConfirm={handleScopeConfirm}
        onCancel={() => setScopeDialog(null)}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BankInvoicesPage() {
  const params = useParams()
  const bankId = params.id as string
  const searchParams = useSearchParams()
  const invoiceIdParam = searchParams.get('invoiceId')

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [activeExpanded, setActiveExpanded] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const { data: bank } = useQuery({
    queryKey: ['bank', bankId],
    queryFn: () => getBank(bankId),
  })

  const { data: invoices, isLoading } = useQuery({
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
        const sd = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]
        if (sd !== 0) return sd
        return a.year !== b.year ? a.year - b.year : a.month - b.month
      })

    const paidInvoices = filtered
      .filter((i) => i.status === InvoiceStatus.PAID)
      .sort((a, b) => (b.year !== a.year ? b.year - a.year : b.month - a.month))

    return { overdueInvoices, activeInvoices, paidInvoices }
  }, [invoices])

  const isEmpty = overdueInvoices.length === 0 && activeInvoices.length === 0 && paidInvoices.length === 0

  // Open sheet when arriving via ?invoiceId=
  useEffect(() => {
    if (!invoiceIdParam || !invoices) return
    const inv = invoices.find((i) => i.id === invoiceIdParam)
    if (!inv) return
    if (inv.status === InvoiceStatus.PAID) {
      const idx = paidInvoices.findIndex((i) => i.id === invoiceIdParam)
      if (idx >= PAID_VISIBLE) setHistoryExpanded(true)
    } else if (inv.status === InvoiceStatus.OPEN || inv.status === InvoiceStatus.CLOSED) {
      const idx = activeInvoices.findIndex((i) => i.id === invoiceIdParam)
      if (idx >= ACTIVE_VISIBLE) setActiveExpanded(true)
    }
    setSelectedInvoiceId(invoiceIdParam)
    setDetailOpen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceIdParam, invoices])

  const activeHidden = Math.max(0, activeInvoices.length - ACTIVE_VISIBLE)
  const paidHidden = Math.max(0, paidInvoices.length - PAID_VISIBLE)

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
    setSelectedInvoiceId(id)
    setDetailOpen(true)
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {bank ? bank.name : <Skeleton className="inline-block h-7 w-32" />}
          </h1>
          {bank ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Vence dia {bank.invoiceDueDate} · intervalo de {bank.invoiceDueDaysAfterClose ?? 7} dias
            </p>
          ) : (
            <Skeleton className="mt-1.5 h-4 w-40" />
          )}
        </div>
      </div>

      {/* Invoice sections */}
      {isLoading ? (
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
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── Vencidas ───────────────────────────────────────────────── */}
          {overdueInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-destructive/90">Vencidas</p>
              <div className="border-t border-border">
                {overdueInvoices.map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={selectedInvoiceId === invoice.id && detailOpen}
                      onClick={() => handleClick(invoice.id)}
                    />
                  </MotionRow>
                ))}
              </div>
            </div>
          )}

          {/* ── Ativas ─────────────────────────────────────────────────── */}
          {activeInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground/70">Ativas</p>
              <div className="border-t border-border">
                {activeInvoices.slice(0, ACTIVE_VISIBLE).map((invoice, i) => (
                  <MotionRow key={invoice.id} index={i}>
                    <InvoiceRow
                      invoice={invoice}
                      bank={bank}
                      isSelected={selectedInvoiceId === invoice.id && detailOpen}
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
                        isSelected={selectedInvoiceId === invoice.id && detailOpen}
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
                      isSelected={selectedInvoiceId === invoice.id && detailOpen}
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
                        isSelected={selectedInvoiceId === invoice.id && detailOpen}
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
      <InvoiceDetailSheet
        invoiceId={selectedInvoiceId}
        bankId={bankId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

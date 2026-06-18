'use client'

import { useState, useMemo, memo } from 'react'
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
  X,
  MoreVertical,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/ui/date-picker'
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
  DialogFooter,
} from '@/components/ui/dialog'
import { MotionRow } from '@/components/ui/motion-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TransactionSheet, type TransactionFormData } from './transaction-sheet'
import { InstallmentScopeDialog } from './installment-scope-dialog'
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '@/services/transactions.service'
import { getBanks } from '@/services/banks.service'
import { getCategories } from '@/services/categories.service'
import { formatCurrency, formatDate, isExpense, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { cn } from '@/lib/utils'
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

const INCOME_BG = 'var(--color-income-bg)'
const EXPENSE_BG = 'var(--color-expense-bg)'
const EXPENSE_ICON_CLR = 'var(--color-expense-icon)'
const INCOME_COLOR = 'var(--color-income)'

// ─── Sub-components ──────────────────────────────────────────────────────────

const CategoryBadge = memo(function CategoryBadge({ icon, color, name }: { icon?: string | null; color?: string | null; name: string }) {
  const { Icon } = resolveCategoryIcon(icon)
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      <Icon aria-hidden="true" className="size-3 shrink-0" style={color ? { color } : undefined} />
      <span className="truncate">{name}</span>
    </span>
  )
})

function AmountDisplay({ amount, type, size = 'md' }: { amount: number; type: TransactionType; size?: 'sm' | 'md' }) {
  const expense = isExpense(type)
  const formatted = formatCurrency(amount)
  return (
    <span
      className={cn(
        'tabular-nums tracking-[-0.02em]',
        size === 'md' ? 'text-[17px] font-semibold' : 'text-sm font-medium',
        expense ? 'text-destructive' : '',
      )}
      style={{ color: expense ? undefined : INCOME_COLOR }}
    >
      {expense ? `−${formatted}` : `+${formatted}`}
    </span>
  )
}

function TransactionRow({
  tx,
  onEdit,
  onDelete,
}: {
  tx: Transaction
  onEdit: (tx: Transaction) => void
  onDelete: (tx: Transaction) => void
}) {
  const Icon = TYPE_ICON[tx.type]

  return (
    <div className="group flex items-center gap-4 px-2 py-4">
      {/* Type icon — green for income, neutral for all expenses */}
      <div
        className="flex size-11 shrink-0 items-center justify-center rounded-2xl"
        style={{ backgroundColor: isExpense(tx.type) ? EXPENSE_BG : INCOME_BG }}
      >
        <Icon aria-hidden="true" className="size-5" style={{ color: isExpense(tx.type) ? EXPENSE_ICON_CLR : INCOME_COLOR }} />
      </div>

      {/* Title + badges + description */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-[15px] font-medium leading-tight">{tx.title}</span>

        {/* Type · bank · category — inline, quiet */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0">{TRANSACTION_TYPE_LABELS[tx.type]}</span>
          {tx.bank && <span aria-hidden>·</span>}
          {tx.bank && <span className="truncate">{tx.bank.name}</span>}
          {tx.bank && tx.category && <span aria-hidden>·</span>}
          {tx.category && (
            <CategoryBadge icon={tx.category.icon} color={tx.category.color} name={tx.category.name} />
          )}
          {tx.parentId && (
            <>
              <span aria-hidden>·</span>
              <span className="text-primary/60">parcelado</span>
            </>
          )}
        </div>

        {tx.description && (
          <p className="truncate text-xs text-muted-foreground/60">
            {tx.description}
          </p>
        )}
      </div>

      {/* Amount + date — desktop */}
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <AmountDisplay amount={tx.amount} type={tx.type} />
        <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
      </div>

      {/* Amount — mobile */}
      <div className="flex shrink-0 sm:hidden">
        <AmountDisplay amount={tx.amount} type={tx.type} size="sm" />
      </div>

      {/* Desktop hover actions */}
      <div className="hidden items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(tx)}
          aria-label="Editar transação"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(tx)}
          aria-label="Excluir transação"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Mobile dropdown */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mais opções"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(tx)}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(tx)} className="text-destructive focus:text-destructive">
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

function hasActiveFilters(f: FilterState): boolean {
  return !!(f.startDate || f.endDate || f.bankId || f.categoryId || f.type)
}

// ─── Filter state type ────────────────────────────────────────────────────────

interface FilterState {
  startDate?: string
  endDate?: string
  bankId?: string
  categoryId?: string
  type?: TransactionType
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const qc = useQueryClient()

  // ── State ──
  const [filters, setFilters] = useState<FilterState>({})
  const [bankFilter, setBankFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)

  const [scopeDialog, setScopeDialog] = useState<{ tx: Transaction; mode: 'edit' | 'delete' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)

  // ── Queries ──
  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => getTransactions(filters),
  })

  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: getBanks,
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
      setSheetOpen(false)
      setEditTx(null)
      setEditScope(null)
      toast.success('Transação atualizada')
    },
    onError: () => toast.error('Não foi possível salvar as alterações. Tente novamente.'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: InstallmentScope }) =>
      deleteTransaction(id, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Transação excluída')
    },
    onError: () => toast.error('Não foi possível excluir a transação. Tente novamente.'),
  })

  // ── Summary ──
  const summary = useMemo(() => {
    if (!transactions) return { receitas: 0, gastos: 0, saldo: 0 }
    const receitas = transactions.filter((t) => !isExpense(t.type)).reduce((s, t) => s + t.amount, 0)
    const gastos = transactions.filter((t) => isExpense(t.type)).reduce((s, t) => s + t.amount, 0)
    return { receitas, gastos, saldo: receitas - gastos }
  }, [transactions])

  // ── Handlers ──
  function handleEdit(tx: Transaction) {
    if (tx.parentId) {
      setScopeDialog({ tx, mode: 'edit' })
    } else {
      setEditTx(tx)
      setEditScope(null)
      setSheetOpen(true)
    }
  }

  function handleDelete(tx: Transaction) {
    if (tx.parentId) {
      setScopeDialog({ tx, mode: 'delete' })
    } else {
      setDeleteTarget(tx)
    }
  }

  function handleScopeConfirm(scope: InstallmentScope) {
    if (!scopeDialog) return
    if (scopeDialog.mode === 'delete') {
      deleteMut.mutate({ id: scopeDialog.tx.id, scope })
    } else {
      setEditScope(scope)
      setEditTx(scopeDialog.tx)
      setSheetOpen(true)
    }
    setScopeDialog(null)
  }

  async function handleSheetSubmit(data: TransactionFormData, scope: InstallmentScope | null) {
    if (editTx) {
      const { installments, ...payload } = data
      void installments
      updateMut.mutate({ id: editTx.id, payload, scope: scope ?? undefined })
    } else {
      createMut.mutate(data)
    }
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
          <h1 className="text-2xl font-semibold tracking-tight">Transações</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Registre e acompanhe seus gastos e receitas
          </p>
        </div>
        <Button onClick={() => { setEditTx(null); setEditScope(null); setSheetOpen(true) }}>
          <Plus className="size-4" />
          Nova transação
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Date range */}
          <div className="w-40">
            <DatePicker
              value={filters.startDate}
              onChange={(v) => setFilters((f) => ({ ...f, startDate: v }))}
              placeholder="Data início"
            />
          </div>
          <div className="w-40">
            <DatePicker
              value={filters.endDate}
              onChange={(v) => setFilters((f) => ({ ...f, endDate: v }))}
              placeholder="Data fim"
            />
          </div>

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

          {/* Clear filters */}
          {hasActiveFilters(filters) && (
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

      {/* Summary tiles */}
      {!txLoading && transactions && transactions.length > 0 && (
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 rounded-2xl bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Receitas</p>
            <p className="mt-1 truncate text-base font-semibold tabular-nums tracking-[-0.02em]" style={{ color: INCOME_COLOR }}>
              {formatCurrency(summary.receitas)}
            </p>
          </div>
          <div className="min-w-0 flex-1 rounded-2xl bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Gastos</p>
            <p className="mt-1 truncate text-base font-semibold tabular-nums tracking-[-0.02em] text-destructive">
              {formatCurrency(summary.gastos)}
            </p>
          </div>
          <div className="min-w-0 flex-1 rounded-2xl bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Saldo</p>
            <p
              className={cn(
                'mt-1 truncate text-base font-semibold tabular-nums tracking-[-0.02em]',
                summary.saldo < 0 ? 'text-destructive' : '',
              )}
              style={summary.saldo >= 0 ? { color: INCOME_COLOR } : undefined}
            >
              {formatCurrency(summary.saldo)}
            </p>
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div className="border-t border-border">
        {txLoading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted/40">
              <TrendingUp className="size-7 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">
              {hasActiveFilters(filters) ? 'Nenhuma transação encontrada' : 'Ainda sem transações'}
            </p>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
              {hasActiveFilters(filters)
                ? 'Nenhuma transação corresponde aos filtros aplicados. Tente ajustá-los ou limpar a busca.'
                : 'Crie sua primeira transação para começar a acompanhar seus gastos e receitas.'}
            </p>
            {!hasActiveFilters(filters) && (
              <Button
                className="mt-5"
                onClick={() => { setEditTx(null); setEditScope(null); setSheetOpen(true) }}
              >
                <Plus className="size-4" />
                Nova transação
              </Button>
            )}
          </div>
        ) : (
          <div>
            {transactions.map((tx, i) => (
              <MotionRow key={tx.id} index={i}>
                <TransactionRow
                  tx={tx}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </MotionRow>
            ))}
          </div>
        )}
      </div>

      {/* Sheets & Dialogs */}
      <TransactionSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) { setEditTx(null); setEditScope(null) }
        }}
        editTarget={editTx}
        editScope={editScope}
        banks={banks}
        categories={categories}
        onSubmit={handleSheetSubmit}
      />

      <InstallmentScopeDialog
        open={scopeDialog !== null}
        mode={scopeDialog?.mode ?? 'delete'}
        onConfirm={handleScopeConfirm}
        onCancel={() => setScopeDialog(null)}
      />

      {/* Simple delete confirm for non-parcelado */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir transação</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir{' '}
              <strong className="text-foreground">{deleteTarget?.title}</strong>? Esta ação não pode ser desfeita.
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
                  deleteMut.mutate({ id: deleteTarget.id })
                  setDeleteTarget(null)
                }
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

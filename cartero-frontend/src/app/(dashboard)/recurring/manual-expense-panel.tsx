'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Pencil, Pause, Play, Repeat, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FinancialAvatar } from '@/components/ui/financial-avatar'
import { FinancialListRow, FinancialRowTrailing } from '@/components/ui/financial-list-row'
import { MotionRow } from '@/components/ui/motion-row'
import { financialDrawerRowSurfaceClass } from '@/components/ui/financial-drawer-row-surface'
import { FinancialSettlementRow } from '@/components/ui/financial-settlement-row'
import { QueryError } from '@/components/ui/query-error'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DrawerCompletionStatus, DrawerFinancialList, FinancialRowList, DrawerOutlineCard, DrawerSectionEmpty,
  DrawerSectionGroup, DrawerSectionHeading, DrawerSectionTitle, DrawerSummaryCard,
  DrawerSummaryLabel, DrawerSummaryMeta, DrawerSummaryValue,
} from '@/components/ui/drawer-section'
import { DrawerIdentityHeader } from '@/components/ui/drawer-identity-header'
import { DRAWER_WIDE_CONTENT_INSET, DRAWER_WIDTH_WIDE, DRAWER_WIDE_VERTICAL_RHYTHM } from '@/components/ui/drawer-layout'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '../transactions/unmark-paid-warning-dialog'
import { DebtDetailDrawer } from '../debts/debt-detail-drawer'
import { RecurringExpenseSheet } from './recurring-expense-sheet'
import { getDebts, updateDebt, deleteDebt } from '@/services/debts.service'
import {
  createRecurringExpense, deleteRecurringExpense, getRecurringExpense, getRecurringExpenses,
  reconcileRecurringExpensePeriod, updateRecurringExpense,
  type CreateRecurringExpensePayload, type UpdateRecurringExpensePayload,
} from '@/services/recurring-expense.service'
import { useDetailNavigation } from '@/lib/detail-navigation'
import { useDetailEntity } from '@/lib/use-detail-entity'
import { invalidateRecurringDependents } from '@/lib/recurring-invalidation'
import { invalidateTransactionDependents } from '@/lib/transaction-dependent-queries'
import { syncSettlementEntity } from '@/lib/settlement-cache'
import { accountToday } from '@/lib/date'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/auth-provider'
import type { Debt, RecurringExpenseRule, TransactionType } from '@/types'

function DueRows({ rows, onView, onToggle, resolved }: {
  rows: Debt[]
  onView: (debt: Debt) => void
  onToggle: (debt: Debt) => void
  resolved: boolean
}) {
  if (rows.length === 0) return <DrawerSectionEmpty inset={false}>Nenhuma ocorrência.</DrawerSectionEmpty>
  return <DrawerFinancialList>{rows.map((debt) => <FinancialSettlementRow
    key={debt.id}
    resolved={resolved}
    onToggleStatus={() => onToggle(debt)}
    statusActionLabel={resolved ? `Desfazer pagamento de ${debt.title}` : `Marcar ${debt.title} como paga`}
    onView={() => onView(debt)}
    ariaLabel={`Abrir ${debt.title}`}
    title={formatDate(debt.dueDate)}
    meta={resolved ? `Paga em ${debt.paidAt ? formatDate(debt.paidAt) : 'data não informada'}` : debt.creditorName}
    trailing={<FinancialRowTrailing amount={formatCurrency(debt.amount)} label={resolved ? 'PAGA' : 'A PAGAR'} />}
  />)}</DrawerFinancialList>
}

export function ManualExpensePanel({ createTarget, formHost, footerHost, onCreated, onClose }: { createTarget: boolean; formHost: HTMLElement | null; footerHost: HTMLElement | null; onCreated: (id: string) => void; onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const detail = useDetailNavigation('recurringExpenseRuleId')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<RecurringExpenseRule | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecurringExpenseRule | null>(null)
  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null)
  const [deleteDebtTarget, setDeleteDebtTarget] = useState<Debt | null>(null)
  const [markTarget, setMarkTarget] = useState<Debt | null>(null)
  const [unmarkTarget, setUnmarkTarget] = useState<Debt | null>(null)

  const rulesQuery = useQuery({ queryKey: ['recurring-expenses'], queryFn: getRecurringExpenses })
  const debtsQuery = useQuery({ queryKey: ['debts'], queryFn: () => getDebts() })
  const rules = rulesQuery.data ?? []
  const debts = debtsQuery.data ?? []
  const { entity: selectedRule } = useDetailEntity({
    openId: detail.openId,
    fromList: rules.find((rule) => rule.id === detail.openId),
    fetchById: getRecurringExpense,
    queryKey: 'recurring-expense',
    onNotFound: detail.close,
  })
  const today = user?.timeZone ? accountToday(user.timeZone) : new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)
  const reconcileQuery = useQuery({
    queryKey: ['recurring-expense-reconcile', user?.id, currentMonth],
    queryFn: () => reconcileRecurringExpensePeriod({ year: Number(currentMonth.slice(0, 4)), month: Number(currentMonth.slice(5, 7)) }),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (reconcileQuery.data?.created) void qc.invalidateQueries({ queryKey: ['debts'] })
  }, [reconcileQuery.data, qc])

  const occurrences = selectedRule ? debts.filter((debt) => debt.recurringExpenseRuleId === selectedRule.id) : []
  const overdue = occurrences.filter((debt) => !debt.isPaid && debt.dueDate.slice(0, 10) < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const open = occurrences.filter((debt) => !debt.isPaid && debt.dueDate.slice(0, 10) >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const history = occurrences.filter((debt) => debt.isPaid).sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''))
  const nextDue = open[0]

  const createMutation = useMutation({
    mutationFn: createRecurringExpense,
    onSuccess: (rule) => { invalidateRecurringDependents(qc, 'manual'); onCreated(rule.id); toast.success('Despesa recorrente criada') },
    onError: () => toast.error('Não foi possível criar a despesa recorrente'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateRecurringExpensePayload }) => updateRecurringExpense(id, payload),
    onSuccess: (_rule, variables) => {
      invalidateRecurringDependents(qc, 'manual')
      setSheetOpen(false)
      setEditTarget(null)
      toast.success(variables.payload.isActive === false ? 'Despesa pausada' : variables.payload.isActive === true ? 'Despesa reativada' : 'Despesa atualizada')
    },
    onError: () => toast.error('Não foi possível atualizar a despesa'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteRecurringExpense,
    onSuccess: () => { invalidateRecurringDependents(qc, 'manual'); setDeleteTarget(null); detail.close(); toast.success('Despesa recorrente excluída') },
    onError: () => toast.error('Não foi possível excluir a despesa'),
  })
  const paymentMutation = useMutation({
    mutationFn: ({ id, isPaid, payload }: { id: string; isPaid: boolean; payload?: { paymentDate?: string; paymentBankId?: string; paymentType?: TransactionType } }) => updateDebt(id, { isPaid, ...payload }),
    onSuccess: (result, variables) => {
      syncSettlementEntity(qc, 'debt', variables.id, result)
      invalidateRecurringDependents(qc, 'manual')
      invalidateTransactionDependents(qc, { affectsPerson: Boolean(selectedDebt?.personId ?? markTarget?.personId ?? unmarkTarget?.personId) })
      const updated = Array.isArray(result) ? result.find((item) => item.id === variables.id) : result
      if (updated && selectedDebt?.id === updated.id) setSelectedDebt(updated)
      setMarkTarget(null)
      setUnmarkTarget(null)
      toast.success(variables.isPaid ? 'Pagamento registrado' : 'Pagamento desfeito')
    },
    onError: () => toast.error('Não foi possível atualizar o pagamento'),
  })
  const deleteOccurrenceMutation = useMutation({
    mutationFn: (id: string) => deleteDebt(id),
    onSuccess: () => { invalidateRecurringDependents(qc, 'manual'); setDeleteDebtTarget(null); setSelectedDebt(null); toast.success('Dívida excluída') },
    onError: () => toast.error('Não foi possível excluir a dívida'),
  })

  function togglePayment(debt: Debt) {
    if (!debt.isPaid) setMarkTarget(debt)
    else if (debt.paymentTransactionId) setUnmarkTarget(debt)
    else paymentMutation.mutate({ id: debt.id, isPaid: false })
  }

  if ((rulesQuery.error || debtsQuery.error) && !(rulesQuery.isLoading || debtsQuery.isLoading)) {
    return <QueryError message="Não foi possível carregar as despesas recorrentes." isFetching={rulesQuery.isFetching || debtsQuery.isFetching} onRetry={() => { void rulesQuery.refetch(); void debtsQuery.refetch() }} />
  }

  return <div className="flex flex-col gap-3">
    <h2 className="text-sm font-medium">Contas para pagar</h2>
    {rulesQuery.isLoading || debtsQuery.isLoading ? <div className="space-y-2">{[1, 2].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div> : rules.length === 0 ? <div className="rounded-xl border border-dashed border-border/70 px-6 py-10 text-center"><CircleAlert className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Nenhuma conta recorrente cadastrada.</p><p className="mt-1 text-sm text-muted-foreground">Aluguel e outras contas podem ficar em aberto até você registrar o pagamento.</p></div> : <FinancialRowList variant="page">{rules.map((rule, index) => {
      const due = debts.filter((debt) => debt.recurringExpenseRuleId === rule.id && !debt.isPaid).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
      const late = due && due.dueDate.slice(0, 10) < today
      return <MotionRow key={rule.id} index={index} separator={false} className={financialDrawerRowSurfaceClass('animatedWrapper')}>
        <FinancialListRow variant="page" onView={() => detail.open(rule.id)} ariaLabel={`Abrir ${rule.title}`} leading={<FinancialAvatar icon={<Repeat className="size-5 text-muted-foreground" />} />} title={rule.title} titleAdornment={!rule.isActive ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Pausada</span> : null} meta={<span className={late ? 'text-destructive' : undefined}>{late ? 'Em atraso' : due ? `Vence ${formatDate(due.dueDate)}` : `Dia ${rule.dayOfMonth}`}</span>} trailing={<FinancialRowTrailing amount={formatCurrency(rule.amount)} label={rule.isActive ? 'A PAGAR' : 'PAUSADA'} />} />
      </MotionRow>
    })}</FinancialRowList>}

    <Sheet open={selectedRule !== null} onOpenChange={(opened) => { if (!opened) detail.close() }}>
      <SheetContent className={cn(DRAWER_WIDTH_WIDE, DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap)} showCloseButton={false}>
        <DrawerIdentityHeader title={selectedRule?.title} description={`Despesa recorrente · ${selectedRule?.isActive ? 'Ativa' : 'Pausada'}`} />
        {selectedRule ? <div className={cn('flex flex-1 flex-col overflow-y-auto subtle-scrollbar', DRAWER_WIDE_CONTENT_INSET, DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap, 'pb-6')}>
          <DrawerSummaryCard inset={false}>
            <DrawerSummaryLabel emphasis="regular">Valor esperado por mês</DrawerSummaryLabel>
            <DrawerSummaryValue>{formatCurrency(selectedRule.amount)}</DrawerSummaryValue>
            <DrawerSummaryMeta className="mt-2">Dia {selectedRule.dayOfMonth} · {selectedRule.creditorName ?? selectedRule.title}</DrawerSummaryMeta>
            <div className="mt-3"><DrawerCompletionStatus variant={overdue.length > 0 ? 'destructive' : selectedRule.isActive ? 'pending' : 'informational'}>{overdue.length > 0 ? 'Em atraso' : selectedRule.isActive ? 'Ativa' : 'Pausada'}</DrawerCompletionStatus></div>
          </DrawerSummaryCard>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setEditTarget(selectedRule); setSheetOpen(true); detail.close() }}><Pencil className="size-3.5" /> Editar despesa</Button>
            <Button variant="outline" className="gap-2" onClick={() => updateMutation.mutate({ id: selectedRule.id, payload: { isActive: !selectedRule.isActive } })}>{selectedRule.isActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{selectedRule.isActive ? 'Pausar despesa' : 'Reativar despesa'}</Button>
            <Button variant="destructive" className="gap-2" onClick={() => setDeleteTarget(selectedRule)}><Trash2 className="size-3.5" /> Excluir despesa</Button>
          </div>
          <DrawerOutlineCard variant="compact"><p className="text-xs text-muted-foreground">Próximo vencimento</p><p className="mt-1 text-sm font-medium">{nextDue ? formatDate(nextDue.dueDate) : 'Nenhum em aberto'}</p></DrawerOutlineCard>
          {overdue.length > 0 ? <DrawerSectionGroup><DrawerSectionHeading><DrawerSectionTitle title="Em atraso" count={overdue.length} /></DrawerSectionHeading><DueRows rows={overdue} onView={setSelectedDebt} onToggle={togglePayment} resolved={false} /></DrawerSectionGroup> : null}
          {open.length > 0 ? <DrawerSectionGroup><DrawerSectionHeading><DrawerSectionTitle title="Em aberto" count={open.length} /></DrawerSectionHeading><DueRows rows={open} onView={setSelectedDebt} onToggle={togglePayment} resolved={false} /></DrawerSectionGroup> : null}
          <DrawerSectionGroup><DrawerSectionHeading>Histórico</DrawerSectionHeading><DueRows rows={history} onView={setSelectedDebt} onToggle={togglePayment} resolved /></DrawerSectionGroup>
        </div> : null}
      </SheetContent>
    </Sheet>
    <DebtDetailDrawer debt={selectedDebt} mode="operational" onOpenChange={(opened) => { if (!opened) setSelectedDebt(null) }} onTogglePaid={togglePayment} onDelete={setDeleteDebtTarget} />
    <RecurringExpenseSheet key={`${editTarget?.id ?? 'new'}-${sheetOpen}`} open={sheetOpen} onOpenChange={(opened) => { setSheetOpen(opened); if (!opened) setEditTarget(null) }} editTarget={editTarget} isPending={updateMutation.isPending} onSubmit={(payload) => { if (editTarget) updateMutation.mutate({ id: editTarget.id, payload: payload as UpdateRecurringExpensePayload }) }} />
    {createTarget && formHost && footerHost ? createPortal(
      <RecurringExpenseSheet open onOpenChange={(opened) => { if (!opened) onClose() }} editTarget={null} isPending={createMutation.isPending} onSubmit={(payload) => createMutation.mutate(payload as CreateRecurringExpensePayload)} embedded embeddedFooterHost={footerHost} />,
      formHost,
    ) : null}
    <MarkAsPaidDialog open={markTarget !== null} kind="debt" createTransaction isPending={paymentMutation.isPending} onConfirm={(payload) => markTarget && paymentMutation.mutate({ id: markTarget.id, isPaid: true, payload })} onCancel={() => setMarkTarget(null)} />
    <UnmarkPaidWarningDialog open={unmarkTarget !== null} kind="debt" isPending={paymentMutation.isPending} onConfirm={() => unmarkTarget && paymentMutation.mutate({ id: unmarkTarget.id, isPaid: false })} onCancel={() => setUnmarkTarget(null)} />
    <ConfirmDialog open={deleteTarget !== null} title="Excluir despesa recorrente?" description="Novas contas deixarão de ser criadas. Contas futuras em aberto serão removidas; as vencidas e pagas permanecem." confirmLabel="Excluir despesa" variant="destructive" isPending={deleteMutation.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} />
    <ConfirmDialog open={deleteDebtTarget !== null} title="Excluir esta dívida?" description="Esta competência não será recriada. Se houver lançamento de pagamento, a exclusão seguirá a regra atual de Dívidas." confirmLabel="Excluir" variant="destructive" isPending={deleteOccurrenceMutation.isPending} onCancel={() => setDeleteDebtTarget(null)} onConfirm={() => deleteDebtTarget && deleteOccurrenceMutation.mutate(deleteDebtTarget.id)} />
  </div>
}

'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CircleDollarSign, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryError } from '@/components/ui/query-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FinancialListRow, FinancialRowTrailing, ROW_AMOUNT_CLASS } from '@/components/ui/financial-list-row'
import { FinancialSettlementRow } from '@/components/ui/financial-settlement-row'
import { FinancialAvatar } from '@/components/ui/financial-avatar'
import {
  DrawerFinancialList,
  DrawerOutlineCard,
  DrawerSectionGroup,
  DrawerSectionHeading,
  DrawerSectionEmpty,
  DrawerSectionTitle,
  DrawerSummaryCard,
  DrawerSummaryLabel,
  DrawerSummaryMeta,
  DrawerSummaryValue,
  DrawerCompletionStatus,
} from '@/components/ui/drawer-section'
import { DrawerIdentityHeader } from '@/components/ui/drawer-identity-header'
import {
  DRAWER_WIDE_CONTENT_INSET,
  DRAWER_WIDTH_WIDE,
  DRAWER_WIDE_VERTICAL_RHYTHM,
} from '@/components/ui/drawer-layout'
import { cn } from '@/lib/utils'
import { ReceivableDetailDrawer } from '../receivables/receivable-detail-drawer'
import { ReceivableSheet, type ReceivableFormData } from '../receivables/receivable-sheet'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '../transactions/unmark-paid-warning-dialog'
import { RecurringIncomeSheet } from './recurring-income-sheet'
import { deleteReceivable, getReceivables, undoAndDeleteRecurringIncomeReceived, updateReceivable } from '@/services/receivables.service'
import { createRecurringIncome, deleteRecurringIncome, getRecurringIncomes, updateRecurringIncome, type CreateRecurringIncomePayload, type UpdateRecurringIncomePayload } from '@/services/recurring-income.service'
import { useAuth } from '@/providers/auth-provider'
import { formatCurrency, formatDate, formatSignedCurrency } from '@/lib/formatters'
import { accountToday, formatDateValue } from '@/lib/date'
import { syncSettlementEntity } from '@/lib/settlement-cache'
import { invalidateTransactionDependents } from '@/lib/transaction-dependent-queries'
import { settlementStatus } from '@/lib/settlement-status'
import { ROW_TRAILING_META_CLASS } from '@/components/ui/financial-list-row'
import { nextOpenIncomeOccurrence, nextOpenIncomeOccurrenceOnOrAfter, openRecurringIncomeOccurrences, recurringIncomeHistoryOccurrences, recurringIncomeOccurrencePresentation, recurringIncomeStatusPresentation, splitRecurringIncomeOpenOccurrences } from '@/lib/income-presentation'
import { incomeHistoryReceiptLabel } from '@/lib/income-history'
import type { Receivable, RecurringIncomeRule, TransactionType } from '@/types'

function OpenOccurrencesList({ occurrences, today, onSelect, onReceive }: { occurrences: Receivable[]; today: string; onSelect: (occurrence: Receivable) => void; onReceive: (occurrence: Receivable) => void }) {
  if (occurrences.length === 0) return <p className="text-sm text-muted-foreground">Ainda não há ocorrências abertas.</p>

  return (
    <DrawerFinancialList>
      {occurrences.map((occurrence) => {
        const overdue = settlementStatus(occurrence, today) === 'overdue'
        return (
          <FinancialSettlementRow
            key={occurrence.id}
            resolved={false}
            onToggleStatus={() => onReceive(occurrence)}
            ariaLabel={`Abrir ${occurrence.title}`}
            onView={() => onSelect(occurrence)}
            statusActionLabel={`Marcar ${occurrence.title} como recebido`}
            title={formatDate(occurrence.dueDate)}
            meta={<span className={overdue ? 'text-destructive' : 'text-muted-foreground'}>{overdue ? 'Em atraso' : 'A receber'}</span>}
            trailing={<FinancialRowTrailing amount={formatCurrency(occurrence.amount)} label="A RECEBER" />}
          />
        )
      })}
    </DrawerFinancialList>
  )
}

function HistoryOccurrencesList({ occurrences, timeZone, onSelect, onReverse }: { occurrences: Receivable[]; timeZone: string | null | undefined; onSelect: (occurrence: Receivable) => void; onReverse: (occurrence: Receivable) => void }) {
  if (occurrences.length === 0) {
    return (
      <DrawerSectionEmpty inset={false} className={DRAWER_WIDE_VERTICAL_RHYTHM.sectionEmptyPadding}>
        Nenhum recebimento realizado.
      </DrawerSectionEmpty>
    )
  }

  return (
    <DrawerFinancialList>
      {occurrences.map((occurrence) => {
        const receiptLabel = incomeHistoryReceiptLabel(occurrence, timeZone)
        return (
          <FinancialSettlementRow
            key={occurrence.id}
            resolved
            onToggleStatus={() => onReverse(occurrence)}
            statusActionLabel={`Desfazer recebimento de ${occurrence.title}`}
            ariaLabel={`Abrir ${occurrence.title}: ${receiptLabel}`}
            onView={() => onSelect(occurrence)}
            title={formatDate(occurrence.dueDate)}
            meta={<span>{receiptLabel}</span>}
            trailing={
              <>
                <span className={cn(ROW_AMOUNT_CLASS, 'text-muted-foreground')}>
                  {formatSignedCurrency(Number(occurrence.amount), 'in')}
                </span>
                <span className={ROW_TRAILING_META_CLASS}>{formatDate(occurrence.dueDate)}</span>
              </>
            }
          />
        )
      })}
    </DrawerFinancialList>
  )
}

export default function IncomePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [recurringSheetOpen, setRecurringSheetOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringIncomeRule | null>(null)
  const [selectedRule, setSelectedRule] = useState<RecurringIncomeRule | null>(null)
  const [selectedReceivable, setSelectedReceivable] = useState<Receivable | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecurringIncomeRule | null>(null)
  const [occurrenceDeleteTarget, setOccurrenceDeleteTarget] = useState<Receivable | null>(null)
  const [occurrenceEditTarget, setOccurrenceEditTarget] = useState<Receivable | null>(null)
  const [markPaidTarget, setMarkPaidTarget] = useState<Receivable | null>(null)
  const [unmarkPaidTarget, setUnmarkPaidTarget] = useState<Receivable | null>(null)

  const rulesQuery = useQuery({ queryKey: ['recurring-incomes'], queryFn: getRecurringIncomes })
  const receivablesQuery = useQuery({ queryKey: ['receivables'], queryFn: () => getReceivables() })
  const rules = rulesQuery.data ?? []
  const receivables = receivablesQuery.data ?? []
  const today = user?.timeZone ? accountToday(user.timeZone) : formatDateValue()
  const selectedOccurrences = selectedRule ? openRecurringIncomeOccurrences(selectedRule, receivables) : []
  const selectedOccurrenceGroups = splitRecurringIncomeOpenOccurrences(selectedOccurrences, today)
  const selectedHistoryOccurrences = selectedRule ? recurringIncomeHistoryOccurrences(selectedRule, receivables) : []
  const selectedRuleNextOccurrence = nextOpenIncomeOccurrenceOnOrAfter(selectedOccurrences, today) ?? null

  const invalidateIncome = (sourceChanged = false) => {
    queryClient.invalidateQueries({ queryKey: ['recurring-incomes'] })
    queryClient.invalidateQueries({ queryKey: ['receivables'] })
    queryClient.invalidateQueries({ queryKey: ['obligations'] })
    if (sourceChanged) {
      queryClient.invalidateQueries({ queryKey: ['recurring-income-reconcile'] })
      queryClient.removeQueries({ queryKey: ['recurring-income-overdue-refresh'] })
    }
  }

  const recurringCreateMutation = useMutation({
    mutationFn: (payload: CreateRecurringIncomePayload | UpdateRecurringIncomePayload) => createRecurringIncome(payload as CreateRecurringIncomePayload),
    onSuccess: () => { invalidateIncome(true); setRecurringSheetOpen(false); toast.success('Renda recorrente criada') },
    onError: () => toast.error('Não foi possível criar a renda'),
  })
  const recurringUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateRecurringIncomePayload | UpdateRecurringIncomePayload }) => updateRecurringIncome(id, payload as UpdateRecurringIncomePayload),
    onSuccess: () => { invalidateIncome(true); setRecurringSheetOpen(false); setEditingRule(null); toast.success('Renda atualizada') },
    onError: () => toast.error('Não foi possível atualizar a renda'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteRecurringIncome,
    onSuccess: () => { invalidateIncome(true); setDeleteTarget(null); setSelectedRule(null); toast.success('Renda excluída') },
    onError: () => toast.error('Não foi possível excluir a renda'),
  })
  const deleteOccurrenceMutation = useMutation({
    mutationFn: (id: string) => deleteReceivable(id),
    onSuccess: () => {
      invalidateIncome()
      setOccurrenceDeleteTarget(null)
      setSelectedReceivable(null)
      toast.success('Recebimento excluído')
    },
    onError: () => toast.error('Não foi possível excluir o recebimento'),
  })
  const deleteReceivedOccurrenceMutation = useMutation({
    mutationFn: undoAndDeleteRecurringIncomeReceived,
    onSuccess: () => {
      invalidateIncome(true)
      invalidateTransactionDependents(queryClient, { affectsPerson: false })
      setSelectedReceivable(null)
      toast.success('Recebimento desfeito e excluído')
    },
    onError: () => toast.error('Não foi possível desfazer o recebimento e excluir'),
  })
  const updateOccurrenceMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReceivableFormData }) => {
      const rest = { ...payload }
      delete rest.installments
      return updateReceivable(id, rest)
    },
    onSuccess: () => { invalidateIncome(); setOccurrenceEditTarget(null); toast.success('Recebimento atualizado') },
    onError: () => toast.error('Não foi possível atualizar o recebimento'),
  })
  const settlementMutation = useMutation({
    mutationFn: ({ id, isPaid, payload }: { id: string; isPaid: boolean; payload?: { paymentDate?: string; paymentBankId?: string; paymentType?: TransactionType } }) => updateReceivable(id, { isPaid, ...payload }),
    onSuccess: (result, variables) => {
      syncSettlementEntity(queryClient, 'receivable', variables.id, result)
      invalidateIncome()
      invalidateTransactionDependents(queryClient, { affectsPerson: false })
      const updated = Array.isArray(result) ? result.find((item) => item.id === variables.id) : result
      if (updated && selectedReceivable?.id === updated.id) setSelectedReceivable(updated)
      if (variables.isPaid) setMarkPaidTarget(null)
      toast.success(variables.isPaid ? 'Recebimento registrado' : 'Recebimento desfeito')
    },
    onError: (_error, variables) => toast.error(variables.isPaid ? 'Não foi possível registrar o recebimento' : 'Não foi possível desfazer o recebimento'),
  })

  function handleSelectedReceivableToggle(item: Receivable) {
    if (!item.isPaid) {
      setMarkPaidTarget(item)
    } else if (item.paymentTransactionId) {
      setUnmarkPaidTarget(item)
    } else {
      settlementMutation.mutate({ id: item.id, isPaid: false })
    }
  }

  function handleUnmarkPaidConfirm() {
    if (!unmarkPaidTarget) return
    settlementMutation.mutate({ id: unmarkPaidTarget.id, isPaid: false })
    setUnmarkPaidTarget(null)
  }

  function openRecurringCreate() {
    setEditingRule(null)
    setRecurringSheetOpen(true)
  }

  function openRecurringEdit(rule: RecurringIncomeRule) {
    setSelectedRule(null)
    setEditingRule(rule)
    setRecurringSheetOpen(true)
  }

  function openReceivableEdit(receivable: Receivable) {
    setSelectedReceivable(null)
    setOccurrenceEditTarget(receivable)
  }

  const loading = rulesQuery.isLoading || receivablesQuery.isLoading
  const error = rulesQuery.error || receivablesQuery.error
  if (error && !loading) {
    return <div className="flex flex-col gap-6"><QueryError message="Não foi possível carregar suas rendas." isFetching={rulesQuery.isFetching || receivablesQuery.isFetching} onRetry={() => { rulesQuery.refetch(); receivablesQuery.refetch() }} /></div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Renda</h1><p className="mt-0.5 text-sm text-muted-foreground">Fontes que você espera receber.</p></div>
        <Button className="shrink-0 gap-2" onClick={openRecurringCreate}><Plus className="size-4" /> <span>Adicionar</span></Button>
      </div>

      {loading ? <div className="space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div> : (
        <div className="space-y-8">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-border/70 px-6 py-16 text-center"><div className="flex size-12 items-center justify-center rounded-xl bg-muted"><CircleDollarSign className="size-6 text-muted-foreground" /></div><h2 className="mt-4 text-base font-medium">Nenhuma renda recorrente cadastrada.</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Cadastre salário e outras rendas para acompanhar o que você espera receber.</p><Button className="mt-5" onClick={openRecurringCreate}>Adicionar</Button></div>
          ) : (
            <div className="space-y-8">
              {rules.length > 0 ? <section><h2 className="mb-2 text-sm font-medium">Fontes recorrentes</h2><div className="divide-y divide-border/60">{rules.map((rule) => { const occurrences = openRecurringIncomeOccurrences(rule, receivables); const next = nextOpenIncomeOccurrence(occurrences); const presentation = next ? recurringIncomeOccurrencePresentation(next, today) : null; return <FinancialListRow key={rule.id} onView={() => setSelectedRule(rule)} ariaLabel={`Abrir ${rule.title}`} leading={<FinancialAvatar icon={<Repeat className="size-5 text-muted-foreground" />} />} title={rule.title} titleAdornment={!rule.isActive ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Encerrada</span> : null} meta={<>{presentation?.tone === 'overdue' ? <span className="text-destructive">{presentation.label}</span> : <><span>Dia {rule.dayOfMonth}</span>{rule.counterpartyName ? <><span aria-hidden>·</span><span>{rule.counterpartyName}</span></> : null}</>}</>} trailing={<FinancialRowTrailing amount={<>{formatCurrency(rule.amount)} <span className="text-xs font-normal tracking-normal text-muted-foreground">/ mês</span></>} label={rule.isActive ? 'A RECEBER' : 'ENCERRADA'} />} /> })}</div></section> : null}
            </div>
          )}
        </div>
      )}

      <Sheet open={selectedRule !== null} onOpenChange={(open) => { if (!open) setSelectedRule(null) }}>
        <SheetContent className={cn(DRAWER_WIDTH_WIDE, DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap)} showCloseButton={false}>
          <DrawerIdentityHeader title={selectedRule?.title} description={`Fonte recorrente · ${selectedRule?.isActive ? 'Ativa' : 'Encerrada'}`} />
          {selectedRule ? (
            <div className={cn("flex flex-1 flex-col overflow-y-auto subtle-scrollbar", DRAWER_WIDE_CONTENT_INSET, DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap, "pb-6")}>
              <DrawerSummaryCard inset={false}>
                <DrawerSummaryLabel emphasis="regular">Valor esperado por mês</DrawerSummaryLabel>
                <DrawerSummaryValue className="text-foreground">{formatCurrency(selectedRule.amount)}</DrawerSummaryValue>
                <DrawerSummaryMeta className="mt-2">Dia {selectedRule.dayOfMonth}{selectedRule.counterpartyName ? ` · ${selectedRule.counterpartyName}` : ''}</DrawerSummaryMeta>
                <DrawerSummaryMeta className="mt-2">Renda desde {formatDate(`${selectedRule.firstOccurrence}-01`)}</DrawerSummaryMeta>
                {(() => {
                  const status = recurringIncomeStatusPresentation(selectedOccurrences, today)
                  return <div className="mt-3"><DrawerCompletionStatus variant={status.tone}>{status.label}</DrawerCompletionStatus></div>
                })()}
              </DrawerSummaryCard>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2" onClick={() => openRecurringEdit(selectedRule)}><Pencil className="size-3.5" /> Editar renda</Button>
                {selectedRule.isActive ? <Button variant="destructive" className="gap-2" onClick={() => setDeleteTarget(selectedRule)}><Trash2 className="size-3.5" /> Excluir renda</Button> : null}
              </div>
              <DrawerOutlineCard variant="compact">
                <p className="text-xs text-muted-foreground">Próxima ocorrência</p>
                <p className="mt-1 text-sm font-medium">{selectedRuleNextOccurrence ? formatDate(selectedRuleNextOccurrence.dueDate) : 'Nenhuma em aberto'}</p>
              </DrawerOutlineCard>
              {selectedOccurrenceGroups.overdue.length > 0 ? (
                <DrawerSectionGroup>
                  <DrawerSectionHeading>
                    <DrawerSectionTitle title="Em atraso" count={selectedOccurrenceGroups.overdue.length} />
                  </DrawerSectionHeading>
                  <OpenOccurrencesList occurrences={selectedOccurrenceGroups.overdue} today={today} onSelect={setSelectedReceivable} onReceive={(occurrence) => setMarkPaidTarget(occurrence)} />
                </DrawerSectionGroup>
              ) : null}
              {selectedOccurrenceGroups.open.length > 0 ? (
                <DrawerSectionGroup>
                  <DrawerSectionHeading>
                    <DrawerSectionTitle title="Em aberto" count={selectedOccurrenceGroups.open.length} />
                  </DrawerSectionHeading>
                  <OpenOccurrencesList occurrences={selectedOccurrenceGroups.open} today={today} onSelect={setSelectedReceivable} onReceive={(occurrence) => setMarkPaidTarget(occurrence)} />
                </DrawerSectionGroup>
              ) : null}
              <DrawerSectionGroup>
                <DrawerSectionHeading>Histórico</DrawerSectionHeading>
                <HistoryOccurrencesList
                  occurrences={selectedHistoryOccurrences}
                  timeZone={user?.timeZone}
                  onSelect={setSelectedReceivable}
                  onReverse={handleSelectedReceivableToggle}
                />
              </DrawerSectionGroup>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <ReceivableDetailDrawer receivable={selectedReceivable} mode="operational" onOpenChange={(open) => { if (!open) setSelectedReceivable(null) }} onEdit={openReceivableEdit} onToggleReceived={handleSelectedReceivableToggle} onDelete={(item) => setOccurrenceDeleteTarget(item)} onDeleteFlowStart={() => setOccurrenceDeleteTarget(null)} onDeleteRecurringReceived={(item) => deleteReceivedOccurrenceMutation.mutateAsync(item.id)} />
      <RecurringIncomeSheet key={`${editingRule?.id ?? 'new'}-${recurringSheetOpen}`} open={recurringSheetOpen} onOpenChange={(open) => { setRecurringSheetOpen(open); if (!open) setEditingRule(null) }} editTarget={editingRule} isPending={recurringCreateMutation.isPending || recurringUpdateMutation.isPending} onSubmit={(payload) => editingRule ? recurringUpdateMutation.mutate({ id: editingRule.id, payload }) : recurringCreateMutation.mutate(payload)} />
      <ReceivableSheet mode="income-occurrence" open={occurrenceEditTarget !== null} onOpenChange={(open) => { if (!open) setOccurrenceEditTarget(null) }} editTarget={occurrenceEditTarget} editScope={null} timeZone={user?.timeZone} onSubmit={async (data) => { if (occurrenceEditTarget) await updateOccurrenceMutation.mutateAsync({ id: occurrenceEditTarget.id, payload: data }) }} />
      <MarkAsPaidDialog open={markPaidTarget !== null} kind="receivable" createTransaction onConfirm={(payload) => markPaidTarget && settlementMutation.mutate({ id: markPaidTarget.id, isPaid: true, payload })} onCancel={() => setMarkPaidTarget(null)} isPending={settlementMutation.isPending} />
      <UnmarkPaidWarningDialog open={unmarkPaidTarget !== null} kind="receivable" isPending={settlementMutation.isPending} onConfirm={handleUnmarkPaidConfirm} onCancel={() => setUnmarkPaidTarget(null)} />
      <ConfirmDialog open={deleteTarget !== null} title="Excluir renda recorrente?" description="Novos recebimentos deixarão de ser criados. Os recebimentos em aberto serão removidos, mas os já realizados e o histórico financeiro serão preservados." confirmLabel="Excluir renda" variant="destructive" isPending={deleteMutation.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} />
      <ConfirmDialog open={occurrenceDeleteTarget !== null} title="Excluir este recebimento?" description="Essa ocorrência será removida e não será criada novamente para esta competência." confirmLabel="Excluir" variant="destructive" isPending={deleteOccurrenceMutation.isPending} onCancel={() => setOccurrenceDeleteTarget(null)} onConfirm={() => occurrenceDeleteTarget && deleteOccurrenceMutation.mutate(occurrenceDeleteTarget.id)} />
    </div>
  )
}

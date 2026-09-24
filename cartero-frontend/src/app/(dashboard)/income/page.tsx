'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, CircleDollarSign, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryError } from '@/components/ui/query-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FinancialListRow, FinancialRowTrailing, ROW_ICON_BG_CLASS, ROW_ICON_CLASS, SETTLEMENT_ACTION_CIRCLE_CLASS } from '@/components/ui/financial-list-row'
import { ReceivableDetailDrawer } from '../receivables/receivable-detail-drawer'
import { ReceivableSheet, type ReceivableFormData } from '../receivables/receivable-sheet'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { RecurringIncomeSheet } from './recurring-income-sheet'
import { getReceivables, createReceivable, updateReceivable } from '@/services/receivables.service'
import { createRecurringIncome, deleteRecurringIncome, getRecurringIncomes, updateRecurringIncome, type CreateRecurringIncomePayload, type UpdateRecurringIncomePayload } from '@/services/recurring-income.service'
import { useAuth } from '@/providers/auth-provider'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { formatDateValue } from '@/lib/date'
import { accountToday } from '@/lib/date'
import { nextOpenIncomeOccurrence, nextOpenIncomeOccurrenceOnOrAfter, openOneOffIncome, openRecurringIncomeOccurrences, recurringIncomeOccurrencePresentation } from '@/lib/income-presentation'
import type { Receivable, RecurringIncomeRule, TransactionType } from '@/types'

function IncomeRow({ item, onView, today }: { item: Receivable; onView: () => void; today: string }) {
  const presentation = recurringIncomeOccurrencePresentation(item, today)
  return (
    <FinancialListRow
      ariaLabel={`Abrir ${item.title}`}
      leadingAction={<button type="button" className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS} ${SETTLEMENT_ACTION_CIRCLE_CLASS}`} aria-label={`Abrir ${item.title}`} onClick={onView}><span className="sr-only">Abrir detalhes</span></button>}
      title={item.title}
      meta={<span className={presentation.tone === 'overdue' ? 'text-destructive' : 'text-muted-foreground'}>{presentation.label}</span>}
      trailing={<FinancialRowTrailing amount={formatCurrency(item.amount)} label="A RECEBER" />}
    />
  )
}

function OpenOccurrencesList({ occurrences, today, onSelect, onReceive }: { occurrences: Receivable[]; today: string; onSelect: (occurrence: Receivable) => void; onReceive: (occurrence: Receivable) => void }) {
  if (occurrences.length === 0) return <p className="mt-3 text-sm text-muted-foreground">Ainda não há ocorrências abertas.</p>

  return (
    <div className="mt-2 divide-y divide-border/60">
      {occurrences.map((occurrence) => {
        const presentation = recurringIncomeOccurrencePresentation(occurrence, today)
        return (
          <FinancialListRow
            key={occurrence.id}
            ariaLabel={`Abrir ${occurrence.title}`}
            onView={() => onSelect(occurrence)}
            leadingAction={<button type="button" className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS} ${SETTLEMENT_ACTION_CIRCLE_CLASS}`} aria-label={`Marcar ${occurrence.title} como recebido`} title="Marcar como recebido" onClick={(event) => { event.stopPropagation(); onReceive(occurrence) }}><span className="sr-only">Marcar como recebido</span></button>}
            title={formatDate(occurrence.dueDate)}
            meta={<span className={presentation.tone === 'overdue' ? 'text-destructive' : 'text-muted-foreground'}>{presentation.tone === 'overdue' ? 'Em atraso' : 'A receber'}</span>}
            trailing={<FinancialRowTrailing amount={formatCurrency(occurrence.amount)} label="A RECEBER" />}
          />
        )
      })}
    </div>
  )
}

export default function IncomePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [chooserOpen, setChooserOpen] = useState(false)
  const [recurringSheetOpen, setRecurringSheetOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringIncomeRule | null>(null)
  const [selectedRule, setSelectedRule] = useState<RecurringIncomeRule | null>(null)
  const [selectedReceivable, setSelectedReceivable] = useState<Receivable | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecurringIncomeRule | null>(null)
  const [oneOffOpen, setOneOffOpen] = useState(false)
  const [occurrenceEditTarget, setOccurrenceEditTarget] = useState<Receivable | null>(null)
  const [markPaidTarget, setMarkPaidTarget] = useState<Receivable | null>(null)

  const rulesQuery = useQuery({ queryKey: ['recurring-incomes'], queryFn: getRecurringIncomes })
  const receivablesQuery = useQuery({ queryKey: ['receivables'], queryFn: () => getReceivables() })
  const rules = rulesQuery.data ?? []
  const receivables = receivablesQuery.data ?? []
  const oneOffs = openOneOffIncome(receivables)
  const selectedOccurrences = selectedRule ? openRecurringIncomeOccurrences(selectedRule, receivables) : []
  const today = user?.timeZone ? accountToday(user.timeZone) : formatDateValue()
  const selectedRuleNextOccurrence = nextOpenIncomeOccurrenceOnOrAfter(selectedOccurrences, today) ?? null

  const invalidateIncome = () => {
    queryClient.invalidateQueries({ queryKey: ['recurring-incomes'] })
    queryClient.invalidateQueries({ queryKey: ['receivables'] })
  }

  const recurringCreateMutation = useMutation({
    mutationFn: (payload: CreateRecurringIncomePayload | UpdateRecurringIncomePayload) => createRecurringIncome(payload as CreateRecurringIncomePayload),
    onSuccess: () => { invalidateIncome(); setRecurringSheetOpen(false); toast.success('Renda recorrente criada') },
    onError: () => toast.error('Não foi possível criar a renda'),
  })
  const recurringUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateRecurringIncomePayload | UpdateRecurringIncomePayload }) => updateRecurringIncome(id, payload as UpdateRecurringIncomePayload),
    onSuccess: () => { invalidateIncome(); setRecurringSheetOpen(false); setEditingRule(null); toast.success('Renda atualizada') },
    onError: () => toast.error('Não foi possível atualizar a renda'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteRecurringIncome,
    onSuccess: () => { invalidateIncome(); setDeleteTarget(null); setSelectedRule(null); toast.success('Renda excluída') },
    onError: () => toast.error('Não foi possível excluir a renda'),
  })
  const createOneOffMutation = useMutation({
    mutationFn: (payload: ReceivableFormData) => {
      const rest = { ...payload }
      delete rest.installments
      return createReceivable({ ...rest, incomeClassification: 'INCOME' })
    },
    onSuccess: () => { invalidateIncome(); setOneOffOpen(false); toast.success('Recebimento pontual criado') },
    onError: () => toast.error('Não foi possível criar o recebimento'),
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
  const markPaidMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { paymentDate?: string; paymentBankId?: string; paymentType?: TransactionType } }) => updateReceivable(id, { isPaid: true, ...payload }),
    onSuccess: () => { invalidateIncome(); setMarkPaidTarget(null); toast.success('Recebimento marcado como recebido') },
    onError: () => toast.error('Não foi possível marcar o recebimento'),
  })

  function openRecurringCreate() {
    setChooserOpen(false)
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
        <Button className="shrink-0 gap-2" onClick={() => setChooserOpen(true)}><Plus className="size-4" /> <span className="hidden sm:inline">Adicionar renda</span><span className="sm:hidden">Adicionar</span></Button>
      </div>

      {loading ? <div className="space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div> : rules.length === 0 && oneOffs.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border/70 px-6 py-16 text-center"><div className="flex size-12 items-center justify-center rounded-xl bg-muted"><CircleDollarSign className="size-6 text-muted-foreground" /></div><h2 className="mt-4 text-base font-medium">Comece pelas suas fontes de renda</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Cadastre salário e outras rendas para acompanhar o que você espera receber.</p><Button className="mt-5" onClick={() => setChooserOpen(true)}>Adicionar renda</Button></div>
      ) : (
        <div className="space-y-8">
          {rules.length > 0 ? <section><h2 className="mb-2 text-sm font-medium">Fontes recorrentes</h2><div className="divide-y divide-border/60">{rules.map((rule) => { const occurrences = openRecurringIncomeOccurrences(rule, receivables); const next = nextOpenIncomeOccurrence(occurrences); const presentation = next ? recurringIncomeOccurrencePresentation(next, today) : null; return <FinancialListRow key={rule.id} onView={() => setSelectedRule(rule)} ariaLabel={`Abrir ${rule.title}`} leading={<span className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS}`}><Repeat className="size-5 text-muted-foreground" /></span>} title={rule.title} titleAdornment={!rule.isActive ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Encerrada</span> : null} meta={<>{presentation?.tone === 'overdue' ? <span className="text-destructive">{presentation.label}</span> : <><span>Dia {rule.dayOfMonth}</span>{rule.counterpartyName ? <><span aria-hidden>·</span><span>{rule.counterpartyName}</span></> : null}</>}</>} trailing={<FinancialRowTrailing amount={<>{formatCurrency(rule.amount)} <span className="text-xs font-normal tracking-normal text-muted-foreground">/ mês</span></>} label={rule.isActive ? 'A RECEBER' : 'ENCERRADA'} />} /> })}</div></section> : null}
          {oneOffs.length > 0 ? <section><h2 className="mb-2 text-sm font-medium">Recebimentos pontuais</h2><div className="divide-y divide-border/60">{oneOffs.map((item) => <IncomeRow key={item.id} item={item} today={today} onView={() => setSelectedReceivable(item)} />)}</div></section> : null}
        </div>
      )}

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Adicionar renda</DialogTitle><DialogDescription>Escolha se este recebimento se repete ou acontece uma única vez.</DialogDescription></DialogHeader><div className="grid gap-2"><button type="button" className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50" onClick={openRecurringCreate}><Repeat className="mt-0.5 size-5 text-muted-foreground" /><span><span className="block text-sm font-medium">Renda recorrente</span><span className="mt-1 block text-xs text-muted-foreground">Salário, aluguel, pensão ou outra renda mensal.</span></span></button><button type="button" className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50" onClick={() => { setChooserOpen(false); setOneOffOpen(true) }}><CalendarDays className="mt-0.5 size-5 text-muted-foreground" /><span><span className="block text-sm font-medium">Renda pontual</span><span className="mt-1 block text-xs text-muted-foreground">Comissão, freelance, bônus ou outro valor esperado.</span></span></button></div><DialogFooter><Button variant="outline" onClick={() => setChooserOpen(false)}>Cancelar</Button></DialogFooter></DialogContent></Dialog>

      <Sheet open={selectedRule !== null} onOpenChange={(open) => { if (!open) setSelectedRule(null) }}><SheetContent className="sm:max-w-lg"><SheetHeader><SheetTitle>{selectedRule?.title}</SheetTitle><SheetDescription>Fonte recorrente · {selectedRule?.isActive ? 'Ativa' : 'Encerrada'}</SheetDescription></SheetHeader>{selectedRule ? <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-6"><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Valor esperado por mês</p><p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(selectedRule.amount)}</p><p className="mt-2 text-xs text-muted-foreground">Dia {selectedRule.dayOfMonth}{selectedRule.counterpartyName ? ` · ${selectedRule.counterpartyName}` : ''}</p><p className="mt-2 text-xs text-muted-foreground">Renda desde {formatDate(`${selectedRule.firstOccurrence}-01`)}</p></div><div className="mt-3 flex gap-2"><Button variant="outline" className="gap-2" onClick={() => openRecurringEdit(selectedRule)}><Pencil className="size-3.5" /> Editar renda</Button>{selectedRule.isActive ? <Button variant="destructive" className="gap-2" onClick={() => setDeleteTarget(selectedRule)}><Trash2 className="size-3.5" /> Excluir renda</Button> : null}</div><div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5"><p className="text-xs text-muted-foreground">Próxima ocorrência</p><p className="mt-1 text-sm font-medium">{selectedRuleNextOccurrence ? formatDate(selectedRuleNextOccurrence.dueDate) : 'Nenhuma em aberto'}</p></div><div className="mt-8"><h3 className="text-sm font-medium">Ocorrências em aberto</h3><OpenOccurrencesList occurrences={selectedOccurrences} today={today} onSelect={(occurrence) => { setSelectedRule(null); setSelectedReceivable(occurrence) }} onReceive={(occurrence) => setMarkPaidTarget(occurrence)} /></div></div> : null}</SheetContent></Sheet>
      <ReceivableDetailDrawer receivable={selectedReceivable} onOpenChange={(open) => { if (!open) setSelectedReceivable(null) }} onEdit={openReceivableEdit} onToggleReceived={(item) => { setSelectedReceivable(null); setMarkPaidTarget(item) }} />
      <RecurringIncomeSheet key={`${editingRule?.id ?? 'new'}-${recurringSheetOpen}`} open={recurringSheetOpen} onOpenChange={(open) => { setRecurringSheetOpen(open); if (!open) setEditingRule(null) }} editTarget={editingRule} isPending={recurringCreateMutation.isPending || recurringUpdateMutation.isPending} onSubmit={(payload) => editingRule ? recurringUpdateMutation.mutate({ id: editingRule.id, payload }) : recurringCreateMutation.mutate(payload)} />
      <ReceivableSheet mode={occurrenceEditTarget ? 'income-occurrence' : 'income'} open={oneOffOpen || occurrenceEditTarget !== null} onOpenChange={(open) => { if (!open) { setOneOffOpen(false); setOccurrenceEditTarget(null) } }} editTarget={occurrenceEditTarget} editScope={null} timeZone={user?.timeZone} onSubmit={async (data) => { if (occurrenceEditTarget) await updateOccurrenceMutation.mutateAsync({ id: occurrenceEditTarget.id, payload: data }); else await createOneOffMutation.mutateAsync(data) }} />
      <MarkAsPaidDialog open={markPaidTarget !== null} kind="receivable" createTransaction onConfirm={(payload) => markPaidTarget && markPaidMutation.mutate({ id: markPaidTarget.id, payload })} onCancel={() => setMarkPaidTarget(null)} isPending={markPaidMutation.isPending} />
      <ConfirmDialog open={deleteTarget !== null} title="Excluir renda recorrente?" description="Novos recebimentos deixarão de ser criados. Os recebimentos em aberto serão removidos, mas os já realizados e o histórico financeiro serão preservados." confirmLabel="Excluir renda" variant="destructive" isPending={deleteMutation.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} />
    </div>
  )
}

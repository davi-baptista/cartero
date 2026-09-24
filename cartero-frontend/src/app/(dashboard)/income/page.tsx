'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, Check, CircleDollarSign, Pencil, Plus, Repeat, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryError } from '@/components/ui/query-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FinancialListRow, ROW_AMOUNT_CLASS, ROW_AMOUNT_TONE, ROW_ICON_BG_CLASS, ROW_ICON_CLASS, ROW_TRAILING_META_CLASS, SETTLEMENT_ACTION_CIRCLE_CLASS } from '@/components/ui/financial-list-row'
import { ReceivableSheet, type ReceivableFormData } from '../receivables/receivable-sheet'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { RecurringIncomeSheet } from './recurring-income-sheet'
import { getReceivables, createReceivable, updateReceivable } from '@/services/receivables.service'
import { createRecurringIncome, deactivateRecurringIncome, getRecurringIncomes, updateRecurringIncome, type CreateRecurringIncomePayload } from '@/services/recurring-income.service'
import { useAuth } from '@/providers/auth-provider'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { isOneOffIncome, nextOpenIncomeOccurrence, recurringIncomeOccurrences } from '@/lib/income-presentation'
import type { Receivable, RecurringIncomeRule, TransactionType } from '@/types'

function IncomeRow({ item, onView }: { item: Receivable; onView: () => void }) {
  return (
    <FinancialListRow
      onView={onView}
      ariaLabel={`Abrir ${item.title}`}
      leading={<span className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS}`}><CircleDollarSign className="size-5 text-receivable" /></span>}
      title={item.title}
      meta={<><span>{item.debtorName || 'Renda pontual'}</span><span aria-hidden>·</span><span>{formatDate(item.dueDate)}</span></>}
      trailing={<><span className={`${ROW_AMOUNT_CLASS} ${item.isPaid ? ROW_AMOUNT_TONE.muted : ROW_AMOUNT_TONE.in}`}>{formatCurrency(item.amount)}</span><span className={`${ROW_TRAILING_META_CLASS} ${item.isPaid ? 'text-paid' : ''}`}>{item.isPaid ? 'Recebido' : 'A receber'}</span></>}
    />
  )
}

export default function IncomePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [chooserOpen, setChooserOpen] = useState(false)
  const [recurringSheetOpen, setRecurringSheetOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringIncomeRule | null>(null)
  const [selectedRule, setSelectedRule] = useState<RecurringIncomeRule | null>(null)
  const [closeTarget, setCloseTarget] = useState<RecurringIncomeRule | null>(null)
  const [oneOffOpen, setOneOffOpen] = useState(false)
  const [occurrenceEditTarget, setOccurrenceEditTarget] = useState<Receivable | null>(null)
  const [markPaidTarget, setMarkPaidTarget] = useState<Receivable | null>(null)

  const rulesQuery = useQuery({ queryKey: ['recurring-incomes'], queryFn: getRecurringIncomes })
  const receivablesQuery = useQuery({ queryKey: ['receivables'], queryFn: () => getReceivables() })
  const rules = rulesQuery.data ?? []
  const receivables = receivablesQuery.data ?? []
  const oneOffs = receivables.filter(isOneOffIncome)
  const selectedOccurrences = selectedRule ? recurringIncomeOccurrences(selectedRule, receivables) : []

  const invalidateIncome = () => {
    queryClient.invalidateQueries({ queryKey: ['recurring-incomes'] })
    queryClient.invalidateQueries({ queryKey: ['receivables'] })
  }

  const recurringCreateMutation = useMutation({
    mutationFn: createRecurringIncome,
    onSuccess: () => { invalidateIncome(); setRecurringSheetOpen(false); toast.success('Renda recorrente criada') },
    onError: () => toast.error('Não foi possível criar a renda'),
  })
  const recurringUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateRecurringIncomePayload }) => updateRecurringIncome(id, payload),
    onSuccess: () => { invalidateIncome(); setRecurringSheetOpen(false); setEditingRule(null); toast.success('Renda atualizada') },
    onError: () => toast.error('Não foi possível atualizar a renda'),
  })
  const deactivateMutation = useMutation({
    mutationFn: deactivateRecurringIncome,
    onSuccess: () => { invalidateIncome(); setCloseTarget(null); setSelectedRule(null); toast.success('Renda encerrada') },
    onError: () => toast.error('Não foi possível encerrar a renda'),
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
    setChooserOpen(false); setEditingRule(null); setRecurringSheetOpen(true)
  }

  function openRecurringEdit(rule: RecurringIncomeRule) {
    setSelectedRule(null); setEditingRule(rule); setRecurringSheetOpen(true)
  }

  const loading = rulesQuery.isLoading || receivablesQuery.isLoading
  const error = rulesQuery.error || receivablesQuery.error
  if (error && !loading) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"><QueryError message="Não foi possível carregar suas rendas." isFetching={rulesQuery.isFetching || receivablesQuery.isFetching} onRetry={() => { rulesQuery.refetch(); receivablesQuery.refetch() }} /></main>
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Planejamento</p><h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Renda</h1><p className="mt-1 text-sm text-muted-foreground">Fontes que você espera receber.</p></div>
        <Button className="shrink-0 gap-2" onClick={() => setChooserOpen(true)}><Plus className="size-4" /> <span className="hidden sm:inline">Adicionar renda</span><span className="sm:hidden">Adicionar</span></Button>
      </div>

      {loading ? <div className="mt-8 space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div> : rules.length === 0 && oneOffs.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-xl border border-dashed border-border/70 px-6 py-16 text-center"><div className="flex size-12 items-center justify-center rounded-xl bg-primary/10"><CircleDollarSign className="size-6 text-primary" /></div><h2 className="mt-4 text-base font-medium">Comece pelas suas fontes de renda</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Cadastre salário e outras rendas para acompanhar o que você espera receber.</p><Button className="mt-5" onClick={() => setChooserOpen(true)}>Adicionar renda</Button></div>
      ) : (
        <div className="mt-8 space-y-8">
          {rules.length > 0 ? <section><div className="mb-2 flex items-center gap-2"><Repeat className="size-4 text-muted-foreground" /><h2 className="text-sm font-medium">Fontes recorrentes</h2></div><div className="divide-y divide-border/60">{rules.map((rule) => { const occurrences = recurringIncomeOccurrences(rule, receivables); const next = nextOpenIncomeOccurrence(occurrences); return <FinancialListRow key={rule.id} onView={() => setSelectedRule(rule)} ariaLabel={`Abrir ${rule.title}`} leading={<span className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS}`}><Repeat className="size-5 text-primary" /></span>} title={rule.title} titleAdornment={!rule.isActive ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Encerrada</span> : null} meta={<><span>{formatCurrency(rule.amount)} / mês</span><span aria-hidden>·</span><span>Dia {rule.dayOfMonth}</span>{rule.counterpartyName ? <><span aria-hidden>·</span><span>{rule.counterpartyName}</span></> : null}</>} trailing={<><span className={`${ROW_AMOUNT_CLASS} ${ROW_AMOUNT_TONE.in}`}>{next ? formatCurrency(next.amount) : '—'}</span><span className={ROW_TRAILING_META_CLASS}>{next ? `Próximo: ${formatDate(next.dueDate)}` : rule.isActive ? 'Sem ocorrência' : 'Encerrada'}</span></>} /> })}</div></section> : null}
          {oneOffs.length > 0 ? <section><div className="mb-2 flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /><h2 className="text-sm font-medium">Recebimentos pontuais</h2></div><div className="divide-y divide-border/60">{oneOffs.map((item) => <IncomeRow key={item.id} item={item} onView={() => setOccurrenceEditTarget(item)} />)}</div></section> : null}
        </div>
      )}

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Adicionar renda</DialogTitle><DialogDescription>Escolha se este recebimento se repete ou acontece uma única vez.</DialogDescription></DialogHeader><div className="grid gap-2"><button type="button" className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50" onClick={openRecurringCreate}><Repeat className="mt-0.5 size-5 text-primary" /><span><span className="block text-sm font-medium">Renda recorrente</span><span className="mt-1 block text-xs text-muted-foreground">Salário, aluguel, pensão ou outra renda mensal.</span></span></button><button type="button" className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50" onClick={() => { setChooserOpen(false); setOneOffOpen(true) }}><CalendarDays className="mt-0.5 size-5 text-primary" /><span><span className="block text-sm font-medium">Renda pontual</span><span className="mt-1 block text-xs text-muted-foreground">Comissão, freelance, bônus ou outro valor esperado.</span></span></button></div><DialogFooter><Button variant="outline" onClick={() => setChooserOpen(false)}>Cancelar</Button></DialogFooter></DialogContent></Dialog>

      <Sheet open={selectedRule !== null} onOpenChange={(open) => { if (!open) setSelectedRule(null) }}><SheetContent className="sm:max-w-lg"><SheetHeader><SheetTitle>{selectedRule?.title}</SheetTitle><SheetDescription>Fonte recorrente · {selectedRule?.isActive ? 'Ativa' : 'Encerrada'}</SheetDescription></SheetHeader>{selectedRule ? <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-6"><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Valor esperado por mês</p><p className="mt-1 text-2xl font-semibold tabular-nums text-receivable">{formatCurrency(selectedRule.amount)}</p><p className="mt-2 text-xs text-muted-foreground">Dia {selectedRule.dayOfMonth}{selectedRule.counterpartyName ? ` · ${selectedRule.counterpartyName}` : ''}</p></div><div className="mt-6 flex gap-2"><Button variant="outline" className="gap-2" onClick={() => openRecurringEdit(selectedRule)}><Pencil className="size-3.5" /> Editar renda</Button>{selectedRule.isActive ? <Button variant="outline" className="gap-2" onClick={() => setCloseTarget(selectedRule)}><XCircle className="size-3.5" /> Encerrar</Button> : null}</div><div className="mt-8"><h3 className="text-sm font-medium">Recebimentos relacionados</h3>{selectedOccurrences.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Ainda não há ocorrências materializadas.</p> : <div className="mt-2 divide-y divide-border/60">{selectedOccurrences.map((item) => <FinancialListRow key={item.id} onView={() => setOccurrenceEditTarget(item)} ariaLabel={`Editar ${item.title}`} leadingAction={!item.isPaid ? <button type="button" className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS} ${SETTLEMENT_ACTION_CIRCLE_CLASS}`} aria-label={`Marcar ${item.title} como recebido`} onClick={() => setMarkPaidTarget(item)}><Check className="size-5 text-muted-foreground" /></button> : <span className={`${ROW_ICON_CLASS} ${ROW_ICON_BG_CLASS}`}><Check className="size-5 text-paid" /></span>} title={item.title} meta={<span>{formatDate(item.dueDate)} · {item.isPaid ? 'Recebido' : 'A receber'}</span>} trailing={<><span className={`${ROW_AMOUNT_CLASS} ${item.isPaid ? ROW_AMOUNT_TONE.muted : ROW_AMOUNT_TONE.in}`}>{formatCurrency(item.amount)}</span><span className={`${ROW_TRAILING_META_CLASS} ${item.isPaid ? 'text-paid' : ''}`}>{item.isPaid ? 'Recebido' : 'A receber'}</span></>} />)}</div>}</div></div> : null}</SheetContent></Sheet>

      <RecurringIncomeSheet key={`${editingRule?.id ?? 'new'}-${recurringSheetOpen}`} open={recurringSheetOpen} onOpenChange={(open) => { setRecurringSheetOpen(open); if (!open) setEditingRule(null) }} editTarget={editingRule} isPending={recurringCreateMutation.isPending || recurringUpdateMutation.isPending} onSubmit={(payload) => editingRule ? recurringUpdateMutation.mutate({ id: editingRule.id, payload }) : recurringCreateMutation.mutate(payload)} />
      <ReceivableSheet open={oneOffOpen || occurrenceEditTarget !== null} onOpenChange={(open) => { if (!open) { setOneOffOpen(false); setOccurrenceEditTarget(null) } }} editTarget={occurrenceEditTarget} editScope={null} timeZone={user?.timeZone} onSubmit={async (data) => { if (occurrenceEditTarget) await updateOccurrenceMutation.mutateAsync({ id: occurrenceEditTarget.id, payload: data }); else await createOneOffMutation.mutateAsync(data) }} />
      <MarkAsPaidDialog open={markPaidTarget !== null} kind="receivable" createTransaction onConfirm={(payload) => markPaidTarget && markPaidMutation.mutate({ id: markPaidTarget.id, payload })} onCancel={() => setMarkPaidTarget(null)} isPending={markPaidMutation.isPending} />
      <ConfirmDialog open={closeTarget !== null} title="Encerrar renda recorrente?" description="Novos recebimentos não serão criados para esta fonte. Os recebimentos já existentes continuam no histórico." confirmLabel="Encerrar renda" variant="default" isPending={deactivateMutation.isPending} onCancel={() => setCloseTarget(null)} onConfirm={() => closeTarget && deactivateMutation.mutate(closeTarget.id)} />
    </main>
  )
}

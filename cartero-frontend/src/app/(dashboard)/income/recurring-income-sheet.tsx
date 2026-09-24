'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { RecurringIncomeRule } from '@/types'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { previewRecurringIncome, type CreateRecurringIncomePayload, type RecurringIncomePreview, type UpdateRecurringIncomePayload } from '@/services/recurring-income.service'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency } from '@/lib/formatters'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: RecurringIncomeRule | null
  isPending: boolean
  onSubmit: (payload: CreateRecurringIncomePayload | UpdateRecurringIncomePayload) => void
}

export type RecurringIncomeFormState = {
  title: string
  amount: number
  dayOfMonth: number
  firstOccurrence: string
  counterpartyName: string
}

export function recurringIncomeFormState(editTarget: RecurringIncomeRule | null): RecurringIncomeFormState {
  return {
    title: editTarget?.title ?? '',
    amount: editTarget?.amount ?? 0,
    dayOfMonth: editTarget?.dayOfMonth ?? 1,
    firstOccurrence: editTarget?.firstOccurrence ?? '',
    counterpartyName: editTarget?.counterpartyName ?? '',
  }
}

export function recurringIncomePayload(state: RecurringIncomeFormState, editing: boolean): CreateRecurringIncomePayload | UpdateRecurringIncomePayload {
  return {
    title: state.title.trim(),
    amount: state.amount,
    dayOfMonth: state.dayOfMonth,
    ...(editing ? {} : state.firstOccurrence ? { firstOccurrence: state.firstOccurrence } : {}),
    ...(state.counterpartyName.trim() ? { counterpartyName: state.counterpartyName.trim() } : {}),
  }
}

export function recurringIncomeCompetence(month: string, year: string): string {
  return /^(0[1-9]|1[0-2])$/.test(month) && /^\d{4}$/.test(year)
    ? `${year}-${month}`
    : ''
}

export function recurringIncomeFormIsValid(state: RecurringIncomeFormState, editing: boolean): boolean {
  const validCore = state.title.trim().length > 0 && state.amount > 0 && state.dayOfMonth >= 1 && state.dayOfMonth <= 31
  const validFirstOccurrence = /^\d{4}-(0[1-9]|1[0-2])$/.test(state.firstOccurrence)
  return validCore && (editing || validFirstOccurrence)
}

export function recurringIncomePreviewCopy(preview: RecurringIncomePreview, amount: number) {
  return {
    summary: `Isso vai criar ${preview.occurrenceCount} ${preview.occurrenceCount === 1 ? 'recebimento' : 'recebimentos'} de ${formatCurrency(amount)}.`,
    timing: `${preview.overdueCount === 0 ? 'Nenhum estará vencido' : preview.overdueCount === 1 ? '1 estará vencido' : `${preview.overdueCount} estarão vencidos`} e ${preview.upcomingCount === 0 ? 'nenhum será próximo' : preview.upcomingCount === 1 ? '1 será o próximo' : `${preview.upcomingCount} serão próximos`}.`,
    total: `Total esperado: ${formatCurrency(preview.totalAmount)}.`,
  }
}

export function RecurringIncomeSheet({ open, onOpenChange, editTarget, isPending, onSubmit }: Props) {
  const initial = recurringIncomeFormState(editTarget)
  const [title, setTitle] = useState(initial.title)
  const [amount, setAmount] = useState(initial.amount)
  const [dayOfMonth, setDayOfMonth] = useState(initial.dayOfMonth)
  const [firstMonth, setFirstMonth] = useState(initial.firstOccurrence.slice(5, 7))
  const [firstYear, setFirstYear] = useState(initial.firstOccurrence.slice(0, 4))
  const [counterpartyName, setCounterpartyName] = useState(initial.counterpartyName)

  const editing = editTarget !== null
  const selectedFirstOccurrence = recurringIncomeCompetence(firstMonth, firstYear)
  const validCore = title.trim().length > 0 && amount > 0 && dayOfMonth >= 1 && dayOfMonth <= 31
  const validFirstOccurrence = /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedFirstOccurrence)
  const valid = recurringIncomeFormIsValid({ title, amount, dayOfMonth, firstOccurrence: selectedFirstOccurrence, counterpartyName }, editing)
  const previewQuery = useQuery({
    queryKey: ['recurring-income-preview', selectedFirstOccurrence, amount, dayOfMonth],
    queryFn: () => previewRecurringIncome({ firstOccurrence: selectedFirstOccurrence, amount, dayOfMonth }),
    enabled: open && !editing && validCore && validFirstOccurrence && Boolean(selectedFirstOccurrence),
    staleTime: 30_000,
  })

  function submit() {
    if (!valid) return
    onSubmit(recurringIncomePayload({ title, amount, dayOfMonth, firstOccurrence: selectedFirstOccurrence, counterpartyName }, editing))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? 'Editar renda' : 'Nova renda recorrente'}</SheetTitle>
          <SheetDescription>
            Configure a fonte esperada. Banco e pessoa entram apenas quando o recebimento acontecer.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="grid gap-2">
            <Label htmlFor="income-title">Nome</Label>
            <Input id="income-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Salário" autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="income-amount">Valor esperado</Label>
            <CurrencyInput id="income-amount" value={amount} onChange={setAmount} placeholder="R$ 0,00" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="income-day">Dia previsto do recebimento</Label>
            <Input id="income-day" type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(Number(event.target.value))} />
            <p className="text-xs text-muted-foreground">É uma previsão. O recebimento real pode ser registrado em outra data.</p>
          </div>
          {!editing ? (
            <div className="grid gap-2">
              <Label>Renda desde</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={firstMonth} onValueChange={(value) => setFirstMonth(value ?? '')}>
                  <SelectTrigger className="w-full min-w-0" aria-label="Mês da renda desde">
                    <SelectValue placeholder="Selecionar mês" />
                  </SelectTrigger>
                  <SelectContent className="min-w-[10rem]">
                    {Array.from({ length: 12 }, (_, index) => { const value = String(index + 1).padStart(2, '0'); const rawLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, index, 1))); const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1); return <SelectItem key={value} value={value}>{label}</SelectItem> })}
                  </SelectContent>
                </Select>
                <Input aria-label="Ano da renda desde" type="number" min={1900} max={9999} placeholder="Ano" value={firstYear} onChange={(event) => setFirstYear(event.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
              <p className="text-xs text-muted-foreground">A competência inicial define quais recebimentos elegíveis serão materializados.</p>
              {previewQuery.data ? <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground"><p className="text-foreground">Isso vai criar {previewQuery.data.occurrenceCount} {previewQuery.data.occurrenceCount === 1 ? 'recebimento' : 'recebimentos'} de {formatCurrency(amount)}.</p><p className="mt-1">{previewQuery.data.overdueCount === 0 ? 'Nenhum estará vencido' : previewQuery.data.overdueCount === 1 ? '1 estará vencido' : `${previewQuery.data.overdueCount} estarão vencidos`} e {previewQuery.data.upcomingCount === 0 ? 'nenhum será próximo' : previewQuery.data.upcomingCount === 1 ? '1 será o próximo' : `${previewQuery.data.upcomingCount} serão próximos`}.</p><p className="mt-1 text-foreground/80">Total esperado: {formatCurrency(previewQuery.data.totalAmount)}.</p></div> : null}
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="income-origin">Empresa / origem <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id="income-origin" value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} placeholder="Ex.: Empresa Horizonte" />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? 'Salvar alterações' : 'Criar renda'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

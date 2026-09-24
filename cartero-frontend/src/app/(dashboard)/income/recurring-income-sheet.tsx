'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { RecurringIncomeRule } from '@/types'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import type { CreateRecurringIncomePayload } from '@/services/recurring-income.service'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: RecurringIncomeRule | null
  isPending: boolean
  onSubmit: (payload: CreateRecurringIncomePayload) => void
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

export function recurringIncomePayload(state: RecurringIncomeFormState, editing: boolean): CreateRecurringIncomePayload {
  return {
    title: state.title.trim(),
    amount: state.amount,
    dayOfMonth: state.dayOfMonth,
    ...(editing ? {} : state.firstOccurrence ? { firstOccurrence: state.firstOccurrence } : {}),
    ...(state.counterpartyName.trim() ? { counterpartyName: state.counterpartyName.trim() } : {}),
  }
}

export function RecurringIncomeSheet({ open, onOpenChange, editTarget, isPending, onSubmit }: Props) {
  const initial = recurringIncomeFormState(editTarget)
  const [title, setTitle] = useState(initial.title)
  const [amount, setAmount] = useState(initial.amount)
  const [dayOfMonth, setDayOfMonth] = useState(initial.dayOfMonth)
  const [firstOccurrence, setFirstOccurrence] = useState(initial.firstOccurrence)
  const [counterpartyName, setCounterpartyName] = useState(initial.counterpartyName)

  const editing = editTarget !== null
  const valid = title.trim().length > 0 && amount > 0 && dayOfMonth >= 1 && dayOfMonth <= 31 && (editing || firstOccurrence.length === 0 || /^\d{4}-(0[1-9]|1[0-2])$/.test(firstOccurrence))

  function submit() {
    if (!valid) return
    onSubmit(recurringIncomePayload({ title, amount, dayOfMonth, firstOccurrence, counterpartyName }, editing))
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
            <Label htmlFor="income-day">Dia do recebimento</Label>
            <Input id="income-day" type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(Number(event.target.value))} />
            <p className="text-xs text-muted-foreground">O servidor aplica a regra correta para meses mais curtos.</p>
          </div>
          {!editing ? (
            <div className="grid gap-2">
              <Label htmlFor="income-first-occurrence">Primeiro recebimento <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Input id="income-first-occurrence" type="month" value={firstOccurrence} onChange={(event) => setFirstOccurrence(event.target.value)} />
              <p className="text-xs text-muted-foreground">Escolha a competência inicial; a data concreta é definida pelo backend.</p>
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

'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getPersons } from '@/services/persons.service'
import type { RecurringExpenseRule } from '@/types'
import type { CreateRecurringExpensePayload, UpdateRecurringExpensePayload } from '@/services/recurring-expense.service'
import { PROGRESSIVE_REVEAL_CLASS } from '@/components/ui/progressive-reveal'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: RecurringExpenseRule | null
  isPending: boolean
  onSubmit: (payload: CreateRecurringExpensePayload | UpdateRecurringExpensePayload) => void
  embedded?: boolean
  embeddedFooterHost?: HTMLElement | null
}

export function RecurringExpenseSheet({ open, onOpenChange, editTarget, isPending, onSubmit, embedded = false, embeddedFooterHost }: Props) {
  const [title, setTitle] = useState(editTarget?.title ?? '')
  const [amount, setAmount] = useState(editTarget?.amount ?? 0)
  const [dayOfMonth, setDayOfMonth] = useState(editTarget?.dayOfMonth ?? 1)
  const [firstMonth, setFirstMonth] = useState(editTarget?.firstOccurrence.slice(5, 7) ?? '')
  const [firstYear, setFirstYear] = useState(editTarget?.firstOccurrence.slice(0, 4) ?? '')
  const [creditorName, setCreditorName] = useState(editTarget?.creditorName ?? '')
  const [personId, setPersonId] = useState(editTarget?.personId ?? '')
  const { data: persons = [] } = useQuery({ queryKey: ['persons'], queryFn: getPersons, enabled: open })
  const firstOccurrence = `${firstYear}-${firstMonth}`
  const editing = Boolean(editTarget)
  const valid = title.trim().length > 0 && amount > 0 && dayOfMonth >= 1 && dayOfMonth <= 31 &&
    (editing || /^\d{4}-(0[1-9]|1[0-2])$/.test(firstOccurrence))

  function submit() {
    if (!valid) return
    onSubmit({
      title: title.trim(), amount, dayOfMonth,
      ...(!editing ? { firstOccurrence } : {}),
      ...(editing ? { creditorName: creditorName.trim() || null, personId: personId || null } : {
        ...(creditorName.trim() ? { creditorName: creditorName.trim() } : {}),
        ...(personId ? { personId } : {}),
      }),
    } as CreateRecurringExpensePayload | UpdateRecurringExpensePayload)
  }

  const fields = (
        <div className={embedded ? `flex flex-col gap-5 ${PROGRESSIVE_REVEAL_CLASS}` : 'flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4'}>
          <div className="grid gap-2"><Label htmlFor="expense-rule-title">Nome</Label><Input id="expense-rule-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Aluguel" autoFocus /></div>
          <div className="grid gap-2"><Label htmlFor="expense-rule-amount">Valor esperado</Label><CurrencyInput id="expense-rule-amount" value={amount} onChange={setAmount} placeholder="R$ 0,00" /></div>
          <div className="grid gap-2"><Label htmlFor="expense-rule-day">Dia do vencimento</Label><Input id="expense-rule-day" type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(Number(event.target.value))} /></div>
          {!editing ? <div className="grid gap-2">
            <Label>Primeira competência</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select value={firstMonth} onValueChange={(value) => setFirstMonth(value ?? '')}>
                <SelectTrigger aria-label="Mês da primeira despesa"><SelectValue placeholder="Mês" /></SelectTrigger>
                <SelectContent>{Array.from({ length: 12 }, (_, index) => { const value = String(index + 1).padStart(2, '0'); return <SelectItem key={value} value={value}>{new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, index, 1)))}</SelectItem> })}</SelectContent>
              </Select>
              <Input aria-label="Ano da primeira despesa" type="number" min={1900} max={9999} placeholder="Ano" value={firstYear} onChange={(event) => setFirstYear(event.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
          </div> : null}
          <div className="grid gap-2"><Label htmlFor="expense-rule-creditor">Credor</Label><Input id="expense-rule-creditor" value={creditorName} onChange={(event) => setCreditorName(event.target.value)} placeholder="Ex.: Imobiliária" /><p className="text-xs text-muted-foreground">Se ficar vazio, usamos o nome da despesa.</p></div>
          <div className="grid gap-2">
            <Label>Pessoa vinculada (opcional)</Label>
            <Select value={personId || 'none'} onValueChange={(value) => setPersonId(value === 'none' || !value ? '' : value)}>
              <SelectTrigger aria-label="Pessoa vinculada à despesa"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Nenhuma</SelectItem>{persons.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
  )
  const footer = <SheetFooter className={embedded ? 'px-6 py-4' : undefined}><Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button><Button disabled={!valid || isPending} onClick={submit}>{isPending ? <Loader2 className="size-4 animate-spin" /> : null}{editing ? 'Salvar alterações' : 'Criar despesa'}</Button></SheetFooter>

  if (embedded) return <>{fields}{embeddedFooterHost ? createPortal(footer, embeddedFooterHost) : null}</>

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? 'Editar despesa recorrente' : 'Nova despesa recorrente'}</SheetTitle>
          <SheetDescription>Esta conta fica em aberto até você registrar o pagamento.</SheetDescription>
        </SheetHeader>
        {fields}
        {footer}
      </SheetContent>
    </Sheet>
  )
}

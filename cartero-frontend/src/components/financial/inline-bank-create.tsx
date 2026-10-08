'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createBank } from '@/services/banks.service'
import type { Bank } from '@/types'

export function InlineBankCreate({ onCreated }: { onCreated: (bank: Bank) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [bank, setBank] = useState({ name: '', dueDate: '', daysAfterClose: '7' })
  const nameRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const reset = () => { setExpanded(false); setBank({ name: '', dueDate: '', daysAfterClose: '7' }) }
  const mutation = useMutation({
    mutationFn: createBank,
    onSuccess: (created) => {
      queryClient.setQueryData<Bank[]>(['banks'], (old) => [...(old ?? []), created])
      void queryClient.invalidateQueries({ queryKey: ['banks'] })
      onCreated(created)
      reset()
    },
    onError: () => toast.error('Não foi possível criar o banco.'),
  })
  const confirm = () => {
    const name = bank.name.trim()
    const invoiceDueDate = Number(bank.dueDate)
    const invoiceDueDaysAfterClose = Number(bank.daysAfterClose)
    if (!name || !invoiceDueDate || !invoiceDueDaysAfterClose) return
    mutation.mutate({ name, invoiceDueDate, invoiceDueDaysAfterClose })
  }
  if (!expanded) return <button type="button" onClick={() => { setExpanded(true); setTimeout(() => nameRef.current?.focus(), 0) }} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"><Plus className="size-3" />Criar banco</button>
  return <div className="space-y-1.5">
    <Input ref={nameRef} value={bank.name} onChange={(event) => setBank((current) => ({ ...current, name: event.target.value }))} placeholder="Nome do banco" aria-label="Nome do banco" className="h-8 text-sm" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirm() } if (event.key === 'Escape') reset() }} />
    <div className="flex gap-1.5">
      <Input type="number" min={1} max={31} value={bank.daysAfterClose} onChange={(event) => setBank((current) => ({ ...current, daysAfterClose: event.target.value }))} placeholder="Dias entre datas" aria-label="Dias entre fechamento e vencimento" className="h-8 text-sm" />
      <Input type="number" min={1} max={31} value={bank.dueDate} onChange={(event) => setBank((current) => ({ ...current, dueDate: event.target.value }))} placeholder="Dia vencimento" aria-label="Dia do vencimento da fatura" className="h-8 text-sm" />
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={!bank.name.trim() || !bank.dueDate || !bank.daysAfterClose || mutation.isPending} onClick={confirm} aria-label="Confirmar">{mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}</Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={reset} aria-label="Cancelar"><X className="size-3.5" /></Button>
    </div>
  </div>
}

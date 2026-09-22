'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_COMPACT_CLASS } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getBanks } from '@/services/banks.service'
import { bankDisplayName, isSelectableBank } from '@/lib/bank-display'
import { todayDateValue } from '@/lib/date'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean; personName: string; debtsCount: number; receivablesCount: number
  hasPendingDebts: boolean; hasPendingReceivables: boolean
  receivableTotal: number; debtTotal: number; notYetDueCount?: number
  competenceLabel?: string; carriedCount?: number; isPending?: boolean
  onConfirm: (payload: { paymentDate: string; paymentBankId?: string }) => void
  onCancel: () => void
}

export function SettlePersonDialog({ open, personName, debtsCount, receivablesCount, receivableTotal, debtTotal, notYetDueCount = 0, carriedCount = 0, isPending = false, onConfirm, onCancel }: Props) {
  const [paymentDate, setPaymentDate] = useState(todayDateValue())
  const [bankId, setBankId] = useState('none')
  const net = receivableTotal - debtTotal
  const movesCash = net !== 0
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: () => getBanks(), enabled: open && movesCash })
  const selectedBank = banks.find((bank) => bank.id === bankId)

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className={DIALOG_COMPACT_CLASS}>
        <DialogHeader>
          <DialogTitle>Acerto com {personName}</DialogTitle>
          <DialogDescription>
            A receber: R$ {receivableTotal.toFixed(2).replace('.', ',')}. A pagar: R$ {debtTotal.toFixed(2).replace('.', ',')}.{' '}
            {net > 0 ? `Você receberá R$ ${net.toFixed(2).replace('.', ',')}.` : net < 0 ? `Você pagará R$ ${Math.abs(net).toFixed(2).replace('.', ',')}.` : 'Saldo do acerto: R$ 0,00.'}
            {` ${debtsCount + receivablesCount} item(ns) serão liquidados.`}{carriedCount > 0 ? ` Inclui ${carriedCount} pendência(s) anterior(es).` : ''}{notYetDueCount > 0 ? ` ${notYetDueCount} ainda não venceu(ram).` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5"><Label>Data do acerto</Label><DatePicker value={paymentDate} onChange={setPaymentDate} /></div>
          {movesCash && <div className="flex flex-col gap-1.5">
            <Label>Banco</Label>
            <Select value={bankId} onValueChange={(value) => setBankId(value ?? 'none')}>
              <SelectTrigger><SelectValue placeholder="Sem banco">{selectedBank ? bankDisplayName(selectedBank) : 'Sem banco'}</SelectValue></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}><SelectItem value="none">Sem banco</SelectItem>{banks.filter(isSelectableBank).map((bank) => <SelectItem key={bank.id} value={bank.id}>{bankDisplayName(bank)}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button disabled={!paymentDate || isPending} onClick={() => onConfirm({ paymentDate, ...(movesCash && bankId !== 'none' ? { paymentBankId: bankId } : {}) })}>{isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Confirmar acerto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

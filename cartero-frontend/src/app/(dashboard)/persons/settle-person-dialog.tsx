'use client'

import { useEffect, useState } from 'react'
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
import { TransactionType } from '@/types'

interface Props {
  open: boolean; personName: string; debtsCount: number; receivablesCount: number
  hasPendingDebts: boolean; hasPendingReceivables: boolean
  receivableTotal: number; debtTotal: number; notYetDueCount?: number
  competenceLabel?: string; carriedCount?: number; isPending?: boolean
  onConfirm: (payload: { paymentDate: string; paymentBankId?: string; paymentType?: TransactionType }) => void
  onCancel: () => void
}

export function SettlePersonDialog({ open, personName, debtsCount, receivablesCount, receivableTotal, debtTotal, notYetDueCount = 0, carriedCount = 0, isPending = false, onConfirm, onCancel }: Props) {
  const [paymentDate, setPaymentDate] = useState(todayDateValue())
  const [bankId, setBankId] = useState<string | undefined>()
  const [paymentType, setPaymentType] = useState<TransactionType | ''>('')
  const [showOptionalBank, setShowOptionalBank] = useState(false)
  const net = receivableTotal - debtTotal
  const direction = net > 0 ? 'inflow' : net < 0 ? 'outflow' : 'none'
  const isCredit = paymentType === TransactionType.CREDIT_CARD
  const needsBankSelector = Boolean(bankId) || (direction === 'inflow' && showOptionalBank) || (direction === 'outflow' && (showOptionalBank || isCredit))
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: () => getBanks(), enabled: open && needsBankSelector })
  const selectedBank = banks.find((bank) => bank.id === bankId)

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaymentDate(todayDateValue())
      setBankId(undefined)
      setPaymentType('')
      setShowOptionalBank(false)
    }
  }, [open])

  const canConfirm = Boolean(paymentDate) && (direction !== 'outflow' || Boolean(paymentType)) && (!isCredit || Boolean(bankId))

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
          {direction === 'outflow' && <div className="flex flex-col gap-1.5">
            <Label>Como você pagou?</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                [TransactionType.CREDIT_CARD, 'Crédito'],
                [TransactionType.DEBIT_CARD, 'Débito'],
                [TransactionType.PIX, 'PIX'],
                [TransactionType.BOLETO, 'Boleto'],
              ].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={paymentType === value} onClick={() => { setPaymentType(value as TransactionType); if (value === TransactionType.CREDIT_CARD) setShowOptionalBank(false) }} className={paymentType === value ? 'rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm font-medium' : 'rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground'}>{label}</button>
              ))}
            </div>
          </div>}
          {direction === 'inflow' && !showOptionalBank && (
            <button type="button" onClick={() => setShowOptionalBank(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">+ Adicionar banco (opcional)</button>
          )}
          {direction === 'outflow' && paymentType !== TransactionType.CREDIT_CARD && !showOptionalBank && (
            <button type="button" onClick={() => setShowOptionalBank(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">+ Adicionar banco (opcional)</button>
          )}
          {needsBankSelector && <div className="flex flex-col gap-1.5">
            <Label>Banco</Label>
            <Select value={bankId ?? ''} onValueChange={(value) => setBankId(value || undefined)}>
              <SelectTrigger><SelectValue placeholder={isCredit ? 'Selecione o cartão' : 'Selecione um banco'}>{selectedBank ? bankDisplayName(selectedBank) : undefined}</SelectValue></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>{banks.filter(isSelectableBank).map((bank) => <SelectItem key={bank.id} value={bank.id}>{bankDisplayName(bank)}</SelectItem>)}</SelectContent>
            </Select>
            {!isCredit && <button type="button" onClick={() => { setBankId(undefined); setShowOptionalBank(false) }} className="self-start text-xs text-muted-foreground hover:text-foreground">Remover banco</button>}
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button disabled={!canConfirm || isPending} onClick={() => onConfirm({ paymentDate, ...(bankId ? { paymentBankId: bankId } : {}), ...(paymentType ? { paymentType } : {}) })}>{isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Confirmar acerto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

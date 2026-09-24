'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_COMPACT_CLASS } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { todayDateValue } from '@/lib/date'
import { Loader2 } from 'lucide-react'
import { TransactionType } from '@/types'
import { SettlementPaymentFields } from '@/components/settlement-payment-fields'

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
  const net = receivableTotal - debtTotal
  const direction = net > 0 ? 'inflow' : net < 0 ? 'outflow' : 'none'
  const isCredit = paymentType === TransactionType.CREDIT_CARD

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaymentDate(todayDateValue())
      setBankId(undefined)
      setPaymentType('')
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

        {direction !== 'none' && <SettlementPaymentFields
          open={open}
          paymentDate={paymentDate}
          onPaymentDateChange={setPaymentDate}
          dateLabel="Data do acerto"
          bankId={bankId ?? ''}
          onBankIdChange={(value) => setBankId(value || undefined)}
          bankRequired={isCredit}
          bankPlaceholder={isCredit ? 'Selecione o cartão' : 'Selecione um banco'}
          paymentType={paymentType}
          onPaymentTypeChange={setPaymentType}
          paymentTypeRequired={direction === 'outflow'}
          paymentTypeLabel="Como você pagou?"
        />}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button disabled={!canConfirm || isPending} onClick={() => onConfirm({ paymentDate, ...(bankId ? { paymentBankId: bankId } : {}), ...(paymentType ? { paymentType } : {}) })}>{isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Confirmar acerto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

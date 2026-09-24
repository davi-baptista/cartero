'use client'

import { useEffect, useState } from 'react'
import { DIALOG_COMPACT_CLASS } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { todayDateValue } from '@/lib/date'
import { TransactionType } from '@/types'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { SettlementPaymentFields } from '@/components/settlement-payment-fields'

const PAYMENT_TYPE_OPTIONS = [
  TransactionType.PIX,
  TransactionType.DEBIT_CARD,
  TransactionType.CREDIT_CARD,
  TransactionType.BOLETO,
] as const

type PaymentType = typeof PAYMENT_TYPE_OPTIONS[number]

export function buildSettlementPayload({
  kind,
  createTransaction,
  paymentDate,
  bankId,
  type,
}: {
  kind: 'debt' | 'receivable'
  createTransaction: boolean
  paymentDate?: string
  bankId?: string
  type?: PaymentType | ''
}) {
  if (!createTransaction) return {}
  return {
    paymentDate,
    paymentBankId: bankId && bankId !== 'none' ? bankId : undefined,
    paymentType: kind === 'receivable' ? TransactionType.INCOME : type as TransactionType,
  }
}

interface MarkAsPaidDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  createTransaction?: boolean
  isPending?: boolean
  onConfirm: (payload: { paymentBankId?: string; paymentType?: TransactionType; paymentDate?: string }) => void
  onCancel: () => void
}

export function MarkAsPaidDialog({ open, kind, createTransaction = true, isPending = false, onConfirm, onCancel }: MarkAsPaidDialogProps) {
  const [bankId, setBankId] = useState('')
  const [type, setType] = useState<PaymentType | ''>('')
  const [paymentDate, setPaymentDate] = useState(todayDateValue())

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBankId('')
      setType('')
      setPaymentDate(todayDateValue())
    }
  }, [open])

  const bankRequired = createTransaction && kind === 'debt' && type === TransactionType.CREDIT_CARD
  const canConfirm = !createTransaction
    ? true
    : kind === 'receivable'
      ? Boolean(paymentDate)
      : Boolean(paymentDate) && Boolean(type) && (!bankRequired || Boolean(bankId))

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !isPending && onCancel()}>
      <DialogContent showCloseButton={false} className={DIALOG_COMPACT_CLASS}>
        <DialogHeader>
          <DialogTitle>{kind === 'debt' ? 'Marcar dívida como paga' : 'Marcar cobrança como recebida'}</DialogTitle>
          <DialogDescription>
            {!createTransaction
              ? kind === 'receivable'
                ? 'A cobrança será marcada como recebida sem criar uma receita.'
                : 'A dívida será marcada como paga sem criar um gasto.'
              : kind === 'receivable'
                ? 'Informe a data em que o valor foi recebido.'
                : 'Escolha a forma de pagamento e, se necessário, o banco. Isso vai criar uma transação vinculada.'}
          </DialogDescription>
        </DialogHeader>

        {createTransaction && <SettlementPaymentFields
          open={open}
          paymentDate={paymentDate}
          onPaymentDateChange={setPaymentDate}
          dateLabel={kind === 'debt' ? 'Data do pagamento' : 'Data do recebimento'}
          bankId={bankId}
          onBankIdChange={setBankId}
          bankRequired={bankRequired}
          bankPlaceholder={bankRequired ? 'Selecione o cartão' : 'Selecione um banco'}
          paymentType={type}
          onPaymentTypeChange={(value) => setType(value as PaymentType)}
          paymentTypeRequired={kind === 'debt'}
          paymentTypeLabel="Forma de pagamento"
          paymentTypeOptions={PAYMENT_TYPE_OPTIONS.map((value) => ({ value, label: TRANSACTION_TYPE_LABELS[value] }))}
        />}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button disabled={!canConfirm || isPending} onClick={() => canConfirm && !isPending && onConfirm(buildSettlementPayload({ kind, createTransaction, paymentDate, bankId, type }))}>
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

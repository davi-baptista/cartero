'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { getBanks } from '@/services/banks.service'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { todayDateValue } from '@/lib/date'
import { TransactionType } from '@/types'

const PAYMENT_TYPE_OPTIONS = [
  TransactionType.PIX,
  TransactionType.DEBIT_CARD,
  TransactionType.CREDIT_CARD,
  TransactionType.BOLETO,
] as const

type PaymentType = typeof PAYMENT_TYPE_OPTIONS[number]

interface MarkAsPaidDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  createTransaction?: boolean
  /** Bloqueia o botão enquanto a mutação está em andamento. */
  isPending?: boolean
  onConfirm: (payload: { paymentBankId?: string; paymentType?: TransactionType; paymentDate?: string }) => void
  onCancel: () => void
}

export function MarkAsPaidDialog({ open, kind, createTransaction = true, isPending = false, onConfirm, onCancel }: MarkAsPaidDialogProps) {
  const [bankId, setBankId] = useState<string>('')
  const [type, setType] = useState<PaymentType | ''>('')
  const [paymentDate, setPaymentDate] = useState(todayDateValue())

  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: () => getBanks() })

  useEffect(() => {
    if (!open) {
      setBankId('')
      setType('')
      setPaymentDate(todayDateValue())
    }
  }, [open])

  const canConfirm = !createTransaction
    ? true
    : kind === 'receivable'
    ? Boolean(paymentDate)
    : Boolean(type) && Boolean(bankId)
  const selectedBank = banks.find((b) => b.id === bankId)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === 'debt' ? 'Marcar dívida como paga' : 'Marcar cobrança como recebida'}
          </DialogTitle>
          <DialogDescription>
            {!createTransaction
              ? kind === 'receivable'
                ? 'A cobrança será marcada como recebida sem criar uma receita.'
                : 'A dívida será marcada como paga sem criar um gasto.'
              : kind === 'receivable'
              ? 'Informe a data em que o valor foi recebido.'
              : kind === 'debt'
              ? 'Escolha o banco e a forma de pagamento. Isso vai criar uma transação vinculada.'
              : 'Escolha o banco e a forma de recebimento. Isso vai criar uma transação de receita vinculada — independente da forma escolhida, ela será registrada como receita.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          {kind === 'debt' && createTransaction && <div className="flex flex-col gap-1.5">
            <Label>Banco</Label>
            <Select value={bankId} onValueChange={(v) => setBankId(v ?? '')}>
              <SelectTrigger aria-label="Banco">
                <SelectValue placeholder="Selecione um banco">
                  {selectedBank?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}

          {kind === 'receivable' && createTransaction ? (
            <div className="flex flex-col gap-1.5">
              <Label>Data do recebimento</Label>
              <DatePicker value={paymentDate} onChange={setPaymentDate} />
            </div>
          ) : createTransaction ? (
            <div className="flex flex-col gap-1.5">
              <Label>Forma de pagamento</Label>
              <Select<PaymentType> value={type || null} onValueChange={(v) => setType(v ?? '')}>
                <SelectTrigger aria-label="Tipo">
                  <SelectValue placeholder="Selecione">
                    {type ? TRANSACTION_TYPE_LABELS[type] : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {PAYMENT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{TRANSACTION_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!canConfirm || isPending}
            onClick={() => canConfirm && !isPending && onConfirm(
              !createTransaction
                ? {}
                : kind === 'receivable'
                ? { paymentDate }
                : createTransaction
                ? { paymentBankId: bankId, paymentType: type as TransactionType }
                : {},
            )}
          >
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

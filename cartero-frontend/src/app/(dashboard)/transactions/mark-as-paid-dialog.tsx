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
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { getBanks } from '@/services/banks.service'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
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
  onConfirm: (payload: { paymentBankId: string; paymentType: TransactionType }) => void
  onCancel: () => void
}

export function MarkAsPaidDialog({ open, kind, onConfirm, onCancel }: MarkAsPaidDialogProps) {
  const [bankId, setBankId] = useState<string>('')
  const [type, setType] = useState<PaymentType | ''>('')

  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: getBanks })

  useEffect(() => {
    if (!open) {
      setBankId('')
      setType('')
    }
  }, [open])

  const canConfirm = Boolean(bankId) && Boolean(type)
  const selectedBank = banks.find((b) => b.id === bankId)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === 'debt' ? 'Marcar dívida como paga' : 'Marcar cobrança como recebida'}
          </DialogTitle>
          <DialogDescription>
            {kind === 'debt'
              ? 'Escolha o banco e a forma de pagamento. Isso vai criar uma transação vinculada.'
              : 'Escolha o banco e a forma de recebimento. Isso vai criar uma transação de receita vinculada — independente da forma escolhida, ela será registrada como receita.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{kind === 'debt' ? 'Forma de pagamento' : 'Forma de recebimento'}</Label>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm({ paymentBankId: bankId, paymentType: type as TransactionType })}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

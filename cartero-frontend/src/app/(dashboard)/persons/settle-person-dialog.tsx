'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getBanks } from '@/services/banks.service'
import { formatCurrency, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { todayDateValue } from '@/lib/date'
import { TransactionType } from '@/types'

const PAYMENT_TYPES = [
  TransactionType.PIX,
  TransactionType.DEBIT_CARD,
  TransactionType.CREDIT_CARD,
  TransactionType.BOLETO,
] as const

interface SettlePersonDialogProps {
  open: boolean
  personName: string
  netBalance: number
  hasPendingDebts: boolean
  hasPendingReceivables: boolean
  createIncome: boolean
  createExpense: boolean
  onConfirm: (payload: { paymentDate?: string; paymentBankId?: string; paymentType?: TransactionType }) => void
  onCancel: () => void
}

export function SettlePersonDialog({
  open,
  personName,
  netBalance,
  hasPendingDebts,
  hasPendingReceivables,
  createIncome,
  createExpense,
  onConfirm,
  onCancel,
}: SettlePersonDialogProps) {
  const [paymentDate, setPaymentDate] = useState(todayDateValue())
  const [bankId, setBankId] = useState('')
  const [paymentType, setPaymentType] = useState<TransactionType | ''>('')
  // Cada dívida/cobrança pendente gera sua própria transação — então os dados
  // de pagamento são necessários sempre que houver QUALQUER dívida pendente,
  // não só quando o saldo líquido total for negativo.
  const createsTransaction = (hasPendingReceivables && createIncome) || (hasPendingDebts && createExpense)
  const needsExpenseDetails = hasPendingDebts && createExpense
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: getBanks, enabled: open && needsExpenseDetails })
  const selectedBank = banks.find((bank) => bank.id === bankId)
  const canConfirm = !createsTransaction || (
    Boolean(paymentDate) &&
    (!needsExpenseDetails || (Boolean(bankId) && Boolean(paymentType)))
  )

  useEffect(() => {
    if (!open) {
      setPaymentDate(todayDateValue())
      setBankId('')
      setPaymentType('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quitar saldo de {personName}</DialogTitle>
          <DialogDescription>
            {netBalance > 0
              ? `Esta pessoa deve ${formatCurrency(netBalance)} para você.`
              : netBalance < 0
              ? `Você deve ${formatCurrency(Math.abs(netBalance))} para esta pessoa.`
              : 'As dívidas e cobranças pendentes serão marcadas como resolvidas.'}
            {' '}Tudo será resolvido de uma vez.
          </DialogDescription>
        </DialogHeader>

        {createsTransaction && (
          <div className="flex flex-col gap-3 py-1">
            <div className="flex flex-col gap-1.5">
              <Label>
                {hasPendingReceivables && hasPendingDebts
                  ? 'Data do acerto'
                  : hasPendingReceivables
                    ? 'Data do recebimento'
                    : 'Data do pagamento'}
              </Label>
              <DatePicker value={paymentDate} onChange={setPaymentDate} />
            </div>

            {needsExpenseDetails && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>Banco</Label>
                  <Select value={bankId} onValueChange={(value) => setBankId(value ?? '')}>
                    <SelectTrigger><SelectValue placeholder="Selecione um banco">{selectedBank?.name}</SelectValue></SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {banks.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Forma de pagamento</Label>
                  <Select<TransactionType> value={paymentType || null} onValueChange={(value) => setPaymentType(value ? value as TransactionType : '')}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {PAYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{TRANSACTION_TYPE_LABELS[type]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm({
              ...(createsTransaction ? { paymentDate } : {}),
              ...(needsExpenseDetails ? { paymentBankId: bankId, paymentType: paymentType as TransactionType } : {}),
            })}
          >
            Quitar tudo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

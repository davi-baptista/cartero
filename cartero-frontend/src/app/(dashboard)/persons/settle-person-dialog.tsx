'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getBanks } from '@/services/banks.service'
import { bankDisplayName, isSelectableBank } from '@/lib/bank-display'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
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
  /** Quantas dívidas pendentes serão liquidadas. */
  debtsCount: number
  /** Quantas cobranças pendentes serão liquidadas. */
  receivablesCount: number
  hasPendingDebts: boolean
  hasPendingReceivables: boolean
  createIncome: boolean
  createExpense: boolean
  /**
   * Quantos dos itens ainda NÃO venceram.
   *
   * A quitação é all-time e inclui obrigações futuras — legítimo, mas o
   * usuário precisa saber que está antecipando pagamento.
   */
  notYetDueCount?: number
  /** Mês do acerto — o diálogo precisa dizer QUAL competência será quitada. */
  competenceLabel?: string
  /** Itens que vieram de competências anteriores. */
  carriedCount?: number
  /** Bloqueia o botão enquanto a liquidação em lote está em andamento. */
  isPending?: boolean
  onConfirm: (payload: { paymentDate?: string; paymentBankId?: string; paymentType?: TransactionType }) => void
  onCancel: () => void
}

export function SettlePersonDialog({
  open,
  personName,
  debtsCount,
  receivablesCount,
  hasPendingDebts,
  hasPendingReceivables,
  createIncome,
  createExpense,
  notYetDueCount = 0,
  competenceLabel,
  carriedCount = 0,
  isPending = false,
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
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: () => getBanks(), enabled: open && needsExpenseDetails })
  const selectedBank = banks.find((bank) => bank.id === bankId)
  const canConfirm = !createsTransaction || (
    Boolean(paymentDate) &&
    (!needsExpenseDetails || (Boolean(bankId) && Boolean(paymentType)))
  )

  // Quantos itens serão liquidados — mais honesto que anunciar um saldo que a
  // ação não usa. Só menciona o que existe.
  const pendingSummary = (() => {
    const parts: string[] = []
    if (debtsCount > 0) {
      parts.push(debtsCount === 1 ? '1 dívida' : `${debtsCount} dívidas`)
    }
    if (receivablesCount > 0) {
      parts.push(
        receivablesCount === 1 ? '1 cobrança' : `${receivablesCount} cobranças`,
      )
    }
    if (parts.length === 0) return ''

    const total = debtsCount + receivablesCount
    const verb = total === 1 ? 'será marcada' : 'serão marcadas'
    return `${parts.join(' e ')} ${verb} como quitada${total === 1 ? '' : 's'}.`
  })()

  /**
   * O que a operação vai REGISTRAR, conforme as preferências reais.
   *
   * Se `createExpenseOnDebtPaid` está desligada, as dívidas são quitadas sem
   * gerar despesa — e prometer "2 pagamentos registrados" seria falso.
   */
  const willGenerate = (() => {
    const parts: string[] = []
    if (needsExpenseDetails && debtsCount > 0) {
      parts.push(
        debtsCount === 1 ? '1 pagamento' : `${debtsCount} pagamentos`,
      )
    }
    if (hasPendingReceivables && createIncome && receivablesCount > 0) {
      parts.push(
        receivablesCount === 1
          ? '1 recebimento'
          : `${receivablesCount} recebimentos`,
      )
    }
    if (parts.length === 0) return ''

    // "Será registrado 1 pagamento" / "Serão registrados 2 pagamentos e 1
    // recebimento" — a concordância segue o total de lançamentos.
    const total =
      (needsExpenseDetails ? debtsCount : 0) +
      (hasPendingReceivables && createIncome ? receivablesCount : 0)
    return total === 1
      ? `Será registrado ${parts.join(' e ')} no extrato.`
      : `Serão registrados ${parts.join(' e ')} no extrato.`
  })()

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
          <DialogTitle>
            {competenceLabel
              ? `Quitar pendências de ${competenceLabel}`
              : `Quitar pendências de ${personName}`}
          </DialogTitle>
          {/* O texto anterior ("Tudo será resolvido de uma vez", sobre o saldo
              líquido) sugeria compensação entre o que se deve e o que se tem a
              receber. Não é o que acontece: cada item é liquidado pelo próprio
              valor integral, e o saldo é só informativo. */}
          <DialogDescription>
            {pendingSummary}
            {pendingSummary && ' '}
            Cada item é quitado pelo próprio valor, sem abater um do outro.
            {carriedCount > 0 && (
              <>
                {' '}
                <span className="text-foreground">
                  {carriedCount === 1
                    ? 'Inclui 1 pendência anterior'
                    : `Inclui ${carriedCount} pendências anteriores`}
                  .
                </span>
              </>
            )}
            {notYetDueCount > 0 && (
              <>
                {' '}
                <span className="text-foreground">
                  {notYetDueCount === 1
                    ? '1 deles ainda não venceu'
                    : `${notYetDueCount} deles ainda não venceram`}
                  .
                </span>
              </>
            )}
            {willGenerate && (
              <>
                {' '}
                <span className="text-foreground">{willGenerate}</span>
              </>
            )}
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
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um banco">
                        {selectedBank ? bankDisplayName(selectedBank) : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {/*
                        O banco de sistema nunca é oferecido: o usuário não o
                        criou e ele existe só para ancorar recebimentos sem
                        banco escolhido.
                      */}
                      {banks.filter(isSelectableBank).map((bank) => (
                        <SelectItem key={bank.id} value={bank.id}>
                          {bankDisplayName(bank)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Forma de pagamento</Label>
                  <Select<TransactionType> value={paymentType || null} onValueChange={(value) => setPaymentType(value ? value as TransactionType : '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione">
                        {paymentType ? TRANSACTION_TYPE_LABELS[paymentType] : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {PAYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{TRANSACTION_TYPE_LABELS[type]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}

        {/*
          O escopo agora é a COMPETÊNCIA visível — não mais all-time. O aviso
          anterior ("quita todos os itens em aberto") deixou de ser verdade e
          foi removido em vez de mantido como texto obsoleto.
        */}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!canConfirm || isPending}
            onClick={() => canConfirm && !isPending && onConfirm({
              ...(createsTransaction ? { paymentDate } : {}),
              ...(needsExpenseDetails ? { paymentBankId: bankId, paymentType: paymentType as TransactionType } : {}),
            })}
          >
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Marcar tudo como quitado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

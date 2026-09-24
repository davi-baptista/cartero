'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { bankDisplayName, isSelectableBank } from '@/lib/bank-display'
import { createBank, getBanks } from '@/services/banks.service'
import type { Bank } from '@/types'
import { TransactionType } from '@/types'

export interface SettlementPaymentFieldsProps {
  open: boolean
  paymentDate: string
  onPaymentDateChange: (value: string) => void
  dateLabel: string
  bankId: string
  onBankIdChange: (value: string) => void
  bankRequired?: boolean
  bankLabel?: string
  bankPlaceholder?: string
  paymentType?: TransactionType | ''
  onPaymentTypeChange?: (value: TransactionType) => void
  paymentTypeRequired?: boolean
  paymentTypeLabel?: string
  paymentTypeOptions?: readonly { value: TransactionType; label: string }[]
}

const DEFAULT_PAYMENT_TYPES = [
  { value: TransactionType.CREDIT_CARD, label: 'Crédito' },
  { value: TransactionType.DEBIT_CARD, label: 'Débito' },
  { value: TransactionType.PIX, label: 'PIX' },
  { value: TransactionType.BOLETO, label: 'Boleto' },
] as const

const BANK_ACTION_CLASS = 'self-start flex items-center gap-1 text-xs font-normal leading-5 text-muted-foreground transition-colors hover:text-foreground'

export function SettlementPaymentFields({
  open,
  paymentDate,
  onPaymentDateChange,
  dateLabel,
  bankId,
  onBankIdChange,
  bankRequired = false,
  bankLabel = 'Banco',
  bankPlaceholder = 'Selecione um banco',
  paymentType = '',
  onPaymentTypeChange,
  paymentTypeRequired = false,
  paymentTypeLabel = 'Forma de pagamento',
  paymentTypeOptions = DEFAULT_PAYMENT_TYPES,
}: SettlementPaymentFieldsProps) {
  const [showOptionalBank, setShowOptionalBank] = useState(false)
  const [showBankCreate, setShowBankCreate] = useState(false)
  const [newBank, setNewBank] = useState({ name: '', dueDate: '', daysAfterClose: '7' })
  const bankNameRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const bankVisible = bankRequired || showOptionalBank || Boolean(bankId)
  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: () => getBanks(),
    enabled: open && bankVisible,
  })

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowOptionalBank(false)
      setShowBankCreate(false)
      setNewBank({ name: '', dueDate: '', daysAfterClose: '7' })
    }
  }, [open])

  const createBankMutation = useMutation({
    mutationFn: createBank,
    onSuccess: (bank) => {
      queryClient.setQueryData<Bank[]>(['banks'], (old) => [...(old ?? []), bank])
      void queryClient.invalidateQueries({ queryKey: ['banks'] })
      onBankIdChange(bank.id)
      setShowBankCreate(false)
      setNewBank({ name: '', dueDate: '', daysAfterClose: '7' })
    },
    onError: () => toast.error('Não foi possível criar o banco.'),
  })

  function openBankCreate() {
    setShowBankCreate(true)
    setTimeout(() => bankNameRef.current?.focus(), 0)
  }

  function confirmBankCreate() {
    const name = newBank.name.trim()
    const dueDate = Number(newBank.dueDate)
    const daysAfterClose = Number(newBank.daysAfterClose)
    if (!name || !dueDate || !daysAfterClose) return
    createBankMutation.mutate({ name, invoiceDueDate: dueDate, invoiceDueDaysAfterClose: daysAfterClose })
  }

  const selectedBank = banks.find((bank) => bank.id === bankId)

  function handlePaymentTypeChange(value: TransactionType) {
    onPaymentTypeChange?.(value)
    if (value === TransactionType.CREDIT_CARD && selectedBank && !isSelectableBank(selectedBank)) {
      onBankIdChange('')
    }
  }

  return (
    <div className="flex flex-col gap-3 py-1">
      {paymentTypeRequired && onPaymentTypeChange && (
        <div className="flex flex-col gap-1.5">
          <Label>{paymentTypeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            {paymentTypeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={paymentType === option.value}
                onClick={() => handlePaymentTypeChange(option.value)}
                className={paymentType === option.value
                  ? 'rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm font-medium'
                  : 'rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground'}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{dateLabel}</Label>
        <DatePicker value={paymentDate} onChange={onPaymentDateChange} />
      </div>

      {!bankVisible && (
        <button
          type="button"
          onClick={() => setShowOptionalBank(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-3" aria-hidden="true" />
          Adicionar banco (opcional)
        </button>
      )}

      {bankVisible && (
        <div className="flex flex-col gap-1.5">
          <Label>{bankLabel}</Label>
          <Select value={bankId} onValueChange={(value) => onBankIdChange(value ?? '')}>
            <SelectTrigger aria-label={bankLabel}>
              <span data-slot="select-value" className="flex flex-1 text-left text-sm">
                {selectedBank ? bankDisplayName(selectedBank) : <span className="text-muted-foreground">{bankRequired && bankPlaceholder === 'Selecione um banco' ? 'Selecione o banco' : bankPlaceholder}</span>}
              </span>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {banks.filter(isSelectableBank).map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>{bankDisplayName(bank)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!bankRequired && (
            <button
              type="button"
              onClick={() => { onBankIdChange(''); setShowOptionalBank(false); setShowBankCreate(false) }}
              className={BANK_ACTION_CLASS}
            >
              Remover banco
            </button>
          )}

          {!showBankCreate ? (
            <button
              type="button"
              onClick={openBankCreate}
              className={BANK_ACTION_CLASS}
            >
              <Plus className="size-3" aria-hidden="true" />
              Criar novo banco
            </button>
          ) : (
            <div className="space-y-1.5">
              <Input
                ref={bankNameRef}
                value={newBank.name}
                onChange={(event) => setNewBank((current) => ({ ...current, name: event.target.value }))}
                placeholder="Nome do banco"
                className="h-8 text-sm"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); confirmBankCreate() }
                  if (event.key === 'Escape') { setShowBankCreate(false); setNewBank({ name: '', dueDate: '', daysAfterClose: '7' }) }
                }}
              />
              <div className="flex gap-1.5">
                <Input type="number" min={1} max={31} value={newBank.daysAfterClose} onChange={(event) => setNewBank((current) => ({ ...current, daysAfterClose: event.target.value }))} placeholder="Dias entre datas" className="h-8 text-sm" />
                <Input type="number" min={1} max={31} value={newBank.dueDate} onChange={(event) => setNewBank((current) => ({ ...current, dueDate: event.target.value }))} placeholder="Dia vencimento" className="h-8 text-sm" />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={!newBank.name.trim() || !newBank.dueDate || !newBank.daysAfterClose || createBankMutation.isPending} onClick={confirmBankCreate} aria-label="Confirmar">
                  {createBankMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => { setShowBankCreate(false); setNewBank({ name: '', dueDate: '', daysAfterClose: '7' }) }} aria-label="Cancelar">
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

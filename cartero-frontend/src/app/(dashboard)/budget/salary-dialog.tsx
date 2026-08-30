'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DIALOG_COMPACT_CLASS } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CurrencyInput } from '@/components/ui/currency-input'
import { formatMonthYear } from '@/lib/formatters'

/**
 * Define a renda a partir de uma competência.
 *
 * Deliberadamente não é um editor de timeline: o usuário informa um valor e o
 * mês em que ele passa a valer. O histórico existe para os cálculos mensais
 * ficarem corretos, não para ser administrado tela a tela.
 *
 * A microcopy diz "a partir de <mês>" porque a alteração NÃO é global: ela
 * vale desse mês em diante até a próxima entrada já cadastrada.
 */
interface SalaryDialogProps {
  open: boolean
  /** Competência selecionada no Orçamento. */
  month: number
  year: number
  /** Valor atual do período, quando conhecido. */
  currentAmount: number | null
  isPending?: boolean
  onConfirm: (amount: number) => void
  onCancel: () => void
}

export function SalaryDialog(props: SalaryDialogProps) {
  /*
    O `key` remonta o formulário quando muda a competência ou o valor de
    partida, zerando o estado sem um efeito que chame `setState`.

    A alternativa — um `useEffect` que reseta em `open` — dispara render em
    cascata (`react-hooks/set-state-in-effect`) e faz o campo piscar o valor
    anterior antes de corrigir.
  */
  return (
    <SalaryDialogForm
      {...props}
      key={`${props.year}-${props.month}-${props.currentAmount ?? 'none'}`}
    />
  )
}

function SalaryDialogForm({
  open,
  month,
  year,
  currentAmount,
  isPending = false,
  onConfirm,
  onCancel,
}: SalaryDialogProps) {
  const [amount, setAmount] = useState(currentAmount ?? 0)

  const competenceLabel = formatMonthYear(month, year)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isPending && onCancel()}>
      <DialogContent showCloseButton={false} className={DIALOG_COMPACT_CLASS}>
        <DialogHeader>
          <DialogTitle>
            {currentAmount != null ? 'Alterar renda' : 'Definir renda'}
          </DialogTitle>
          <DialogDescription>
            O valor passa a valer a partir de {competenceLabel} e segue valendo
            nos meses seguintes, até a próxima alteração que você registrar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 py-1">
          <Label htmlFor="salary-amount">Renda mensal</Label>
          <CurrencyInput
            id="salary-amount"
            value={amount}
            onChange={setAmount}
          />
          <p className="text-xs text-muted-foreground">
            Válido a partir de {competenceLabel}. Meses anteriores não são
            alterados.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(amount)} disabled={isPending}>
            {isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

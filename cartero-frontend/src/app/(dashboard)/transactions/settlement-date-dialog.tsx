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
import { DatePicker } from '@/components/ui/date-picker'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { todayDateValue } from '@/lib/date'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Corrigir a data real de um acerto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Existe para regularização: quem lança no Cartero um pagamento feito meses
 * atrás gravava a data de HOJE, e o Orçamento — que reconstrói o histórico
 * por essa data — passava a mostrar a obrigação como pendência anterior em
 * todos os meses intermediários.
 *
 * É uma ferramenta de correção, não um fluxo principal: vive no menu
 * contextual do item já resolvido, nunca como botão primário.
 *
 * Não é preciso desfazer o pagamento e refazê-lo — aquilo apagaria e recriaria
 * a transação vinculada, dois passos destrutivos para uma correção trivial.
 */
interface SettlementDateDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  title: string
  amount: number
  /** Data atualmente registrada. `null` em legado pago sem data. */
  currentDate: string | null
  isPending?: boolean
  onConfirm: (paidAt: string) => void
  onCancel: () => void
}

export function SettlementDateDialog(props: SettlementDateDialogProps) {
  /*
    O `key` remonta o formulário ao trocar de item, zerando o estado sem um
    efeito que chame `setState` — mesmo padrão do diálogo de renda.
  */
  return (
    <SettlementDateForm
      {...props}
      key={`${props.title}-${props.currentDate ?? 'sem-data'}`}
    />
  )
}

function SettlementDateForm({
  open,
  kind,
  title,
  amount,
  currentDate,
  isPending = false,
  onConfirm,
  onCancel,
}: SettlementDateDialogProps) {
  /*
    Parte da data já registrada. No legado sem data, HOJE é só o ponto de
    partida do seletor — o usuário informa a data verdadeira.
  */
  const [paidAt, setPaidAt] = useState(
    currentDate ? currentDate.slice(0, 10) : todayDateValue(),
  )

  const isReceivable = kind === 'receivable'
  const label = isReceivable ? 'recebimento' : 'pagamento'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isPending && onCancel()}>
      <DialogContent showCloseButton={false} className={DIALOG_COMPACT_CLASS}>
        <DialogHeader>
          <DialogTitle>Alterar data do {label}</DialogTitle>
          <DialogDescription>
            Use a data em que o {label} realmente aconteceu.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-[13px] tabular-nums text-muted-foreground">
            {formatCurrency(amount)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {currentDate ? (
              <>Registrado em {formatDate(currentDate)}</>
            ) : (
              /*
                Legado: `isPaid` sem data. Dizer isso é melhor que exibir uma
                data inventada — e esta é a tela que permite corrigir.
              */
              <>Data do {label} não registrada</>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5 py-1">
          <Label htmlFor="settlement-date">Data do {label}</Label>
          <DatePicker value={paidAt} onChange={setPaidAt} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(paidAt)}
            disabled={isPending || !paidAt}
          >
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

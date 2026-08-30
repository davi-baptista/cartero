'use client'

import { Loader2 } from 'lucide-react'
import { DIALOG_ROOMY_CLASS } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { parseInvoiceDate } from '@/lib/invoice-dates'
import { INVOICE_STATUS_LABEL } from '@/lib/invoice-status'
import { formatMonthYear } from '@/lib/formatters'
import type { BillingConfigPreview } from '@/services/banks.service'

/**
 * Impacto concreto de mudar o ciclo de faturamento.
 *
 * Substitui o aviso genérico que a fase anterior colocou no formulário —
 * "essa alteração também afeta as datas calculadas das faturas existentes".
 * Aquele texto era verdadeiro na época e deixou de ser: agora o histórico não
 * se move, e só as faturas em aberto acompanham a nova configuração. Manter
 * uma microcópia que descreve o comportamento antigo seria pior que não avisar.
 *
 * O dialog mostra o que muda, fatura por fatura, e nada mais.
 */

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
})

function shortDate(iso: string): string {
  return DAY_MONTH.format(parseInvoiceDate(iso))
}

/** "Set/2026" a partir da competência. */
function periodLabel(year: number, month: number): string {
  const label = formatMonthYear(month, year)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

interface BillingConfigDialogProps {
  open: boolean
  bankName: string
  preview: BillingConfigPreview | undefined
  isLoading: boolean
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function BillingConfigDialog({
  open,
  bankName,
  preview,
  isLoading,
  isPending,
  onConfirm,
  onCancel,
}: BillingConfigDialogProps) {
  const changes = preview?.changes ?? []
  const affected = preview?.affectedCount ?? 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>Alterar o ciclo de {bankName}?</DialogTitle>
          <DialogDescription>
            {affected === 1
              ? '1 fatura em aberto terá as datas atualizadas.'
              : `${affected} faturas em aberto terão as datas atualizadas.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Calculando o impacto…
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {/* O histórico é o que as pessoas temem perder; dizer isso antes de
                listar o que muda responde a dúvida na ordem em que ela surge. */}
            <p className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              Faturas fechadas, em atraso e pagas mantêm as datas originais.
            </p>

            {changes.length > 0 && (
              <ul className="flex flex-col gap-1.5 text-xs">
                {changes.slice(0, 4).map((change) => (
                  <li
                    key={change.invoiceId}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-muted-foreground">
                      {periodLabel(change.year, change.month)}
                    </span>
                    <span className="tabular-nums">
                      <span className="text-muted-foreground line-through">
                        {shortDate(change.dueDate.before)}
                      </span>
                      <span aria-hidden className="mx-1 text-muted-foreground/50">
                        →
                      </span>
                      <span className="font-medium">
                        {shortDate(change.dueDate.after)}
                      </span>
                      {change.statusChanged && (
                        <span className="ml-1.5 text-pending">
                          {INVOICE_STATUS_LABEL[change.status.after]}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {changes.length > 4 && (
                  <li className="text-muted-foreground/70">
                    e mais {changes.length - 4}{' '}
                    {changes.length - 4 === 1 ? 'fatura' : 'faturas'}
                  </li>
                )}
              </ul>
            )}

            {/* Mudança de status merece destaque próprio: é a consequência
                menos esperada de mexer no vencimento. */}
            {Boolean(preview?.statusChangeCount) && (
              <p className="text-xs text-pending">
                {preview!.statusChangeCount === 1
                  ? '1 fatura passa a ficar fechada ou em atraso imediatamente.'
                  : `${preview!.statusChangeCount} faturas passam a ficar fechadas ou em atraso imediatamente.`}
              </p>
            )}

            {Boolean(preview?.pendingReceivables) && (
              <p className="text-xs text-receivable">
                {preview!.pendingReceivables === 1
                  ? '1 cobrança pendente terá o vencimento atualizado.'
                  : `${preview!.pendingReceivables} cobranças pendentes terão o vencimento atualizado.`}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={isPending || isLoading}>
            {isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { DIALOG_ROOMY_CLASS } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Excluir uma dívida/cobrança que tem transação vinculada.
 *
 * A escolha é explícita porque as duas saídas são legítimas e o usuário é o
 * único que sabe qual quer: apagar um registro duplicado (leva a transação
 * embora) não é a mesma coisa que parar de acompanhar uma dívida já quitada
 * (o pagamento aconteceu de verdade e continua no extrato).
 *
 * O PADRÃO PRESERVA a transação. Ela é o registro do dinheiro que saiu ou
 * entrou; um clique apressado no botão primário não pode fazer desaparecer
 * movimentação que existiu de fato — esse é o dado que ninguém consegue
 * reconstruir depois, e o `paidAt` original vai com ele.
 */
interface DeleteLinkedWarningDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  /**
   * Que transação está em jogo.
   *
   * `payment` → comprovante da quitação (a dívida foi paga, a cobrança foi
   * recebida). `purchase` → a compra que ORIGINOU a cobrança automática.
   * Sem isso a frase dizia só "uma transação vinculada", e o usuário decidia
   * sem saber o que ia perder.
   */
  link?: 'payment' | 'purchase'
  /** Bloqueia os três caminhos enquanto a exclusão está em andamento. */
  isPending?: boolean
  /** Exclui os dois: o registro e a transação. */
  onConfirm: () => void
  /** Exclui só o registro e mantém a transação — o caminho padrão. */
  onDeleteOnly: () => void
  onCancel: () => void
}

export function DeleteLinkedWarningDialog({
  open,
  kind,
  link = 'payment',
  isPending = false,
  onConfirm,
  onDeleteOnly,
  onCancel,
}: DeleteLinkedWarningDialogProps) {
  const noun = kind === 'debt' ? 'dívida' : 'cobrança'

  const linkedLabel =
    link === 'purchase' ? 'a compra que a originou' : 'a transação do pagamento'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>Excluir {noun}</DialogTitle>
          <DialogDescription>
            Esta {noun} está vinculada a {linkedLabel}. Escolha o que fazer com
            ela — a exclusão não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              Manter a transação
            </span>{' '}
            — a {noun} sai da lista e a movimentação continua no extrato.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Excluir as duas
            </span>{' '}
            — some também do extrato, junto com a data original.
          </p>
        </div>

        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            Excluir as duas
          </Button>
          {/*
            Padrão à direita: preservar. O botão primário é o que não destrói
            o registro do dinheiro.
          */}
          <Button onClick={onDeleteOnly} disabled={isPending}>
            {isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Manter a transação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

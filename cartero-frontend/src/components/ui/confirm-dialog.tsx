'use client'

import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Confirmação de uma ação única, geralmente destrutiva.
 *
 * Existe porque o mesmo diálogo estava reescrito em oito telas, e cada cópia
 * divergia num detalhe: umas fechavam antes da resposta do servidor (o usuário
 * nunca via o erro), nenhuma bloqueava o segundo clique enquanto a mutação
 * corria, e o texto do botão variava sem motivo.
 *
 * O diálogo NÃO se fecha sozinho ao confirmar: quem chama fecha no `onSuccess`
 * da mutação. Assim uma recusa do servidor — categoria em uso, banco com
 * histórico — aparece com o diálogo ainda aberto, no contexto da ação.
 */
export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** O que vai acontecer. Curto; o título já diz qual é a ação. */
  description: React.ReactNode
  /** Texto do botão principal. Padrão: "Excluir". */
  confirmLabel?: string
  cancelLabel?: string
  /** `destructive` para exclusões; `default` para ações reversíveis. */
  variant?: 'destructive' | 'default'
  /** Enquanto true, bloqueia o botão e sinaliza processamento. */
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Ações extras entre Cancelar e o botão principal (ex.: excluir só um lado). */
  secondaryAction?: React.ReactNode
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Excluir',
  cancelLabel = 'Cancelar',
  variant = 'destructive',
  isPending = false,
  onConfirm,
  onCancel,
  secondaryAction,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Fechar no meio da mutação deixaria a ação correndo sem feedback.
        if (!next && !isPending) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          {secondaryAction}
          <Button variant={variant} onClick={onConfirm} disabled={isPending}>
            {isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

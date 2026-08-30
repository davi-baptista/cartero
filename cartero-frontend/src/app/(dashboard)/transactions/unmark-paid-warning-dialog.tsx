'use client'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface UnmarkPaidWarningDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  /** Bloqueia os botões enquanto a mutação está em andamento. */
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function UnmarkPaidWarningDialog({
  open,
  kind,
  isPending = false,
  onConfirm,
  onCancel,
}: UnmarkPaidWarningDialogProps) {
  const noun = kind === 'debt' ? 'dívida' : 'cobrança'
  const verb = kind === 'debt' ? 'paga' : 'recebida'

  /*
    Adapter sobre `ConfirmDialog` — a casca canônica de decisão binária.

    Isto era uma reimplementação byte a byte dela: mesmo `sm:max-w-sm`, mesmo
    rodapé Cancelar/destrutivo, mesma guarda de `isPending` no `onOpenChange`
    e o mesmo spinner. Só o texto era próprio.

    O domínio continua aqui: `kind` decide o substantivo e o particípio. A
    casca segue sem saber o que é dívida ou cobrança.
  */
  return (
    <ConfirmDialog
      open={open}
      title={`Desmarcar como ${verb}`}
      description={`Isso vai excluir a transação de pagamento vinculada a esta ${noun}, incluindo a data original do pagamento. Esta ação não pode ser desfeita.`}
      confirmLabel="Desmarcar"
      variant="destructive"
      isPending={isPending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

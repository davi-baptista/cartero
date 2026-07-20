'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface UnmarkPaidWarningDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  onConfirm: () => void
  onCancel: () => void
}

export function UnmarkPaidWarningDialog({ open, kind, onConfirm, onCancel }: UnmarkPaidWarningDialogProps) {
  const noun = kind === 'debt' ? 'dívida' : 'cobrança'
  const verb = kind === 'debt' ? 'paga' : 'recebida'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Desmarcar como {verb}</DialogTitle>
          <DialogDescription>
            Isso vai excluir a transação de pagamento vinculada a esta {noun}, incluindo a data
            original do pagamento. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm}>Desmarcar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

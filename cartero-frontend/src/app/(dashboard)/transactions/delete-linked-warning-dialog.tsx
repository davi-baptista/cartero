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

interface DeleteLinkedWarningDialogProps {
  open: boolean
  kind: 'debt' | 'receivable'
  onConfirm: () => void
  onDeleteOnly: () => void
  onCancel: () => void
}

export function DeleteLinkedWarningDialog({
  open,
  kind,
  onConfirm,
  onDeleteOnly,
  onCancel,
}: DeleteLinkedWarningDialogProps) {
  const noun = kind === 'debt' ? 'dívida' : 'cobrança'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir {noun} vinculada</DialogTitle>
          <DialogDescription>
            Esta {noun} possui uma transação vinculada. Excluir os dois remove também a transação.
            Você pode excluir somente a {noun} e manter a transação. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={onDeleteOnly}>
            Excluir só a {noun}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Excluir os dois
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
  onCancel: () => void
}

export function DeleteLinkedWarningDialog({
  open,
  kind,
  onConfirm,
  onCancel,
}: DeleteLinkedWarningDialogProps) {
  const noun = kind === 'debt' ? 'dívida' : 'cobrança'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir {noun} vinculada</DialogTitle>
          <DialogDescription>
            Esta {noun} possui uma transação vinculada. Excluir esta {noun} também vai deletar a
            transação vinculada. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Excluir os dois
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

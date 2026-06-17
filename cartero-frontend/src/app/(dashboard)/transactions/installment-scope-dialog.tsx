'use client'

import { InstallmentScope } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface InstallmentScopeDialogProps {
  open: boolean
  mode: 'edit' | 'delete'
  onConfirm: (scope: InstallmentScope) => void
  onCancel: () => void
}

const OPTIONS: { scope: InstallmentScope; label: string; description: string }[] = [
  { scope: InstallmentScope.ONE, label: 'Apenas esta', description: 'Afeta somente esta parcela' },
  { scope: InstallmentScope.NEXT, label: 'Esta e futuras', description: 'Afeta esta e todas as próximas parcelas' },
  { scope: InstallmentScope.ALL, label: 'Todas as parcelas', description: 'Afeta todas as parcelas da série' },
]

export function InstallmentScopeDialog({ open, mode, onConfirm, onCancel }: InstallmentScopeDialogProps) {
  const verb = mode === 'delete' ? 'excluir' : 'editar'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Transação parcelada</DialogTitle>
          <DialogDescription>
            Você deseja {verb} apenas esta parcela ou outras da série?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-1">
          {OPTIONS.map(({ scope, label, description }) => (
            <button
              key={scope}
              type="button"
              onClick={() => onConfirm(scope)}
              className={
                mode === 'delete' && scope !== InstallmentScope.ONE
                  ? 'flex flex-col items-start rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-left transition-colors hover:bg-destructive/10'
                  : 'flex flex-col items-start rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted'
              }
            >
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

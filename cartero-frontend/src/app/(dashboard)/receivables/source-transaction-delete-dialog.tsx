'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_ROOMY_CLASS } from '@/components/ui/confirm-dialog'
import { invalidateTransactionDependents } from '@/lib/transaction-dependent-queries'
import { apiErrorMessage } from '@/lib/api-error'
import { deleteOpenInstallments, deleteTransaction, previewDeleteTransaction } from '@/services/transactions.service'
import type { Receivable } from '@/types'

export function SourceTransactionDeleteDialog({ receivable, open, onClose, onSuccess }: { receivable: Receivable; open: boolean; onClose: () => void; onSuccess?: () => void }) {
  const qc = useQueryClient()
  const transactionId = receivable.transactionId
  const source = receivable.sourceTransaction
  const previewQuery = useQuery({
    queryKey: ['source-delete-preview', transactionId],
    queryFn: () => previewDeleteTransaction(transactionId!),
    enabled: open && Boolean(transactionId),
  })
  const mutation = useMutation({
    mutationFn: async () => {
      const preview = previewQuery.data!
      return preview.isInstallment
        ? deleteOpenInstallments(transactionId!, preview.deletable.map(({ id }) => id))
        : deleteTransaction(transactionId!)
    },
    onSuccess: async () => {
      invalidateTransactionDependents(qc, {
        affectsPerson: Boolean(source?.personId),
        transactionId,
        receivableId: receivable.id,
        invoiceId: source?.invoiceId,
      })
      await qc.invalidateQueries({ queryKey: ['source-delete-preview', transactionId] })
      toast.success('Compra removida')
      onClose()
      onSuccess?.()
    },
    onError: async (error) => {
      setExecutionMessage(apiErrorMessage(error, 'A situação da compra mudou. Confira a prévia novamente.'))
      await previewQuery.refetch()
    },
  })
  const [executionMessage, setExecutionMessage] = useState<string | null>(null)
  const preview = previewQuery.data
  const blocked = Boolean(preview && preview.deletableCount === 0)
  const canConfirm = Boolean(preview && !blocked && !previewQuery.isFetching && !mutation.isPending)

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent showCloseButton={false} className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>{preview?.isInstallment ? 'Excluir parcelas disponíveis?' : 'Excluir compra e cobrança?'}</DialogTitle>
          <div className="space-y-2 text-sm">
              {previewQuery.isFetching && !preview && <p>Verificando o que pode ser excluído…</p>}
              {previewQuery.isError && !preview && <p className="text-destructive">Não foi possível verificar esta compra.</p>}
              {preview?.isInstallment && !blocked && <>
                <p className="text-foreground">{preview.deletableCount} parcelas serão excluídas. {preview.preservedCount} serão preservadas.</p>
                {preview.preserved.map((item) => <p key={item.id}>{item.message}</p>)}
                <p>As cobranças pendentes vinculadas às parcelas excluídas também serão removidas.</p>
              </>}
              {preview && !preview.isInstallment && !blocked && <p>A compra e a cobrança associada serão removidas.</p>}
              {blocked && <>
                <p className="text-foreground">Esta compra não pode ser excluída agora.</p>
                {preview?.preserved.map((item) => <p key={item.id}>{item.message}</p>)}
                {receivable.isPaid && <p>Desfaça o recebimento antes de excluir a compra.</p>}
                {source?.invoiceStatus === 'PAID' && <p>Reabra a fatura antes de alterar ou excluir esta compra.</p>}
              </>}
              {executionMessage && <p className="flex gap-2 text-destructive"><AlertCircle className="size-4 shrink-0" />{executionMessage}</p>}
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>{blocked ? 'Fechar' : 'Cancelar'}</Button>
          {!blocked && <Button variant="destructive" disabled={!canConfirm} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {preview?.isInstallment ? 'Excluir parcelas disponíveis' : 'Excluir compra'}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

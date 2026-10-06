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
import { previewUnlinkTransaction, unlinkTransactionPerson } from '@/services/transactions.service'
import type { Receivable } from '@/types'

export function ReceivableUnlinkDialog({ receivable, open, onClose, onSuccess }: { receivable: Receivable; open: boolean; onClose: () => void; onSuccess?: () => void }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'ONE' | 'NEXT' | 'ALL'>('ONE')
  const [executionError, setExecutionError] = useState<string | null>(null)
  const source = receivable.sourceTransaction
  const previewQuery = useQuery({
    queryKey: ['unlink-preview', source?.id, scope],
    queryFn: () => previewUnlinkTransaction(source!.id, scope),
    enabled: open && Boolean(source?.id),
  })
  const mutation = useMutation({
    mutationFn: () =>
      unlinkTransactionPerson(
        source!.id,
        scope,
        previewQuery.data!.eligibleIds,
        previewQuery.data!.targetPersonId,
      ),
    onSuccess: async () => {
      invalidateTransactionDependents(qc, {
        affectsPerson: true,
        transactionId: source?.id,
        receivableId: receivable.id,
        invoiceId: source?.invoiceId,
      })
      await qc.invalidateQueries({ queryKey: ['unlink-preview', source?.id] })
      toast.success('Compra desvinculada da pessoa')
      onClose()
      onSuccess?.()
    },
    onError: async (error) => {
      const message = apiErrorMessage(error, 'Não foi possível desvincular a compra')
      setExecutionError(message)
      await previewQuery.refetch()
    },
  })

  if (!source) return null
  const preview = previewQuery.data
  const canConfirm = Boolean(preview?.eligibleCount) && !previewQuery.isFetching && !mutation.isPending

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent showCloseButton={false} className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>
            Desvincular parcelas de{' '}
            {preview?.targetPersonName ??
              source.personName ??
              receivable.person?.name ??
              receivable.debtorName}
            ?
          </DialogTitle>
          <div className="space-y-3 text-sm">
              {source.isInstallment && (
                <div className="flex flex-wrap gap-2" aria-label="Escopo do desvínculo">
                  {([
                    ['ONE', 'Apenas esta'],
                    ['NEXT', 'Esta e as próximas'],
                    ['ALL', 'Todas'],
                  ] as const).map(([value, label]) => (
                    <Button key={value} size="sm" variant={scope === value ? 'secondary' : 'outline'} onClick={() => { setScope(value); setExecutionError(null) }}>{label}</Button>
                  ))}
                </div>
              )}
              {previewQuery.isFetching && !preview && <p className="text-muted-foreground">Verificando as parcelas…</p>}
              {previewQuery.isError && !preview && <p className="text-destructive">Não foi possível verificar o vínculo.</p>}
              {preview && <>
                <p className="text-foreground">{preview.eligibleCount} de {preview.seriesTotal} {preview.seriesTotal === 1 ? 'parcela será desvinculada' : 'parcelas serão desvinculadas'}.</p>
                <p>A compra será mantida e esses valores passarão a contar como gastos seus.</p>
                {preview.preserved.filter((item) => item.reason === 'RECEIVABLE_ALREADY_PAID').length > 0 && <p>{preview.preserved.filter((item) => item.reason === 'RECEIVABLE_ALREADY_PAID').length} parcela(s) será(ão) preservada(s) porque o recebimento já foi registrado.</p>}
                {preview.preserved.filter((item) => item.reason === 'DIFFERENT_PERSON_LINK').length > 0 && <p>Parcelas vinculadas a outra pessoa serão preservadas.</p>}
                {preview.paidInvoiceEligibleCount > 0 && <p>{preview.paidInvoiceEligibleCount} parcela(s) pertencem a faturas pagas. O pagamento dessas faturas não será alterado; apenas a classificação do gasto mudará.</p>}
                {preview.eligibleCount === 0 && <p>Nenhuma parcela elegível para desvincular.</p>}
              </>}
              {executionError && <p className="flex items-start gap-2 text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{executionError}</p>}
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button disabled={!canConfirm} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Desvincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

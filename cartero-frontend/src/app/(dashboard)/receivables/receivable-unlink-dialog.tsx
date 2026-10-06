'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_ROOMY_CLASS } from '@/components/ui/confirm-dialog'
import {
  InstallmentScopeSelector,
  installmentScopeDescription,
} from '@/components/ui/installment-scope-selector'
import { invalidateTransactionDependents } from '@/lib/transaction-dependent-queries'
import { originalInstallmentNumber } from '@/lib/installment-series'
import { apiErrorMessage } from '@/lib/api-error'
import { previewUnlinkTransaction, unlinkTransactionPerson } from '@/services/transactions.service'
import { InstallmentScope } from '@/types'
import type { Receivable } from '@/types'

export function ReceivableUnlinkDialog({ receivable, open, onClose, onSuccess }: { receivable: Receivable; open: boolean; onClose: () => void; onSuccess?: () => void }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<InstallmentScope>(InstallmentScope.ONE)
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
  const personName = preview?.targetPersonName ?? source.personName ?? receivable.person?.name ?? receivable.debtorName
  const plural = source.isInstallment && scope !== InstallmentScope.ONE
  // Backend installmentIndex is the original 1-based identity, even when the
  // series has deleted members. Never derive this from the visible array.
  const position = originalInstallmentNumber(source)
  const preservedPaidCount = preview?.preserved.filter((item) => item.reason === 'RECEIVABLE_ALREADY_PAID').length ?? 0

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent showCloseButton={false} className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>
            Desvincular {plural ? 'parcelas' : 'parcela'} de {personName}?
          </DialogTitle>
          <div className="space-y-3 text-sm">
              {source.isInstallment && (
                <InstallmentScopeSelector
                  value={scope}
                  ariaLabel="Escopo do desvínculo"
                  onChange={(value) => {
                    setScope(value)
                    setExecutionError(null)
                  }}
                  options={[
                    InstallmentScope.ONE,
                    InstallmentScope.NEXT,
                    InstallmentScope.ALL,
                  ].map((value) => ({
                    scope: value,
                    description: installmentScopeDescription(value, {
                      position: value === InstallmentScope.ONE ? position : null,
                      count: preview?.scope === value ? preview.seriesTotal : undefined,
                    }),
                  }))}
                />
              )}
              {previewQuery.isFetching && !preview && <p className="text-muted-foreground">Verificando as parcelas…</p>}
              {previewQuery.isError && !preview && <p className="text-destructive">Não foi possível verificar o vínculo.</p>}
              {preview && <>
                <p className="text-foreground">{preview.eligibleCount} de {preview.seriesTotal} {preview.seriesTotal === 1 ? 'parcela será desvinculada.' : 'parcelas serão desvinculadas.'}</p>
                <p>A compra será mantida e esses valores passarão a contar como gastos seus.</p>
                {preservedPaidCount > 0 && <p>{preservedPaidCount === 1
                  ? '1 parcela será preservada porque seu recebimento já foi registrado.'
                  : `${preservedPaidCount} parcelas serão preservadas porque seus recebimentos já foram registrados.`}</p>}
                {preview.preserved.filter((item) => item.reason === 'DIFFERENT_PERSON_LINK').length > 0 && <p>Parcelas vinculadas a outra pessoa serão preservadas.</p>}
                {preview.paidInvoiceEligibleCount > 0 && <p>O pagamento das faturas não será alterado. Esses valores passarão a contar como gastos seus.</p>}
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

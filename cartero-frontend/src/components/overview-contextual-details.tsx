'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DebtDetailDrawer } from '@/app/(dashboard)/debts/debt-detail-drawer'
import { DebtSheet, type DebtFormData } from '@/app/(dashboard)/debts/debt-sheet'
import { ReceivableDetailDrawer } from '@/app/(dashboard)/receivables/receivable-detail-drawer'
import { ReceivableSheet, type ReceivableFormData } from '@/app/(dashboard)/receivables/receivable-sheet'
import { SettlementDateDialog } from '@/app/(dashboard)/transactions/settlement-date-dialog'
import { InvoiceDetailsDrawer } from '@/components/invoice-details-drawer'
import { PersonStatementDrawer } from '@/components/person-statement-drawer'
import { getDebt, updateDebt, deleteDebt, updateDebtSettlementDate } from '@/services/debts.service'
import { getReceivable, updateReceivable, deleteReceivable, updateReceivableSettlementDate } from '@/services/receivables.service'
import { getPerson } from '@/services/persons.service'
import { useDetailEntity } from '@/lib/use-detail-entity'
import type { Debt, Invoice, Receivable } from '@/types'
import { InstallmentScope } from '@/types'
import { useAuth } from '@/providers/auth-provider'
import type { OverviewDetailParam } from '@/lib/overview-detail-navigation'

type OverviewContextualDetailsProps = {
  activeParam: OverviewDetailParam | null
  activeId: string | null
  invoices: Invoice[]
  debts: Debt[]
  receivables: Receivable[]
  onClose: () => void
  period: { month: number; year: number }
}

/**
 * Composição dos drawers canônicos da Overview.
 *
 * Este componente controla somente qual domínio está aberto e a orquestração
 * mínima necessária para Debt/Receivable. O corpo e as regras visuais continuam
 * nos drawers de cada domínio; não existe um drawer universal.
 */
export function OverviewContextualDetails({
  activeParam,
  activeId,
  invoices,
  debts,
  receivables,
  onClose,
  period,
}: OverviewContextualDetailsProps) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const debtId = activeParam === 'debtId' ? activeId : null
  const receivableId = activeParam === 'receivableId' ? activeId : null
  const personId = activeParam === 'personId' ? activeId : null
  const invoiceId = activeParam === 'invoiceId' ? activeId : null

  const { entity: debt } = useDetailEntity({
    openId: debtId,
    fromList: debts.find((item) => item.id === debtId),
    fetchById: getDebt,
    queryKey: 'debt',
    onNotFound: onClose,
  })
  const { entity: receivable } = useDetailEntity({
    openId: receivableId,
    fromList: receivables.find((item) => item.id === receivableId),
    fetchById: getReceivable,
    queryKey: 'receivable',
    onNotFound: onClose,
  })
  const { data: person } = useQuery({
    queryKey: ['person', personId],
    queryFn: () => getPerson(personId!),
    enabled: Boolean(personId),
  })

  const [editDebt, setEditDebt] = useState<Debt | null>(null)
  const [editReceivable, setEditReceivable] = useState<Receivable | null>(null)
  const [settlementDate, setSettlementDate] = useState<{
    kind: 'debt' | 'receivable'
    item: Debt | Receivable
  } | null>(null)

  function invalidateDebt() {
    void Promise.all([
      qc.invalidateQueries({ queryKey: ['debts'] }),
      qc.invalidateQueries({ queryKey: ['transactions'] }),
      qc.invalidateQueries({ queryKey: ['bank-invoices'] }),
      qc.invalidateQueries({ queryKey: ['invoices'] }),
      qc.invalidateQueries({ queryKey: ['receivables'] }),
      qc.invalidateQueries({ queryKey: ['budget'] }),
      qc.invalidateQueries({ queryKey: ['person-statement'] }),
      qc.invalidateQueries({ queryKey: ['persons'] }),
    ])
  }

  const updateDebtMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateDebt>[1] }) => updateDebt(id, payload),
    onSuccess: () => {
      invalidateDebt()
      setEditDebt(null)
      toast.success('Dívida atualizada')
    },
    onError: () => toast.error('Erro ao salvar dívida'),
  })
  const deleteDebtMut = useMutation({
    mutationFn: (id: string) => deleteDebt(id),
    onSuccess: () => {
      invalidateDebt()
      onClose()
      toast.success('Dívida excluída')
    },
    onError: () => toast.error('Erro ao excluir dívida'),
  })
  const toggleDebtMut = useMutation({
    mutationFn: ({ id, isPaid }: { id: string; isPaid: boolean }) => updateDebt(id, { isPaid }),
    onSuccess: invalidateDebt,
    onError: () => toast.error('Erro ao atualizar dívida'),
  })
  const debtDateMut = useMutation({
    mutationFn: ({ id, paidAt }: { id: string; paidAt: string }) => updateDebtSettlementDate(id, paidAt),
    onSuccess: () => {
      invalidateDebt()
      setSettlementDate(null)
    },
    onError: () => toast.error('Erro ao atualizar a data'),
  })

  async function handleDebtSubmit(data: DebtFormData, scope: InstallmentScope | null) {
    if (!editDebt) return
    void scope
    const { installments, ...payload } = data
    void installments
    await updateDebtMut.mutateAsync({ id: editDebt.id, payload })
  }

  const updateReceivableMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateReceivable>[1] }) => updateReceivable(id, payload),
    onSuccess: () => {
      invalidateDebt()
      setEditReceivable(null)
      toast.success('Cobrança atualizada')
    },
    onError: () => toast.error('Erro ao salvar cobrança'),
  })
  const deleteReceivableMut = useMutation({
    mutationFn: (id: string) => deleteReceivable(id),
    onSuccess: () => {
      invalidateDebt()
      onClose()
      toast.success('Cobrança excluída')
    },
    onError: () => toast.error('Erro ao excluir cobrança'),
  })
  const toggleReceivableMut = useMutation({
    mutationFn: ({ id, isPaid }: { id: string; isPaid: boolean }) => updateReceivable(id, { isPaid }),
    onSuccess: invalidateDebt,
    onError: () => toast.error('Erro ao atualizar cobrança'),
  })
  const receivableDateMut = useMutation({
    mutationFn: ({ id, paidAt }: { id: string; paidAt: string }) => updateReceivableSettlementDate(id, paidAt),
    onSuccess: () => {
      invalidateDebt()
      setSettlementDate(null)
    },
    onError: () => toast.error('Erro ao atualizar a data'),
  })

  async function handleReceivableSubmit(data: ReceivableFormData, scope: InstallmentScope | null) {
    if (!editReceivable) return
    void scope
    const { installments, ...payload } = data
    void installments
    await updateReceivableMut.mutateAsync({ id: editReceivable.id, payload })
  }

  return (
    <>
      {activeParam === 'invoiceId' && invoiceId && (
        <InvoiceDetailsDrawer
          key={`invoice:${invoiceId}`}
          invoiceId={invoiceId}
          bankId={invoices.find((item) => item.id === invoiceId)?.bankId ?? ''}
          open
          onOpenChange={(open) => !open && onClose()}
        />
      )}
      {activeParam === 'personId' && personId && (
        <PersonStatementDrawer
          key={`person:${personId}`}
          person={person ? { id: person.id, name: person.name, phone: person.phone } : null}
          open={Boolean(person)}
          onClose={onClose}
          period={period}
        />
      )}
      {activeParam === 'debtId' && debtId && (
        <DebtDetailDrawer
          key={`debt:${debtId}`}
          debt={debt}
          onOpenChange={(open) => !open && onClose()}
          onEdit={(item) => setEditDebt(item)}
          onDelete={(item) => deleteDebtMut.mutate(item.id)}
          onTogglePaid={(item) => toggleDebtMut.mutate({ id: item.id, isPaid: !item.isPaid })}
          onEditSettlementDate={(item) => setSettlementDate({ kind: 'debt', item })}
        />
      )}
      {activeParam === 'receivableId' && receivableId && (
        <ReceivableDetailDrawer
          key={`receivable:${receivableId}`}
          receivable={receivable}
          onOpenChange={(open) => !open && onClose()}
          onEdit={(item) => setEditReceivable(item)}
          onDelete={(item) => deleteReceivableMut.mutate(item.id)}
          onToggleReceived={(item) => toggleReceivableMut.mutate({ id: item.id, isPaid: !item.isPaid })}
          onEditSettlementDate={(item) => setSettlementDate({ kind: 'receivable', item })}
        />
      )}
      <DebtSheet
        open={editDebt !== null}
        onOpenChange={(open) => !open && setEditDebt(null)}
        editTarget={editDebt}
        editScope={null}
        timeZone={user?.timeZone}
        onSubmit={handleDebtSubmit}
      />
      <ReceivableSheet
        open={editReceivable !== null}
        onOpenChange={(open) => !open && setEditReceivable(null)}
        editTarget={editReceivable}
        editScope={null}
        timeZone={user?.timeZone}
        onSubmit={handleReceivableSubmit}
      />
      {settlementDate && (
        <SettlementDateDialog
          open
          kind={settlementDate.kind}
          title={settlementDate.item.title}
          amount={Number(settlementDate.item.amount)}
          currentDate={settlementDate.item.paidAt ?? null}
          isPending={debtDateMut.isPending || receivableDateMut.isPending}
          onConfirm={(paidAt) => {
            if (settlementDate.kind === 'debt') debtDateMut.mutate({ id: settlementDate.item.id, paidAt })
            else receivableDateMut.mutate({ id: settlementDate.item.id, paidAt })
          }}
          onCancel={() => setSettlementDate(null)}
        />
      )}
    </>
  )
}

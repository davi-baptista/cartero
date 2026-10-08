'use client'

import { useState } from 'react'
import { Pencil, Trash2, Pause, Play } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DrawerIdentityHeader } from '@/components/ui/drawer-identity-header'
import { FinancialListRow, FinancialRowTrailing, ROW_AMOUNT_TONE, ROW_HISTORY_TITLE_TONE } from '@/components/ui/financial-list-row'
import { TransactionDetailsDrawer } from '@/components/transaction-details-drawer'
import { DrawerCompletionStatus, DrawerFinancialList, DrawerOutlineCard, DrawerSectionEmpty, DrawerSectionGroup, DrawerSectionHeading, DrawerSummaryCard, DrawerSummaryLabel, DrawerSummaryMeta, DrawerSummaryValue } from '@/components/ui/drawer-section'
import { DRAWER_WIDE_CONTENT_INSET, DRAWER_WIDTH_WIDE, DRAWER_WIDE_VERTICAL_RHYTHM } from '@/components/ui/drawer-layout'
import { getTransaction, getTransactions } from '@/services/transactions.service'
import { bankDisplayName } from '@/lib/bank-display'
import { formatCurrency, formatDate, formatMonthYear, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Subscription, Transaction } from '@/types'

function cycleLabel(cycle: string) {
  const [year, month] = cycle.slice(0, 7).split('-').map(Number)
  return formatMonthYear(month, year)
}

export function SubscriptionHistoryRow({ transaction, onOpen }: {
  transaction: Transaction
  onOpen: (transactionId: string) => void
}) {
  return <FinancialListRow
    onView={() => onOpen(transaction.id)}
    ariaLabel={`Abrir lançamento em ${formatDate(transaction.date)}`}
    title={<span className={ROW_HISTORY_TITLE_TONE}>{formatDate(transaction.date)}</span>}
    meta={transaction.title}
    trailing={<FinancialRowTrailing amount={formatCurrency(transaction.amount)} label="LANÇADA" amountTone={ROW_AMOUNT_TONE.muted} />}
  />
}

export function SubscriptionDetailDrawer({ subscription, onOpenChange, onEdit, onDelete, onToggle }: {
  subscription: Subscription | null
  onOpenChange: (open: boolean) => void
  onEdit: (subscription: Subscription) => void
  onDelete: (subscription: Subscription) => void
  onToggle: (subscription: Subscription) => void
}) {
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)
  const history = useQuery({
    queryKey: ['subscription-history', subscription?.id],
    queryFn: () => getTransactions({ subscriptionId: subscription!.id }),
    enabled: Boolean(subscription?.id),
  })
  const selectedTransactionQuery = useQuery({
    queryKey: ['transaction', selectedTransactionId],
    queryFn: () => getTransaction(selectedTransactionId!),
    enabled: Boolean(subscription?.id && selectedTransactionId),
  })
  const selectedTransaction = selectedTransactionQuery.data ?? history.data?.find((transaction) => transaction.id === selectedTransactionId)
  return <>
    <Sheet open={Boolean(subscription)} onOpenChange={(open) => { if (!open) setSelectedTransactionId(null); onOpenChange(open) }}>
    <SheetContent className={cn(DRAWER_WIDTH_WIDE, DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap)} showCloseButton={false}>
      <DrawerIdentityHeader title={subscription?.title} description={`Cobrança automática · ${subscription?.isActive ? 'Ativa' : 'Pausada'}`} />
      {subscription && <div className={cn('flex flex-1 flex-col overflow-y-auto subtle-scrollbar', DRAWER_WIDE_CONTENT_INSET, DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap, 'pb-6')}>
        <DrawerSummaryCard inset={false}>
          <DrawerSummaryLabel emphasis="regular">Valor por cobrança</DrawerSummaryLabel>
          <DrawerSummaryValue>{formatCurrency(Number(subscription.amount))}</DrawerSummaryValue>
          <DrawerSummaryMeta className="mt-2">Dia {subscription.dayOfMonth} · {TRANSACTION_TYPE_LABELS[subscription.type]}</DrawerSummaryMeta>
          <div className="mt-3"><DrawerCompletionStatus variant={subscription.isActive ? 'pending' : 'informational'} className={subscription.isActive ? 'text-paid' : 'text-muted-foreground'}>{subscription.isActive ? 'Ativa' : 'Pausada'}</DrawerCompletionStatus></div>
        </DrawerSummaryCard>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => onEdit(subscription)}><Pencil className="size-3.5" /> Editar despesa</Button>
          <Button variant="outline" className="gap-2" onClick={() => onToggle(subscription)}>{subscription.isActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{subscription.isActive ? 'Pausar despesa' : 'Reativar despesa'}</Button>
          <Button variant="destructive" className="gap-2" onClick={() => onDelete(subscription)}><Trash2 className="size-3.5" /> Excluir despesa</Button>
        </div>
        <DrawerOutlineCard variant="compact">
          <p className="text-xs text-muted-foreground">Próxima cobrança</p>
          <p className="mt-1 text-sm font-medium">{subscription.isActive ? subscription.nextCharge ? formatDate(subscription.nextCharge) : `Todo dia ${subscription.dayOfMonth}` : 'Sem cobranças enquanto estiver pausada'}</p>
        </DrawerOutlineCard>
        <DrawerOutlineCard variant="compact">
          <p className="text-xs text-muted-foreground">Detalhes</p>
          <p className="mt-1 text-sm">{bankDisplayName(subscription.bank)}{subscription.category ? ` · ${subscription.category.name}` : ''}</p>
          <p className="mt-1 text-xs text-muted-foreground">Desde {cycleLabel(subscription.startedAt)}</p>
          {subscription.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{subscription.description}</p>}
        </DrawerOutlineCard>
        <DrawerSectionGroup>
          <DrawerSectionHeading>Histórico de lançamentos</DrawerSectionHeading>
          {history.isLoading ? <DrawerSectionEmpty inset={false}>Carregando histórico…</DrawerSectionEmpty> : history.isError ? <DrawerSectionEmpty inset={false}>Não foi possível carregar o histórico.</DrawerSectionEmpty> : history.data?.length ? <DrawerFinancialList>{history.data.map((transaction) => <SubscriptionHistoryRow key={transaction.id} transaction={transaction} onOpen={setSelectedTransactionId} />)}</DrawerFinancialList> : <DrawerSectionEmpty inset={false}>Nenhuma cobrança lançada.</DrawerSectionEmpty>}
        </DrawerSectionGroup>
      </div>}
    </SheetContent>
    </Sheet>
    {selectedTransactionId && selectedTransaction && subscription?.id === selectedTransaction.subscriptionId && (
      <TransactionDetailsDrawer
        transaction={selectedTransaction}
        siblings={history.data ?? []}
        onClose={() => setSelectedTransactionId(null)}
      />
    )}
  </>
}

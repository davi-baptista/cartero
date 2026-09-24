'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DetailDrawer, DetailFooter, DetailRow, DETAIL_ACTION_CLASS } from '@/components/ui/detail-drawer'
import { bankDisplayName } from '@/lib/bank-display'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { formatCurrency, formatDate, isExpense, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { belongsToSeries, installmentMetadata } from '@/lib/installment-series'
import { ROW_AMOUNT_CLASS } from '@/components/ui/financial-list-row'
import type { Transaction } from '@/types'
import { TransactionType } from '@/types'

export function TransactionDetailsDrawer({
  transaction,
  siblings = [],
  onClose,
  onEdit,
  onDelete,
}: {
  transaction: Transaction
  siblings?: Transaction[]
  onClose: () => void
  onEdit?: (transaction: Transaction) => void
  onDelete?: (transaction: Transaction) => void
}) {
  const Icon = transaction.category?.icon
    ? resolveCategoryIcon(transaction.category.icon).Icon
    : null
  const installment = belongsToSeries(transaction)
  const metadata = installment ? installmentMetadata(transaction) : null
  const rootId = transaction.parentId ?? transaction.id
  const series = siblings.filter((item) => (item.parentId ?? item.id) === rootId)
  const total = metadata?.count && series.length === metadata.count
    ? series.reduce((sum, item) => sum + item.amount, 0)
    : null
  const expense = isExpense(transaction.type, transaction.isRefund)

  return (
    <DetailDrawer
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={transaction.title}
      description={`${TRANSACTION_TYPE_LABELS[transaction.type]} · ${formatDate(transaction.date)}`}
      footer={onEdit || onDelete ? (
        <DetailFooter>
          {onEdit && <Button variant="outline" className={DETAIL_ACTION_CLASS} onClick={() => onEdit(transaction)}><Pencil className="size-4" />Editar</Button>}
          {onDelete && <Button variant="destructive" className={DETAIL_ACTION_CLASS} onClick={() => onDelete(transaction)}><Trash2 className="size-4" />Excluir</Button>}
        </DetailFooter>
      ) : undefined}
    >
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <p className="text-xs font-medium text-muted-foreground">{installment ? 'Valor desta parcela' : 'Valor'}</p>
        <p className={`${ROW_AMOUNT_CLASS} mt-1`}>{expense ? '−' : '+'}{formatCurrency(transaction.amount)}</p>
        {transaction.isRefund && <p className="mt-1 text-[11px] text-primary">Estorno — reduz o total da fatura</p>}
      </div>
      <dl className="divide-y divide-border px-5">
        <DetailRow label="Natureza">{transaction.type === TransactionType.INCOME ? 'Receita' : 'Gasto'}</DetailRow>
        {transaction.type !== TransactionType.INCOME && transaction.type !== TransactionType.INVOICE_PAYMENT && <DetailRow label="Forma de pagamento">{TRANSACTION_TYPE_LABELS[transaction.type]}</DetailRow>}
        <DetailRow label="Banco">{bankDisplayName(transaction.bank)}</DetailRow>
        <DetailRow label="Categoria"><span className="flex min-w-0 items-center justify-end gap-1.5">{Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" style={transaction.category?.color ? { color: transaction.category.color } : undefined} />}<span className="truncate">{transaction.category?.name ?? 'Não informada'}</span></span></DetailRow>
        {transaction.person && <DetailRow label="Cobrança"><span className="text-receivable">A receber de {transaction.person.name}</span></DetailRow>}
        {installment && <DetailRow label="Parcelamento">{metadata?.index ? `Parcela ${metadata.index} de ${metadata.count}` : 'Parcelado'}</DetailRow>}
        {total !== null && <DetailRow label="Total da compra"><span className="tabular-nums">{formatCurrency(total)}</span><span className="ml-1 text-muted-foreground">· {metadata?.count} parcelas</span></DetailRow>}
        {transaction.invoice && <DetailRow label="Fatura">{`${transaction.invoice.month}/${transaction.invoice.year}`}</DetailRow>}
        {transaction.invoiceSettlement && <DetailRow label="Fatura">{`${transaction.invoiceSettlement.invoice.month}/${transaction.invoiceSettlement.invoice.year}`}</DetailRow>}
        {transaction.description && <DetailRow label="Descrição" align="start"><span className="whitespace-pre-wrap">{transaction.description}</span></DetailRow>}
      </dl>
    </DetailDrawer>
  )
}

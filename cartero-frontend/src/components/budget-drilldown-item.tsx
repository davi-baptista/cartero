import { formatCurrency, formatDate, formatMonthOfYear, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { accountCivilDayOf } from '@/lib/date'
import { cn } from '@/lib/utils'
import {
  FinancialListRow,
  FinancialRowTrailing,
  ROW_AMOUNT_CLASS,
} from '@/components/ui/financial-list-row'
import { FinancialAvatar } from '@/components/ui/financial-avatar'
import {
  TRANSACTION_EXPENSE_ICON_COLOR,
  TRANSACTION_INCOME_ICON_COLOR,
  TRANSACTION_TYPE_ICONS,
} from '@/lib/transaction-icons'
import { TransactionType } from '@/types'
import {
  DRILLDOWN_BUCKET_CONFIG,
  transactionFallback,
} from '@/lib/budget-drilldown-config'
import type {
  BudgetV2DrilldownBucket,
  BudgetV2DrilldownItem,
} from '@/types/budget-v2-drilldown'

function eventDateLabel(value: string, timeZone: string): string {
  return formatDate(accountCivilDayOf(value, timeZone))
}

function dueDateLabel(value: string, overdue: boolean): string {
  return `${overdue ? 'Venceu' : 'Vence'} ${formatDate(value)}`
}

function metadata(parts: Array<string | null | undefined>): string | null {
  const values = parts.filter(
    (part): part is string => typeof part === 'string' && part.length > 0 && !part.includes('__'),
  )
  return values.length > 0 ? values.join(' · ') : null
}

function paymentTypeLabel(value: string | null | undefined): string | null {
  if (!value || value.includes('__')) return null
  if (value === 'INCOME') return 'Renda'
  return TRANSACTION_TYPE_LABELS[value as keyof typeof TRANSACTION_TYPE_LABELS] ?? value
}

function Amount({ value }: { value: string }) {
  return <span className={cn(ROW_AMOUNT_CLASS, 'text-foreground')}>{formatCurrency(Number(value))}</span>
}

export type BudgetQuickSettlementTarget = {
  kind: 'receivable' | 'debt'
  id: string
  title: string
  amount: string
}

function itemIconType(item: BudgetV2DrilldownItem): string | null {
  switch (item.kind) {
    case 'TRANSACTION':
    case 'RECEIVABLE_RECEIPT':
    case 'PERSON_SETTLEMENT':
    case 'DEBT_SETTLEMENT':
      return item.paymentType
    case 'INVOICE_SETTLEMENT':
      return TransactionType.CREDIT_CARD
    default:
      return null
  }
}

function isIncomeMovement(item: BudgetV2DrilldownItem): boolean {
  return item.kind === 'RECEIVABLE_RECEIPT' ||
    (item.kind === 'TRANSACTION' && item.paymentType === TransactionType.INCOME) ||
    (item.kind === 'PERSON_SETTLEMENT' && item.direction === 'INFLOW')
}

export function BudgetDrilldownItemRow({
  bucket,
  item,
  timeZone,
  onQuickAction,
  onView,
  quickActionPending = false,
}: {
  bucket: BudgetV2DrilldownBucket
  item: BudgetV2DrilldownItem
  timeZone: string
  onQuickAction?: (target: BudgetQuickSettlementTarget) => void
  onView?: (item: BudgetV2DrilldownItem) => void
  quickActionPending?: boolean
}) {
  const overdue = DRILLDOWN_BUCKET_CONFIG[bucket].scope === 'overdue'
  const realized = DRILLDOWN_BUCKET_CONFIG[bucket].scope === 'period'
  const Icon = realized || item.kind === 'INVOICE'
    ? TRANSACTION_TYPE_ICONS[itemIconType(item) as TransactionType] ??
      TRANSACTION_TYPE_ICONS[TransactionType.PIX]
    : null
  const incomeMovement = isIncomeMovement(item)
  let primary = ''
  let secondary: string | null = null

  switch (item.kind) {
    case 'TRANSACTION':
      primary = item.description || item.title || transactionFallback(bucket)
      secondary = metadata([
        item.description && item.title !== item.description ? item.title : null,
        item.categoryName,
        item.bankName,
        paymentTypeLabel(item.paymentType),
        eventDateLabel(item.eventDate, timeZone),
      ])
      break
    case 'RECEIVABLE_RECEIPT':
      primary = item.counterparty || item.description || item.title
      secondary = metadata([
        item.description,
        eventDateLabel(item.eventDate, timeZone),
        item.bankName,
        paymentTypeLabel(item.paymentType),
      ])
      break
    case 'PERSON_SETTLEMENT':
      primary = item.personName
      secondary = metadata([
        eventDateLabel(item.eventDate, timeZone),
        paymentTypeLabel(item.paymentType),
        item.bankName,
      ])
      break
    case 'DEBT_SETTLEMENT':
      primary = item.title || item.counterparty || 'Dívida'
      secondary = metadata([
        item.counterparty !== primary ? item.counterparty : null,
        item.description,
        eventDateLabel(item.eventDate, timeZone),
        item.bankName,
        paymentTypeLabel(item.paymentType),
      ])
      break
    case 'INVOICE_SETTLEMENT':
      primary = item.bankName
      secondary = metadata([
        formatMonthOfYear(item.month, item.year),
        `Pago ${eventDateLabel(item.eventDate, timeZone)}`,
        `Vencia ${formatDate(item.dueDate)}`,
      ])
      break
    case 'RECEIVABLE':
      primary = item.title || item.counterparty
      secondary = metadata([
        item.title !== item.counterparty ? item.counterparty : null,
        dueDateLabel(item.dueDate, overdue),
      ])
      break
    case 'INVOICE':
      primary = item.bankName
      secondary = metadata([
        dueDateLabel(item.dueDate, overdue),
        formatMonthOfYear(item.month, item.year),
      ])
      break
    case 'DEBT':
      primary = item.title || item.counterparty
      secondary = metadata([
        item.title !== item.counterparty ? item.counterparty : null,
        dueDateLabel(item.dueDate, overdue),
      ])
      break
  }

  const quickSettlement = !realized && (item.kind === 'RECEIVABLE' || item.kind === 'DEBT')
    ? {
        kind: item.kind === 'RECEIVABLE' ? 'receivable' as const : 'debt' as const,
        id: item.id,
        title: primary,
        amount: item.amount,
      }
    : null
  const trailingLabel = realized
    ? null
    : item.kind === 'RECEIVABLE'
      ? overdue ? 'EM ATRASO' : 'A RECEBER'
      : item.kind === 'DEBT'
        ? overdue ? 'EM ATRASO' : 'A PAGAR'
        : item.kind === 'INVOICE'
          ? overdue ? 'EM ATRASO' : 'FATURA'
          : null
  const icon = Icon ? (
    <FinancialAvatar
      tone={realized && incomeMovement ? 'income' : 'expense'}
      icon={<Icon
        className="size-4.5 sm:size-5"
        style={{
          color: realized
            ? incomeMovement ? TRANSACTION_INCOME_ICON_COLOR : TRANSACTION_EXPENSE_ICON_COLOR
            : undefined,
        }}
      />}
    />
  ) : null
  const navigableMovement = realized && (
    item.kind === 'TRANSACTION' ||
    item.kind === 'RECEIVABLE_RECEIPT' ||
    item.kind === 'DEBT_SETTLEMENT' ||
    item.kind === 'PERSON_SETTLEMENT' ||
    item.kind === 'INVOICE_SETTLEMENT'
  ) || item.kind === 'RECEIVABLE' || item.kind === 'DEBT' || item.kind === 'INVOICE'

  return (
    <FinancialListRow
      interactive={navigableMovement}
      onView={navigableMovement ? () => onView?.(item) : undefined}
      ariaLabel={primary}
      leading={icon}
      leadingAction={quickSettlement && onQuickAction ? (
        <FinancialAvatar
          disabled={quickActionPending}
          ariaLabel={quickSettlement.kind === 'receivable' ? 'Marcar como recebido' : 'Marcar como paga'}
          onClick={() => onQuickAction(quickSettlement)}
        />
      ) : undefined}
      title={primary}
      meta={secondary}
      trailing={(
        <FinancialRowTrailing
          amount={<Amount value={item.amount} />}
          label={trailingLabel ?? ''}
        />
      )}
      className={cn(
        'border-b border-border/70 last:border-b-0',
        realized && 'border-border/60',
      )}
    />
  )
}

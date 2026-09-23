import { formatCurrency, formatDate, formatMonthOfYear } from '@/lib/formatters'
import { accountCivilDayOf } from '@/lib/date'
import { cn } from '@/lib/utils'
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

function ItemText({ primary, secondary }: { primary: string; secondary: string | null }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{primary}</p>
      {secondary && <p className="mt-0.5 truncate text-xs text-muted-foreground">{secondary}</p>}
    </div>
  )
}

function Amount({ value }: { value: string }) {
  return <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(Number(value))}</span>
}

export function BudgetDrilldownItemRow({
  bucket,
  item,
  timeZone,
}: {
  bucket: BudgetV2DrilldownBucket
  item: BudgetV2DrilldownItem
  timeZone: string
}) {
  const overdue = DRILLDOWN_BUCKET_CONFIG[bucket].scope === 'overdue'
  let primary = ''
  let secondary: string | null = null

  switch (item.kind) {
    case 'TRANSACTION':
      primary = item.description || item.title || transactionFallback(bucket)
      secondary = metadata([
        item.description && item.title !== item.description ? item.title : null,
        item.categoryName,
        item.bankName,
        item.paymentType,
        eventDateLabel(item.eventDate, timeZone),
      ])
      break
    case 'RECEIVABLE_RECEIPT':
      primary = item.counterparty || item.description || item.title
      secondary = metadata([
        item.description,
        eventDateLabel(item.eventDate, timeZone),
        item.bankName,
        item.paymentType,
      ])
      break
    case 'PERSON_SETTLEMENT':
      primary = item.personName
      secondary = metadata([
        eventDateLabel(item.eventDate, timeZone),
        item.paymentType,
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
        item.paymentType,
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

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border/70 px-5 py-3.5 last:border-b-0',
        'transition-colors hover:bg-muted/30',
      )}
    >
      <ItemText primary={primary} secondary={secondary} />
      <Amount value={item.amount} />
    </div>
  )
}

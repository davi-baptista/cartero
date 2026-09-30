import type { ReactNode } from 'react'
import { FinancialAvatar } from '@/components/ui/financial-avatar'
import { FinancialListRow, ROW_HISTORY_TITLE_TONE } from '@/components/ui/financial-list-row'
import { cn } from '@/lib/utils'

/** Shared interaction contract for a settleable row: circle toggles status, body opens detail. */
export function FinancialSettlementRow({
  resolved,
  onToggleStatus,
  onView,
  title,
  meta,
  trailing,
  ariaLabel,
  statusActionLabel,
  leadingIcon,
}: {
  resolved: boolean
  onToggleStatus: () => void
  onView: () => void
  title: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  ariaLabel: string
  statusActionLabel: string
  leadingIcon?: ReactNode
}) {
  return (
    <FinancialListRow
      ariaLabel={ariaLabel}
      onView={onView}
      leadingAction={
        <FinancialAvatar
          icon={leadingIcon}
          onClick={onToggleStatus}
          ariaLabel={statusActionLabel}
          title={statusActionLabel}
        />
      }
      title={<span className={cn(resolved && ROW_HISTORY_TITLE_TONE)}>{title}</span>}
      meta={meta}
      trailing={trailing}
    />
  )
}

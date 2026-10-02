import type { ReactNode } from 'react'
import { FinancialAvatar } from '@/components/ui/financial-avatar'
import { FinancialListRow, ROW_HISTORY_TITLE_TONE, ROW_HIGHLIGHT_CLASS } from '@/components/ui/financial-list-row'
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
  variant = 'drawer',
  actionDisabled = false,
  actionLoading = false,
  isHighlighted = false,
  highlightRef,
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
  /** Selects the shared page row geometry when used in a full-width page list. */
  variant?: 'drawer' | 'page'
  actionDisabled?: boolean
  actionLoading?: boolean
  isHighlighted?: boolean
  highlightRef?: (node: HTMLElement | null) => void
}) {
  return (
    <FinancialListRow
      ariaLabel={ariaLabel}
      variant={variant}
      ref={isHighlighted ? highlightRef : undefined}
      className={cn(isHighlighted && ROW_HIGHLIGHT_CLASS)}
      onView={onView}
      leadingAction={
        <FinancialAvatar
          icon={leadingIcon}
          disabled={actionDisabled}
          loading={actionLoading}
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

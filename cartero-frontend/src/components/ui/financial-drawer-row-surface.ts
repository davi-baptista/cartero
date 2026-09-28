import { cn } from '@/lib/utils'

/**
 * Shared visual classes for financial drawer rows.
 *
 * The list owns separators and list-level inset. This helper owns row geometry
 * and surface only; the animated wrapper variant keeps motion wrappers on the
 * same radius authority without adding DOM or changing their animation.
 */
const FINANCIAL_DRAWER_ROW_SURFACE_VARIANTS = {
  interactive: cn(
    'group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg',
    'px-0 py-3.5 text-left outline-none transition-colors hover:bg-muted/30',
    'focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-4 sm:px-2 sm:py-4',
  ),
  withLeadingAction: cn(
    'group flex w-full min-w-0 items-center gap-3 rounded-lg',
    'px-0 py-3.5 transition-colors hover:bg-muted/30 sm:gap-4 sm:px-2 sm:py-4',
  ),
  leadingActionTarget: cn(
    'flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg',
    'text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-4',
  ),
  animatedWrapper: 'rounded-lg',
} as const

export type FinancialDrawerRowSurfaceVariant =
  keyof typeof FINANCIAL_DRAWER_ROW_SURFACE_VARIANTS

export function financialDrawerRowSurfaceClass(
  variant: FinancialDrawerRowSurfaceVariant,
) {
  return FINANCIAL_DRAWER_ROW_SURFACE_VARIANTS[variant]
}

import { cn } from '@/lib/utils'

export const MOVEMENT_FILTER_CHIP_BASE =
  'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors'

export const MOVEMENT_SEARCH_INPUT_CLASS = 'h-8 pl-8 pr-8 text-sm'

export function movementFilterChipClass(active: boolean) {
  return cn(
    MOVEMENT_FILTER_CHIP_BASE,
    active
      ? 'border-transparent bg-primary/15 text-primary'
      : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
  )
}

import { cn } from '@/lib/utils'

const MOVEMENT_VIEW_LINK_BASE =
  'flex min-w-0 flex-1 items-center justify-center rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export function movementViewLinkClass(active: boolean) {
  return cn(
    MOVEMENT_VIEW_LINK_BASE,
    active
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground',
  )
}

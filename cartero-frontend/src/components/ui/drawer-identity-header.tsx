import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { DRAWER_WIDE_CONTENT_INSET } from '@/components/ui/drawer-layout'
import { cn } from '@/lib/utils'

/** Shared title, action, subtitle, and close control for financial drawers. */
export function DrawerIdentityHeader({
  title,
  description,
  action,
  inset = 'default',
}: {
  title: ReactNode
  description: ReactNode
  action?: ReactNode
  inset?: 'default' | 'wide'
}) {
  return (
    <SheetHeader className={cn('pb-0 pt-6', inset === 'wide' ? DRAWER_WIDE_CONTENT_INSET : 'px-6')}>
      <div className="flex min-w-0 items-start gap-3">
        <SheetTitle className="min-w-0 flex-1 break-words">{title}</SheetTitle>
        <div className="ml-auto flex shrink-0 items-start gap-1 sm:gap-2">
          {action}
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-10 shrink-0 p-0 sm:size-8"
                aria-label="Fechar drawer"
              />
            }
          >
            <X className="size-4" />
          </SheetClose>
        </div>
      </div>
      <SheetDescription>{description}</SheetDescription>
    </SheetHeader>
  )
}

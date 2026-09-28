import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

/** Shared title, action, subtitle, and close control for financial drawers. */
export function DrawerIdentityHeader({
  title,
  description,
  action,
}: {
  title: ReactNode
  description: ReactNode
  action?: ReactNode
}) {
  return (
    <SheetHeader className="px-6 pb-0 pt-6">
      <div className="flex min-w-0 items-start gap-3">
        <SheetTitle className="min-w-0 flex-1 break-words">{title}</SheetTitle>
        <div className="ml-auto flex shrink-0 items-start gap-2">
          {action}
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0 p-0"
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

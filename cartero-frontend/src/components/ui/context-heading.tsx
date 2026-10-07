'use client'

import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type ContextHeadingProps = {
  title: string
  description: string
  infoContent: string
  infoLabel: string
  level?: 1 | 2
  descriptionClassName?: string
  className?: string
}

export function ContextHeading({ title, description, infoContent, infoLabel, level = 2, descriptionClassName, className }: ContextHeadingProps) {
  const Heading = level === 1 ? 'h1' : 'h2'

  return (
    <div className={cn('min-w-0', className)}>
      <div className="inline-flex max-w-full items-center gap-0.5">
        <Heading className={cn('min-w-0 break-words', level === 1 ? 'text-2xl font-semibold tracking-tight' : 'text-sm font-medium')}>{title}</Heading>
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={infoLabel} />}>
            <Info className="size-4" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="max-w-xs text-sm">{infoContent}</PopoverContent>
        </Popover>
      </div>
      <p className={cn('mt-0.5 text-sm text-muted-foreground', descriptionClassName)}>{description}</p>
    </div>
  )
}

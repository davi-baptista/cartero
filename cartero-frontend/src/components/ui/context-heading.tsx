'use client'

import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type ContextHeadingProps = {
  title: string
  description: string
  infoContent: string
  infoLabel: string
}

export function ContextHeading({ title, description, infoContent, infoLabel }: ContextHeadingProps) {
  return (
    <div className="min-w-0">
      <div className="inline-flex max-w-full items-center gap-0.5">
        <h2 className="min-w-0 break-words text-sm font-medium">{title}</h2>
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={infoLabel} />}>
            <Info className="size-4" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="max-w-xs text-sm">{infoContent}</PopoverContent>
        </Popover>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

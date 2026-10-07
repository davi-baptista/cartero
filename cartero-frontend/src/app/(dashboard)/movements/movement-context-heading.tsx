import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type MovementContextHeadingProps = {
  title: string
  subtitle: string
  explanation: string
}

export function MovementContextHeading({ title, subtitle, explanation }: MovementContextHeadingProps) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0">
        <h2 className="whitespace-nowrap text-sm font-medium">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={`Sobre ${title.toLocaleLowerCase('pt-BR')}`} />}>
          <Info className="size-4" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="max-w-xs text-sm">{explanation}</PopoverContent>
      </Popover>
    </div>
  )
}

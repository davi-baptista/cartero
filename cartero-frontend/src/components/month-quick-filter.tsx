'use client'

import { cn } from '@/lib/utils'

type MonthRange = { startDate: string; endDate: string }

type MonthQuickFilterProps = {
  startDate?: string
  endDate?: string
  onChange: (range: MonthRange) => void
  className?: string
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function monthRange(offset: number): MonthRange {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return { startDate: dateValue(start), endDate: dateValue(end) }
}

const options = [
  { label: 'M\u00eas passado', offset: -1 },
  { label: 'M\u00eas atual', offset: 0 },
  { label: 'Pr\u00f3ximo m\u00eas', offset: 1 },
]

export function MonthQuickFilter({ startDate, endDate, onChange, className }: MonthQuickFilterProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} aria-label="Filtrar por m\u00eas">
      {options.map(({ label, offset }) => {
        const range = monthRange(offset)
        const selected = startDate === range.startDate && endDate === range.endDate
        return (
          <button
            key={label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(range)}
            className={cn(
              'min-h-8 rounded-full border px-3 text-xs font-medium transition-colors sm:text-sm',
              selected
                ? 'border-primary/30 bg-primary/15 text-primary'
                : 'border-border/70 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

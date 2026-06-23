'use client'

import { useState } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseDateOnly } from '@/lib/date'

const DAY_HEADERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

interface DatePickerProps {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DatePicker({ value, onChange, placeholder = 'Selecionar data', className, disabled }: DatePickerProps) {
  const selected = value ? parseDateOnly(value) : undefined
  const [viewDate, setViewDate] = useState<Date>(selected ?? new Date())
  const [open, setOpen] = useState(false)

  const monthStart = startOfMonth(viewDate)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calEnd = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  function handleSelect(day: Date) {
    onChange(format(day, 'yyyy-MM-dd'))
    setOpen(false)
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-full justify-start gap-2 font-normal',
          !value && 'text-muted-foreground',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <CalendarIcon className="size-4 shrink-0" />
        {selected
          ? format(selected, 'dd/MM/yyyy')
          : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setViewDate(subMonths(viewDate, 1))}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium capitalize">
            {format(viewDate, 'MMMM yyyy', { locale: ptBR })}
          </span>
          <button
            type="button"
            onClick={() => setViewDate(addMonths(viewDate, 1))}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map((d, i) => (
            <div key={i} className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-0.5">
          {days.map((day) => {
            const isSelected = selected ? isSameDay(day, selected) : false
            const inMonth = isSameMonth(day, viewDate)
            const isToday = isSameDay(day, new Date())

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => handleSelect(day)}
                className={cn(
                  'flex h-7 w-full items-center justify-center rounded-md text-sm transition-colors',
                  isSelected && 'bg-primary text-primary-foreground',
                  !isSelected && inMonth && 'hover:bg-muted',
                  !isSelected && isToday && inMonth && 'font-semibold text-foreground',
                  !inMonth && 'pointer-events-none opacity-25',
                )}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

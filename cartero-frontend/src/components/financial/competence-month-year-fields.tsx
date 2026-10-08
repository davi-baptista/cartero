'use client'

import { useCallback, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Props = {
  month: string
  year: string
  onMonthChange: (month: string) => void
  onYearChange: (year: string) => void
  monthAriaLabel: string
  yearAriaLabel: string
  disabled?: boolean
}

/** O mesmo controle de mês e ano usado em Renda desde. */
export function CompetenceMonthYearFields({ month, year, onMonthChange, onYearChange, monthAriaLabel, yearAriaLabel, disabled = false }: Props) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const setTrigger = useCallback((trigger: HTMLButtonElement | null) => {
    setPortalContainer(trigger?.closest<HTMLElement>('[data-slot="sheet-content"]') ?? null)
  }, [])
  return <div className="grid grid-cols-2 gap-2">
    <Select value={month} onValueChange={(value) => onMonthChange(value ?? '')} disabled={disabled}>
      <SelectTrigger ref={setTrigger} className="w-full min-w-0" aria-label={monthAriaLabel}>
        <SelectValue placeholder="Selecionar mês" />
      </SelectTrigger>
      <SelectContent portalContainer={portalContainer} alignItemWithTrigger={false} className="min-w-[10rem]">
        {Array.from({ length: 12 }, (_, index) => {
          const value = String(index + 1).padStart(2, '0')
          const rawLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, index, 1)))
          const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)
          return <SelectItem key={value} value={value}>{label}</SelectItem>
        })}
      </SelectContent>
    </Select>
    <Input aria-label={yearAriaLabel} type="number" min={1900} max={9999} placeholder="Ano" value={year} disabled={disabled} onChange={(event) => onYearChange(event.target.value.replace(/\D/g, '').slice(0, 4))} />
  </div>
}

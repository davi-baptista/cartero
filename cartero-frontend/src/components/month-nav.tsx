'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthYear } from '@/lib/formatters'
import { formatDateValue } from '@/lib/date'
import { cn } from '@/lib/utils'

export type MonthPeriod = { month: number; year: number }

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Primeiro e último dia do mês, no formato `YYYY-MM-DD`. */
export function monthBounds({ month, year }: MonthPeriod) {
  return {
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: formatDateValue(new Date(year, month, 0)),
  }
}

/** Mês/ano atuais — ponto de partida padrão das páginas com filtro por mês. */
export function currentPeriod(): MonthPeriod {
  const today = new Date()
  return { month: today.getMonth() + 1, year: today.getFullYear() }
}

/** Descobre a que mês pertence uma data `YYYY-MM-DD`. */
export function periodFromDate(value: string): MonthPeriod {
  const [year, month] = value.slice(0, 10).split('-').map(Number)
  return { month, year }
}

export function addMonths({ month, year }: MonthPeriod, delta: number): MonthPeriod {
  const date = new Date(year, month - 1 + delta, 1)
  return { month: date.getMonth() + 1, year: date.getFullYear() }
}

export function MonthNav({
  period,
  onChange,
  className,
  compact = false,
}: {
  period: MonthPeriod
  onChange: (next: MonthPeriod) => void
  className?: string
  /** Versão enxuta para a barra superior: botões e rótulo menores. */
  compact?: boolean
}) {
  const label = capitalize(formatMonthYear(period.month, period.year))
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <button
        type="button"
        onClick={() => onChange(addMonths(period, -1))}
        aria-label="Mês anterior"
        className={cn(
          'flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
          compact ? 'size-8' : 'size-10',
        )}
      >
        <ChevronLeft className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
      </button>
      <span
        className={cn(
          'select-none text-center font-medium',
          compact ? 'min-w-[6.5rem] text-[13px]' : 'min-w-[9.5rem] text-sm',
        )}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(addMonths(period, 1))}
        aria-label="Próximo mês"
        className={cn(
          'flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
          compact ? 'size-8' : 'size-10',
        )}
      >
        <ChevronRight className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
      </button>
    </div>
  )
}

// ─── Contexto global ──────────────────────────────────────────────────────────

/**
 * O mês selecionado é contexto do app, não de uma página: navegar entre
 * Orçamento, Extrato, Dívidas, A Receber e Pessoas preserva o período.
 */
const MonthPeriodContext = createContext<{
  period: MonthPeriod
  setPeriod: (next: MonthPeriod) => void
} | null>(null)

export function MonthPeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriod] = useState<MonthPeriod>(currentPeriod)
  const value = useMemo(() => ({ period, setPeriod }), [period])
  return <MonthPeriodContext value={value}>{children}</MonthPeriodContext>
}

export function useMonthPeriod() {
  const ctx = useContext(MonthPeriodContext)
  if (!ctx) throw new Error('useMonthPeriod precisa estar dentro de MonthPeriodProvider')
  return ctx
}

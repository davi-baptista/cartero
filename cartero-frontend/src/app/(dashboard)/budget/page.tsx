'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, CircleAlert, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { getBudgetV2 } from '@/services/budget.service'
import { BudgetV2PeriodPreset, type BudgetV2Response } from '@/types/budget-v2'
import { formatCurrency } from '@/lib/formatters'
import { cn } from '@/lib/utils'

const PERIOD_OPTIONS = [
  { value: BudgetV2PeriodPreset.LAST_30_DAYS, label: 'Últimos 30 dias' },
  { value: BudgetV2PeriodPreset.THIS_MONTH, label: 'Este mês' },
  { value: BudgetV2PeriodPreset.LAST_MONTH, label: 'Mês passado' },
  { value: BudgetV2PeriodPreset.ALL_TIME, label: 'Todo o histórico' },
] as const

const REALIZED_INFLOW_ROWS = [
  ['manualIncome', 'Receitas registradas'],
  ['receivableReceipts', 'Recebimentos'],
  ['personSettlementInflows', 'Acertos recebidos'],
] as const

const REALIZED_OUTFLOW_ROWS = [
  ['manualDirectTransactions', 'Gastos diretos'],
  ['debtDirectSettlements', 'Dívidas quitadas'],
  ['invoiceSettlements', 'Faturas pagas'],
  ['personSettlementDirectOutflows', 'Acertos pagos'],
] as const

function formatBudgetMoney(value: string) {
  // Conversão exclusivamente para apresentação; nenhum valor é recalculado.
  return formatCurrency(Number(value))
}

function isZero(value: string) {
  return Number(value) === 0
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative'
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-2 truncate text-[22px] font-semibold tabular-nums tracking-[-0.02em]',
            tone === 'positive' && 'text-receivable',
            tone === 'negative' && 'text-destructive',
          )}
        >
          {formatBudgetMoney(value)}
        </p>
      </CardContent>
    </Card>
  )
}

function DetailRows({
  rows,
  empty,
}: {
  rows: readonly (readonly [string, string])[]
  empty: string
}) {
  return rows.length > 0 ? (
    <div className="divide-y divide-border/60 rounded-lg border border-border/70">
      {rows.map(([value, label]) => (
        <div className="flex items-center justify-between gap-4 px-3 py-2.5" key={label}>
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="shrink-0 text-sm font-medium tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  ) : (
    <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
      {empty}
    </p>
  )
}

function CompositionDisclosure({ budget }: { budget: BudgetV2Response }) {
  const [open, setOpen] = useState(false)
  const realized = budget.composition.realized
  const realizedInflowRows = REALIZED_INFLOW_ROWS.filter(([key]) => !isZero(realized[key]))
    .map(([key, label]) => [formatBudgetMoney(realized[key]), label] as const)
  const realizedOutflowRows = REALIZED_OUTFLOW_ROWS.filter(([key]) => !isZero(realized[key]))
    .map(([key, label]) => [formatBudgetMoney(realized[key]), label] as const)

  return (
    <div className="mt-4 border-t border-border/70 pt-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        Ver composição
        <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>
      {open && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.01em] text-muted-foreground">Entradas</h3>
            <DetailRows rows={realizedInflowRows} empty="Nenhuma entrada registrada no período." />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.01em] text-muted-foreground">Saídas</h3>
            <DetailRows rows={realizedOutflowRows} empty="Nenhuma saída registrada no período." />
          </div>
        </div>
      )}
    </div>
  )
}

function OpenComposition({ budget }: { budget: BudgetV2Response }) {
  const [open, setOpen] = useState(false)
  const values = budget.composition.open
  const rows = [
    ['receivables', 'Recebíveis', values.receivables],
    ['invoices', 'Faturas', values.invoices],
    ['debts', 'Dívidas', values.debts],
  ] as const

  return (
    <div className="mt-4 border-t border-border/70 pt-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        Ver composição
        <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>
      {open && (
        <div className="mt-3 divide-y divide-border/60 rounded-lg border border-border/70">
          {rows.map(([key, label, value]) => (
            <div className="flex items-center justify-between gap-4 px-3 py-2.5" key={key}>
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="shrink-0 text-sm font-medium tabular-nums">{formatBudgetMoney(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-8" aria-label="Carregando orçamento" role="status">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <section className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton className="h-24 rounded-xl" key={index} />)}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  )
}

function OpenRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative'
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn(
        'shrink-0 text-sm font-medium tabular-nums',
        tone === 'positive' && 'text-receivable',
        tone === 'negative' && 'text-destructive',
      )}>
        {formatBudgetMoney(value)}
      </span>
    </div>
  )
}

function PeriodSelector({
  value,
  onChange,
}: {
  value: BudgetV2PeriodPreset
  onChange: (value: BudgetV2PeriodPreset) => void
}) {
  const selected = PERIOD_OPTIONS.find((option) => option.value === value) ?? PERIOD_OPTIONS[0]
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="budget-period">Período da movimentação</label>
      <Select value={value} onValueChange={(next) => next && onChange(next as BudgetV2PeriodPreset)}>
        <SelectTrigger id="budget-period" size="sm" aria-label="Período da movimentação" className="w-full sm:w-44">
          <SelectValue>{selected.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function BudgetContent({
  budget,
  preset,
  onPresetChange,
}: {
  budget: BudgetV2Response
  preset: BudgetV2PeriodPreset
  onPresetChange: (value: BudgetV2PeriodPreset) => void
}) {
  const balanceTone = budget.realized.balance.startsWith('-')
    ? 'negative'
    : isZero(budget.realized.balance) ? 'neutral' : 'positive'
  const hasOverdue = !isZero(budget.open.overdue.inflow) || !isZero(budget.open.overdue.outflow)

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Orçamento</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">Uma visão do que entrou, saiu e ainda está pendente no Cartero.</p>
      </header>

      <section aria-labelledby="movement-title" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold" id="movement-title">Movimentação</h2>
            <p className="mt-1 text-sm text-muted-foreground">Valores registrados no período.</p>
          </div>
          <PeriodSelector value={preset} onChange={onPresetChange} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Entradas registradas" value={budget.realized.inflow} tone="positive" />
          <SummaryCard label="Saídas registradas" value={budget.realized.outflow} tone="negative" />
          <SummaryCard label="Balanço registrado" value={budget.realized.balance} tone={balanceTone} />
        </div>
        <CompositionDisclosure budget={budget} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="open-title">
          <Card className="h-full">
            <CardHeader className="px-4 pb-1 sm:px-5">
              <CardTitle className="text-base" id="open-title">Em aberto</CardTitle>
              <p className="text-sm text-muted-foreground">Pendências atuais.</p>
            </CardHeader>
            <CardContent className="p-4 pt-3 sm:p-5 sm:pt-3">
              <div className="divide-y divide-border/60 rounded-lg border border-border/70">
                <OpenRow label="A receber" value={budget.open.inflow} tone="positive" />
                <OpenRow label="A pagar" value={budget.open.outflow} tone="negative" />
                <OpenRow label="Diferença em aberto" value={budget.open.net} />
              </div>
              <OpenComposition budget={budget} />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="overdue-title">
          <Card className={cn('h-full', hasOverdue && 'ring-destructive/30')}>
            <CardHeader className="px-4 pb-1 sm:px-5">
              <CardTitle className="flex items-center gap-2 text-base" id="overdue-title">
                Vencidos
                {hasOverdue && <CircleAlert className="size-4 text-destructive" aria-label="Há valores vencidos" />}
              </CardTitle>
              <p className="text-sm text-muted-foreground">Parte das pendências atuais.</p>
            </CardHeader>
            <CardContent className="p-4 pt-3 sm:p-5 sm:pt-3">
              {!hasOverdue ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">Nenhum valor vencido.</p>
              ) : (
                <div className="divide-y divide-border/60 rounded-lg border border-border/70">
                  <OpenRow label="A receber vencido" value={budget.open.overdue.inflow} tone="positive" />
                  <OpenRow label="A pagar vencido" value={budget.open.overdue.outflow} tone="negative" />
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

export default function BudgetPage() {
  const [preset, setPreset] = useState(BudgetV2PeriodPreset.LAST_30_DAYS)
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['budget-v2', preset],
    queryFn: () => getBudgetV2(preset),
    placeholderData: keepPreviousData,
  })

  if (isLoading && !data) return <LoadingState />
  if (isError && !data) {
    return <QueryError message="Não foi possível carregar o orçamento." isFetching={isFetching} onRetry={() => void refetch()} />
  }
  if (!data) return null

  return <BudgetContent budget={data} preset={preset} onPresetChange={setPreset} />
}

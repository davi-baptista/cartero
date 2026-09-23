'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { QueryError } from '@/components/ui/query-error'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { getBudgetV2 } from '@/services/budget.service'
import { BudgetV2PeriodPreset, type BudgetV2Response } from '@/types/budget-v2'

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
  secondary,
  tone = 'neutral',
}: {
  label: string
  value: string
  secondary: string
  tone?: 'neutral' | 'positive' | 'negative'
}) {
  return (
    <div className="flex min-w-0 flex-col items-center pb-3">
        <p className="text-center text-xs font-medium text-muted-foreground">{label}</p>
         <p
           className={cn(
             'mt-1.5 truncate text-center text-[22px] font-semibold tabular-nums tracking-[-0.02em]',
            tone === 'positive' && 'text-receivable',
            tone === 'negative' && 'text-destructive',
          )}
        >
          {formatBudgetMoney(value)}
        </p>
         <p className="mt-1 text-center text-xs text-muted-foreground">{secondary}</p>
         <div className="mt-2 w-[72%] rounded-full border-b-[4px] border-muted-foreground/40 sm:w-[58%]" aria-hidden="true" />
    </div>
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

function CompositionGroup({
  label,
  rows,
  empty,
}: {
  label: string
  rows: readonly (readonly [string, string])[]
  empty: string
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-[0.01em] text-muted-foreground">{label}</h3>
      <DetailRows rows={rows} empty={empty} />
    </div>
  )
}

function CompositionColumn({
  title,
  registeredRows,
  openRows,
  registeredEmpty,
}: {
  title: string
  registeredRows: readonly (readonly [string, string])[]
  openRows: readonly (readonly [string, string])[]
  registeredEmpty: string
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <CompositionGroup
        label="REGISTRADO NO PERÍODO"
        rows={registeredRows}
        empty={registeredEmpty}
      />
      <CompositionGroup label="EM ABERTO" rows={openRows} empty="Nenhum valor em aberto." />
    </div>
  )
}

function Composition({ budget }: { budget: BudgetV2Response }) {
  const realized = budget.composition.realized
  const open = budget.composition.open
  const realizedInflowRows = REALIZED_INFLOW_ROWS.filter(([key]) => !isZero(realized[key]))
    .map(([key, label]) => [formatBudgetMoney(realized[key]), label] as const)
  const realizedOutflowRows = REALIZED_OUTFLOW_ROWS.filter(([key]) => !isZero(realized[key]))
    .map(([key, label]) => [formatBudgetMoney(realized[key]), label] as const)

  return (
    <section aria-labelledby="composition-title" className="space-y-3">
      <div>
        <h2 className="text-base font-semibold" id="composition-title">Composição</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CompositionColumn
          title="Entradas"
          registeredRows={realizedInflowRows}
          openRows={isZero(open.receivables) ? [] : [[formatBudgetMoney(open.receivables), 'Recebíveis']]}
          registeredEmpty="Nenhuma entrada registrada no período."
        />
        <CompositionColumn
          title="Saídas"
          registeredRows={realizedOutflowRows}
          openRows={[
            ...(!isZero(open.invoices) ? [[formatBudgetMoney(open.invoices), 'Faturas'] as const] : []),
            ...(!isZero(open.debts) ? [[formatBudgetMoney(open.debts), 'Dívidas'] as const] : []),
          ]}
          registeredEmpty="Nenhuma saída registrada no período."
        />
      </div>
    </section>
  )
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-label="Carregando orçamento" role="status">
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
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
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
      <SelectTrigger id="budget-period" size="sm" aria-label="Período da movimentação" className="w-auto min-w-40 shrink-0">
          <SelectValue>{selected.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function Overdue({ budget }: { budget: BudgetV2Response }) {
  const hasOverdue = !isZero(budget.open.overdue.inflow) || !isZero(budget.open.overdue.outflow)
  const rows = [
    [budget.open.overdue.inflow, 'A receber vencido'],
    [budget.open.overdue.outflow, 'A pagar vencido'],
  ] as const

  return (
    <section aria-labelledby="overdue-title" className={cn('space-y-3 sm:w-1/2', hasOverdue && 'border-l-2 border-destructive/40 pl-3')}>
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold" id="overdue-title">
          Vencidos
          {hasOverdue && <CircleAlert className="size-4 text-destructive" aria-hidden="true" />}
        </h2>
      </div>
      {hasOverdue ? (
        <DetailRows
          rows={rows.filter(([value]) => !isZero(value)).map(([value, label]) => [formatBudgetMoney(value), label] as const)}
          empty="Nenhum valor vencido."
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          Nenhum valor vencido.
        </p>
      )}
    </section>
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

  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Orçamento</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">Uma visão do que entrou, saiu e ainda está pendente no Cartero.</p>
      </header>

      <section aria-labelledby="movement-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" id="movement-title">Movimentação</h2>
          </div>
          <PeriodSelector value={preset} onChange={onPresetChange} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="Entradas registradas"
            value={budget.realized.inflow}
            secondary={`+ ${formatBudgetMoney(budget.open.inflow)} em aberto`}
            tone="positive"
          />
          <SummaryCard
            label="Saídas registradas"
            value={budget.realized.outflow}
            secondary={`+ ${formatBudgetMoney(budget.open.outflow)} em aberto`}
            tone="negative"
          />
          <SummaryCard
            label="Balanço registrado"
            value={budget.realized.balance}
            secondary={`Resultado em aberto: ${formatBudgetMoney(budget.open.net)}`}
            tone={balanceTone}
          />
        </div>
      </section>

      <div className="hidden border-t border-border/60 sm:block" aria-hidden="true" />
      <Composition budget={budget} />
      <Overdue budget={budget} />
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

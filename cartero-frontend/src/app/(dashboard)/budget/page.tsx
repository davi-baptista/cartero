'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { BudgetDrilldownDrawer } from '@/components/budget-drilldown-drawer'
import { QueryError } from '@/components/ui/query-error'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { getBudgetV2 } from '@/services/budget.service'
import { BudgetV2PeriodPreset, type BudgetV2Response } from '@/types/budget-v2'
import { BudgetV2DrilldownBucket } from '@/types/budget-v2-drilldown'

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

const BUCKET_BY_ROW_KEY: Record<string, BudgetV2DrilldownBucket> = {
  manualIncome: BudgetV2DrilldownBucket.MANUAL_INCOME,
  receivableReceipts: BudgetV2DrilldownBucket.RECEIVABLE_RECEIPTS,
  personSettlementInflows: BudgetV2DrilldownBucket.PERSON_SETTLEMENT_INFLOW,
  manualDirectTransactions: BudgetV2DrilldownBucket.DIRECT_EXPENSES,
  debtDirectSettlements: BudgetV2DrilldownBucket.DEBT_DIRECT_SETTLEMENTS,
  invoiceSettlements: BudgetV2DrilldownBucket.INVOICE_SETTLEMENTS,
  personSettlementDirectOutflows: BudgetV2DrilldownBucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW,
}

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
  className,
}: {
  label: string
  value: string
  secondary: string
  tone?: 'neutral' | 'positive' | 'negative'
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center pb-3', className)}>
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
    </div>
  )
}

function DetailRows({
  rows,
  empty,
  onRowClick,
}: {
  rows: readonly (readonly [string, string, BudgetV2DrilldownBucket])[]
  empty: string
  onRowClick: (bucket: BudgetV2DrilldownBucket) => void
}) {
  return rows.length > 0 ? (
    <div className="divide-y divide-border/60 rounded-lg border border-border/70">
      {rows.map(([value, label, bucket]) => (
        <button
          className="group flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50"
          key={label}
          onClick={() => onRowClick(bucket)}
          type="button"
        >
          <span className="text-sm text-muted-foreground group-hover:text-foreground">{label}</span>
          <span className="shrink-0 text-sm font-medium tabular-nums">{value}</span>
        </button>
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
  onRowClick,
}: {
  label: string
  rows: readonly (readonly [string, string, BudgetV2DrilldownBucket])[]
  empty: string
  onRowClick: (bucket: BudgetV2DrilldownBucket) => void
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-[0.01em] text-muted-foreground">{label}</h3>
      <DetailRows rows={rows} empty={empty} onRowClick={onRowClick} />
    </div>
  )
}

function CompositionColumn({
  title,
  registeredRows,
  openRows,
  registeredEmpty,
  onRowClick,
}: {
  title: string
  registeredRows: readonly (readonly [string, string, BudgetV2DrilldownBucket])[]
  openRows: readonly (readonly [string, string, BudgetV2DrilldownBucket])[]
  registeredEmpty: string
  onRowClick: (bucket: BudgetV2DrilldownBucket) => void
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <CompositionGroup
        label="REGISTRADO NO PERÍODO"
        rows={registeredRows}
        empty={registeredEmpty}
        onRowClick={onRowClick}
      />
      <CompositionGroup label="A VENCER · PRÓXIMOS 30 DIAS" rows={openRows} empty="Nenhum valor a vencer." onRowClick={onRowClick} />
    </div>
  )
}

function Composition({
  budget,
  onRowClick,
}: {
  budget: BudgetV2Response
  onRowClick: (bucket: BudgetV2DrilldownBucket) => void
}) {
  const realized = budget.composition.realized
  const upcoming = budget.composition.upcoming
  const realizedInflowRows = REALIZED_INFLOW_ROWS.filter(([key]) => !isZero(realized[key]))
    .map(([key, label]) => [formatBudgetMoney(realized[key]), label, BUCKET_BY_ROW_KEY[key]] as const)
  const realizedOutflowRows = REALIZED_OUTFLOW_ROWS.filter(([key]) => !isZero(realized[key]))
    .map(([key, label]) => [formatBudgetMoney(realized[key]), label, BUCKET_BY_ROW_KEY[key]] as const)

  return (
    <section aria-labelledby="composition-title" className="space-y-3">
      <div>
        <h2 className="text-base font-semibold" id="composition-title">Composição</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CompositionColumn
          title="Entradas"
          registeredRows={realizedInflowRows}
          openRows={isZero(upcoming.receivables)
            ? []
            : [[formatBudgetMoney(upcoming.receivables), 'Recebíveis', BudgetV2DrilldownBucket.UPCOMING_RECEIVABLES]]}
          registeredEmpty="Nenhuma entrada registrada no período."
          onRowClick={onRowClick}
        />
        <CompositionColumn
          title="Saídas"
          registeredRows={realizedOutflowRows}
          openRows={[
            ...(!isZero(upcoming.invoices)
              ? [[formatBudgetMoney(upcoming.invoices), 'Faturas', BudgetV2DrilldownBucket.UPCOMING_INVOICES] as const]
              : []),
            ...(!isZero(upcoming.debts)
              ? [[formatBudgetMoney(upcoming.debts), 'Dívidas', BudgetV2DrilldownBucket.UPCOMING_DEBTS] as const]
              : []),
          ]}
          registeredEmpty="Nenhuma saída registrada no período."
          onRowClick={onRowClick}
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
      <SelectTrigger id="budget-period" size="default" aria-label="Período da movimentação" className="h-10 w-auto min-w-40 shrink-0 px-3">
          <SelectValue>{selected.label}</SelectValue>
        </SelectTrigger>
        <SelectContent side="bottom" align="end" sideOffset={4} alignItemWithTrigger={false} className="min-w-40 p-1">
          {PERIOD_OPTIONS.map((option) => <SelectItem className="min-h-8 px-2 py-1.5" key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function Overdue({
  budget,
  onRowClick,
}: {
  budget: BudgetV2Response
  onRowClick: (bucket: BudgetV2DrilldownBucket) => void
}) {
  const hasOverdue = !isZero(budget.pending.overdue.inflow) || !isZero(budget.pending.overdue.outflow)
  const rows = [
    [budget.pending.overdue.inflow, 'A receber vencido', BudgetV2DrilldownBucket.OVERDUE_RECEIVABLES],
    [budget.pending.overdue.outflow, 'A pagar vencido', BudgetV2DrilldownBucket.OVERDUE_OUTFLOWS],
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
          rows={rows.filter(([value]) => !isZero(value)).map(([value, label, bucket]) => [formatBudgetMoney(value), label, bucket] as const)}
          empty="Nenhum valor vencido."
          onRowClick={onRowClick}
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
  onRowClick,
}: {
  budget: BudgetV2Response
  preset: BudgetV2PeriodPreset
  onPresetChange: (value: BudgetV2PeriodPreset) => void
  onRowClick: (bucket: BudgetV2DrilldownBucket) => void
}) {
  const balanceTone = budget.realized.balance.startsWith('-')
    ? 'negative'
    : isZero(budget.realized.balance) ? 'neutral' : 'positive'

  return (
    <div className="space-y-5 sm:space-y-7">
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
        <div className="relative grid grid-cols-1 gap-x-3 gap-y-4 pt-2 min-[375px]:grid-cols-2 sm:grid-cols-3 sm:gap-3 sm:pt-3">
          <SummaryCard
            label="Entradas registradas"
            value={budget.realized.inflow}
            secondary={`+ ${formatBudgetMoney(budget.pending.inflow)} pendentes`}
            tone="positive"
          />
          <SummaryCard
            label="Saídas registradas"
            value={budget.realized.outflow}
            secondary={`+ ${formatBudgetMoney(budget.pending.outflow)} pendentes`}
            tone="negative"
          />
          <SummaryCard
            label="Balanço registrado"
            value={budget.realized.balance}
            secondary={`Resultado após pendências: ${formatBudgetMoney(budget.resultAfterPending)}`}
            tone={balanceTone}
            className="min-[375px]:col-span-2 sm:col-span-1"
          />
          <span
            className="pointer-events-none absolute left-1/2 top-8 hidden -translate-x-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground min-[375px]:block sm:hidden"
            aria-hidden="true"
          >
            −
          </span>
          <span
            className="pointer-events-none absolute left-1/2 top-[calc(50%-0.5rem)] hidden -translate-x-1/2 -translate-y-1/2 text-base font-medium text-muted-foreground min-[375px]:block sm:hidden mt-1"
            aria-hidden="true"
          >
            =
          </span>
          <span
            className="pointer-events-none absolute left-1/3 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground sm:block sm:text-base"
            aria-hidden="true"
          >
            −
          </span>
          <span
            className="pointer-events-none absolute left-2/3 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground sm:block sm:text-base"
            aria-hidden="true"
          >
            =
          </span>
        </div>
      </section>

      <div className="border-t border-border/60" aria-hidden="true" />
      <Composition budget={budget} onRowClick={onRowClick} />
      <Overdue budget={budget} onRowClick={onRowClick} />
    </div>
  )
}

export default function BudgetPage() {
  const [preset, setPreset] = useState(BudgetV2PeriodPreset.LAST_30_DAYS)
  const [drilldownBucket, setDrilldownBucket] = useState<BudgetV2DrilldownBucket | null>(null)
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

  return (
    <>
      <BudgetContent
        budget={data}
        preset={preset}
        onPresetChange={(nextPreset) => {
          setDrilldownBucket(null)
          setPreset(nextPreset)
        }}
        onRowClick={setDrilldownBucket}
      />
      <BudgetDrilldownDrawer
        bucket={drilldownBucket}
        preset={preset}
        open={drilldownBucket !== null}
        onClose={() => setDrilldownBucket(null)}
      />
    </>
  )
}

import { BudgetV2DrilldownBucket } from '@/types/budget-v2-drilldown'
import { BudgetV2PeriodPreset } from '@/types/budget-v2'

export const PERIOD_LABELS: Record<BudgetV2PeriodPreset, string> = {
  [BudgetV2PeriodPreset.LAST_30_DAYS]: 'Últimos 30 dias',
  [BudgetV2PeriodPreset.THIS_MONTH]: 'Este mês',
  [BudgetV2PeriodPreset.LAST_MONTH]: 'Mês passado',
  [BudgetV2PeriodPreset.ALL_TIME]: 'Todo o histórico',
}

export const DRILLDOWN_BUCKET_CONFIG: Record<
  BudgetV2DrilldownBucket,
  { title: string; scope: 'period' | 'upcoming' | 'overdue' }
> = {
  [BudgetV2DrilldownBucket.MANUAL_INCOME]: { title: 'Receitas registradas', scope: 'period' },
  [BudgetV2DrilldownBucket.RECEIVABLE_RECEIPTS]: { title: 'Recebimentos', scope: 'period' },
  [BudgetV2DrilldownBucket.PERSON_SETTLEMENT_INFLOW]: { title: 'Acertos recebidos', scope: 'period' },
  [BudgetV2DrilldownBucket.DIRECT_EXPENSES]: { title: 'Gastos diretos', scope: 'period' },
  [BudgetV2DrilldownBucket.DEBT_DIRECT_SETTLEMENTS]: { title: 'Dívidas quitadas', scope: 'period' },
  [BudgetV2DrilldownBucket.INVOICE_SETTLEMENTS]: { title: 'Faturas pagas', scope: 'period' },
  [BudgetV2DrilldownBucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW]: { title: 'Acertos pagos', scope: 'period' },
  [BudgetV2DrilldownBucket.UPCOMING_RECEIVABLES]: { title: 'Recebíveis', scope: 'upcoming' },
  [BudgetV2DrilldownBucket.UPCOMING_INVOICES]: { title: 'Faturas', scope: 'upcoming' },
  [BudgetV2DrilldownBucket.UPCOMING_DEBTS]: { title: 'Dívidas', scope: 'upcoming' },
  [BudgetV2DrilldownBucket.OVERDUE_RECEIVABLES]: { title: 'A receber vencido', scope: 'overdue' },
  [BudgetV2DrilldownBucket.OVERDUE_OUTFLOWS]: { title: 'A pagar vencido', scope: 'overdue' },
}

export function drilldownContextLabel(
  bucket: BudgetV2DrilldownBucket,
  preset: BudgetV2PeriodPreset,
): string {
  const scope = DRILLDOWN_BUCKET_CONFIG[bucket].scope
  if (scope === 'period') return PERIOD_LABELS[preset]
  if (scope === 'upcoming') return 'Próximos 30 dias'
  return 'Vencidos'
}

export function isRealizedDrilldownBucket(bucket: BudgetV2DrilldownBucket): boolean {
  return DRILLDOWN_BUCKET_CONFIG[bucket].scope === 'period'
}

export function transactionFallback(bucket: BudgetV2DrilldownBucket): string {
  return bucket === BudgetV2DrilldownBucket.MANUAL_INCOME ? 'Receita' : 'Gasto'
}

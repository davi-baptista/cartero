import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BudgetV2PeriodPreset } from '@/types/budget-v2'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../app/(dashboard)/budget/page.tsx')
const service = read('../services/budget.service.ts')
const types = read('../types/budget-v2.ts')
const layout = read('../app/(dashboard)/layout.tsx')

describe('Budget V2 contract and movement', () => {
  it('uses the typed V2 endpoint and keeps the complete core shape', () => {
    expect(service).toContain("api.get<BudgetV2Response>('/budget/v2'")
    expect(page).toContain('getBudgetV2(preset)')
    expect(page).toContain("queryKey: ['budget-v2', preset]")
    expect(types).toContain('period: BudgetV2Period')
    expect(types).toContain('realized: BudgetV2Realized')
    expect(types).toContain('pending: BudgetV2Pending')
    expect(types).toContain('resultAfterPending: string')
    expect(types).toContain('composition:')
    expect(types).not.toContain('future')
    expect(types).not.toContain('estimatedBalance')
    expect(types).not.toContain('bankBalance')
  })

  it('keeps the period selector inside Movement and the three realized authorities', () => {
    expect(page).toContain('Movimentação')
    expect(page).toContain('Período da movimentação')
    expect(page).toContain('PeriodSelector value={preset}')
    expect(page).not.toContain('Valores registrados no perÃ­odo.')
    expect(page).toContain('Uma visão do que entrou, saiu e ainda está pendente no Cartero.')
    for (const label of ['Entradas registradas', 'Saídas registradas', 'Balanço registrado']) {
      expect(page).toContain(label)
    }
    for (const field of ['budget.realized.inflow', 'budget.realized.outflow', 'budget.realized.balance']) {
      expect(page).toContain(field)
    }
    expect(page).toContain('flex flex-wrap items-center justify-between gap-3')
    expect(page).toContain('size="default"')
    expect(page).toContain('h-10 w-auto min-w-40 shrink-0 px-3')
    expect(page).toContain('side="bottom" align="end" sideOffset={4} alignItemWithTrigger={false}')
    expect(page).toContain('className="min-w-40 p-1"')
    expect(page).toContain('className="min-h-8 px-2 py-1.5"')
    expect(page).not.toContain('w-full sm:w-44')
    expect(page).not.toContain('w-[72%]')
    expect(page).not.toContain('border-b-[4px]')
    expect(page).toContain('flex min-w-0 flex-col items-center')
    expect(page).not.toContain('<Card')
    for (const preset of Object.values(BudgetV2PeriodPreset)) expect(page).toContain(preset)
    expect(layout).not.toContain("  '/budget',")
  })

  it('uses the compact 2-plus-1 metric grid with a narrow-screen fallback', () => {
    expect(page).toContain('relative grid grid-cols-1 gap-x-3 gap-y-4 pt-2 min-[375px]:grid-cols-2 sm:grid-cols-3 sm:gap-3 sm:pt-3')
    expect(page).toContain('min-[375px]:col-span-2 sm:col-span-1')
    expect(page).toContain('className="space-y-3"')
    expect(page).toContain('className="space-y-5 sm:space-y-7"')
  })

  it('shows pending values as secondary information without client financial arithmetic', () => {
    expect(page).toContain('budget.pending.inflow')
    expect(page).toContain('budget.pending.outflow')
    expect(page).toContain('budget.resultAfterPending')
    expect(page).toContain('pendentes')
    expect(page).toContain('Resultado após pendências')
    expect(page).toContain('aria-hidden="true"')
    expect(page).toContain('sm:text-base')
    expect(page).toContain('left-[calc(50%-4rem)]')
    expect(page).toContain('−')
    expect(page).toContain('=')
    expect(page).not.toContain('Diferença em aberto')
    expect(page).not.toContain('budget.realized.inflow +')
    expect(page).not.toContain('budget.realized.outflow +')
    expect(page).not.toContain('budget.realized.balance +')
    expect(page).not.toContain('budget.pending.inflow -')
  })
})

describe('Budget V2 unified composition', () => {
  it('is always visible and has no disclosure or eye toggle', () => {
    expect(page).toContain('<Composition budget={budget} />')
    expect(page).toContain('aria-labelledby="composition-title"')
    expect(page).not.toContain('Registrado no perÃ­odo e valores ainda em aberto.')
    expect(page).not.toContain('Ver composição')
    expect(page).not.toContain('aria-expanded')
    expect(page).not.toContain('EyeOff')
    expect(page).not.toContain('ChevronDown')
  })

  it('separates Movement from Composition on every viewport', () => {
    expect(page).toContain('border-t border-border/60')
    expect(page).not.toContain('hidden border-t border-border/60 sm:block')
    expect(page).toContain('<Composition budget={budget} />')
  })

  it('separates registered and upcoming groups in both columns', () => {
    expect(page).toContain('REGISTRADO NO PERÍODO')
    expect(page).toContain('A VENCER · PRÓXIMOS 30 DIAS')
    for (const field of [
      'manualIncome',
      'receivableReceipts',
      'personSettlementInflows',
      'manualDirectTransactions',
      'debtDirectSettlements',
      'invoiceSettlements',
      'personSettlementDirectOutflows',
      'budget.composition.upcoming',
    ]) {
      expect(page).toContain(field)
    }
  })

  it('keeps zero detail rows out and provides concise subgroup empty states', () => {
    expect(page).toContain('filter(([key]) => !isZero(realized[key]))')
    expect(page).toContain('Nenhuma entrada registrada no período.')
    expect(page).toContain('Nenhuma saída registrada no período.')
    expect(page).toContain('Nenhum valor a vencer.')
    expect(page).toContain('formatBudgetMoney(value)')
  })
})

describe('Budget V2 overdue block and state UX', () => {
  it('renders overdue as a full-width block using only the backend overdue fields', () => {
    expect(page).toContain('<Overdue budget={budget} />')
    expect(page).toContain('sm:w-1/2')
    expect(page).toContain('CircleAlert')
    expect(page).toContain('aria-hidden="true"')
    expect(page).toContain('budget.pending.overdue.inflow')
    expect(page).toContain('budget.pending.overdue.outflow')
    expect(page).toContain('A receber vencido')
    expect(page).toContain('A pagar vencido')
    expect(page).not.toContain('Parte dos valores em aberto.')
    expect(page).toContain('Nenhum valor vencido.')
  })

  it('keeps loading, retryable error and forbidden V1 concepts out of the page', () => {
    expect(page).toContain('<LoadingState />')
    expect(page).toContain('<QueryError')
    expect(page).toContain('onRetry={() => void refetch()}')
    expect(page).toContain('placeholderData: keepPreviousData')
    for (const forbidden of [
      'Salário',
      'salary',
      'remaining',
      'committedPct',
      'Saldo bancário',
      'Saldo disponível',
      'Saldo estimado',
      'transaction timeline',
      'peopleSettlements',
      'InvoiceDetailsDrawer',
      'PersonStatementDrawer',
    ]) {
      expect(page).not.toContain(forbidden)
    }
  })
})

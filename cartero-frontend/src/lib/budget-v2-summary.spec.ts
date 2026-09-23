import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BudgetV2PeriodPreset } from '@/types/budget-v2'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../app/(dashboard)/budget/page.tsx')
const service = read('../services/budget.service.ts')
const types = read('../types/budget-v2.ts')
const layout = read('../app/(dashboard)/layout.tsx')

describe('Budget V2 summary contract', () => {
  it('uses the typed V2 endpoint and keeps the complete core shape', () => {
    expect(service).toContain("api.get<BudgetV2Response>('/budget/v2'")
    expect(page).toContain('getBudgetV2(preset)')
    expect(page).toContain("queryKey: ['budget-v2', preset]")
    expect(types).toContain('period: BudgetV2Period')
    expect(types).toContain('realized: BudgetV2Realized')
    expect(types).toContain('open: BudgetV2Open')
    expect(types).toContain('composition:')
    expect(types).not.toContain('future')
    expect(types).not.toContain('estimatedBalance')
    expect(types).not.toContain('bankBalance')
  })

  it('keeps money serialized as strings in the frontend contract', () => {
    expect(types).toContain('inflow: string')
    expect(types).toContain('outflow: string')
    expect(types).toContain('balance: string')
    expect(types).toContain('net: string')
    expect(page).not.toContain('budget.realized.inflow +')
    expect(page).not.toContain('budget.open.inflow -')
    expect(page).not.toContain('estimatedBalance')
  })
})

describe('Budget V2 summary composition', () => {
  it('renders the three movement cards with exact labels and server fields', () => {
    for (const label of ['Entradas registradas', 'Saídas registradas', 'Balanço registrado']) {
      expect(page).toContain(label)
    }
    expect(page).toContain('budget.realized.inflow')
    expect(page).toContain('budget.realized.outflow')
    expect(page).toContain('budget.realized.balance')
    expect(page).toContain('Valores registrados no período.')
  })

  it('starts both composition disclosures collapsed and maps every canonical label', () => {
    expect(page.match(/useState\(false\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(page).toContain('aria-expanded={open}')
    for (const label of [
      'Receitas registradas',
      'Recebimentos',
      'Acertos recebidos',
      'Gastos diretos',
      'Dívidas quitadas',
      'Faturas pagas',
      'Acertos pagos',
      'Recebíveis',
      'Faturas',
      'Dívidas',
    ]) {
      expect(page).toContain(label)
    }
    expect(page).toContain('Nenhuma entrada registrada no período.')
    expect(page).toContain('Nenhuma saída registrada no período.')
  })
})

describe('Budget V2 period and state UX', () => {
  it('offers all four presets in Movimentação and keeps the selector local', () => {
    for (const preset of Object.values(BudgetV2PeriodPreset)) expect(page).toContain(preset)
    for (const label of ['Últimos 30 dias', 'Este mês', 'Mês passado', 'Todo o histórico']) {
      expect(page).toContain(label)
    }
    expect(page).toContain('Período da movimentação')
    expect(page).toContain('onPresetChange')
    expect(page).not.toContain('useMonthPeriod')
    expect(layout).not.toContain("  '/budget',")
  })

  it('separates open and overdue current state without a global filter', () => {
    for (const label of ['Em aberto', 'A receber', 'A pagar', 'Diferença em aberto', 'Vencidos']) {
      expect(page).toContain(label)
    }
    expect(page).toContain('budget.open.inflow')
    expect(page).toContain('budget.open.outflow')
    expect(page).toContain('budget.open.net')
    expect(page).toContain('budget.open.overdue.inflow')
    expect(page).toContain('budget.open.overdue.outflow')
    expect(page).toContain('Nenhum valor vencido.')
  })

  it('keeps loading, retryable error and zero-value rendering as normal states', () => {
    expect(page).toContain('<LoadingState />')
    expect(page).toContain('<QueryError')
    expect(page).toContain('onRetry={() => void refetch()}')
    expect(page).toContain('placeholderData: keepPreviousData')
    expect(page).toContain('formatBudgetMoney(value)')
  })
})

describe('Budget V2 scope guard', () => {
  it('does not retain the removed V1 page concepts or detailed lists', () => {
    for (const forbidden of [
      'Salário',
      'salary',
      'remaining',
      'committedPct',
      'Saldo bancário',
      'Saldo disponível',
      'Saldo estimado',
      'transaction timeline',
    ]) {
      expect(page).not.toContain(forbidden)
    }
    expect(page).not.toContain('peopleSettlements')
    expect(page).not.toContain('InvoiceDetailsDrawer')
    expect(page).not.toContain('PersonStatementDrawer')
  })
})

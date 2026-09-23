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
    expect(types).toContain('open: BudgetV2Open')
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
    expect(page).toContain('border-b-2 border-muted-foreground/40')
    expect(page).not.toContain('<Card')
    for (const preset of Object.values(BudgetV2PeriodPreset)) expect(page).toContain(preset)
    expect(layout).not.toContain("  '/budget',")
  })

  it('shows open values as secondary information without client financial arithmetic', () => {
    expect(page).toContain('budget.open.inflow')
    expect(page).toContain('budget.open.outflow')
    expect(page).toContain('budget.open.net')
    expect(page).toContain('em aberto')
    expect(page).toContain('Diferença em aberto')
    expect(page).not.toContain('budget.realized.inflow +')
    expect(page).not.toContain('budget.realized.outflow +')
    expect(page).not.toContain('budget.realized.balance +')
    expect(page).not.toContain('budget.open.inflow -')
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

  it('separates registered and open groups in both columns', () => {
    expect(page).toContain('REGISTRADO NO PERÍODO')
    expect(page).toContain('EM ABERTO')
    for (const field of [
      'manualIncome',
      'receivableReceipts',
      'personSettlementInflows',
      'manualDirectTransactions',
      'debtDirectSettlements',
      'invoiceSettlements',
      'personSettlementDirectOutflows',
      'open.receivables',
      'open.invoices',
      'open.debts',
    ]) {
      expect(page).toContain(field)
    }
  })

  it('keeps zero detail rows out and provides concise subgroup empty states', () => {
    expect(page).toContain('filter(([key]) => !isZero(realized[key]))')
    expect(page).toContain('Nenhuma entrada registrada no período.')
    expect(page).toContain('Nenhuma saída registrada no período.')
    expect(page).toContain('Nenhum valor em aberto.')
    expect(page).toContain('formatBudgetMoney(value)')
  })
})

describe('Budget V2 overdue block and state UX', () => {
  it('renders overdue as a full-width block using only the backend overdue fields', () => {
    expect(page).toContain('<Overdue budget={budget} />')
    expect(page).toContain('sm:w-1/2')
    expect(page).toContain('CircleAlert')
    expect(page).toContain('aria-hidden="true"')
    expect(page).toContain('budget.open.overdue.inflow')
    expect(page).toContain('budget.open.overdue.outflow')
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

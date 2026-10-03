import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const budget = read('../components/budget-drilldown-drawer.tsx')
const obligations = read('../app/(dashboard)/movements/obligations/obligations-client.tsx')
const personStatement = read('../components/person-statement-drawer.tsx')
const receivableDrawer = read('../app/(dashboard)/receivables/receivable-detail-drawer.tsx')
const deletePolicy = read('./receivable-delete-policy.ts')
const debtDrawer = read('../app/(dashboard)/debts/debt-detail-drawer.tsx')

describe('obligation detail action mode', () => {
  it('keeps Budget drawers explicitly read-only', () => {
    expect(budget).toContain('<DebtDetailDrawer')
    expect(budget).toContain('<ReceivableDetailDrawer')
    expect(budget.match(/mode="readOnly"/g)).toHaveLength(2)
    expect(budget).not.toContain('onEdit={() => undefined}')
    expect(budget).not.toContain('onDelete={() => undefined}')
    expect(budget).not.toContain('onTogglePaid={() => undefined}')
    expect(budget).not.toContain('onToggleReceived={() => undefined}')
    expect(receivableDrawer).toContain("mode === 'readOnly' || (!onToggleReceived && !onEdit && !onDelete && !onEditSettlementDate)")
    expect(debtDrawer).toContain("mode === 'readOnly' || (!onTogglePaid && !onEdit && !onDelete && !onEditSettlementDate)")
  })

  it('connects the operational Movements drawers to settlement, edit, and delete handlers', () => {
    expect(obligations.match(/mode="operational"/g)).toHaveLength(2)
    expect(obligations).toContain('onEdit={(item) => { setEditTarget')
    expect(obligations).toContain('onDelete={(item) => handleDetailDelete(item,')
    expect(obligations).toContain('onToggleReceived={(item) => handleDetailSettle(item,')
    expect(obligations).toContain('onTogglePaid={(item) => handleDetailSettle(item,')
  })

  it('offers the shared recurring delete action in Movements with occurrence-specific confirmation and refresh', () => {
    expect(deletePolicy).toContain("? { mode: 'recurring-income' }")
    expect(deletePolicy).toContain(": { mode: 'direct' }")
    expect(obligations).toContain('deleteReceivable(target.item.id)')
    expect(obligations).toContain("queryKey: ['receivables']")
    expect(obligations).toContain("queryKey: ['obligations']")
    expect(obligations).toContain("'Excluir este recebimento?'")
    expect(obligations).toContain('Essa ocorrência será removida e não será criada novamente para esta competência.')
    expect(budget).toContain('mode="readOnly"')
  })

  it('explains linked settlement deletion before removing the historical item', () => {
    expect(obligations).toContain('A dívida e o lançamento financeiro associado ao pagamento serão removidos.')
    expect(obligations).toContain('A cobrança e o lançamento financeiro associado ao recebimento serão removidos.')
  })

  it('keeps Person operational and gives historical deletion the same explicit consequence', () => {
    expect(personStatement).toContain('onDelete={handleDeleteReceivable}')
    expect(personStatement).toContain('onDelete={handleDeleteDebt}')
    expect(personStatement).toContain('A dívida e o lançamento financeiro associado ao pagamento serão removidos.')
    expect(personStatement).toContain('A cobrança e o lançamento financeiro associado ao recebimento serão removidos.')
  })
})

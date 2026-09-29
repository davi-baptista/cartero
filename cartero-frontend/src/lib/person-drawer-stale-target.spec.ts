import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detailEntityForId } from './use-detail-entity'
import { resolvePersonTargetId } from './person-detail-state'

const budgetDrawer = readFileSync(
  new URL('../components/budget-drilldown-drawer.tsx', import.meta.url),
  'utf-8',
)
const overviewDetails = readFileSync(
  new URL('../components/overview-contextual-details.tsx', import.meta.url),
  'utf-8',
)
const personsPage = readFileSync(
  new URL('../app/(dashboard)/persons/page.tsx', import.meta.url),
  'utf-8',
)

const person = (id: string) => ({ id, name: id, phone: null })

describe('Person drawer stale target protection', () => {
  it('does not expose Person A while target B is loading', () => {
    expect(detailEntityForId(person('A'), 'B')).toBeNull()
    expect(detailEntityForId(person('B'), 'B')?.id).toBe('B')
  })

  it('supports A → B → A without cross-rendering stale data', () => {
    expect(detailEntityForId(person('A'), 'A')?.id).toBe('A')
    expect(detailEntityForId(person('A'), 'B')).toBeNull()
    expect(detailEntityForId(person('B'), 'B')?.id).toBe('B')
    expect(detailEntityForId(person('B'), 'A')).toBeNull()
    expect(detailEntityForId(person('A'), 'A')?.id).toBe('A')
  })

  it('reproduces close-A → click-B while the URL still says A', () => {
    const closed = resolvePersonTargetId('A', null, 'A', 1, 1)
    const targetWhileRouterCatchesUp = resolvePersonTargetId('A', 'B', 'A', 1, 2)

    expect(closed).toBeNull()
    expect(targetWhileRouterCatchesUp).toBe('B')
    expect(detailEntityForId(person('A'), targetWhileRouterCatchesUp)).toBeNull()
    expect(detailEntityForId(person('B'), targetWhileRouterCatchesUp)?.id).toBe('B')
  })

  it('remounts and resets nested detail when Budget changes person', () => {
    expect(budgetDrawer).toContain('key={`person:${selectedPerson.id}`}')
    expect(budgetDrawer).toContain('setSelectedTransactionId(null)')
    expect(budgetDrawer).toContain('setSelectedInvoice(null)')
    expect(budgetDrawer).toContain('setSelectedDebtId(null)')
    expect(budgetDrawer).toContain('setSelectedReceivableId(null)')
  })

  it('uses the shared identity authority for Overview Person lookup', () => {
    expect(overviewDetails).toContain('useDetailEntity({')
    expect(overviewDetails).toContain("queryKey: 'person'")
    expect(overviewDetails).not.toContain("queryKey: ['person', personId]")
  })

  it('uses a pending Person target before the URL search param catches up', () => {
    expect(personsPage).toContain('pendingPersonId')
    expect(personsPage).toContain('resolvePersonTargetId(')
    expect(personsPage).toContain('setPendingPersonId(id)')
    expect(personsPage).toContain('key={openPersonId ?? \'none\'}')
  })
})

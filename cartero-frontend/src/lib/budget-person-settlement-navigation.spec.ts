import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BudgetDrilldownItemRow } from '@/components/budget-drilldown-item'
import { BudgetV2DrilldownBucket } from '@/types/budget-v2-drilldown'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const drawer = read('../components/budget-drilldown-drawer.tsx')
const row = read('../components/budget-drilldown-item.tsx')
const types = read('../types/budget-v2-drilldown.ts')

describe('Budget person settlement detail navigation', () => {
  it('renders the person settlement as an accessible actionable row', () => {
    const html = renderToStaticMarkup(
      createElement(BudgetDrilldownItemRow, {
        bucket: BudgetV2DrilldownBucket.PERSON_SETTLEMENT_INFLOW,
        item: {
          kind: 'PERSON_SETTLEMENT',
          id: 'settlement-1',
          amount: '25.00',
          eventDate: '2026-09-22T12:00:00.000Z',
          personId: 'person-1',
          personName: 'Pessoa de teste',
          direction: 'INFLOW',
          paymentType: null,
          settlementTransactionId: null,
          bankName: null,
        },
        timeZone: 'America/Sao_Paulo',
        onView: () => undefined,
      }),
    )

    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Pessoa de teste"')
    expect(html).toContain('Pessoa de teste')
    expect(html).toContain('lucide-chevron-right')
  })

  it('uses personId for lookup and PersonStatementDrawer, keeping personName as display only', () => {
    expect(types).toMatch(/kind: 'PERSON_SETTLEMENT'[\s\S]*?personId: string[\s\S]*?personName: string/)
    expect(drawer).toContain('queryFn: () => getPerson(selectedPerson!.id)')
    expect(drawer).toContain('id: item.personId')
    expect(drawer).toContain('<PersonStatementDrawer')
    expect(row).toContain("primary = item.personName")
    expect(row).toContain('interactive={navigableMovement}')
    expect(drawer).toContain('getTransaction(selectedTransactionId!)')
    expect(drawer).toContain('item.settlementTransactionId')
    expect(drawer).toContain('<TransactionDetailsDrawer')
    expect(drawer).not.toContain('getPerson(item.personName)')
    expect(drawer).not.toContain('getPerson(selectedPerson!.name)')
  })
})

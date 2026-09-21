import { describe, expect, it } from 'vitest'
import type { AgendaEntry } from './overview-agenda'
import { groupAgendaEntries, groupAttention, limitAgenda } from './overview-agenda'

const entry = (overrides: Partial<AgendaEntry> = {}): AgendaEntry => ({
  id: 'debt:1',
  kind: 'debt',
  title: 'Curso',
  amount: 100,
  status: 'Pendente',
  direction: 'out',
  href: '/debts?highlight=1',
  ...overrides,
})

describe('overview contextual agenda grouping', () => {
  it('groups same-person debts but never by display name alone', () => {
    const samePerson = groupAgendaEntries([
      entry({ id: 'debt:1', personId: 'p1', personName: 'Mariana' }),
      entry({ id: 'debt:2', personId: 'p1', personName: 'Mariana', amount: 230 }),
    ], 'selected')
    const sameNameDifferentPeople = groupAgendaEntries([
      entry({ id: 'debt:1', personId: 'p1', personName: 'Mariana' }),
      entry({ id: 'debt:2', personId: 'p2', personName: 'Mariana' }),
    ], 'selected')

    expect(samePerson).toHaveLength(1)
    expect(samePerson[0].entries).toHaveLength(2)
    expect(sameNameDifferentPeople).toHaveLength(2)
  })

  it('keeps debt and receivable groups separate for the same person', () => {
    const groups = groupAgendaEntries([
      entry({ id: 'debt:1', personId: 'p1', personName: 'Mariana' }),
      entry({
        id: 'receivable:1',
        kind: 'receivable',
        personId: 'p1',
        personName: 'Mariana',
        direction: 'neutral',
      }),
    ], 'selected')

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.kind)).toEqual(['debt', 'receivable'])
  })

  it('preserves urgency buckets and removes selected-day duplicates', () => {
    const today = new Date('2026-09-21T12:00:00')
    const overdue = {
      id: 'd1',
      title: 'Antiga',
      amount: 100,
      dueDate: '2026-09-20',
      isPaid: false,
      personId: 'p1',
      person: { name: 'Mariana' },
    } as never
    const upcoming = {
      id: 'd2',
      title: 'Próxima',
      amount: 200,
      dueDate: '2026-09-23',
      isPaid: false,
      personId: 'p1',
      person: { name: 'Mariana' },
    } as never

    const groups = groupAttention({
      invoices: [],
      banks: [],
      debts: [overdue, upcoming],
      receivables: [],
      hiddenIds: new Set(['debt:d1']),
      today,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].entries[0].id).toBe('debt:d2')
  })

  it('limits summary rows while counting hidden underlying items', () => {
    const groups = groupAgendaEntries(
      Array.from({ length: 5 }, (_, index) => entry({ id: `debt:${index}` })),
      'selected',
    )

    const limited = limitAgenda(groups, 4)
    expect(limited.visible).toHaveLength(4)
    expect(limited.hiddenItems).toBe(1)
  })
})

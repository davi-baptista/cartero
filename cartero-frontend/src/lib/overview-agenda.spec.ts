import { describe, expect, it } from 'vitest'
import type { AgendaEntry } from './overview-agenda'
import {
  aggregateOpenTiming,
  groupAgendaEntries,
  groupAttention,
  limitAgenda,
} from './overview-agenda'

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

  it('puts open rows before settled rows and splits a mixed person group', () => {
    const groups = groupAgendaEntries([
      entry({ id: 'debt:paid', personId: 'p1', personName: 'Mariana', settled: true }),
      entry({ id: 'debt:open', personId: 'p1', personName: 'Mariana', settled: false }),
    ], 'selected')

    expect(groups).toHaveLength(2)
    expect(groups[0].entries[0].settled).toBe(false)
    expect(groups[1].entries[0].settled).toBe(true)
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

  it('sorts pending groups by the oldest underlying due date before limiting', () => {
    const groups = groupAgendaEntries([
      entry({ id: 'debt:later', dueDate: '2026-09-30', personId: 'p1', personName: 'Ana' }),
      entry({ id: 'debt:oldest', dueDate: '2026-09-10', personId: 'p2', personName: 'Bia' }),
      entry({ id: 'debt:middle', dueDate: '2026-09-20', personId: 'p3', personName: 'Caio' }),
    ], 'attention')

    expect(groups.map((group) => group.entries[0].id)).toEqual([
      'debt:oldest',
      'debt:middle',
      'debt:later',
    ])
    expect(limitAgenda(groups, 2).hiddenItems).toBe(1)
  })

  it('exposes due-today timing only for a uniformly due-today open group', () => {
    const today = new Date('2026-09-21T12:00:00')
    const allToday = [
      entry({ id: 'r1', kind: 'receivable', dueDate: '2026-09-21', settled: false }),
      entry({ id: 'r2', kind: 'receivable', dueDate: '2026-09-21', settled: false }),
    ]
    const mixed = [
      ...allToday,
      entry({ id: 'r3', kind: 'receivable', dueDate: '2026-09-23', settled: false }),
    ]

    expect(aggregateOpenTiming(allToday, today)).toEqual({
      kind: 'today',
      text: 'vence hoje',
    })
    expect(aggregateOpenTiming(mixed, today)).toBeNull()
    expect(aggregateOpenTiming([
      entry({ id: 'd1', kind: 'debt', dueDate: '2026-09-21', settled: false }),
      entry({ id: 'd2', kind: 'debt', dueDate: '2026-09-21', settled: false }),
    ], today)).toEqual({ kind: 'today', text: 'vence hoje' })
  })

  it('uses the oldest due date for an uniformly overdue group', () => {
    const timing = aggregateOpenTiming([
      entry({ id: 'd1', dueDate: '2026-09-01', settled: false }),
      entry({ id: 'd2', dueDate: '2026-09-10', settled: false }),
    ], new Date('2026-09-21T12:00:00'))

    expect(timing).toEqual({
      kind: 'overdue',
      text: 'venceu há 20 dias',
    })
  })
})

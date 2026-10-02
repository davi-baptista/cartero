import { describe, expect, it } from 'vitest'
import { groupStatementItemsByMonth } from './statement-month-groups'

describe('statement month grouping over accumulated pages', () => {
  it('starts a new section when pagination crosses a month boundary', () => {
    const pages = [
      [{ id: 'october', date: '2026-10-01T00:00:00.000Z' }],
      [{ id: 'september', date: '2026-09-30T00:00:00.000Z' }],
    ]

    expect(groupStatementItemsByMonth(pages.flat())).toMatchObject([
      { key: '2026-10', items: [{ id: 'october' }] },
      { key: '2026-09', items: [{ id: 'september' }] },
    ])
  })

  it('does not repeat a month heading when adjacent pages share that month', () => {
    const pages = [
      [{ id: 'first', date: '2026-09-15T00:00:00.000Z' }],
      [{ id: 'second', date: '2026-09-14T00:00:00.000Z' }],
      [{ id: 'third', date: '2026-08-31T00:00:00.000Z' }],
    ]
    const groups = groupStatementItemsByMonth(pages.flat())
    expect(groups.map(({ key }) => key)).toEqual(['2026-09', '2026-08'])
    expect(groups[0].items.map(({ id }) => id)).toEqual(['first', 'second'])
  })
})

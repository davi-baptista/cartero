import { formatMonthYear } from '@/lib/formatters'

export interface StatementMonthGroup<T> {
  key: string
  label: string
  items: T[]
}

/** Groups the already ordered, accumulated timeline; page boundaries are irrelevant. */
export function groupStatementItemsByMonth<T extends { date: string }>(
  items: readonly T[],
): StatementMonthGroup<T>[] {
  const groups = new Map<string, StatementMonthGroup<T>>()

  for (const item of items) {
    const key = item.date.slice(0, 7)
    let group = groups.get(key)
    if (!group) {
      const [year, month] = key.split('-').map(Number)
      group = { key, label: formatMonthYear(month, year), items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }

  return [...groups.values()]
}

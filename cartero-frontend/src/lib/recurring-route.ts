export type LegacyRecurringParams = Record<string, string | string[] | undefined>

export function recurringLegacyDestination(tab: 'income' | 'expenses', params: LegacyRecurringParams) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (key === 'tab' || value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item)
  }
  query.set('tab', tab)
  return `/recurring?${query.toString()}`
}

export type LegacyMovementRoute = 'transactions' | 'receivables' | 'debts'

const LEGACY_DESTINATIONS: Record<LegacyMovementRoute, string> = {
  transactions: '/movements/statement',
  receivables: '/movements/obligations',
  debts: '/movements/obligations',
}

/** Builds canonical destinations while retaining repeatable deep-link params. */
export function movementLegacyDestination(
  route: LegacyMovementRoute,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams()
  const endDate = Array.isArray(searchParams.endDate)
    ? searchParams.endDate[0]
    : searchParams.endDate
  const monthFromEndDate = endDate && /^(\d{4})-(\d{2})-\d{2}$/.exec(endDate)
  const legacyMonth = monthFromEndDate ? Number(monthFromEndDate[2]) : 0
  const legacyYear = monthFromEndDate ? Number(monthFromEndDate[1]) : 0

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    if (route === 'transactions' && key === 'invoicePeriod') continue
    if (key === 'startDate' || key === 'endDate') continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }

  if (route === 'receivables' || route === 'debts') {
    if (legacyMonth >= 1 && legacyMonth <= 12) {
      if (!params.has('month')) params.set('month', String(legacyMonth))
      if (!params.has('year')) params.set('year', String(legacyYear))
    }

    if (params.has('debtId')) {
      params.delete('receivableId')
      params.set('domain', 'debt')
    } else if (params.has('receivableId')) {
      params.set('domain', 'receivable')
    } else {
      params.set('domain', route === 'receivables' ? 'receivable' : 'debt')
    }
  }

  const query = params.toString()
  return `${LEGACY_DESTINATIONS[route]}${query ? `?${query}` : ''}`
}

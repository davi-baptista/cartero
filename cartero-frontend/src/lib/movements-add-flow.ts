export type MovementAddTarget = 'expense' | 'income' | 'receivable' | 'debt'

const STATEMENT_TARGETS: MovementAddTarget[] = ['expense', 'income']

export function movementAddDestination(
  target: MovementAddTarget,
  pathname: string,
  currentParams: string,
) {
  const destination = STATEMENT_TARGETS.includes(target)
    ? '/movements/statement'
    : '/movements/obligations'
  const params = pathname === destination
    ? new URLSearchParams(currentParams)
    : new URLSearchParams()

  params.set('add', target)
  if (target === 'receivable' || target === 'debt') params.set('domain', target)

  const query = params.toString()
  return query ? `${destination}?${query}` : destination
}

export function movementPostCreateDestination(
  target: MovementAddTarget,
  pathname: string,
  currentParams: string,
) {
  const destination = STATEMENT_TARGETS.includes(target)
    ? '/movements/statement'
    : '/movements/obligations'
  const params = pathname === destination
    ? new URLSearchParams(currentParams)
    : new URLSearchParams()

  params.delete('add')
  if (target === 'receivable' || target === 'debt') params.set('domain', target)

  const query = params.toString()
  return query ? `${destination}?${query}` : destination
}

export function parseMovementAddTarget(value: string | null): MovementAddTarget | null {
  return value === 'expense' || value === 'income' || value === 'receivable' || value === 'debt'
    ? value
    : null
}

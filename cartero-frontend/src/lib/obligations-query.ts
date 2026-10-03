import type {
  ObligationDomain,
  ObligationRow,
  ObligationSection,
  ObligationSummary,
} from '@/services/obligations.service'

export type ObligationDomainFilter = 'all' | 'receivable' | 'debt'

export function parseObligationDomain(value: string | null | undefined): ObligationDomainFilter {
  return value === 'receivable' || value === 'debt' ? value : 'all'
}

export function apiObligationDomain(domain: ObligationDomainFilter): ObligationDomain {
  if (domain === 'receivable') return 'RECEIVABLE'
  if (domain === 'debt') return 'DEBT'
  return 'ALL'
}

export function obligationsSummaryKey(filters: {
  month: number
  year: number
  domain: ObligationDomain
  personId?: string
}) {
  return [
    'obligations',
    'summary',
    filters.month,
    filters.year,
    filters.domain,
    filters.personId ?? null,
  ] as const
}

export function recurringIncomeReconcileKey(
  userId: string,
  period: { month: number; year: number },
) {
  return ['recurring-income-reconcile', userId, period.year, period.month] as const
}

/** Search-independent overdue totals are shared across month-scoped summaries. */
export function obligationsOverdueSummaryKey(filters: {
  domain: ObligationDomain
  personId?: string
}) {
  return [
    'obligations',
    'summary-overdue',
    filters.domain,
    filters.personId ?? null,
  ] as const
}

export function obligationsSectionKey(filters: {
  section: ObligationSection
  domain: ObligationDomain
  search: string
  personId?: string
  month: number
  year: number
}) {
  return filters.section === 'OVERDUE'
    ? [
        'obligations',
        'section',
        filters.section,
        filters.domain,
        filters.search,
        filters.personId ?? null,
      ] as const
    : [
        'obligations',
        'section',
        filters.section,
        filters.domain,
        filters.search,
        filters.personId ?? null,
        filters.month,
        filters.year,
      ] as const
}

/** The summary includes only unresolved items due this month and not overdue. */
export function obligationSummaryDelta(
  item: ObligationRow,
  nextResolved: boolean,
  period: { month: number; year: number },
  today: string,
): string {
  const dueDate = item.dueDate.slice(0, 10)
  const targetMonth = `${period.year}-${String(period.month).padStart(2, '0')}`
  if (!dueDate.startsWith(`${targetMonth}-`) || dueDate < today) return '0'
  if (!/^-?\d+(?:\.\d+)?$/.test(item.amount)) return '0'
  const amount = item.amount.replace(/^-/, '')
  return nextResolved ? `-${amount}` : amount
}

function parseDecimal(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return { negative: false, whole: '0', fraction: '' }
  return {
    negative: match[1] === '-',
    whole: match[2].replace(/^0+(?=\d)/, ''),
    fraction: match[3] ?? '',
  }
}

function compareUnsigned(left: string, right: string) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '')
  const normalizedRight = right.replace(/^0+(?=\d)/, '')
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1
  }
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1
}

function addUnsigned(left: string, right: string) {
  let carry = 0
  let result = ''
  const width = Math.max(left.length, right.length)
  for (let offset = 0; offset < width; offset += 1) {
    const leftDigit = Number(left[left.length - 1 - offset] ?? '0')
    const rightDigit = Number(right[right.length - 1 - offset] ?? '0')
    const digit = leftDigit + rightDigit + carry
    result = String(digit % 10) + result
    carry = Math.floor(digit / 10)
  }
  return `${carry ? String(carry) : ''}${result}`.replace(/^0+(?=\d)/, '')
}

function subtractUnsigned(larger: string, smaller: string) {
  let borrow = 0
  let result = ''
  for (let offset = 0; offset < larger.length; offset += 1) {
    let digit = Number(larger[larger.length - 1 - offset]) - borrow
    const smallerDigit = Number(smaller[smaller.length - 1 - offset] ?? '0')
    if (digit < smallerDigit) {
      digit += 10
      borrow = 1
    } else {
      borrow = 0
    }
    result = String(digit - smallerDigit) + result
  }
  return result.replace(/^0+(?=\d)/, '')
}

function addDecimalStrings(left: string, right: string): string {
  const leftParts = parseDecimal(left)
  const rightParts = parseDecimal(right)
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length)
  const leftMagnitude = `${leftParts.whole}${leftParts.fraction.padEnd(scale, '0')}`
  const rightMagnitude = `${rightParts.whole}${rightParts.fraction.padEnd(scale, '0')}`
  let negative = false
  let magnitude: string

  if (leftParts.negative === rightParts.negative) {
    negative = leftParts.negative
    magnitude = addUnsigned(leftMagnitude, rightMagnitude)
  } else {
    const comparison = compareUnsigned(leftMagnitude, rightMagnitude)
    if (comparison >= 0) {
      negative = leftParts.negative
      magnitude = subtractUnsigned(leftMagnitude, rightMagnitude)
    } else {
      negative = rightParts.negative
      magnitude = subtractUnsigned(rightMagnitude, leftMagnitude)
    }
  }

  magnitude = magnitude.padStart(scale + 1, '0')
  const whole = scale ? magnitude.slice(0, -scale) : magnitude
  const fraction = scale ? `.${magnitude.slice(-scale)}` : ''
  const isZero = /^0+$/.test(magnitude)
  return `${negative && !isZero ? '-' : ''}${whole}${fraction}`
}

export function applyObligationSummaryDelta(
  summary: ObligationSummary,
  domain: Exclude<ObligationDomain, 'ALL'>,
  delta: string,
): ObligationSummary {
  if (delta === '0') return summary
  const receivable = addDecimalStrings(
    summary.open.receivable,
    domain === 'RECEIVABLE' ? delta : '0',
  )
  const debt = addDecimalStrings(
    summary.open.debt,
    domain === 'DEBT' ? delta : '0',
  )
  return {
    ...summary,
    open: {
      receivable,
      debt,
      net: addDecimalStrings(receivable, debt.startsWith('-') ? debt.slice(1) : `-${debt}`),
    },
  }
}

import type { ObligationDomain, ObligationPage, ObligationRow, ObligationSection } from '@/services/obligations.service'
import { accountCivilDayOf } from '@/lib/date'

export type ObligationHighlightEntity = {
  domain: Exclude<ObligationDomain, 'ALL'>
  id: string
  personId?: string | null
  isPaid: boolean
  dueDate: string
  resolvedAt: string | null
}

export function obligationResolvedCivilDay(
  paidAt: string | null | undefined,
  paymentTransactionDate: string | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  if (paidAt) return paidAt.slice(0, 10)
  if (!paymentTransactionDate || !timeZone) return paymentTransactionDate?.slice(0, 10) ?? null
  return accountCivilDayOf(paymentTransactionDate, timeZone)
}

export function obligationHighlightSection(
  target: Pick<ObligationHighlightEntity, 'isPaid' | 'dueDate'>,
  today: string,
): ObligationSection {
  if (target.isPaid) return 'HISTORY'
  return target.dueDate.slice(0, 10) < today ? 'OVERDUE' : 'OPEN'
}

export function obligationHighlightPeriodDate(
  target: Pick<ObligationHighlightEntity, 'isPaid' | 'dueDate' | 'resolvedAt'>,
): string {
  return target.isPaid ? target.resolvedAt ?? target.dueDate : target.dueDate
}

export function obligationHighlightPeriod(date: string): { month: number; year: number } | null {
  const match = /^(\d{4})-(\d{2})/.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? { month, year } : null
}

export function sameObligationPeriod(
  left: { month: number; year: number },
  right: { month: number; year: number },
): boolean {
  return left.month === right.month && left.year === right.year
}

export function parseObligationPeriodContext(params: {
  month: string | null
  year: string | null
  endDate?: string | null
}): { month: number; year: number } | null {
  const month = Number(params.month)
  const year = Number(params.year)
  if (params.month && params.year && month >= 1 && month <= 12 && year >= 1900) {
    return { month, year }
  }
  const legacyDate = params.endDate && /^(\d{4})-(\d{2})-\d{2}$/.exec(params.endDate)
  if (!legacyDate) return null
  const legacyMonth = Number(legacyDate[2])
  const legacyYear = Number(legacyDate[1])
  return legacyMonth >= 1 && legacyMonth <= 12
    ? { month: legacyMonth, year: legacyYear }
    : null
}

export function findObligationHighlightRow(
  pages: readonly ObligationPage[] | undefined,
  target: Pick<ObligationHighlightEntity, 'id' | 'domain'>,
): ObligationRow | undefined {
  return pages?.flatMap((page) => page.items)
    .find((row) => row.id === target.id && row.domain === target.domain)
}

export function obligationHighlightHref(
  domain: 'debt' | 'receivable',
  id: string,
  dateContext?: string | null,
): string {
  const params = new URLSearchParams({ domain, highlight: id })
  const period = dateContext ? obligationHighlightPeriod(dateContext) : null
  if (period) {
    params.set('month', String(period.month))
    params.set('year', String(period.year))
  }
  return `/movements/obligations?${params.toString()}`
}

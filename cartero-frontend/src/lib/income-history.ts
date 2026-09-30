import type { Receivable } from '@/types'
import { accountCivilDayOf, civilDayOf } from '@/lib/date'
import { formatDate } from '@/lib/formatters'

export const INCOME_HISTORY_PAGE_SIZE = 5

export function incomeHistoryReceiptDay(
  item: Pick<Receivable, 'paidAt'>,
  timeZone: string | null | undefined,
) {
  if (!item.paidAt) return null
  return timeZone ? accountCivilDayOf(item.paidAt, timeZone) : civilDayOf(item.paidAt)
}

export function isResolvedIncomeHistoryItem(item: Pick<Receivable, 'isPaid'>) {
  return item.isPaid
}

/** Dated settlements first by paidAt DESC; undated legacy settlements last by stable ID. */
export function compareIncomeHistoryItems(a: Receivable, b: Receivable) {
  if (a.paidAt && b.paidAt) {
    const byInstant = b.paidAt.localeCompare(a.paidAt)
    if (byInstant !== 0) return byInstant
  } else if (a.paidAt) {
    return -1
  } else if (b.paidAt) {
    return 1
  }

  return a.id.localeCompare(b.id)
}

export function incomeHistoryReceiptLabel(
  item: Pick<Receivable, 'paidAt'>,
  timeZone: string | null | undefined,
) {
  const day = incomeHistoryReceiptDay(item, timeZone)
  return day ? `Recebido em ${formatDate(day)}` : 'Data de recebimento não registrada'
}

export function settledIncomeHistory(receivables: Receivable[]) {
  return receivables
    .filter((item) => item.incomeClassification === 'INCOME' && isResolvedIncomeHistoryItem(item))
    .sort(compareIncomeHistoryItems)
}

export function paginateIncomeHistory<T>(items: T[], requestedPage: number, pageSize = INCOME_HISTORY_PAGE_SIZE) {
  const pageCount = Math.ceil(items.length / pageSize)
  const page = pageCount === 0 ? 0 : Math.min(Math.max(0, requestedPage), pageCount - 1)
  const start = page * pageSize

  return {
    items: items.slice(start, start + pageSize),
    page,
    pageCount,
    hasPagination: pageCount > 1,
  }
}

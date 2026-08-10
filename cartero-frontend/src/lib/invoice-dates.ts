export const DEFAULT_INVOICE_DAYS_AFTER_CLOSE = 7

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function dateForDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, Math.min(day, daysInMonth(year, month)))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function intervalDays(daysAfterClose?: number): number {
  return Math.max(1, daysAfterClose ?? DEFAULT_INVOICE_DAYS_AFTER_CLOSE)
}

function closeOffsetDays(daysAfterClose?: number): number {
  return intervalDays(daysAfterClose)
}

/** Returns the local date on which an invoice period closes. */
export function getInvoiceCloseDate(
  year: number,
  month: number,
  dueDay: number,
  daysAfterClose?: number,
): Date {
  return addDays(
    getInvoiceDueDate(year, month, dueDay, daysAfterClose),
    -closeOffsetDays(daysAfterClose),
  )
}

/**
 * Returns the local due date for an invoice period.
 * The invoice period follows the due month. The closing date may therefore
 * fall in the previous calendar month.
 */
export function getInvoiceDueDate(
  year: number,
  month: number,
  dueDay: number,
  daysAfterClose?: number,
): Date {
  return dateForDay(year, month, dueDay)
}

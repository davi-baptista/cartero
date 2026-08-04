/**
 * Returns the local date on which an invoice period closes.
 * The period month is the month represented by the invoice record.
 */
export function getInvoiceCloseDate(year: number, month: number, closeDay: number): Date {
  return new Date(year, month - 1, closeDay)
}

/**
 * Returns the local due date for an invoice period.
 * If the due day is numerically before the close day, payment is due in the
 * following calendar month (for example, close 30 and due 6).
 */
export function getInvoiceDueDate(
  year: number,
  month: number,
  closeDay: number,
  dueDay: number,
): Date {
  const dueMonthOffset = dueDay < closeDay ? 1 : 0
  return new Date(year, month - 1 + dueMonthOffset, dueDay)
}

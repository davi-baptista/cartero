import { Bank, Invoice, Prisma } from '@prisma/client';

export const SYSTEM_RECEIVABLE_BANK_NAME = '__system_receivables__';
export const DEFAULT_INVOICE_DAYS_AFTER_CLOSE = 7;

export function getLegacyCloseDay(
  dueDay: number,
  daysAfterClose: number,
): number {
  const closeOffset = Math.max(0, daysAfterClose - 1);
  return ((dueDay - 1 - closeOffset) % 31 + 31) % 31 + 1;
}

export async function findOrCreateSystemReceivableBank(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Bank> {
  const existing = await tx.bank.findFirst({
    where: { userId, isSystem: true, name: SYSTEM_RECEIVABLE_BANK_NAME },
  });
  if (existing) return existing;

  return tx.bank.create({
    data: {
      userId,
      name: SYSTEM_RECEIVABLE_BANK_NAME,
      isSystem: true,
      invoiceCloseDate: 31,
      invoiceDueDate: 31,
      invoiceDueDaysAfterClose: DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
    },
  });
}

type InvoiceSchedule = Pick<
  Bank,
  'invoiceDueDate' | 'invoiceDueDaysAfterClose'
>;

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateForDayUtc(year: number, month: number, day: number): Date {
  const clampedDay = Math.min(day, daysInMonthUtc(year, month));
  return new Date(Date.UTC(year, month - 1, clampedDay, 3));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isSamePeriod(date: Date, year: number, month: number): boolean {
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

function intervalDays(bank: Pick<Bank, 'invoiceDueDaysAfterClose'>): number {
  return Math.max(
    1,
    bank.invoiceDueDaysAfterClose ?? DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
  );
}

function closeOffsetDays(bank: Pick<Bank, 'invoiceDueDaysAfterClose'>): number {
  return Math.max(0, intervalDays(bank) - 1);
}

/**
 * Invoice periods are identified by the month in which the statement closes.
 * The due date is calculated from the configured due day and the number of
 * calendar days in the closing-to-due interval. The configured interval is
 * inclusive, so an interval of 7 means the due date is 6 days after closing.
 * Due days beyond the end of a month are clamped to that month's last day.
 */
export function getInvoiceCloseDateForPeriod(
  bank: InvoiceSchedule,
  year: number,
  month: number,
): Date {
  const dueDate = getInvoiceDueDateForPeriod(bank, year, month);
  return addDays(dueDate, -closeOffsetDays(bank));
}

export function getInvoiceDueDateForPeriod(
  bank: InvoiceSchedule,
  year: number,
  month: number,
): Date {
  const days = closeOffsetDays(bank);

  // A period's due date is normally in the same month as its close date. If
  // subtracting the interval would move closing into the previous month, use
  // the next month's occurrence of the due day instead (close 30, due 6).
  const sameMonthDue = dateForDayUtc(year, month, bank.invoiceDueDate);
  if (isSamePeriod(addDays(sameMonthDue, -days), year, month)) {
    return sameMonthDue;
  }

  return dateForDayUtc(year, month + 1, bank.invoiceDueDate);
}

export function getInvoiceDueDate(bank: Bank, invoice: Invoice): Date {
  return getInvoiceDueDateForPeriod(bank, invoice.year, invoice.month);
}

export async function findOrCreateInvoice(
  tx: Prisma.TransactionClient,
  userId: string,
  bankId: string,
  invoiceDueDate: number,
  invoiceDueDaysAfterClose: number,
  transactionDate: Date,
): Promise<Invoice> {
  const schedule = { invoiceDueDate, invoiceDueDaysAfterClose };
  let month = transactionDate.getUTCMonth() + 1;
  let year = transactionDate.getUTCFullYear();

  const closeDate = getInvoiceCloseDateForPeriod(schedule, year, month);
  if (transactionDate >= closeDate) {
    month = (month % 12) + 1;
    if (month === 1) {
      year += 1;
    }
  }

  let invoice = await tx.invoice.findFirst({
    where: {
      userId,
      bankId,
      month,
      year,
    },
  });

  if (!invoice) {
    const today = new Date();
    const periodCloseDate = getInvoiceCloseDateForPeriod(schedule, year, month);
    const dueDate = getInvoiceDueDateForPeriod(schedule, year, month);

    const status =
      today > dueDate
        ? 'OVERDUE'
        : today >= periodCloseDate
          ? 'CLOSED'
          : 'OPEN';

    invoice = await tx.invoice.create({
      data: {
        userId,
        bankId,
        month,
        year,
        status,
      },
    });
  }

  return invoice;
}

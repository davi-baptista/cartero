import { Bank, Invoice, Prisma } from '@prisma/client';

export const SYSTEM_RECEIVABLE_BANK_NAME = '__system_receivables__';
export const DEFAULT_INVOICE_DAYS_AFTER_CLOSE = 7;

export function getLegacyCloseDay(
  dueDay: number,
  daysAfterClose: number,
): number {
  const closeOffset = Math.max(1, daysAfterClose);
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

export type InvoiceSchedule = Pick<
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

function intervalDays(bank: Pick<Bank, 'invoiceDueDaysAfterClose'>): number {
  return Math.max(
    1,
    bank.invoiceDueDaysAfterClose ?? DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
  );
}

function closeOffsetDays(bank: Pick<Bank, 'invoiceDueDaysAfterClose'>): number {
  return intervalDays(bank);
}

/**
 * Invoice periods are identified by the month in which the invoice is due.
 * The closing date is calculated backwards from that due date using the
 * configured number of calendar days. This is important for cards that close
 * near the end of one month and are due early in the next one: an invoice for
 * August can close on July 30 and still be the August invoice.
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
  // The invoice period always follows the due month. The close date may be
  // in the previous month; that does not change the invoice's month/year.
  return dateForDayUtc(year, month, bank.invoiceDueDate);
}

export function getInvoiceDueDate(bank: Bank, invoice: Invoice): Date {
  return getInvoiceDueDateForPeriod(bank, invoice.year, invoice.month);
}

export function getInvoicePeriodForDate(
  bank: InvoiceSchedule,
  transactionDate: Date,
): { year: number; month: number } {
  let month = transactionDate.getUTCMonth() + 1;
  let year = transactionDate.getUTCFullYear();

  const closeDate = getInvoiceCloseDateForPeriod(bank, year, month);
  // The closing day belongs to the current invoice; transactions after it
  // move to the next invoice (whose due date is in the following month).
  if (transactionDate > closeDate) {
    month = (month % 12) + 1;
    if (month === 1) year += 1;
  }

  return { year, month };
}

export function offsetInvoicePeriod(
  year: number,
  month: number,
  offset: number,
): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

export async function findOrCreateInvoiceForPeriod(
  tx: Prisma.TransactionClient,
  userId: string,
  bankId: string,
  schedule: InvoiceSchedule,
  year: number,
  month: number,
): Promise<Invoice> {
  let invoice = await tx.invoice.findFirst({
    where: { userId, bankId, month, year },
  });

  if (!invoice) {
    const today = new Date();
    const periodCloseDate = getInvoiceCloseDateForPeriod(
      schedule,
      year,
      month,
    );
    const dueDate = getInvoiceDueDateForPeriod(schedule, year, month);

    const status =
      today > dueDate
        ? 'OVERDUE'
        : today >= periodCloseDate
          ? 'CLOSED'
          : 'OPEN';

    invoice = await tx.invoice.create({
      data: { userId, bankId, month, year, status },
    });
  }

  return invoice;
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
  const { year, month } = getInvoicePeriodForDate(schedule, transactionDate);
  return findOrCreateInvoiceForPeriod(
    tx,
    userId,
    bankId,
    schedule,
    year,
    month,
  );
}

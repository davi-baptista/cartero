import { Bank, Invoice, Prisma } from '@prisma/client';

export const SYSTEM_RECEIVABLE_BANK_NAME = '__system_receivables__';

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
    },
  });
}

/**
 * Invoice periods are identified by the month in which the statement closes.
 * When the due day is numerically before the close day (e.g. close 30, due 6),
 * the due date belongs to the following calendar month.
 */
export function getInvoiceCloseDateForPeriod(
  bank: Pick<Bank, 'invoiceCloseDate'>,
  year: number,
  month: number,
): Date {
  return new Date(Date.UTC(year, month - 1, bank.invoiceCloseDate, 3));
}

export function getInvoiceDueDateForPeriod(
  bank: Pick<Bank, 'invoiceCloseDate' | 'invoiceDueDate'>,
  year: number,
  month: number,
): Date {
  const dueMonthOffset = bank.invoiceDueDate < bank.invoiceCloseDate ? 1 : 0;
  return new Date(
    Date.UTC(year, month - 1 + dueMonthOffset, bank.invoiceDueDate, 3),
  );
}

export function getInvoiceDueDate(bank: Bank, invoice: Invoice): Date {
  return getInvoiceDueDateForPeriod(bank, invoice.year, invoice.month);
}

export async function findOrCreateInvoice(
  tx: Prisma.TransactionClient,
  userId: string,
  bankId: string,
  invoiceCloseDate: number,
  invoiceDueDate: number,
  transactionDate: Date,
): Promise<Invoice> {
  let month = transactionDate.getUTCMonth() + 1;
  let year = transactionDate.getUTCFullYear();

  if (transactionDate.getUTCDate() >= invoiceCloseDate) {
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
    const periodBank = { invoiceCloseDate, invoiceDueDate };
    const closeDate = getInvoiceCloseDateForPeriod(periodBank, year, month);
    const dueDate = getInvoiceDueDateForPeriod(periodBank, year, month);

    const status =
      today > dueDate ? 'OVERDUE' : today >= closeDate ? 'CLOSED' : 'OPEN';

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

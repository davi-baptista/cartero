import { Bank, Invoice, Prisma } from '@prisma/client';

export function getInvoiceDueDate(bank: Bank, invoice: Invoice): Date {
  return new Date(invoice.year, invoice.month - 1, bank.invoiceDueDate);
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
    const closeDate = new Date(year, month, invoiceCloseDate);
    const dueDate = new Date(year, month, invoiceDueDate);

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

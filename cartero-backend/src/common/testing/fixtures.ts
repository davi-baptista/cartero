import { Prisma } from '@prisma/client';

/**
 * Fixtures e um duplo de PrismaService para testes de serviço.
 *
 * Duas escolhas deliberadas:
 *
 * 1. Valores monetários são sempre `Prisma.Decimal`, como em produção. Usar
 *    `number` aqui validaria um contrato que o banco não entrega, e esconderia
 *    exatamente os erros de conversão que queremos vigiar.
 *
 * 2. O duplo do Prisma é um objeto simples com as delegações usadas pelos
 *    serviços, não um mock profundo automático. Um `deepMock` deixaria qualquer
 *    consulta responder `undefined` silenciosamente, e o teste passaria por
 *    acidente.
 */

export const USER_ID = 'user-1';

export function money(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Uma data-calendário em UTC, sem depender do relógio real. */
export function utcDate(
  year: number,
  month: number,
  day: number,
  hour = 12,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour));
}

type BankOverrides = Partial<{
  id: string;
  name: string;
  invoiceDueDate: number;
  invoiceDueDaysAfterClose: number;
  isSystem: boolean;
  isArchived: boolean;
}>;

export function makeBank(overrides: BankOverrides = {}) {
  return {
    id: 'bank-1',
    userId: USER_ID,
    name: 'Cartão Teste',
    isSystem: false,
    isArchived: false,
    invoiceCloseDate: 3,
    invoiceDueDate: 10,
    invoiceDueDaysAfterClose: 7,
    createdAt: utcDate(2026, 1, 1),
    updatedAt: utcDate(2026, 1, 1),
    ...overrides,
  };
}

type InvoiceOverrides = Partial<{
  id: string;
  bankId: string;
  month: number;
  year: number;
  status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE';
  totalAmount: Prisma.Decimal;
  closeDate: Date;
  dueDate: Date;
  /** Configuração usada para derivar as datas quando não são passadas. */
  schedule: { invoiceDueDate: number; invoiceDueDaysAfterClose: number };
}>;

/**
 * Fatura de teste com datas persistidas.
 *
 * `closeDate`/`dueDate` são derivados do calendário padrão de `makeBank`
 * (vence dia 10, fecha 7 dias antes) quando não informados — assim os testes
 * escritos antes da persistência continuam descrevendo o mesmo cenário. Quem
 * precisa de datas específicas passa `closeDate`/`dueDate`, e quem quer outro
 * cartão passa `schedule`.
 */
export function makeInvoice(overrides: InvoiceOverrides = {}) {
  const month = overrides.month ?? 8;
  const year = overrides.year ?? 2026;
  const schedule = overrides.schedule ?? {
    invoiceDueDate: 10,
    invoiceDueDaysAfterClose: 7,
  };

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dueDay = Math.min(schedule.invoiceDueDate, lastDay);
  const dueDate = new Date(Date.UTC(year, month - 1, dueDay, 3));
  const closeDate = new Date(
    dueDate.getTime() -
      Math.max(1, schedule.invoiceDueDaysAfterClose) * 86400000,
  );

  const { schedule: _schedule, ...rest } = overrides;
  void _schedule;

  return {
    id: 'invoice-1',
    userId: USER_ID,
    bankId: 'bank-1',
    month,
    year,
    status: 'OPEN' as const,
    totalAmount: money(0),
    closeDate,
    dueDate,
    createdAt: utcDate(2026, 8, 1),
    updatedAt: utcDate(2026, 8, 1),
    ...rest,
  };
}

type TransactionOverrides = Partial<{
  id: string;
  parentId: string | null;
  bankId: string;
  categoryId: string;
  invoiceId: string | null;
  personId: string | null;
  subscriptionId: string | null;
  title: string;
  type: 'INCOME' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX' | 'BOLETO';
  amount: Prisma.Decimal;
  isRefund: boolean;
  date: Date;
}>;

export function makeTransaction(overrides: TransactionOverrides = {}) {
  return {
    id: 'tx-1',
    parentId: null,
    userId: USER_ID,
    bankId: 'bank-1',
    categoryId: 'cat-1',
    invoiceId: 'invoice-1',
    personId: null,
    subscriptionId: null,
    title: 'Compra',
    type: 'CREDIT_CARD' as const,
    amount: money(100),
    isRefund: false,
    description: null,
    date: utcDate(2026, 8, 1),
    createdAt: utcDate(2026, 8, 1),
    updatedAt: utcDate(2026, 8, 1),
    ...overrides,
  };
}

type ReceivableOverrides = Partial<{
  id: string;
  parentId: string | null;
  personId: string | null;
  transactionId: string | null;
  paymentTransactionId: string | null;
  title: string;
  debtorName: string;
  amount: Prisma.Decimal;
  isPaid: boolean;
  paidAt: Date | null;
  dueDate: Date;
  occurredAt: Date;
}>;

export function makeReceivable(overrides: ReceivableOverrides = {}) {
  return {
    id: 'rec-1',
    userId: USER_ID,
    personId: 'person-1',
    parentId: null,
    transactionId: 'tx-1',
    paymentTransactionId: null,
    title: 'Compra',
    debtorName: 'Eva',
    amount: money(100),
    description: null,
    occurredAt: utcDate(2026, 8, 1),
    dueDate: utcDate(2026, 8, 10, 3),
    isPaid: false,
    paidAt: null,
    createdAt: utcDate(2026, 8, 1),
    updatedAt: utcDate(2026, 8, 1),
    ...overrides,
  };
}

type DebtOverrides = Partial<{
  id: string;
  personId: string | null;
  parentId: string | null;
  paymentTransactionId: string | null;
  title: string;
  creditorName: string;
  amount: Prisma.Decimal;
  isPaid: boolean;
  dueDate: Date;
}>;

export function makeDebt(overrides: DebtOverrides = {}) {
  return {
    id: 'debt-1',
    userId: USER_ID,
    personId: null,
    parentId: null,
    paymentTransactionId: null,
    title: 'Dívida',
    creditorName: 'Credor',
    amount: money(100),
    description: null,
    occurredAt: utcDate(2026, 8, 1),
    dueDate: utcDate(2026, 8, 15),
    isAlertEnabled: true,
    isPaid: false,
    paidAt: null,
    createdAt: utcDate(2026, 8, 1),
    updatedAt: utcDate(2026, 8, 1),
    ...overrides,
  };
}

export function makePerson(
  overrides: Partial<{ id: string; name: string }> = {},
) {
  return {
    id: 'person-1',
    userId: USER_ID,
    name: 'Eva',
    phone: null,
    createdAt: utcDate(2026, 1, 1),
    updatedAt: utcDate(2026, 1, 1),
    ...overrides,
  };
}

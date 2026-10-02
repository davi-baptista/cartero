export enum ObligationSection {
  OVERDUE = 'OVERDUE',
  OPEN = 'OPEN',
  HISTORY = 'HISTORY',
}

export enum ObligationDomain {
  ALL = 'ALL',
  RECEIVABLE = 'RECEIVABLE',
  DEBT = 'DEBT',
}

export interface ObligationRow {
  domain: Exclude<ObligationDomain, ObligationDomain.ALL>;
  id: string;
  title: string;
  amount: string;
  description: string | null;
  personId: string | null;
  personName: string | null;
  counterpartyName: string;
  dueDate: Date;
  isResolved: boolean;
  resolvedAt: Date | null;
  paymentTransactionId: string | null;
}

export interface ObligationPage {
  items: ObligationRow[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export interface ObligationSectionSummary {
  receivable: string;
  debt: string;
  net: string;
}

export interface ObligationSummary {
  overdue: ObligationSectionSummary;
  open: ObligationSectionSummary;
}

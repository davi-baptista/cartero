export enum BudgetV2PeriodPreset {
  LAST_30_DAYS = 'LAST_30_DAYS',
  THIS_MONTH = 'THIS_MONTH',
  LAST_MONTH = 'LAST_MONTH',
  ALL_TIME = 'ALL_TIME',
}

export interface BudgetV2Period {
  preset: BudgetV2PeriodPreset;
  /** Inclusive financial civil date, or null for ALL_TIME. */
  startDate: string | null;
  /** Exclusive financial civil date. */
  endDate: string;
  timeZone: string;
}

export interface BudgetV2RealizedComposition {
  manualIncome: string;
  receivableReceipts: string;
  personSettlementInflows: string;
  manualDirectTransactions: string;
  debtDirectSettlements: string;
  invoiceSettlements: string;
  personSettlementDirectOutflows: string;
}

export interface BudgetV2OpenComposition {
  invoices: string;
  debts: string;
  receivables: string;
}

/** Future response contract; B2.1A intentionally does not expose totals. */
export interface BudgetV2ResponseContract {
  period: BudgetV2Period;
  realized: {
    inflow: string;
    outflow: string;
    balance: string;
    composition: BudgetV2RealizedComposition;
  };
  open: {
    inflow: string;
    outflow: string;
    net: string;
    overdue: { inflow: string; outflow: string };
    composition: BudgetV2OpenComposition;
  };
}

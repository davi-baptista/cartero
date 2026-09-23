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

export interface BudgetV2Realized {
  inflow: string;
  outflow: string;
  balance: string;
}

export interface BudgetV2Open {
  inflow: string;
  outflow: string;
  net: string;
  overdue: {
    inflow: string;
    outflow: string;
  };
}

/** Current public response; open/future sections are added in later slices. */
export interface BudgetV2ResponseContract {
  period: BudgetV2Period;
  realized: BudgetV2Realized;
  open: BudgetV2Open;
  composition: {
    realized: BudgetV2RealizedComposition;
    open: BudgetV2OpenComposition;
  };
}

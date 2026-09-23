export enum BudgetV2PeriodPreset {
  LAST_30_DAYS = 'LAST_30_DAYS',
  THIS_MONTH = 'THIS_MONTH',
  LAST_MONTH = 'LAST_MONTH',
  ALL_TIME = 'ALL_TIME',
}

export interface BudgetV2Period {
  preset: BudgetV2PeriodPreset
  startDate: string | null
  endDate: string
  timeZone: string
}

export interface BudgetV2Realized {
  inflow: string
  outflow: string
  balance: string
}

export interface BudgetV2Pending {
  inflow: string
  outflow: string
  net: string
  overdue: {
    inflow: string
    outflow: string
  }
}

export interface BudgetV2RealizedComposition {
  manualIncome: string
  receivableReceipts: string
  personSettlementInflows: string
  manualDirectTransactions: string
  debtDirectSettlements: string
  invoiceSettlements: string
  personSettlementDirectOutflows: string
}

export interface BudgetV2UpcomingComposition {
  invoices: string
  debts: string
  receivables: string
}

export interface BudgetV2Response {
  period: BudgetV2Period
  realized: BudgetV2Realized
  pending: BudgetV2Pending
  resultAfterPending: string
  composition: {
    realized: BudgetV2RealizedComposition
    upcoming: BudgetV2UpcomingComposition
  }
}

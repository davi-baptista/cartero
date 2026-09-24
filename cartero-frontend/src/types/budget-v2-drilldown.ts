import type { BudgetV2Period, BudgetV2PeriodPreset } from './budget-v2'

export enum BudgetV2DrilldownBucket {
  MANUAL_INCOME = 'MANUAL_INCOME',
  RECEIVABLE_RECEIPTS = 'RECEIVABLE_RECEIPTS',
  PERSON_SETTLEMENT_INFLOW = 'PERSON_SETTLEMENT_INFLOW',
  DIRECT_EXPENSES = 'DIRECT_EXPENSES',
  DEBT_DIRECT_SETTLEMENTS = 'DEBT_DIRECT_SETTLEMENTS',
  INVOICE_SETTLEMENTS = 'INVOICE_SETTLEMENTS',
  PERSON_SETTLEMENT_DIRECT_OUTFLOW = 'PERSON_SETTLEMENT_DIRECT_OUTFLOW',
  UPCOMING_RECEIVABLES = 'UPCOMING_RECEIVABLES',
  UPCOMING_INVOICES = 'UPCOMING_INVOICES',
  UPCOMING_DEBTS = 'UPCOMING_DEBTS',
  OVERDUE_RECEIVABLES = 'OVERDUE_RECEIVABLES',
  OVERDUE_OUTFLOWS = 'OVERDUE_OUTFLOWS',
}

export type BudgetV2DrilldownItem =
  | {
      kind: 'TRANSACTION'
      id: string
      amount: string
      eventDate: string
      title: string
      description: string | null
      categoryName: string | null
      bankName: string | null
      paymentType: string
    }
  | {
      kind: 'RECEIVABLE_RECEIPT'
      id: string
      sourceId: string
      amount: string
      eventDate: string
      title: string
      description: string | null
      counterparty: string | null
      bankName: string | null
      paymentType: string
    }
  | {
      kind: 'PERSON_SETTLEMENT'
      id: string
      amount: string
      eventDate: string
      personId: string
      personName: string
      direction: 'INFLOW' | 'OUTFLOW'
      paymentType: string | null
      settlementTransactionId: string | null
      bankName: string | null
    }
  | {
      kind: 'DEBT_SETTLEMENT'
      id: string
      sourceId: string
      amount: string
      eventDate: string
      title: string
      description: string | null
      counterparty: string | null
      bankName: string | null
      paymentType: string
    }
  | {
      kind: 'INVOICE_SETTLEMENT'
      id: string
      sourceId: string
      amount: string
      eventDate: string
      dueDate: string
      month: number
      year: number
      bankName: string
      bankId: string
    }
  | {
      kind: 'RECEIVABLE'
      id: string
      amount: string
      dueDate: string
      title: string
      description: string | null
      counterparty: string
    }
  | {
      kind: 'INVOICE'
      id: string
      amount: string
      dueDate: string
      month: number
      year: number
      bankName: string
      bankId: string
    }
  | {
      kind: 'DEBT'
      id: string
      amount: string
      dueDate: string
      title: string
      description: string | null
      counterparty: string
    }

export interface BudgetV2DrilldownResponse {
  bucket: BudgetV2DrilldownBucket
  total: string
  context: {
    timeZone: string
    period?: BudgetV2Period
    pendingWindow?: {
      startDate: string
      endDateExclusive: string
    }
  }
  items: BudgetV2DrilldownItem[]
  pageInfo: {
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface BudgetV2DrilldownRequest {
  bucket: BudgetV2DrilldownBucket
  preset?: BudgetV2PeriodPreset
  cursor?: string
  limit?: number
}

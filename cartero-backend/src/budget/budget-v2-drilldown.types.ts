import type { BudgetV2Period, BudgetV2PeriodPreset } from './budget-v2.types';
import { BudgetV2Bucket } from './budget-v2-classification.helper';

export { BudgetV2Bucket as BudgetV2DrilldownBucket } from './budget-v2-classification.helper';

export type BudgetV2DrilldownItem =
  | {
      kind: 'TRANSACTION';
      id: string;
      amount: string;
      eventDate: string;
      title: string;
      description: string | null;
      categoryName: string | null;
      bankName: string | null;
      paymentType: string;
    }
  | {
      kind: 'RECEIVABLE_RECEIPT';
      id: string;
      sourceId: string;
      amount: string;
      eventDate: string;
      title: string;
      description: string | null;
      counterparty: string | null;
      bankName: string | null;
      paymentType: string;
    }
  | {
      kind: 'PERSON_SETTLEMENT';
      id: string;
      amount: string;
      eventDate: string;
      personId: string;
      personName: string;
      direction: 'INFLOW' | 'OUTFLOW';
      paymentType: string | null;
      settlementTransactionId: string | null;
      bankName: string | null;
    }
  | {
      kind: 'DEBT_SETTLEMENT';
      id: string;
      sourceId: string;
      amount: string;
      eventDate: string;
      title: string;
      description: string | null;
      counterparty: string | null;
      bankName: string | null;
      paymentType: string;
    }
  | {
      kind: 'INVOICE_SETTLEMENT';
      id: string;
      sourceId: string;
      transactionId: string | null;
      amount: string;
      eventDate: string;
      dueDate: string;
      month: number;
      year: number;
      bankName: string | null;
      bankId: string;
    }
  | {
      kind: 'RECEIVABLE';
      id: string;
      amount: string;
      dueDate: string;
      title: string;
      description: string | null;
      counterparty: string;
    }
  | {
      kind: 'INVOICE';
      id: string;
      amount: string;
      dueDate: string;
      month: number;
      year: number;
      bankName: string;
      bankId: string;
    }
  | {
      kind: 'DEBT';
      id: string;
      amount: string;
      dueDate: string;
      title: string;
      description: string | null;
      counterparty: string;
    };

export interface BudgetV2DrilldownResponse {
  bucket: BudgetV2Bucket;
  total: string;
  context: {
    timeZone: string;
    period?: BudgetV2Period;
    pendingWindow?: {
      startDate: string;
      endDateExclusive: string;
    };
  };
  items: BudgetV2DrilldownItem[];
  pageInfo: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export type BudgetV2DrilldownPreset = BudgetV2PeriodPreset | null;

export type UnlinkPreservationReason =
  | 'ALREADY_UNLINKED'
  | 'DIFFERENT_PERSON_LINK'
  | 'RECEIVABLE_ALREADY_PAID';

export interface UnlinkPreview {
  scope: 'ONE' | 'NEXT' | 'ALL';
  isInstallment: boolean;
  targetPersonId: string;
  targetPersonName: string;
  seriesTotal: number;
  eligibleIds: string[];
  eligibleCount: number;
  preservedCount: number;
  preserved: Array<{ id: string; reason: UnlinkPreservationReason }>;
  paidInvoiceEligibleCount: number;
}

export interface UnlinkTransactionDto {
  expectedEligibleIds?: string[];
}

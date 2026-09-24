import { shiftCivilDate } from 'src/common/helpers/financial-period.helper';

/** Future pending window for Budget receivables and debts, inclusive. */
export const BUDGET_PENDING_DUE_DAYS = 10;

/**
 * Returns the exclusive upper bound for the pending due-date window.
 * `today + 11` is exclusive, so `today + 10` remains included.
 */
export function budgetPendingHorizonExclusive(today: string): string {
  return shiftCivilDate(today, BUDGET_PENDING_DUE_DAYS + 1);
}

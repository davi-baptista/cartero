import { resumeRecurringMonth } from 'src/recurring-income/recurring-income.helper';

export function recurringExpenseLockKey(userId: string, ruleId: string) {
  return `recurring-expense-occurrences:${userId}:${ruleId}`;
}

/** The due date still belongs to the current cycle on that civil day. */
export function recurringExpenseResumeMonth(
  dayOfMonth: number,
  now: Date,
  timeZone: string,
) {
  return resumeRecurringMonth(dayOfMonth, now, timeZone);
}

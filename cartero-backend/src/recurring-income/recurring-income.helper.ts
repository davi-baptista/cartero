import {
  financialCivilDay,
  financialCivilParts,
} from 'src/common/helpers/financial-timezone.helper';
import { shiftCivilDate } from 'src/common/helpers/financial-period.helper';

export interface CivilMonth {
  year: number;
  month: number;
}

export function isRecurringMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function parseRecurringMonth(value: string): CivilMonth {
  if (!isRecurringMonth(value)) {
    throw new Error(`Invalid recurring month: ${value}`);
  }

  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

export function formatRecurringMonth({ year, month }: CivilMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function compareRecurringMonths(a: string, b: string): number {
  return a.localeCompare(b);
}

export function addRecurringMonths(month: string, amount: number): string {
  const parsed = parseRecurringMonth(month);
  const shifted = new Date(
    Date.UTC(parsed.year, parsed.month - 1 + amount, 1, 12),
  );
  return formatRecurringMonth({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  });
}

export function lastDayOfRecurringMonth(month: string): number {
  const parsed = parseRecurringMonth(month);
  return new Date(Date.UTC(parsed.year, parsed.month, 0, 12)).getUTCDate();
}

export function occurrenceDateForMonth(
  month: string,
  dayOfMonth: number,
): string {
  const day = Math.min(dayOfMonth, lastDayOfRecurringMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function defaultFirstOccurrence(
  now: Date,
  dayOfMonth: number,
  timeZone: string,
): string {
  const today = financialCivilDay(now, timeZone);
  const currentMonth = formatRecurringMonth(financialCivilParts(now, timeZone));
  return occurrenceDateForMonth(currentMonth, dayOfMonth) >= today
    ? currentMonth
    : addRecurringMonths(currentMonth, 1);
}

/** A resumed rule may include this month only while its due day has not passed. */
export function resumeRecurringMonth(
  dayOfMonth: number,
  now: Date,
  timeZone: string,
): string {
  const today = financialCivilDay(now, timeZone);
  const month = formatRecurringMonth(financialCivilParts(now, timeZone));
  return occurrenceDateForMonth(month, dayOfMonth) >= today
    ? month
    : addRecurringMonths(month, 1);
}

export function materializationHorizon(now: Date, timeZone: string): string {
  return shiftCivilDate(financialCivilDay(now, timeZone), 30);
}

export interface RecurringIncomePreview {
  firstOccurrence: string;
  horizonDate: string;
  occurrenceCount: number;
  overdueCount: number;
  notOverdueCount: number;
  currentMonthCount: number;
  nextOccurrenceDate: string | null;
  totalAmount: number;
}

export interface RecurringIncomeOccurrenceDate {
  month: string;
  dueDate: string;
}

/** Shared preview/materialization sequence; all dates use the account civil calendar. */
export function recurringIncomeOccurrenceDates(
  input: { firstOccurrence: string; dayOfMonth: number },
  now: Date,
  timeZone: string,
  horizonDate = materializationHorizon(now, timeZone),
): RecurringIncomeOccurrenceDate[] {
  const horizonMonth = horizonDate.slice(0, 7);
  let month = input.firstOccurrence;
  const occurrences: RecurringIncomeOccurrenceDate[] = [];

  while (compareRecurringMonths(month, horizonMonth) <= 0) {
    const dueDate = occurrenceDateForMonth(month, input.dayOfMonth);
    if (dueDate <= horizonDate) {
      occurrences.push({ month, dueDate });
    }
    month = addRecurringMonths(month, 1);
  }

  return occurrences;
}

function incomeMaterializationHorizon(
  input: { firstOccurrence: string; dayOfMonth: number },
  now: Date,
  timeZone: string,
): string {
  const currentMonth = formatRecurringMonth(financialCivilParts(now, timeZone));
  const nextDueMonth = defaultFirstOccurrence(now, input.dayOfMonth, timeZone);
  // A future-start rule may begin next calendar month, but not months away.
  const eligibleMonth =
    input.firstOccurrence <= addRecurringMonths(currentMonth, 1) &&
    input.firstOccurrence > nextDueMonth
      ? input.firstOccurrence
      : nextDueMonth;
  return occurrenceDateForMonth(eligibleMonth, input.dayOfMonth);
}

/** Income creates every past due occurrence and only the next not-yet-due month. */
export function incomeOccurrenceDates(
  input: { firstOccurrence: string; dayOfMonth: number },
  now: Date,
  timeZone: string,
): RecurringIncomeOccurrenceDate[] {
  const horizonDate = incomeMaterializationHorizon(input, now, timeZone);
  return recurringIncomeOccurrenceDates(input, now, timeZone, horizonDate);
}

/** Preview authority shared with materialization; it does not write data. */
export function previewRecurringIncome(
  input: { firstOccurrence: string; dayOfMonth: number; amount: number },
  now: Date,
  timeZone: string,
): RecurringIncomePreview {
  const today = financialCivilDay(now, timeZone);
  const currentMonth = formatRecurringMonth(financialCivilParts(now, timeZone));
  const horizonDate = incomeMaterializationHorizon(input, now, timeZone);
  const occurrences = incomeOccurrenceDates(
    { firstOccurrence: input.firstOccurrence, dayOfMonth: input.dayOfMonth },
    now,
    timeZone,
  );
  const occurrenceCount = occurrences.length;
  const overdueCount = occurrences.filter(
    ({ dueDate }) => dueDate < today,
  ).length;
  const currentMonthCount = occurrences.filter(
    ({ month }) => month === currentMonth,
  ).length;

  return {
    firstOccurrence: input.firstOccurrence,
    horizonDate,
    occurrenceCount,
    overdueCount,
    notOverdueCount: occurrenceCount - overdueCount,
    currentMonthCount,
    nextOccurrenceDate:
      occurrences.find(({ dueDate }) => dueDate > today)?.dueDate ?? null,
    totalAmount: occurrenceCount * input.amount,
  };
}

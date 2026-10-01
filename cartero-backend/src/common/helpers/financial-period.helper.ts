import {
  financialCivilDay,
  financialCivilParts,
} from './financial-timezone.helper';
import { requireAccountTimeZone } from './timezone.helper';
import {
  BudgetV2PeriodPreset,
  type BudgetV2Period,
} from 'src/budget/budget-v2.types';

const DAY_MS = 24 * 60 * 60 * 1000;

function civilDateAtUtcNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function shiftCivilDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return shifted.toISOString().slice(0, 10);
}

function firstInstantOfFinancialDay(date: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const center = civilDateAtUtcNoon(year, month, day);
  let low = center.getTime() - 2 * DAY_MS;
  let high = center.getTime() + 2 * DAY_MS;

  // Find the first instant whose account-local civil date is the target day.
  // The search remains correct when the local midnight is shifted by DST.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (financialCivilDay(new Date(middle), timeZone) >= date) high = middle;
    else low = middle;
  }
  return new Date(high);
}

export interface FinancialPeriodNow {
  now?: Date;
}

export function financialCivilDateStart(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0));
}

export interface BudgetV2PeriodBounds {
  period: BudgetV2Period;
  startInclusive: Date | null;
  endExclusive: Date;
}

export function deriveBudgetV2PeriodBounds(
  preset: BudgetV2PeriodPreset,
  accountTimeZone: string | null | undefined,
  { now = new Date() }: FinancialPeriodNow = {},
): BudgetV2PeriodBounds {
  const timeZone = requireAccountTimeZone(
    accountTimeZone,
    'budget v2 account timezone',
  );
  const today = financialCivilDay(now, timeZone);
  const { year, month } = financialCivilParts(now, timeZone);
  const currentMonthStart = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = new Date(Date.UTC(year, month, 1, 12));
  const nextMonthStart = nextMonth.toISOString().slice(0, 10);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1, 12));
  const previousMonthStart = previousMonth.toISOString().slice(0, 10);
  const tomorrow = shiftCivilDate(today, 1);

  let startDate: string | null;
  let endDate: string;
  switch (preset) {
    case BudgetV2PeriodPreset.MONTH:
      throw new Error('MONTH requires an explicit competence');
    case BudgetV2PeriodPreset.NEXT_MONTH:
      startDate = nextMonthStart;
      endDate = new Date(Date.UTC(year, month + 1, 1, 12))
        .toISOString()
        .slice(0, 10);
      break;
    case BudgetV2PeriodPreset.THIS_MONTH:
      startDate = currentMonthStart;
      endDate = nextMonthStart;
      break;
    case BudgetV2PeriodPreset.LAST_MONTH:
      startDate = previousMonthStart;
      endDate = currentMonthStart;
      break;
    case BudgetV2PeriodPreset.ALL_TIME:
      startDate = null;
      endDate = tomorrow;
      break;
    default:
      throw new Error(`Invalid Budget V2 period preset: ${String(preset)}`);
  }

  const endExclusive = firstInstantOfFinancialDay(endDate, timeZone);
  const startInclusive = startDate
    ? firstInstantOfFinancialDay(startDate, timeZone)
    : null;

  return {
    period: { preset, startDate, endDate, timeZone },
    startInclusive,
    endExclusive,
  };
}

export function deriveBudgetV2MonthBounds(
  month: number,
  year: number,
  accountTimeZone: string | null | undefined,
): BudgetV2PeriodBounds {
  const timeZone = requireAccountTimeZone(
    accountTimeZone,
    'budget v2 account timezone',
  );
  const startDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 1, 12))
    .toISOString()
    .slice(0, 10);
  const endExclusive = firstInstantOfFinancialDay(endDate, timeZone);
  const startInclusive = firstInstantOfFinancialDay(startDate, timeZone);
  return {
    period: {
      preset: BudgetV2PeriodPreset.MONTH,
      startDate,
      endDate,
      timeZone,
    },
    startInclusive,
    endExclusive,
  };
}

export function deriveBudgetV2Period(
  preset: BudgetV2PeriodPreset,
  accountTimeZone: string | null | undefined,
  options: FinancialPeriodNow = {},
): BudgetV2Period {
  return deriveBudgetV2PeriodBounds(preset, accountTimeZone, options).period;
}

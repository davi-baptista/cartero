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

function shiftCivilDate(date: string, days: number): string {
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

export function deriveBudgetV2Period(
  preset: BudgetV2PeriodPreset,
  accountTimeZone: string | null | undefined,
  { now = new Date() }: FinancialPeriodNow = {},
): BudgetV2Period {
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
    case BudgetV2PeriodPreset.LAST_30_DAYS:
    default:
      startDate = shiftCivilDate(today, -29);
      endDate = tomorrow;
      break;
  }

  // Evaluate the boundaries here so invalid dates/timezone states fail before
  // a later aggregate query is added. The returned contract remains civil.
  firstInstantOfFinancialDay(endDate, timeZone);
  if (startDate) firstInstantOfFinancialDay(startDate, timeZone);

  return { preset, startDate, endDate, timeZone };
}

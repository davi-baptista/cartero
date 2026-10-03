import { describe, expect, it } from 'vitest';
import {
  addRecurringMonths,
  defaultFirstOccurrence,
  materializationHorizon,
  occurrenceDateForMonth,
  previewRecurringIncome,
} from './recurring-income.helper';

describe('recurring income civil calendar', () => {
  const zone = 'America/Sao_Paulo';

  it('uses the next month when this month day already passed', () => {
    expect(
      defaultFirstOccurrence(new Date('2026-09-23T12:00:00Z'), 5, zone),
    ).toBe('2026-10');
  });

  it('keeps the current month when the configured day is today or future', () => {
    expect(
      defaultFirstOccurrence(new Date('2026-09-02T12:00:00Z'), 5, zone),
    ).toBe('2026-09');
    expect(
      defaultFirstOccurrence(new Date('2026-09-05T12:00:00Z'), 5, zone),
    ).toBe('2026-09');
  });

  it.each([
    ['2026-02', 31, '2026-02-28'],
    ['2028-02', 31, '2028-02-29'],
    ['2026-04', 31, '2026-04-30'],
    ['2026-05', 31, '2026-05-31'],
  ])('clamps %s day %s to %s', (month, day, expected) => {
    expect(occurrenceDateForMonth(month, Number(day))).toBe(expected);
  });

  it('preserves month identity while advancing calendar months', () => {
    expect(addRecurringMonths('2026-12', 1)).toBe('2027-01');
    expect(addRecurringMonths('2028-01', 13)).toBe('2029-02');
  });

  it('uses an inclusive thirty-day civil horizon', () => {
    expect(materializationHorizon(new Date('2026-09-23T12:00:00Z'), zone)).toBe(
      '2026-10-23',
    );
  });

  it('previews past and upcoming occurrences with the same horizon authority', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2025-09', dayOfMonth: 5, amount: 5000 },
        new Date('2026-09-23T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      occurrenceCount: 14,
      overdueCount: 13,
      notOverdueCount: 1,
      currentMonthCount: 1,
      nextOccurrenceDate: '2026-10-05',
      totalAmount: 70000,
      horizonDate: '2026-10-23',
    });
  });

  it('counts retroactive occurrences, the current civil month, and the next future occurrence from one horizon', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2026-03', dayOfMonth: 1, amount: 5000 },
        new Date('2026-10-02T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      horizonDate: '2026-11-01',
      occurrenceCount: 9,
      overdueCount: 8,
      notOverdueCount: 1,
      currentMonthCount: 1,
      nextOccurrenceDate: '2026-11-01',
    });
  });

  it('matches the eight-occurrence October 1 retroactive example', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2026-03', dayOfMonth: 1, amount: 5000 },
        new Date('2026-10-01T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      horizonDate: '2026-10-31',
      occurrenceCount: 8,
      overdueCount: 7,
      currentMonthCount: 1,
      nextOccurrenceDate: null,
    });
  });

  it('includes only the eligible current and future occurrences for a new current-month source', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2026-10', dayOfMonth: 10, amount: 1800 },
        new Date('2026-10-02T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      occurrenceCount: 1,
      overdueCount: 0,
      notOverdueCount: 1,
      currentMonthCount: 1,
      nextOccurrenceDate: '2026-10-10',
    });
  });

  it('uses civil month boundaries for timezone differences and December to January', () => {
    const instant = new Date('2026-10-01T02:00:00Z');
    const saoPaulo = previewRecurringIncome(
      { firstOccurrence: '2026-09', dayOfMonth: 1, amount: 100 },
      instant,
      zone,
    );
    const tokyo = previewRecurringIncome(
      { firstOccurrence: '2026-10', dayOfMonth: 1, amount: 100 },
      instant,
      'Asia/Tokyo',
    );
    expect(saoPaulo).toMatchObject({
      currentMonthCount: 1,
      nextOccurrenceDate: '2026-10-01',
    });
    expect(tokyo).toMatchObject({
      overdueCount: 0,
      currentMonthCount: 1,
      nextOccurrenceDate: null,
    });

    expect(
      previewRecurringIncome(
        { firstOccurrence: '2026-11', dayOfMonth: 1, amount: 100 },
        new Date('2026-12-15T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      horizonDate: '2027-01-14',
      occurrenceCount: 3,
      overdueCount: 2,
      currentMonthCount: 1,
      nextOccurrenceDate: '2027-01-01',
    });
  });

  it('uses month-end clamping and excludes dates beyond the horizon', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2026-09', dayOfMonth: 31, amount: 2000 },
        new Date('2026-09-23T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({ occurrenceCount: 1, overdueCount: 0, totalAmount: 2000 });
  });

  it('includes a future-start occurrence only when its due date is within the horizon', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2026-10', dayOfMonth: 5, amount: 1800 },
        new Date('2026-09-23T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      occurrenceCount: 1,
      overdueCount: 0,
      currentMonthCount: 0,
      nextOccurrenceDate: '2026-10-05',
    });
  });

  it('keeps leap-day preview dates in the account civil calendar', () => {
    expect(
      previewRecurringIncome(
        { firstOccurrence: '2028-02', dayOfMonth: 29, amount: 1000 },
        new Date('2028-02-01T12:00:00Z'),
        zone,
      ),
    ).toMatchObject({
      occurrenceCount: 1,
      overdueCount: 0,
      currentMonthCount: 1,
      nextOccurrenceDate: '2028-02-29',
    });
  });
});

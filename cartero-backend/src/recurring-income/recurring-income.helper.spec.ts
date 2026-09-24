import { describe, expect, it } from 'vitest';
import {
  addRecurringMonths,
  defaultFirstOccurrence,
  materializationHorizon,
  occurrenceDateForMonth,
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
});

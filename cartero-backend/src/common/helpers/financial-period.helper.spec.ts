import { describe, expect, it } from 'vitest';
import {
  deriveBudgetV2MonthBounds,
  deriveBudgetV2Period,
  financialCivilDateStart,
} from './financial-period.helper';
import { BudgetV2PeriodPreset } from 'src/budget/budget-v2.types';

const now = new Date('2026-09-16T02:30:00.000Z');

describe('deriveBudgetV2Period', () => {
  it('derives arbitrary month competence without a rolling preset', () => {
    expect(
      deriveBudgetV2MonthBounds(2, 2028, 'America/Sao_Paulo').period,
    ).toMatchObject({
      preset: BudgetV2PeriodPreset.MONTH,
      startDate: '2028-02-01',
      endDate: '2028-03-01',
    });
  });

  it('starts civil date comparisons at UTC midnight', () => {
    expect(financialCivilDateStart('2026-09-16')).toEqual(
      new Date('2026-09-16T00:00:00.000Z'),
    );
  });

  it('derives the current civil month', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.THIS_MONTH,
      'America/Sao_Paulo',
      { now },
    );

    expect(period).toEqual({
      preset: BudgetV2PeriodPreset.THIS_MONTH,
      startDate: '2026-09-01',
      endDate: '2026-10-01',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it.each([
    [BudgetV2PeriodPreset.NEXT_MONTH, '2026-10-01', '2026-11-01'],
    [BudgetV2PeriodPreset.THIS_MONTH, '2026-09-01', '2026-10-01'],
    [BudgetV2PeriodPreset.LAST_MONTH, '2026-08-01', '2026-09-01'],
    [BudgetV2PeriodPreset.ALL_TIME, null, '2026-09-16'],
  ] as const)(
    'derives %s with an exclusive end',
    (preset, startDate, endDate) => {
      expect(
        deriveBudgetV2Period(preset, 'America/Sao_Paulo', { now }),
      ).toMatchObject({
        preset,
        startDate,
        endDate,
      });
    },
  );

  it('uses the account civil date when UTC is already tomorrow', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.THIS_MONTH,
      'America/Sao_Paulo',
      { now: new Date('2026-09-17T02:00:00.000Z') },
    );

    expect(period.startDate).toBe('2026-09-01');
    expect(period.endDate).toBe('2026-10-01');
  });

  it('handles month and year boundaries as civil dates', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.THIS_MONTH,
      'Asia/Tokyo',
      { now: new Date('2027-01-01T00:30:00.000Z') },
    );

    expect(period.startDate).toBe('2027-01-01');
    expect(period.endDate).toBe('2027-02-01');
  });

  it('does not turn a DST transition into 30 elapsed 24-hour periods', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.THIS_MONTH,
      'Europe/Lisbon',
      { now: new Date('2026-11-01T00:30:00.000Z') },
    );

    expect(period.startDate).toBe('2026-11-01');
    expect(period.endDate).toBe('2026-12-01');
  });

  it('requires a valid configured timezone and never falls back', () => {
    expect(() =>
      deriveBudgetV2Period(BudgetV2PeriodPreset.THIS_MONTH, null, { now }),
    ).toThrow('Missing or invalid budget v2 account timezone');
    expect(() =>
      deriveBudgetV2Period(BudgetV2PeriodPreset.THIS_MONTH, 'Not/AZone', {
        now,
      }),
    ).toThrow('Missing or invalid budget v2 account timezone');
  });
});

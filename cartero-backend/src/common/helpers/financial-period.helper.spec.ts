import { describe, expect, it } from 'vitest';
import { deriveBudgetV2Period } from './financial-period.helper';
import { BudgetV2PeriodPreset } from 'src/budget/budget-v2.types';

const now = new Date('2026-09-16T02:30:00.000Z');

describe('deriveBudgetV2Period', () => {
  it('defaults conceptually to exactly 30 financial civil days', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.LAST_30_DAYS,
      'America/Sao_Paulo',
      { now },
    );

    expect(period).toEqual({
      preset: BudgetV2PeriodPreset.LAST_30_DAYS,
      startDate: '2026-08-17',
      endDate: '2026-09-16',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it.each([
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
      BudgetV2PeriodPreset.LAST_30_DAYS,
      'America/Sao_Paulo',
      { now: new Date('2026-09-17T02:00:00.000Z') },
    );

    expect(period.startDate).toBe('2026-08-18');
    expect(period.endDate).toBe('2026-09-17');
  });

  it('handles month and year boundaries as civil dates', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.LAST_30_DAYS,
      'Asia/Tokyo',
      { now: new Date('2027-01-01T00:30:00.000Z') },
    );

    expect(period.startDate).toBe('2026-12-03');
    expect(period.endDate).toBe('2027-01-02');
  });

  it('does not turn a DST transition into 30 elapsed 24-hour periods', () => {
    const period = deriveBudgetV2Period(
      BudgetV2PeriodPreset.LAST_30_DAYS,
      'Europe/Lisbon',
      { now: new Date('2026-11-01T00:30:00.000Z') },
    );

    expect(period.startDate).toBe('2026-10-03');
    expect(period.endDate).toBe('2026-11-02');
  });

  it('requires a valid configured timezone and never falls back', () => {
    expect(() =>
      deriveBudgetV2Period(BudgetV2PeriodPreset.LAST_30_DAYS, null, { now }),
    ).toThrow('Missing or invalid budget v2 account timezone');
    expect(() =>
      deriveBudgetV2Period(BudgetV2PeriodPreset.LAST_30_DAYS, 'Not/AZone', {
        now,
      }),
    ).toThrow('Missing or invalid budget v2 account timezone');
  });
});

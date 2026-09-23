import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GetBudgetV2DrilldownDto } from './get-budget-v2-drilldown.dto';
import { BudgetV2DrilldownBucket } from '../budget-v2-drilldown.types';
import { BudgetV2PeriodPreset } from '../budget-v2.types';

const validBucket = BudgetV2DrilldownBucket.MANUAL_INCOME;

async function errors(input: Record<string, unknown>) {
  return validate(plainToInstance(GetBudgetV2DrilldownDto, input));
}

describe('GetBudgetV2DrilldownDto', () => {
  it('accepts a valid bucket and optional preset', async () => {
    expect(
      await errors({
        bucket: validBucket,
        preset: BudgetV2PeriodPreset.LAST_30_DAYS,
      }),
    ).toHaveLength(0);
  });

  it('rejects invalid or missing bucket', async () => {
    expect(await errors({ bucket: 'NOT_A_BUCKET' })).not.toHaveLength(0);
    expect(await errors({})).not.toHaveLength(0);
  });

  it('validates preset as an enum when supplied', async () => {
    expect(
      await errors({ bucket: validBucket, preset: 'CUSTOM' }),
    ).not.toHaveLength(0);
    expect(await errors({ bucket: validBucket })).toHaveLength(0);
  });

  it.each([1, 20, 100, '1', '20', '100'])('accepts limit %s', async (limit) => {
    expect(await errors({ bucket: validBucket, limit })).toHaveLength(0);
  });

  it.each([0, -1, 101, 1.5, 'not-a-number'])(
    'rejects invalid limit %s',
    async (limit) => {
      expect(await errors({ bucket: validBucket, limit })).not.toHaveLength(0);
    },
  );

  it('defaults limit to twenty', () => {
    const dto = plainToInstance(GetBudgetV2DrilldownDto, {
      bucket: validBucket,
    });
    expect(dto.limit).toBe(20);
  });

  it('owns only cursor shape, not cursor semantics', async () => {
    expect(
      await errors({ bucket: validBucket, cursor: 'opaque-cursor' }),
    ).toHaveLength(0);
    expect(await errors({ bucket: validBucket, cursor: 42 })).not.toHaveLength(
      0,
    );
  });

  it('leaves bucket/preset compatibility rules to the service', async () => {
    expect(
      await errors({
        bucket: BudgetV2DrilldownBucket.UPCOMING_DEBTS,
        preset: BudgetV2PeriodPreset.ALL_TIME,
      }),
    ).toHaveLength(0);
    // The drilldown service owns the realized/pending cross-field rule.
  });
});

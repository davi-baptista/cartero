import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GetBudgetV2Dto } from './get-budget-v2.dto';
import { BudgetV2PeriodPreset } from '../budget-v2.types';

describe('GetBudgetV2Dto', () => {
  it('defaults to THIS_MONTH when preset is omitted', async () => {
    const dto = plainToInstance(GetBudgetV2Dto, {});

    expect(dto.preset).toBe(BudgetV2PeriodPreset.THIS_MONTH);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unsupported presets', async () => {
    const dto = plainToInstance(GetBudgetV2Dto, { preset: 'CUSTOM' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([0, 13, 1.5, 'bad'])('rejects invalid month %s', async (month) => {
    const dto = plainToInstance(GetBudgetV2Dto, { month, year: 2026 });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([0, 10000, 2026.5, 'bad'])(
    'rejects invalid year %s',
    async (year) => {
      const dto = plainToInstance(GetBudgetV2Dto, { month: 9, year });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );
});

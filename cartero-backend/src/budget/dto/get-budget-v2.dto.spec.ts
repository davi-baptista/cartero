import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GetBudgetV2Dto } from './get-budget-v2.dto';
import { BudgetV2PeriodPreset } from '../budget-v2.types';

describe('GetBudgetV2Dto', () => {
  it('defaults to LAST_30_DAYS when preset is omitted', async () => {
    const dto = plainToInstance(GetBudgetV2Dto, {});

    expect(dto.preset).toBe(BudgetV2PeriodPreset.LAST_30_DAYS);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unsupported presets', async () => {
    const dto = plainToInstance(GetBudgetV2Dto, { preset: 'CUSTOM' });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});

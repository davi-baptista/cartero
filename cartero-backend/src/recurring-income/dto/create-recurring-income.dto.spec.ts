import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateRecurringIncomeDto } from './create-recurring-income.dto';

const base = {
  title: 'Salário',
  amount: 5000,
  dayOfMonth: 5,
  counterpartyName: 'Empresa',
};

describe('CreateRecurringIncomeDto.firstOccurrence', () => {
  it('requires a competence', async () => {
    const errors = await validate(
      plainToInstance(CreateRecurringIncomeDto, base),
    );

    expect(errors.some((error) => error.property === 'firstOccurrence')).toBe(
      true,
    );
  });

  it('accepts a valid YYYY-MM competence', async () => {
    const errors = await validate(
      plainToInstance(CreateRecurringIncomeDto, {
        ...base,
        firstOccurrence: '2026-09',
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid month or format', async () => {
    const errors = await validate(
      plainToInstance(CreateRecurringIncomeDto, {
        ...base,
        firstOccurrence: '2026-13',
      }),
    );

    expect(errors.some((error) => error.property === 'firstOccurrence')).toBe(
      true,
    );
  });
});

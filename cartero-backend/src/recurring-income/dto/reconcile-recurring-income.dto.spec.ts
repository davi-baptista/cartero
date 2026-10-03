import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ReconcileRecurringIncomeDto } from './reconcile-recurring-income.dto';

describe('ReconcileRecurringIncomeDto HTTP validation', () => {
  const validationPipe = new ValidationPipe({
    transform: true,
    whitelist: true,
  });

  async function validate(body: Record<string, unknown>) {
    return validationPipe.transform(body, {
      type: 'body',
      metatype: ReconcileRecurringIncomeDto,
    });
  }

  it.each([1, 10, 12])('accepts month %i and year 2026', async (month) => {
    await expect(validate({ month, year: 2026 })).resolves.toMatchObject({
      month,
      year: 2026,
    });
  });

  it.each([0, 13])('rejects month %i', async (month) => {
    await expect(validate({ month, year: 2026 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts { month: 10, year: 2026 } through the ValidationPipe', async () => {
    await expect(validate({ month: 10, year: 2026 })).resolves.toMatchObject({
      month: 10,
      year: 2026,
    });
  });

  it('rejects a year below the service minimum', async () => {
    await expect(validate({ month: 10, year: 1899 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

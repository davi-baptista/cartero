import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.constants';
import { CursorPaginationDto } from './pagination.dto';

async function errors(input: Record<string, unknown>) {
  return validate(plainToInstance(CursorPaginationDto, input));
}

describe('cursor pagination DTO', () => {
  it('uses the established Budget page-size policy', () => {
    expect(DEFAULT_PAGE_LIMIT).toBe(20);
    expect(MAX_PAGE_LIMIT).toBe(100);
    expect(plainToInstance(CursorPaginationDto, {}).limit).toBe(
      DEFAULT_PAGE_LIMIT,
    );
  });

  it('accepts positive bounded integer limits and opaque cursor strings', async () => {
    expect(
      await errors({ limit: '100', cursor: 'eyJ2ZXJzaW9uIjoxfQ' }),
    ).toHaveLength(0);
  });

  it.each([
    { limit: '0' },
    { limit: '-1' },
    { limit: '1.5' },
    { limit: '101' },
  ])('rejects invalid limits: $limit', async (input) =>
    expect(await errors(input)).not.toHaveLength(0),
  );

  it('bounds cursor length', async () => {
    expect(await errors({ cursor: 'a'.repeat(2049) })).not.toHaveLength(0);
  });
});

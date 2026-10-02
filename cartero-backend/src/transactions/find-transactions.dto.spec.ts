import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { FindTransactionsDto } from './dto/find-transactions.dto';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from 'src/common/pagination/pagination.constants';

describe('FindTransactionsDto cursor mode', () => {
  it('keeps pagination opt-in for existing list consumers', () => {
    const legacy = plainToInstance(FindTransactionsDto, {
      startDate: '2026-09-01',
    });
    expect(legacy.limit).toBeUndefined();
    expect(DEFAULT_PAGE_LIMIT).toBe(20);
    expect(MAX_PAGE_LIMIT).toBe(100);
  });

  it('accepts the statement filters and transforms bounded limit', async () => {
    const dto = plainToInstance(FindTransactionsDto, {
      limit: '50',
      search: 'Rafael',
      group: 'direct',
    });
    expect(dto.limit).toBe(50);
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '1.2' },
    { group: 'unknown' },
    { search: 'x'.repeat(121) },
  ])('rejects invalid paging filters: %o', async (input) => {
    expect(
      await validate(plainToInstance(FindTransactionsDto, input)),
    ).not.toHaveLength(0);
  });
});

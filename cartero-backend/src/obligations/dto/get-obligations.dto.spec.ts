import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from 'src/common/pagination/pagination.constants';
import { GetObligationsDto } from './get-obligations.dto';

async function errors(input: Record<string, unknown>) {
  return validate(plainToInstance(GetObligationsDto, input));
}

describe('GetObligationsDto', () => {
  it('requires section, defaults domain, and inherits bounded page size', async () => {
    const missing = await errors({});
    expect(missing.some((error) => error.property === 'section')).toBe(true);
    const dto = plainToInstance(GetObligationsDto, { section: 'OVERDUE' });
    expect(dto.domain).toBe('ALL');
    expect(dto.limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(MAX_PAGE_LIMIT).toBe(100);
  });

  it('trims search before enforcing its maximum length', async () => {
    const dto = plainToInstance(GetObligationsDto, {
      section: 'OPEN',
      search: '  aluguel  ',
    });
    expect(dto.search).toBe('aluguel');
    expect(
      await errors({ section: 'OPEN', search: 'x'.repeat(101) }),
    ).not.toHaveLength(0);
  });

  it.each([
    { section: 'INVALID' },
    { section: 'OPEN', domain: 'INVALID' },
    { section: 'OPEN', month: '13', year: '2026' },
    { section: 'OPEN', month: '10', year: '0' },
    { section: 'OPEN', personId: 'not-a-uuid' },
    { section: 'OPEN', limit: '101' },
  ])(
    'rejects invalid enum, period, person, or limit: $section',
    async (input) => {
      expect(await errors(input)).not.toHaveLength(0);
    },
  );
});

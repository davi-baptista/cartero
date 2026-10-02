import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_LIMIT } from 'src/common/pagination/pagination.constants';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeTransaction } from 'src/common/testing/fixtures';
import {
  decodeTransactionCursor,
  encodeTransactionCursor,
} from './transaction-cursor.helper';
import { TransactionsService } from './transactions.service';

const IDS = [
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
];
const SAME_DATE = new Date('2026-10-04T00:00:00.000Z');

function harness(
  rows = IDS.map((id, index) =>
    makeTransaction({
      id,
      date: SAME_DATE,
      title: `Movimento ${index + 1}`,
    }),
  ),
) {
  const findMany = vi.fn(async (...args: unknown[]) => {
    void args;
    return rows;
  });
  const service = new TransactionsService(
    { transaction: { findMany } } as unknown as PrismaService,
    {} as EntityValidationService,
  );
  return { service, findMany };
}

describe('TransactionsService.findAll timeline read model', () => {
  it('returns a bounded page with the last delivered row as cursor', async () => {
    const { service, findMany } = harness();
    const result = await service.findAll(USER_ID, { limit: 2 });

    expect(result).toMatchObject({
      items: [{ id: IDS[0] }, { id: IDS[1] }],
      pageInfo: { hasMore: true },
    });
    const page = result as {
      items: Array<{ id: string }>;
      pageInfo: { nextCursor: string | null; hasMore: boolean };
    };
    expect(page.pageInfo.nextCursor).toBeTruthy();
    expect(decodeTransactionCursor(page.pageInfo.nextCursor!).id).toBe(IDS[1]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('applies search, group and entity filters in the database query before limit', async () => {
    const { service, findMany } = harness();
    await service.findAll(USER_ID, {
      limit: 20,
      search: '  Rafael  ',
      bankId: 'bank-id',
      categoryId: 'category-id',
      type: 'PIX' as any,
      group: 'direct',
    });

    const args = findMany.mock.calls[0]?.[0] as {
      where: {
        userId: string;
        bankId: string;
        categoryId: string;
        type: string;
        AND: unknown[];
      };
      take: number;
    };
    expect(args.where).toMatchObject({
      userId: USER_ID,
      bankId: 'bank-id',
      categoryId: 'category-id',
      type: 'PIX',
    });
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        { type: { in: ['DEBIT_CARD', 'PIX', 'BOLETO'] } },
        expect.objectContaining({
          OR: expect.arrayContaining([
            { title: { contains: 'Rafael', mode: 'insensitive' } },
            { description: { contains: 'Rafael', mode: 'insensitive' } },
            {
              person: {
                is: { name: { contains: 'Rafael', mode: 'insensitive' } },
              },
            },
          ]),
        }),
      ]),
    );
    expect(args.take).toBe(21);
  });

  it('combines cursor with current filters and rejects an invalid cursor', async () => {
    const { service, findMany } = harness();
    const cursor = encodeTransactionCursor(SAME_DATE, IDS[0]);
    await service.findAll(USER_ID, { cursor, categoryId: 'category-id' });
    const args = findMany.mock.calls[0]?.[0] as {
      where: { categoryId: string; AND: unknown[] };
      take: number;
    };
    expect(args.where.categoryId).toBe('category-id');
    expect(args.where.AND).toContainEqual({
      OR: [
        { date: { lt: SAME_DATE } },
        { date: SAME_DATE, id: { lt: IDS[0] } },
      ],
    });
    expect(args.take).toBe(DEFAULT_PAGE_LIMIT + 1);
    await expect(
      service.findAll(USER_ID, { cursor: 'invalid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps legacy date-filtered consumers on the array response', async () => {
    const { service, findMany } = harness();
    const result = await service.findAll(USER_ID, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(Array.isArray(result)).toBe(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { date: 'desc' },
      }),
    );
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('take');
  });
});

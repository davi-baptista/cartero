import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  decodeTransactionCursor,
  encodeTransactionCursor,
  transactionCursorWhere,
  TRANSACTION_CURSOR_ORDER,
} from './transaction-cursor.helper';
import {
  buildCursorPage,
  encodeCursor,
} from 'src/common/pagination/cursor.helper';

const DATE = new Date('2026-10-03T12:30:00.000Z');
const ids = {
  z: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  y: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  x: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

function item(id: string, date: Date) {
  return { id, date };
}

function compareDesc(
  a: { date: Date; id: string },
  b: { date: Date; id: string },
) {
  return b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id);
}

describe('transaction cursor foundations', () => {
  it('round-trips its versioned ordering, exact timestamp, and UUID', () => {
    const encoded = encodeTransactionCursor(DATE, ids.z);
    expect(decodeTransactionCursor(encoded)).toEqual({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: DATE.toISOString(),
      id: ids.z,
    });
  });

  it.each([
    '%%%not-base64%%%',
    Buffer.from('{broken', 'utf8').toString('base64url'),
    encodeCursor({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: DATE.toISOString(),
    }),
    encodeCursor({
      version: 2,
      order: TRANSACTION_CURSOR_ORDER,
      date: DATE.toISOString(),
      id: ids.z,
    }),
    encodeCursor({
      version: 1,
      order: 'OTHER_ORDER',
      date: DATE.toISOString(),
      id: ids.z,
    }),
    encodeCursor({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: 'not-a-date',
      id: ids.z,
    }),
    encodeCursor({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: DATE.toISOString(),
      id: 'not-a-uuid',
    }),
    encodeCursor({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: DATE.toISOString(),
      id: ids.z,
      userId: 'untrusted',
    }),
  ])(
    'rejects malformed, incomplete, incompatible, or untrusted cursor payloads',
    (cursor) => {
      expect(() => decodeTransactionCursor(cursor)).toThrow(
        BadRequestException,
      );
    },
  );

  it('builds the lexicographic DESC continuation predicate', () => {
    expect(
      transactionCursorWhere(
        decodeTransactionCursor(encodeTransactionCursor(DATE, ids.y)),
      ),
    ).toEqual({
      OR: [{ date: { lt: DATE } }, { date: DATE, id: { lt: ids.y } }],
    });
  });

  it('paginates same-date records without duplicates or skips', () => {
    const rows = [
      item(ids.z, DATE),
      item(ids.y, DATE),
      item(ids.x, new Date('2026-10-02T12:30:00.000Z')),
    ].sort(compareDesc);
    const first = buildCursorPage(rows.slice(0, 3), 2, (last) => ({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: last.date.toISOString(),
      id: last.id,
    }));
    expect(first.items.map((row) => row.id)).toEqual([ids.z, ids.y]);
    expect(first.pageInfo.hasMore).toBe(true);
    expect(decodeTransactionCursor(first.pageInfo.nextCursor!).id).toBe(ids.y);

    const cursor = decodeTransactionCursor(first.pageInfo.nextCursor!);
    const nextRows = rows.filter(
      (row) =>
        row.date < new Date(cursor.date) ||
        (row.date.getTime() === new Date(cursor.date).getTime() &&
          row.id < cursor.id),
    );
    const second = buildCursorPage(nextRows, 2, (last) => ({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: last.date.toISOString(),
      id: last.id,
    }));
    expect(second.items.map((row) => row.id)).toEqual([ids.x]);
    expect(second.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });

  it('uses the last delivered row, not the lookahead row, as next cursor', () => {
    const rows = [item(ids.z, DATE), item(ids.y, DATE), item(ids.x, DATE)];
    const page = buildCursorPage(rows, 2, (last) => ({
      version: 1,
      order: TRANSACTION_CURSOR_ORDER,
      date: last.date.toISOString(),
      id: last.id,
    }));
    expect(decodeTransactionCursor(page.pageInfo.nextCursor!).id).toBe(ids.y);
  });

  it('keeps a stable cursor across inserts before it and deletes after it', () => {
    const cursor = decodeTransactionCursor(
      encodeTransactionCursor(DATE, ids.y),
    );
    const laterRows = [
      item(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        new Date('2026-10-04T00:00:00.000Z'),
      ),
      item(ids.z, DATE),
      item(ids.x, new Date('2026-10-02T12:30:00.000Z')),
    ];
    const next = laterRows.filter(
      (row) =>
        row.date < new Date(cursor.date) ||
        (row.date.getTime() === new Date(cursor.date).getTime() &&
          row.id < cursor.id),
    );
    expect(next.map((row) => row.id)).toEqual([ids.x]);
  });

  it('continues after a later row is deleted without offset drift', () => {
    const cursor = decodeTransactionCursor(
      encodeTransactionCursor(DATE, ids.y),
    );
    const remaining = [
      item(ids.z, DATE),
      item(ids.x, new Date('2026-10-02T12:30:00.000Z')),
    ];
    const next = remaining.filter(
      (row) =>
        row.date < new Date(cursor.date) ||
        (row.date.getTime() === new Date(cursor.date).getTime() &&
          row.id < cursor.id),
    );
    expect(next.map((row) => row.id)).toEqual([ids.x]);
  });
});

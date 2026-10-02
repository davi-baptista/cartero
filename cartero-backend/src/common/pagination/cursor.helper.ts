import { BadRequestException } from '@nestjs/common';

export type CursorPayload = { version: number } & Record<
  string,
  string | number | boolean | null
>;

/** JSON encoded as base64url keeps cursor fields structured and versionable. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor and validate its shape for the calling query.
 * Callers must validate ordering/scope fields; cursors never establish tenant
 * authority. Buffer's permissive decoder is constrained by a canonical
 * base64url roundtrip before parsing.
 */
export function decodeCursor<T extends CursorPayload>(
  encoded: string,
  isExpectedPayload: (value: unknown) => value is T,
  message = 'Invalid pagination cursor',
): T {
  try {
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
      throw new Error('invalid base64url');
    }
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) {
      throw new Error('non-canonical base64url');
    }
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isExpectedPayload(parsed)) throw new Error('invalid cursor payload');
    return parsed;
  } catch {
    throw new BadRequestException(message);
  }
}

/** Prisma-compatible keyset predicate for date/id ordering. */
export function dateIdCursorWhere(
  cursor: { date: Date; id: string } | null,
  direction: 'asc' | 'desc',
  dateField: string,
  idField = 'id',
): Record<string, unknown> | null {
  if (!cursor) return null;
  const afterDate = direction === 'desc' ? 'lt' : 'gt';
  const afterId = direction === 'desc' ? 'lt' : 'gt';
  return {
    OR: [
      { [dateField]: { [afterDate]: cursor.date } },
      {
        [dateField]: cursor.date,
        [idField]: { [afterId]: cursor.id },
      },
    ],
  };
}

export interface CursorPageInfo {
  hasMore: boolean;
  nextCursor: string | null;
}

/** Build page metadata from rows fetched with `take: limit + 1`. */
export function buildCursorPage<T, C extends CursorPayload>(
  rowsWithLookahead: T[],
  limit: number,
  toCursor: (lastDelivered: T) => C,
): { items: T[]; pageInfo: CursorPageInfo } {
  const hasMore = rowsWithLookahead.length > limit;
  const items = rowsWithLookahead.slice(0, limit);
  const lastDelivered = items.at(-1);
  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && lastDelivered ? encodeCursor(toCursor(lastDelivered)) : null,
    },
  };
}

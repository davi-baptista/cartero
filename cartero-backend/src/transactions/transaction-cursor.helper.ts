import { BadRequestException } from '@nestjs/common';
import {
  type CursorPayload,
  decodeCursor,
  encodeCursor,
  dateIdCursorWhere,
} from 'src/common/pagination/cursor.helper';

export const TRANSACTION_CURSOR_ORDER =
  'TRANSACTION_DATE_DESC_ID_DESC' as const;

export interface TransactionCursor extends CursorPayload {
  version: 1;
  order: typeof TRANSACTION_CURSOR_ORDER;
  date: string;
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isTransactionCursor(value: unknown): value is TransactionCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  if (keys.join(',') !== 'date,id,order,version') return false;
  if (
    payload.version !== 1 ||
    payload.order !== TRANSACTION_CURSOR_ORDER ||
    typeof payload.date !== 'string' ||
    typeof payload.id !== 'string' ||
    !UUID_PATTERN.test(payload.id)
  ) {
    return false;
  }
  const timestamp = new Date(payload.date);
  return (
    Number.isFinite(timestamp.getTime()) &&
    timestamp.toISOString() === payload.date
  );
}

export function encodeTransactionCursor(date: Date, id: string): string {
  if (!Number.isFinite(date.getTime()) || !UUID_PATTERN.test(id)) {
    throw new BadRequestException('Invalid transaction cursor values');
  }
  return encodeCursor({
    version: 1,
    order: TRANSACTION_CURSOR_ORDER,
    date: date.toISOString(),
    id,
  });
}

export function decodeTransactionCursor(encoded: string): TransactionCursor {
  return decodeCursor(
    encoded,
    isTransactionCursor,
    'Invalid transaction cursor',
  );
}

export function transactionCursorWhere(
  cursor: TransactionCursor | null,
): Record<string, unknown> | null {
  return dateIdCursorWhere(
    cursor ? { date: new Date(cursor.date), id: cursor.id } : null,
    'desc',
    'date',
  );
}

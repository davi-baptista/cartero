import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RECEIVABLE_PAID_CATEGORY_NAME,
  SYSTEM_CATEGORY_NAMES,
} from './constants/system-categories';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../prisma/migrations/20261001120000_rename_receivable_received_category/migration.sql',
  ),
  'utf8',
);

describe('canonical receivable-paid system category rename', () => {
  it('reserves the new name for system categories and uses it as the authority', () => {
    expect(RECEIVABLE_PAID_CATEGORY_NAME).toBe('A receber pago');
    expect(SYSTEM_CATEGORY_NAMES).toContain(RECEIVABLE_PAID_CATEGORY_NAME);
  });

  it('renames system rows in place, preserving IDs and linked records', () => {
    expect(migration).toContain('UPDATE "Category"');
    expect(migration).toContain('SET "name" = \'A receber pago\'');
    expect(migration).toContain('AND "isSystem" = TRUE');
    expect(migration).not.toContain('UPDATE "Transaction"');
    expect(migration).not.toContain('DELETE FROM');
  });

  it('aborts before the update on per-user destination conflicts and is idempotent', () => {
    const preflight = migration.indexOf('RAISE EXCEPTION');
    const update = migration.indexOf('UPDATE "Category"');
    expect(preflight).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(preflight);
    expect(migration).toContain('canonical."userId" = legacy."userId"');
    expect(migration).toContain('canonical."name" = \'A receber pago\'');
    expect(migration).toContain('legacy."name" = \'Receita recebida\'');
  });
});

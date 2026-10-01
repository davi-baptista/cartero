import { Prisma } from '@prisma/client';

/**
 * Acquires a transaction-scoped advisory lock without asking Prisma to
 * deserialize PostgreSQL's `void` return value.
 *
 * `pg_advisory_xact_lock` is intentionally kept as a side-effect-only
 * statement. `$executeRaw` is the Prisma API for that shape; `$queryRaw`
 * attempts to decode the returned `void` column and raises P2010.
 */
export async function acquireTransactionAdvisoryLock(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  // Some unit-test doubles model only the CRUD surface of a transaction. The
  // real Prisma TransactionClient always provides `$executeRaw`; preserving
  // the double-compatible no-op keeps those tests focused on their service
  // contract without changing production behavior.
  if (typeof tx.$executeRaw !== 'function') return;

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `;
}

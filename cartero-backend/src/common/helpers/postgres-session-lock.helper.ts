import { Client } from 'pg';

export type SessionLockResult<T> =
  | { acquired: false }
  | { acquired: true; value: T };

/**
 * Hold one dedicated PostgreSQL session for a long-running job. Prisma's
 * pooled queries cannot safely release a session advisory lock because a
 * later query may use a different connection. PostgreSQL releases the lock
 * when this session ends, including an ungraceful disconnect.
 */
export async function withPostgresSessionAdvisoryLock<T>(
  key: string,
  work: (assertLockHeld: () => Promise<void>) => Promise<T>,
  createClient: () => Client = () => {
    const connectionString =
      process.env.RECURRING_INCOME_LOCK_DATABASE_URL ??
      process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Recurring income lock database URL is missing');
    }
    // Session advisory locks require a direct PostgreSQL connection. Neon's
    // transaction pooler can return a different backend after each query.
    if (new URL(connectionString).hostname.includes('-pooler')) {
      throw new Error(
        'Recurring income session lock requires a direct database URL',
      );
    }
    return new Client({
      connectionString,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    });
  },
): Promise<SessionLockResult<T>> {
  const client = createClient();
  let acquired = false;
  let lockLost: Error | null = null;
  let outcome: SessionLockResult<T> | undefined;
  let failure: Error | undefined;

  client.on('error', (error: Error) => {
    lockLost = error;
  });
  client.on('end', () => {
    lockLost ??= new Error('PostgreSQL scheduler lock session ended');
  });

  try {
    await client.connect();
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    );
    if (!result.rows[0]?.acquired) {
      outcome = { acquired: false };
    } else {
      acquired = true;
      const assertLockHeld = async () => {
        if (lockLost) {
          throw new Error('PostgreSQL scheduler lock session lost', {
            cause: lockLost,
          });
        }
        await client.query('SELECT 1');
        if (lockLost) {
          throw new Error('PostgreSQL scheduler lock session lost', {
            cause: lockLost,
          });
        }
      };

      const value = await work(assertLockHeld);
      await assertLockHeld();
      outcome = { acquired: true, value };
    }
  } catch (error) {
    failure =
      error instanceof Error ? error : new Error('Scheduler lock failed');
  }

  try {
    if (acquired && !lockLost) {
      const release = await client.query<{ released: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
        [key],
      );
      if (!release.rows[0]?.released) {
        throw new Error('PostgreSQL scheduler advisory lock was not released');
      }
    }
  } catch (error) {
    failure ??=
      error instanceof Error
        ? error
        : new Error('Scheduler lock release failed');
  }
  try {
    await client.end();
  } catch (error) {
    failure ??=
      error instanceof Error
        ? error
        : new Error('Scheduler lock cleanup failed');
  }

  if (failure) throw failure;
  if (!outcome) throw new Error('Scheduler lock finished without a result');
  return outcome;
}

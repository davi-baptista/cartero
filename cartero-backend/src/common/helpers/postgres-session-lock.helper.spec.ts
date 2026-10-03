import { EventEmitter } from 'node:events';
import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { withPostgresSessionAdvisoryLock } from './postgres-session-lock.helper';

function fakeConnections() {
  const held = new Set<string>();
  const clients: FakeClient[] = [];

  class FakeClient extends EventEmitter {
    ended = false;
    private key: string | null = null;

    async connect() {}

    async query(sql: string, values: string[] = []) {
      const key = values[0];
      if (sql.includes('pg_try_advisory_lock')) {
        if (held.has(key)) return { rows: [{ acquired: false }] };
        held.add(key);
        this.key = key;
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        const released = this.key === key && held.delete(key);
        this.key = null;
        return { rows: [{ released }] };
      }
      return { rows: [{ '?column?': 1 }] };
    }

    async end() {
      this.ended = true;
      if (this.key) held.delete(this.key);
      this.emit('end');
    }
  }

  return {
    held,
    clients,
    createClient: () => {
      const client = new FakeClient();
      clients.push(client);
      return client as unknown as Client;
    },
  };
}

describe('PostgreSQL session advisory lock', () => {
  it('lets one global run proceed and skips a concurrent instance', async () => {
    const connections = fakeConnections();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const first = withPostgresSessionAdvisoryLock(
      'recurring-income-scheduler',
      async () => {
        signalAcquired();
        await wait;
        return 'processed';
      },
      connections.createClient,
    );
    await acquired;

    const second = await withPostgresSessionAdvisoryLock(
      'recurring-income-scheduler',
      async () => 'must-not-run',
      connections.createClient,
    );
    expect(second).toEqual({ acquired: false });

    release();
    expect(await first).toEqual({ acquired: true, value: 'processed' });
    expect(connections.held.size).toBe(0);
    expect(connections.clients.every((client) => client.ended)).toBe(true);
  });

  it('releases the session lock when the job fails', async () => {
    const connections = fakeConnections();
    await expect(
      withPostgresSessionAdvisoryLock(
        'recurring-income-scheduler',
        async () => {
          throw new Error('job failed');
        },
        connections.createClient,
      ),
    ).rejects.toThrow('job failed');

    expect(connections.held.size).toBe(0);
    expect(
      await withPostgresSessionAdvisoryLock(
        'recurring-income-scheduler',
        async () => 'retry',
        connections.createClient,
      ),
    ).toEqual({ acquired: true, value: 'retry' });
  });

  it('stops work after the dedicated lock connection is lost', async () => {
    const connections = fakeConnections();
    await expect(
      withPostgresSessionAdvisoryLock(
        'recurring-income-scheduler',
        async (assertLockHeld) => {
          connections.clients[0].emit('error', new Error('connection lost'));
          await assertLockHeld();
        },
        connections.createClient,
      ),
    ).rejects.toThrow('session lost');
    expect(connections.held.size).toBe(0);
  });

  it('rejects a Neon transaction-pooler URL for a session lock', async () => {
    vi.stubEnv('RECURRING_INCOME_LOCK_DATABASE_URL', undefined);
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://user:pass@ep-example-pooler.region.aws.neon.tech/db',
    );
    try {
      await expect(
        withPostgresSessionAdvisoryLock(
          'recurring-income-scheduler',
          async () => undefined,
        ),
      ).rejects.toThrow('direct database URL');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

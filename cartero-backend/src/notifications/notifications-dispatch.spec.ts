import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';
import * as webpush from 'web-push';

vi.mock('web-push', () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function harness(userCount = 1) {
  const subscriptions: Subscription[] = [];
  const users = Array.from({ length: userCount }, (_, index) => {
    const id = `user-${index}`;
    const subscription = {
      id: `sub-${index}`,
      endpoint: `https://push/${index}`,
      p256dh: 'p',
      auth: 'a',
    };
    subscriptions.push(subscription);
    return {
      id,
      notifyDaysBefore: 0,
      timeZone: null,
      pushSubscriptions: [subscription],
    };
  });
  const occurrences: any[] = [];
  const deliveries: any[] = [];
  const reads = { users: 0, debts: 0, receivables: 0, invoices: 0 };
  const prisma: any = {
    user: {
      findMany: vi.fn(async () => {
        reads.users++;
        return users;
      }),
    },
    debt: {
      findMany: vi.fn(async () => {
        reads.debts++;
        return users.map((user) => ({
          id: `debt-${user.id}`,
          userId: user.id,
          title: 'Conta',
          dueDate: new Date(),
        }));
      }),
    },
    receivable: {
      findMany: vi.fn(async () => {
        reads.receivables++;
        return [];
      }),
    },
    invoice: {
      findMany: vi.fn(async () => {
        reads.invoices++;
        return [];
      }),
    },
    notificationOccurrence: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const found = occurrences.find(
          (row) =>
            row.userId === where.userId_type_civilDay.userId &&
            row.type === where.userId_type_civilDay.type &&
            row.civilDay === where.userId_type_civilDay.civilDay,
        );
        if (found) return found;
        const row = { id: `occ-${occurrences.length}`, ...create };
        occurrences.push(row);
        return row;
      }),
    },
    notificationDelivery: {
      createMany: vi.fn(async ({ data }: any) => {
        for (const row of data) {
          if (
            !deliveries.some(
              (item) =>
                item.occurrenceId === row.occurrenceId &&
                item.pushSubscriptionId === row.pushSubscriptionId,
            )
          ) {
            deliveries.push({
              id: `delivery-${deliveries.length}`,
              ...row,
              status: 'PENDING',
              attempts: 0,
            });
          }
        }
        return { count: data.length };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = deliveries.find(
          (item) =>
            item.occurrenceId === where.occurrenceId &&
            item.pushSubscriptionId === where.pushSubscriptionId,
        );
        if (
          !row ||
          !(
            ['PENDING', 'FAILED'].includes(row.status) ||
            (row.status === 'SENDING' && row.leaseUntil < new Date())
          )
        )
          return { count: 0 };
        row.status = data.status;
        row.leaseUntil = data.leaseUntil;
        row.attempts++;
        row.lastError = data.lastError;
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: any) =>
        deliveries.find(
          (item) =>
            item.occurrenceId ===
              where.occurrenceId_pushSubscriptionId.occurrenceId &&
            item.pushSubscriptionId ===
              where.occurrenceId_pushSubscriptionId.pushSubscriptionId,
        ),
      ),
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(
          deliveries.find((item) => item.id === where.id),
          data,
        );
      }),
    },
    pushSubscription: {
      deleteMany: vi.fn(async ({ where }: any) => {
        for (let index = deliveries.length - 1; index >= 0; index--)
          if (deliveries[index].pushSubscriptionId === where.id)
            deliveries.splice(index, 1);
      }),
    },
  };
  const config: any = {
    get: vi.fn((key: string) =>
      key === 'VAPID_SUBJECT' ? 'mailto:test@example.com' : 'value',
    ),
  };
  return {
    service: new NotificationsService(prisma, config),
    prisma,
    occurrences,
    deliveries,
    reads,
    subscriptions,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
  vi.mocked(webpush.setVapidDetails).mockClear();
  vi.mocked(webpush.sendNotification).mockReset();
  vi.mocked(webpush.sendNotification).mockResolvedValue({} as never);
});

afterEach(() => vi.useRealTimers());

describe('durable notification dispatch', () => {
  it('deduplicates sequential and concurrent runs while preserving one delivery per device', async () => {
    const h = harness();
    await h.service.runDueDateCheck();
    const restartedService = new NotificationsService(h.prisma, {
      get: vi.fn((key: string) =>
        key === 'VAPID_SUBJECT' ? 'mailto:test@example.com' : 'value',
      ),
    } as any);
    await restartedService.runDueDateCheck();
    await h.service.runDueDateCheck();
    await Promise.all([
      h.service.runDueDateCheck(),
      h.service.runDueDateCheck(),
    ]);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(h.occurrences).toHaveLength(1);
    expect(h.deliveries[0].status).toBe('SENT');
  });

  it('uses a constant number of read queries for ten users', async () => {
    const h = harness(10);
    await h.service.runDueDateCheck();
    expect(h.reads).toEqual({
      users: 1,
      debts: 1,
      receivables: 1,
      invoices: 1,
    });
  });

  it('removes expired subscriptions on 410', async () => {
    for (const statusCode of [404, 410]) {
      vi.mocked(webpush.sendNotification).mockReset();
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode });
      const h = harness();
      await h.service.runDueDateCheck();
      expect(h.prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { id: 'sub-0' },
      });
      expect(h.deliveries).toHaveLength(0);
    }
  });

  it('retries transient failures without creating another occurrence', async () => {
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({} as never);
    const h = harness();
    await h.service.runDueDateCheck();
    await h.service.runDueDateCheck();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(h.occurrences).toHaveLength(1);
    expect(h.deliveries[0].status).toBe('SENT');
  });

  it('creates a new logical occurrence on the next civil day', async () => {
    const h = harness();
    await h.service.runDueDateCheck();
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
    await h.service.runDueDateCheck();
    expect(h.occurrences).toHaveLength(2);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
  });
});

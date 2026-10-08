import { BadRequestException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

const userId = 'user-1';
const realBank = {
  id: 'bank-1',
  userId,
  name: 'Cartão',
  isSystem: false,
  isArchived: false,
};
const systemBank = {
  id: 'no-bank',
  userId,
  name: '__system_receivables__',
  isSystem: true,
  isArchived: false,
};

function harness() {
  let subscription: Record<string, unknown> | null = null;
  const prisma: any = {
    bank: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.id === realBank.id
          ? realBank
          : where.id === systemBank.id
            ? systemBank
            : null,
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        where.isSystem
          ? systemBank
          : where.id === realBank.id
            ? realBank
            : systemBank,
      ),
    },
    category: { findUnique: vi.fn(async () => ({ id: 'category-1', userId })) },
    subscription: {
      create: vi.fn(async ({ data }: any) => {
        subscription = {
          id: 'subscription-1',
          isActive: true,
          lastGeneratedFor: null,
          activeSince: null,
          ...data,
        };
        return subscription;
      }),
      findFirst: vi.fn(
        async () =>
          subscription && {
            ...subscription,
            bank: subscription.bankId === systemBank.id ? systemBank : realBank,
          },
      ),
      update: vi.fn(async ({ data }: any) => {
        subscription = { ...subscription, ...data };
        return subscription;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    transaction: {
      create: vi.fn(async ({ data }: any) => ({
        id: 'transaction-1',
        ...data,
      })),
    },
  };
  prisma.$transaction = vi.fn(async (callback: (tx: any) => unknown) =>
    callback(prisma),
  );
  const service = new SubscriptionsService(
    prisma as PrismaService,
    new EntityValidationService(prisma as PrismaService),
  );
  (service as any).runForSubscription = vi.fn(async () => []);
  const input = (type: TransactionType, bankId?: string) => ({
    title: 'Netflix',
    categoryId: 'category-1',
    type,
    bankId,
    amount: 39.9,
    dayOfMonth: 12,
    startedAt: '2026-10',
  });
  return { prisma, service, input };
}

describe('Subscription bank contract', () => {
  it.each([
    TransactionType.DEBIT_CARD,
    TransactionType.PIX,
    TransactionType.BOLETO,
  ])(
    'uses the canonical internal bank for %s without a selected bank',
    async (type) => {
      const { prisma, service, input } = harness();
      await service.create(userId, input(type), 'America/Sao_Paulo');
      expect(prisma.subscription.create.mock.calls[0][0].data.bankId).toBe(
        systemBank.id,
      );
      expect(prisma.bank.findFirst).toHaveBeenCalledWith({
        where: { userId, isSystem: true, name: systemBank.name },
      });
    },
  );

  it('requires a real bank for credit at create and when changing a bankless rule to credit', async () => {
    const { prisma, service, input } = harness();
    await expect(
      service.create(
        userId,
        input(TransactionType.CREDIT_CARD),
        'America/Sao_Paulo',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    await service.create(
      userId,
      input(TransactionType.PIX),
      'America/Sao_Paulo',
    );
    await expect(
      service.update(
        'subscription-1',
        userId,
        { type: TransactionType.CREDIT_CARD },
        'America/Sao_Paulo',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(
        'subscription-1',
        userId,
        { type: TransactionType.CREDIT_CARD, bankId: realBank.id },
        'America/Sao_Paulo',
      ),
    ).resolves.toMatchObject({
      type: TransactionType.CREDIT_CARD,
      bankId: realBank.id,
    });
    await expect(
      service.update(
        'subscription-1',
        userId,
        { bankId: null },
        'America/Sao_Paulo',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps an optional selected bank, then clears it explicitly without making it required', async () => {
    const { prisma, service, input } = harness();
    await service.create(
      userId,
      input(TransactionType.CREDIT_CARD, realBank.id),
      'America/Sao_Paulo',
    );
    await service.update(
      'subscription-1',
      userId,
      { type: TransactionType.DEBIT_CARD },
      'America/Sao_Paulo',
    );
    expect(
      prisma.subscription.update.mock.calls[0][0].data.bankId,
    ).toBeUndefined();
    await service.update(
      'subscription-1',
      userId,
      { bankId: null },
      'America/Sao_Paulo',
    );
    expect(prisma.subscription.update.mock.calls[1][0].data.bankId).toBe(
      systemBank.id,
    );
  });

  it('materializes a bankless PIX rule into a Transaction on the canonical internal bank', async () => {
    const { prisma, service, input } = harness();
    const result = await service.create(
      userId,
      input(TransactionType.PIX),
      'America/Sao_Paulo',
    );
    (service as any).runForSubscription =
      SubscriptionsService.prototype['runForSubscription'];
    await (service as any).runForSubscription(
      result.subscription,
      new Date('2026-10-31T12:00:00Z'),
      'America/Sao_Paulo',
    );
    expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
      bankId: systemBank.id,
      type: TransactionType.PIX,
      subscriptionId: result.subscription.id,
    });
    expect(
      prisma.transaction.create.mock.calls[0][0].data.invoiceId,
    ).toBeUndefined();
  });

  it('previews a non-credit rule without a bank and rejects credit without one', async () => {
    const { service } = harness();
    await expect(
      service.previewFor(
        userId,
        undefined,
        'category-1',
        12,
        '2026-09',
        TransactionType.PIX,
        new Date('2026-10-31T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ skipped: false })]),
    );
    await expect(
      service.previewFor(
        userId,
        undefined,
        'category-1',
        12,
        '2026-09',
        TransactionType.CREDIT_CARD,
        new Date('2026-10-31T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

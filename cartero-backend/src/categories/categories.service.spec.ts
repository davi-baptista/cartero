import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CategoriesService } from './categories.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * Excluir categoria em uso batia na FK `ON DELETE RESTRICT` e virava um 500
 * genérico. Agora a recusa é um conflito de domínio que a interface consegue
 * explicar. Categoria sem uso continua excluível; a de sistema segue protegida
 * pela regra anterior.
 */

function makeCategory(
  overrides: Partial<{ id: string; isSystem: boolean }> = {},
) {
  return {
    id: 'cat-1',
    userId: USER_ID,
    name: 'Mercado',
    icon: null,
    color: null,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildHarness(options: {
  category?: ReturnType<typeof makeCategory>;
  transactions?: number;
  subscriptions?: number;
}) {
  const category = options.category ?? makeCategory();
  const calls = { deleted: false };

  const prisma = {
    category: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => makeCategory(data)),
      update: vi.fn(async ({ data }: any) => ({ ...category, ...data })),
      delete: vi.fn(async () => {
        calls.deleted = true;
        return category;
      }),
    },
    transaction: {
      count: vi.fn().mockResolvedValue(options.transactions ?? 0),
    },
    subscription: {
      count: vi.fn().mockResolvedValue(options.subscriptions ?? 0),
    },
  } as unknown as PrismaService;

  const validation = {
    validateCategory: vi.fn().mockResolvedValue(category),
  } as unknown as EntityValidationService;

  return {
    service: new CategoriesService(prisma, validation),
    prisma,
    calls,
  };
}

describe('CategoriesService.remove — categoria sem uso', () => {
  it('exclui normalmente', async () => {
    const harness = buildHarness({});

    await harness.service.remove('cat-1', USER_ID);

    expect(harness.calls.deleted).toBe(true);
  });

  it('verifica os dois vínculos antes de excluir', async () => {
    const harness = buildHarness({});

    await harness.service.remove('cat-1', USER_ID);

    expect(harness.prisma.transaction.count).toHaveBeenCalled();
    expect(harness.prisma.subscription.count).toHaveBeenCalled();
  });
});

describe('CategoriesService.remove — categoria de sistema', () => {
  it('continua protegida', async () => {
    const harness = buildHarness({
      category: makeCategory({ isSystem: true }),
    });

    await expect(harness.service.remove('cat-1', USER_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('nem chega a contar vínculos — a proteção vem antes', async () => {
    const harness = buildHarness({
      category: makeCategory({ isSystem: true }),
    });

    await expect(harness.service.remove('cat-1', USER_ID)).rejects.toThrow();

    expect(harness.prisma.transaction.count).not.toHaveBeenCalled();
    expect(harness.calls.deleted).toBe(false);
  });
});

describe('CATEGORY_IN_USE — categoria vinculada a registros', () => {
  it('recusa quando há transações', async () => {
    const harness = buildHarness({ transactions: 4 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATEGORY_IN_USE' }),
    });
  });

  it('recusa quando há assinaturas — o categoryId delas é obrigatório', async () => {
    const harness = buildHarness({ subscriptions: 1 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATEGORY_IN_USE' }),
    });
  });

  it('responde 409 Conflict, não 500', async () => {
    const harness = buildHarness({ transactions: 1 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('nada é apagado quando a exclusão é recusada', async () => {
    const harness = buildHarness({ transactions: 1 });

    await expect(harness.service.remove('cat-1', USER_ID)).rejects.toThrow();

    expect(harness.calls.deleted).toBe(false);
  });

  it('informa a contagem do que impede', async () => {
    const harness = buildHarness({ transactions: 5, subscriptions: 2 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        details: { transactions: 5, subscriptions: 2 },
      }),
    });
  });

  it('a mensagem usa singular quando há apenas um registro', async () => {
    const harness = buildHarness({ transactions: 1 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('1 transação'),
      }),
    });
  });

  it('a mensagem usa plural quando há vários', async () => {
    const harness = buildHarness({ transactions: 3 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('3 transações'),
      }),
    });
  });

  it('a mensagem cita os dois vínculos quando ambos existem', async () => {
    const harness = buildHarness({ transactions: 2, subscriptions: 1 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('2 transações e 1 assinatura'),
      }),
    });
  });

  it('a mensagem não cita um vínculo que não existe', async () => {
    const harness = buildHarness({ transactions: 2 });

    await expect(
      harness.service.remove('cat-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.not.stringContaining('assinatura'),
      }),
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Idempotência da criação de assinatura (Fase 7B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O problema: a criação persiste a assinatura e SÓ DEPOIS gera os ciclos.
 * Falha na geração devolvia erro com o cadastro já criado, e o retry natural
 * do usuário produzia uma segunda assinatura.
 *
 * A solução NÃO é chave natural. O usuário pode legitimamente ter duas
 * "Netflix", no mesmo banco, com o mesmo valor — qualquer unique sobre
 * (userId, title) recusaria cadastro válido. `creationKey` identifica uma
 * TENTATIVA de requisição.
 *
 * Também não é uma transação gigante: cada ciclo confirmado isoladamente
 * permite retomar de onde parou, e envolver 15 ciclos num bloco
 * all-or-nothing desfaria trabalho bom por uma falha pontual.
 */

interface Setup {
  /** Linhas já existentes, indexadas por creationKey. */
  existingByKey?: Record<string, any>;
  /** Faz o create falhar com P2002 (corrida de inserção). */
  failCreateWithUniqueViolation?: boolean;
  /** Faz a geração de ciclos falhar. */
  failGeneration?: boolean;
}

function buildHarness(setup: Setup = {}) {
  const created: any[] = [];
  const bank = makeBank();

  const prisma: any = {
    subscription: {
      create: vi.fn(async ({ data }: any) => {
        if (setup.failCreateWithUniqueViolation) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed',
            { code: 'P2002', clientVersion: 'test' },
          );
        }
        const row = { id: `sub-${created.length + 1}`, ...data };
        created.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        // Recuperação por chave, quando o índice recusa a segunda inserção.
        if (where?.creationKey) {
          return setup.existingByKey?.[where.creationKey] ?? null;
        }
        // `findOne`, chamado no fim da criação: busca por id. Cobre tanto a
        // linha recém-criada quanto a recuperada no retry.
        if (where?.id) {
          const fromCreated = created.find((row) => row.id === where.id);
          if (fromCreated) return fromCreated;
          const fromExisting = Object.values(setup.existingByKey ?? {}).find(
            (row: any) => row.id === where.id,
          );
          return fromExisting ?? null;
        }
        return created[created.length - 1] ?? null;
      }),
      update: vi.fn(async ({ data }: any) => data),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
    },
    bank: {
      findUnique: vi.fn(async () => bank),
      findFirst: vi.fn(async () => bank),
    },
    category: {
      findFirst: vi.fn(async () => ({
        id: 'cat-sys',
        userId: USER_ID,
        name: 'Assinatura',
        isSystem: true,
      })),
      findUnique: vi.fn(async () => ({ id: 'cat-1', userId: USER_ID })),
      create: vi.fn(async ({ data }: any) => ({ id: 'cat-sys', ...data })),
    },
    invoice: { findFirst: vi.fn(async () => null), create: vi.fn() },
    transaction: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = new EntityValidationService(prisma as PrismaService);
  const service = new SubscriptionsService(prisma as PrismaService, validation);

  if (setup.failGeneration) {
    (service as any).runForSubscription = vi.fn(async () => {
      throw new Error('geração falhou');
    });
  } else {
    (service as any).runForSubscription = vi.fn(async () => [
      { cycle: '2026-08', date: new Date(), skipped: false },
    ]);
  }

  return { service, prisma, created };
}

const dto = (overrides: Record<string, unknown> = {}) =>
  ({
    title: 'Netflix',
    bankId: 'bank-1',
    type: 'PIX',
    amount: 39.9,
    dayOfMonth: 12,
    startedAt: '2026-08',
    ...overrides,
  }) as any;

describe('create — idempotência por chave', () => {
  it('primeira requisição cria a assinatura', async () => {
    const harness = buildHarness();

    const result = await harness.service.create(
      USER_ID,
      dto({ creationKey: 'key-a' }),
    );

    expect(harness.created).toHaveLength(1);
    expect(result.alreadyExisted).toBe(false);
    expect(harness.created[0].creationKey).toBe('key-a');
  });

  it('retry com a MESMA chave devolve a mesma assinatura', async () => {
    // Corrida de inserção: o índice recusa a segunda, e a vencedora é
    // recuperada em vez de o P2002 chegar ao usuário.
    const existing = {
      id: 'sub-existente',
      userId: USER_ID,
      creationKey: 'key-a',
      title: 'Netflix',
      startedAt: '2026-08',
      dayOfMonth: 12,
      activeSince: null,
      lastGeneratedFor: null,
      isActive: true,
    };
    const harness = buildHarness({
      failCreateWithUniqueViolation: true,
      existingByKey: { 'key-a': existing },
    });

    const result = await harness.service.create(
      USER_ID,
      dto({ creationKey: 'key-a' }),
    );

    expect(result.alreadyExisted).toBe(true);
    expect(harness.created).toHaveLength(0);
  });

  it('chave diferente cria uma nova assinatura', async () => {
    const harness = buildHarness();

    await harness.service.create(USER_ID, dto({ creationKey: 'key-a' }));
    await harness.service.create(USER_ID, dto({ creationKey: 'key-b' }));

    expect(harness.created).toHaveLength(2);
  });

  it('sem chave, duas criações idênticas são permitidas', async () => {
    /**
     * Duas "Netflix" com o mesmo valor no mesmo banco são cadastro legítimo —
     * o mesmo serviço em dois cartões, ou dois planos. Nenhuma heurística de
     * negócio pode recusar isso.
     */
    const harness = buildHarness();

    await harness.service.create(USER_ID, dto());
    await harness.service.create(USER_ID, dto());

    expect(harness.created).toHaveLength(2);
    expect(harness.created[0].creationKey).toBeUndefined();
    expect(harness.created[1].creationKey).toBeUndefined();
  });

  it('erro que não é violação de unicidade continua subindo', async () => {
    // Só P2002 é tratado como corrida; o resto é problema de verdade.
    const harness = buildHarness();
    harness.prisma.subscription.create = vi.fn(async () => {
      throw new Error('conexão perdida');
    });

    await expect(
      harness.service.create(USER_ID, dto({ creationKey: 'key-a' })),
    ).rejects.toThrow('conexão perdida');
  });

  it('P2002 sem chave não é tratado como retry', async () => {
    // Sem chave não há como recuperar nada; o erro tem de subir.
    const harness = buildHarness({ failCreateWithUniqueViolation: true });

    await expect(harness.service.create(USER_ID, dto())).rejects.toThrow();
  });
});

describe('create — falha parcial na geração', () => {
  it('a assinatura é devolvida mesmo quando a geração falha', async () => {
    /**
     * O ponto central. Antes isto virava 500, o cliente concluía que nada foi
     * criado e reenviava — ganhando uma segunda assinatura. Agora o cadastro
     * volta com o resumo dizendo o que não deu.
     */
    const harness = buildHarness({ failGeneration: true });

    const result = await harness.service.create(
      USER_ID,
      dto({ creationKey: 'key-a' }),
    );

    expect(result.subscription).toBeDefined();
    expect(result.generation.failed).toBe(1);
    expect(result.generation.failures).toHaveLength(1);
  });

  it('a mensagem de falha não vaza erro interno', async () => {
    const harness = buildHarness({ failGeneration: true });

    const result = await harness.service.create(
      USER_ID,
      dto({ creationKey: 'key-a' }),
    );

    expect(result.generation.failures[0].reason).not.toContain(
      'geração falhou',
    );
  });

  it('geração bem-sucedida reporta o que foi gerado', async () => {
    const harness = buildHarness();

    const result = await harness.service.create(
      USER_ID,
      dto({ creationKey: 'key-a' }),
    );

    expect(result.generation.generated).toBe(1);
    expect(result.generation.failed).toBe(0);
  });

  it('retry reconcilia a geração da assinatura existente', async () => {
    /**
     * O retry não é só "devolva a mesma linha": os ciclos que falharam na
     * primeira tentativa precisam ser retomados. `lastGeneratedFor` impede que
     * os já gerados dupliquem.
     */
    const existing = {
      id: 'sub-existente',
      userId: USER_ID,
      creationKey: 'key-a',
      title: 'Netflix',
      startedAt: '2026-08',
      dayOfMonth: 12,
      activeSince: null,
      lastGeneratedFor: null,
      isActive: true,
    };
    const harness = buildHarness({
      failCreateWithUniqueViolation: true,
      existingByKey: { 'key-a': existing },
    });

    const result = await harness.service.create(
      USER_ID,
      dto({ creationKey: 'key-a' }),
    );

    expect(result.alreadyExisted).toBe(true);
    // A geração roda de novo — é o que retoma o ciclo pendente.
    expect((harness.service as any).runForSubscription).toHaveBeenCalled();
    expect(result.generation.generated).toBe(1);
  });
});

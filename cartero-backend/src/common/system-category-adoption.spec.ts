import { describe, expect, it, vi } from 'vitest';
import { EntityValidationService } from './entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID } from 'src/common/testing/fixtures';
import {
  DEBT_PAID_CATEGORY_COLOR,
  DEBT_PAID_CATEGORY_NAME,
  RECEIVABLE_RECEIVED_CATEGORY_COLOR,
  RECEIVABLE_RECEIVED_CATEGORY_NAME,
  SUBSCRIPTION_CATEGORY_COLOR,
  SUBSCRIPTION_CATEGORY_NAME,
  SYSTEM_CATEGORY_ICON,
} from './constants/system-categories';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Categoria própria com nome de sistema (Fase 7B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O defeito: `findOrCreateSystemCategory` busca por NOME (a unicidade é
 * `(userId, name)`, então filtrar por `isSystem` faria o create seguinte
 * violar a constraint). Encontrando uma categoria própria homônima, ela era
 * PROMOVIDA — `isSystem: true`, com ícone e cor sobrescritos.
 *
 * Ninguém pediu essa conversão. Bastava criar uma assinatura para uma
 * categoria chamada "Assinatura" deixar de ser editável e excluível, sem
 * caminho de volta pela interface.
 *
 * A função é compartilhada por cinco fluxos — pagar dívida, receber
 * recebível, criar assinatura e os dois ramos do settle de pessoa — então a
 * política vale para os três nomes reservados.
 */

function buildValidation(existing: unknown) {
  const writes = { updated: [] as any[], created: [] as any[] };

  const prisma = {
    category: {
      findFirst: vi.fn(async () => existing),
      update: vi.fn(async (args: any) => {
        writes.updated.push(args);
        return args.data;
      }),
      create: vi.fn(async ({ data }: any) => {
        writes.created.push(data);
        return { id: 'cat-nova', ...data };
      }),
    },
  } as unknown as PrismaService;

  return {
    validation: new EntityValidationService(prisma),
    prisma,
    writes,
  };
}

const RESERVED = [
  [SUBSCRIPTION_CATEGORY_NAME, SUBSCRIPTION_CATEGORY_COLOR] as const,
  [DEBT_PAID_CATEGORY_NAME, DEBT_PAID_CATEGORY_COLOR] as const,
  [
    RECEIVABLE_RECEIVED_CATEGORY_NAME,
    RECEIVABLE_RECEIVED_CATEGORY_COLOR,
  ] as const,
];

describe('findOrCreateSystemCategory — nunca promove categoria própria', () => {
  it.each(RESERVED)(
    'categoria própria "%s" é reutilizada sem virar de sistema',
    async (name, color) => {
      const own = {
        id: 'cat-do-usuario',
        userId: USER_ID,
        name,
        isSystem: false,
        icon: 'Popcorn',
        color: '#ff00ff',
      };
      const harness = buildValidation(own);

      const result = await harness.validation.findOrCreateSystemCategory(
        harness.prisma as any,
        USER_ID,
        name,
        SYSTEM_CATEGORY_ICON,
        color,
      );

      // Devolvida como está: mesma linha, mesmo `isSystem`, mesmo visual.
      expect(result).toBe(own);
      expect(result.isSystem).toBe(false);
      expect(harness.writes.updated).toHaveLength(0);
      expect(harness.writes.created).toHaveLength(0);
    },
  );

  it('o ícone e a cor escolhidos pelo usuário são preservados', async () => {
    // A versão anterior sobrescrevia os dois ao promover.
    const own = {
      id: 'cat-do-usuario',
      userId: USER_ID,
      name: SUBSCRIPTION_CATEGORY_NAME,
      isSystem: false,
      icon: 'Popcorn',
      color: '#ff00ff',
    };
    const harness = buildValidation(own);

    const result = await harness.validation.findOrCreateSystemCategory(
      harness.prisma as any,
      USER_ID,
      SUBSCRIPTION_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      SUBSCRIPTION_CATEGORY_COLOR,
    );

    expect(result.icon).toBe('Popcorn');
    expect(result.color).toBe('#ff00ff');
  });

  it('a categoria continua editável e excluível depois do uso', async () => {
    /**
     * O dano da promoção não era cosmético: `CategoriesService` recusa editar
     * (403) e excluir (403) qualquer categoria com `isSystem: true`. Uma
     * categoria adotada ficava presa para sempre.
     */
    const own = {
      id: 'cat-do-usuario',
      userId: USER_ID,
      name: SUBSCRIPTION_CATEGORY_NAME,
      isSystem: false,
    };
    const harness = buildValidation(own);

    const result = await harness.validation.findOrCreateSystemCategory(
      harness.prisma as any,
      USER_ID,
      SUBSCRIPTION_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      SUBSCRIPTION_CATEGORY_COLOR,
    );

    // `isSystem: false` é exatamente o que mantém os dois caminhos abertos.
    expect(result.isSystem).toBe(false);
  });
});

describe('findOrCreateSystemCategory — casos preservados', () => {
  it('categoria de sistema existente é devolvida intacta', async () => {
    const system = {
      id: 'cat-sys',
      userId: USER_ID,
      name: SUBSCRIPTION_CATEGORY_NAME,
      isSystem: true,
      icon: SYSTEM_CATEGORY_ICON,
      color: SUBSCRIPTION_CATEGORY_COLOR,
    };
    const harness = buildValidation(system);

    const result = await harness.validation.findOrCreateSystemCategory(
      harness.prisma as any,
      USER_ID,
      SUBSCRIPTION_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      SUBSCRIPTION_CATEGORY_COLOR,
    );

    expect(result).toBe(system);
    expect(harness.writes.updated).toHaveLength(0);
  });

  it('categorias já marcadas como sistema não são despromovidas', async () => {
    /**
     * Não há como saber se uma categoria `isSystem: true` foi criada assim ou
     * adotada indevidamente antes desta correção. Sem essa evidência,
     * despromover seria adivinhar — a correção impede novas adoções, não
     * tenta reverter as antigas.
     */
    const maybeAdopted = {
      id: 'cat-duvidosa',
      userId: USER_ID,
      name: DEBT_PAID_CATEGORY_NAME,
      isSystem: true,
    };
    const harness = buildValidation(maybeAdopted);

    const result = await harness.validation.findOrCreateSystemCategory(
      harness.prisma as any,
      USER_ID,
      DEBT_PAID_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      DEBT_PAID_CATEGORY_COLOR,
    );

    expect(result.isSystem).toBe(true);
    expect(harness.writes.updated).toHaveLength(0);
  });

  it('sem categoria alguma, cria a de sistema', async () => {
    const harness = buildValidation(null);

    const result = await harness.validation.findOrCreateSystemCategory(
      harness.prisma as any,
      USER_ID,
      SUBSCRIPTION_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      SUBSCRIPTION_CATEGORY_COLOR,
    );

    expect(harness.writes.created).toHaveLength(1);
    expect(harness.writes.created[0]).toMatchObject({
      name: SUBSCRIPTION_CATEGORY_NAME,
      isSystem: true,
      icon: SYSTEM_CATEGORY_ICON,
      color: SUBSCRIPTION_CATEGORY_COLOR,
    });
    expect(result.isSystem).toBe(true);
  });
});

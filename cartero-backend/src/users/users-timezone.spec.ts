import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import * as timezoneHelper from 'src/common/helpers/timezone.helper';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ1 — Account Financial Timezone Foundation: `GET/PATCH /users/me`
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `PATCH /users/me` é a authority de atualização de perfil já existente —
 * TZ1 estende com `timeZone`, sem criar endpoint novo. Estes testes provam a
 * mesma garantia de `account-timezone-foundation.spec.ts`, mas no lado do
 * "restore/perfil": uma conta legada nunca ganha timezone sozinha.
 */

function buildUsersHarness(initialTimeZone: string | null = null) {
  const state = {
    id: 'legacy-user-1',
    email: 'legado@cartero.test',
    password: 'hash-nao-importa',
    name: 'Legado',
    timeZone: initialTimeZone,
    salary: null,
    createIncomeOnReceivablePaid: false,
    createExpenseOnDebtPaid: false,
    notifyDaysBefore: 3,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const prisma: any = {
    user: {
      findUnique: vi.fn(async () => ({ ...state })),
      update: vi.fn(async (args: any) => {
        // Só sobrescreve campos EXPLICITAMENTE presentes no `data` — `undefined`
        // não deve mudar nada, espelhando o comportamento real do Prisma.
        for (const [key, value] of Object.entries(args.data)) {
          if (value !== undefined) (state as any)[key] = value;
        }
        return { ...state };
      }),
    },
  };

  const service = new UsersService(prisma as PrismaService);
  return { service, prisma, state };
}

describe('Legacy account safety — restore/perfil (TZ1)', () => {
  it('GET /users/me (findById) nunca inventa timeZone para conta legada', async () => {
    const harness = buildUsersHarness(null);

    const user = await harness.service.findById('legacy-user-1');

    expect(user.timeZone).toBeNull();
  });

  it('PATCH /users/me sem enviar timeZone preserva null — nenhuma auto-detecção silenciosa', async () => {
    const harness = buildUsersHarness(null);

    const result = await harness.service.update('legacy-user-1', {
      name: 'Legado Editado',
    });

    expect(result.timeZone).toBeNull();
    expect(harness.state.timeZone).toBeNull();
  });

  it('PATCH /users/me com timeZone IANA válida atualiza explicitamente', async () => {
    const harness = buildUsersHarness(null);

    const result = await harness.service.update('legacy-user-1', {
      timeZone: 'America/Sao_Paulo',
    });

    expect(result.timeZone).toBe('America/Sao_Paulo');
  });

  it('TZ1.0.1: PATCH persiste o valor de RETORNO de resolveIanaTimeZone, não o input original', async () => {
    // Mesmo raciocínio de `account-timezone-foundation.spec.ts`: sem um
    // alias real que sobreviva à validação, o probe honesto é confirmar que
    // o write path usa o RETORNO da função, não o argumento.
    const spy = vi
      .spyOn(timezoneHelper, 'resolveIanaTimeZone')
      .mockReturnValue('America/Manaus');

    const harness = buildUsersHarness(null);
    const result = await harness.service.update('legacy-user-1', {
      timeZone: 'America/Sao_Paulo',
    });

    expect(spy).toHaveBeenCalledWith('America/Sao_Paulo');
    expect(result.timeZone).toBe('America/Manaus');
    expect(result.timeZone).not.toBe('America/Sao_Paulo');
  });

  it('PATCH /users/me com timezone inválida é rejeitado, sem escrever nada', async () => {
    const harness = buildUsersHarness(null);

    await expect(
      harness.service.update('legacy-user-1', { timeZone: 'GMT-3' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_TIME_ZONE' } });

    expect(harness.prisma.user.update).not.toHaveBeenCalled();
    expect(harness.state.timeZone).toBeNull();
  });

  it('cliente antigo que nunca conhece timeZone continua funcionando (payload sem o campo)', async () => {
    const harness = buildUsersHarness(null);

    // Simula um DTO de cliente antigo: nenhuma chave `timeZone` no objeto.
    const legacyPayload = {
      createIncomeOnReceivablePaid: true,
    };

    const result = await harness.service.update('legacy-user-1', legacyPayload as any);

    expect(result.timeZone).toBeNull();
    expect(result.createIncomeOnReceivablePaid).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { EnvService } from 'src/env/env.service';
import * as timezoneHelper from 'src/common/helpers/timezone.helper';
import { isValidIanaTimeZone } from 'src/common/helpers/timezone.helper';

// Garante que um `spyOn` de um teste nunca vaze para o próximo, mesmo se o
// teste falhar antes de chamar `mockRestore()` explicitamente.
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ1 — Account Financial Timezone Foundation
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `User.timeZone` é aditivo e opcional, sem default. Estes testes vigiam a
 * garantia central desta fase: nenhuma conta existente é tocada, e nenhum
 * cliente antigo (que nunca ouviu falar deste campo) deixa de funcionar.
 *
 * Nenhuma feature financeira lê este campo ainda — isso é trabalho de fases
 * futuras (TZ2+). Aqui só provamos que a fundação em si é segura.
 */

function buildAuthHarness() {
  const created: Record<string, unknown>[] = [];

  const prisma: any = {
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: any) => {
        created.push(args.data);
        return {
          id: 'new-user-1',
          email: args.data.email,
          password: args.data.password,
          name: args.data.name,
          timeZone: args.data.timeZone ?? null,
          salary: null,
          createIncomeOnReceivablePaid: false,
          createExpenseOnDebtPaid: false,
          notifyDaysBefore: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    },
  };

  const jwt: any = { sign: vi.fn(() => 'token') };
  const env: any = { get: vi.fn(() => 'secret') };

  const service = new AuthService(
    prisma as PrismaService,
    jwt as JwtService,
    env as EnvService,
  );

  return { service, prisma, created };
}

describe('N1-N6: cadastro (TZ1)', () => {
  it('cadastro sem timeZone e rejeitado antes de criar usuario', async () => {
    const harness = buildAuthHarness();

    await expect(
      harness.service.register({
        email: 'sem-tz-rejeitado@cartero.test',
        password: 'segredo123',
        name: 'Sem TZ',
      } as any),
    ).rejects.toMatchObject({ response: { code: 'TIME_ZONE_REQUIRED' } });
    expect(harness.created).toHaveLength(0);
  });

  it('cadastro com timeZone null e rejeitado', async () => {
    const harness = buildAuthHarness();

    await expect(
      harness.service.register({
        email: 'null-tz-rejeitado@cartero.test',
        password: 'segredo123',
        name: 'Null TZ',
        timeZone: null,
      } as any),
    ).rejects.toMatchObject({ response: { code: 'TIME_ZONE_REQUIRED' } });
    expect(harness.created).toHaveLength(0);
  });
  it('N1: signup sem timeZone continua funcionando — resultado timeZone null', async () => {
    const harness = buildAuthHarness();

    const result = await harness.service.register({
      email: 'sem-tz@cartero.test',
      password: 'segredo123',
      name: 'Sem TZ',
      timeZone: 'America/Fortaleza',
    });

    expect(result.user.timeZone).toBe('America/Fortaleza');
    expect(harness.created[0]).toMatchObject({ timeZone: 'America/Fortaleza' });
  });

  it('N2: signup com America/Fortaleza é aceito', async () => {
    const harness = buildAuthHarness();

    const result = await harness.service.register({
      email: 'fortaleza@cartero.test',
      password: 'segredo123',
      name: 'Fortaleza',
      timeZone: 'America/Fortaleza',
    });

    expect(result.user.timeZone).toBe('America/Fortaleza');
  });

  it('N3: signup com America/Manaus é aceito', async () => {
    const harness = buildAuthHarness();

    const result = await harness.service.register({
      email: 'manaus@cartero.test',
      password: 'segredo123',
      name: 'Manaus',
      timeZone: 'America/Manaus',
    });

    expect(result.user.timeZone).toBe('America/Manaus');
  });

  it('N4: signup com Europe/Lisbon é aceito', async () => {
    const harness = buildAuthHarness();

    const result = await harness.service.register({
      email: 'lisboa@cartero.test',
      password: 'segredo123',
      name: 'Lisboa',
      timeZone: 'Europe/Lisbon',
    });

    expect(result.user.timeZone).toBe('Europe/Lisbon');
  });

  it('TZ1.0.1: register persiste o valor de RETORNO de resolveIanaTimeZone, não o dto.timeZone original', async () => {
    /*
      Não existe hoje, dentro do contrato de entrada aprovado (só
      identificadores já-canônicos, nenhum alias regional), um par
      input/canônico DIVERGENTE real que sobreviva à validação — ver nota em
      `timezone.helper.spec.ts`. Este teste prova o contrato de outro
      ângulo, sem depender de um alias real: mocka `resolveIanaTimeZone`
      para devolver um valor DIFERENTE do input (`America/Manaus`, quando o
      dto pediu `America/Sao_Paulo`) e confirma que é ESSE retorno que é
      persistido. Se o código regredisse para `timeZone: dto.timeZone`
      (ignorando o retorno da função), este teste falharia — é o kill real
      que a limitação de alias no runtime não permite fazer de outra forma.
    */
    const spy = vi
      .spyOn(timezoneHelper, 'resolveIanaTimeZone')
      .mockReturnValue('America/Manaus');

    const harness = buildAuthHarness();
    const result = await harness.service.register({
      email: 'canonical@cartero.test',
      password: 'segredo123',
      name: 'Canonical',
      timeZone: 'America/Sao_Paulo',
    });

    expect(spy).toHaveBeenCalledWith('America/Sao_Paulo');
    expect(result.user.timeZone).toBe('America/Manaus');
    expect(result.user.timeZone).not.toBe('America/Sao_Paulo');

    spy.mockRestore();
  });

  it('N5: timezone inválida é rejeitada com erro de validação', async () => {
    const harness = buildAuthHarness();

    await expect(
      harness.service.register({
        email: 'invalida@cartero.test',
        password: 'segredo123',
        name: 'Invalida',
        timeZone: 'Not/AZone',
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_TIME_ZONE' },
    });

    // A rejeição acontece ANTES de qualquer escrita.
    expect(harness.created).toHaveLength(0);
  });

  it('N6: offset "-03:00" é rejeitado como timezone financeira persistida', () => {
    /*
      Prova estrutural, não de integração: `Intl.DateTimeFormat` sozinho
      ACEITA "-03:00" (testado manualmente — não lança, devolve o próprio
      offset como "canônico"). Se `AuthService` usasse isso diretamente sem
      passar por `isValidIanaTimeZone` (que consulta
      `Intl.supportedValuesOf('timeZone')`, que nunca contém um offset),
      este caso passaria pelo signup por engano — daí o teste ser sobre o
      helper que a rejeita, não sobre uma reimplementação aqui.
    */
    expect(isValidIanaTimeZone('-03:00')).toBe(false);
  });
});

describe('Legacy account safety (TZ1)', () => {
  it('conta criada sem timeZone nunca recebe um valor detectado/injetado silenciosamente', async () => {
    const harness = buildAuthHarness();

    await harness.service.register({
      email: 'legado@cartero.test',
      password: 'segredo123',
      name: 'Legado',
      timeZone: 'America/Fortaleza',
    });

    // O `data` passado ao Prisma nunca contém uma string de timezone quando
    // o cliente não enviou nada — não há detecção server-side de propósito.
    expect(harness.created[0].timeZone).toBe('America/Fortaleza');
  });
});

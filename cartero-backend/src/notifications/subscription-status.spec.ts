import { describe, expect, it, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionStatusDto } from './dto/subscription-status.dto';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Verdade do device ATUAL — `POST /notifications/subscription-status`
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O toggle do Perfil derivava exclusivamente da `PushSubscription` local do
 * navegador. Isso responde "este browser tem uma inscrição no PushManager?",
 * que NÃO é a pergunta: o backend pode ter removido a linha correspondente
 * após um `404/410` do push service — silenciosamente, porque esse ramo não
 * loga — e a UI continuaria exibindo "ativado" para sempre, sem nenhum push
 * podendo ser entregue.
 *
 * A autoridade nova responde pelo par (usuário, endpoint). O endpoint viaja no
 * BODY para não acabar em access log, histórico ou proxy.
 *
 * Estes testes vigiam o ESCOPO da consulta, não a aritmética: o defeito que
 * eles previnem é um `where` largo demais.
 */

const THIS_DEVICE = 'https://fcm.googleapis.com/fcm/send/THIS-DEVICE';
const OTHER_DEVICE = 'https://fcm.googleapis.com/fcm/send/OTHER-DEVICE';

/** Duplo que HONRA o `where` — um `mockResolvedValue` fixo devolveria a linha
 *  mesmo com o filtro errado, e a mutação M2 não mataria nenhum teste. */
function buildService(rows: Array<{ userId: string; endpoint: string }>) {
  const captured: unknown[] = [];

  const prisma = {
    pushSubscription: {
      findFirst: vi.fn(async ({ where }: any) => {
        captured.push(where);
        /**
         * O duplo aplica APENAS as cláusulas presentes — como o Prisma. Filtrar
         * sempre pelos dois campos faria um `where` largo demais (só `userId`)
         * deixar de casar com qualquer linha, e o teste passaria a falhar pelo
         * motivo errado: "não achou nada" em vez de "achou o device errado".
         */
        const hit = rows.find(
          (r) =>
            (where.userId === undefined || r.userId === where.userId) &&
            (where.endpoint === undefined || r.endpoint === where.endpoint),
        );
        return hit ? { id: 'sub-1' } : null;
      }),
    },
  } as unknown as PrismaService;

  const config = { get: vi.fn(() => 'x') } as unknown as ConfigService;

  return { service: new NotificationsService(prisma, config), prisma, captured };
}

describe('subscription-status — escopo por usuário e endpoint', () => {
  it('B1: endpoint do usuário atual → registered true', async () => {
    const { service } = buildService([
      { userId: USER_ID, endpoint: THIS_DEVICE },
    ]);

    await expect(
      service.getSubscriptionStatus(USER_ID, { endpoint: THIS_DEVICE }),
    ).resolves.toEqual({ registered: true });
  });

  it('B2: endpoint inexistente → false', async () => {
    const { service } = buildService([]);

    await expect(
      service.getSubscriptionStatus(USER_ID, { endpoint: THIS_DEVICE }),
    ).resolves.toEqual({ registered: false });
  });

  it('B3: endpoint existe, mas para OUTRO usuário → false', async () => {
    /**
     * Nem `true` nem erro: a resposta é indistinguível de "não existe", então
     * não confirma a existência de inscrição alheia.
     */
    const { service } = buildService([
      { userId: 'outro-usuario', endpoint: THIS_DEVICE },
    ]);

    await expect(
      service.getSubscriptionStatus(USER_ID, { endpoint: THIS_DEVICE }),
    ).resolves.toEqual({ registered: false });
  });

  it('B4: usuário tem OUTRO device registrado, não este → false', async () => {
    /**
     * O caso que `count > 0` responderia errado. Desktop Chrome registrado,
     * Brave atual não: o Brave precisa mostrar OFF.
     */
    const { service } = buildService([
      { userId: USER_ID, endpoint: OTHER_DEVICE },
    ]);

    await expect(
      service.getSubscriptionStatus(USER_ID, { endpoint: THIS_DEVICE }),
    ).resolves.toEqual({ registered: false });
  });

  it('a consulta filtra por userId E endpoint', async () => {
    const { service, captured } = buildService([]);

    await service.getSubscriptionStatus(USER_ID, { endpoint: THIS_DEVICE });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ userId: USER_ID, endpoint: THIS_DEVICE });
  });

  it('B5: a resposta expõe APENAS o booleano', async () => {
    /**
     * `p256dh` e `auth` são material criptográfico de entrega; `endpoint` é
     * identificador. Nenhum deles pode voltar — e o `select` da query nem os
     * carrega.
     */
    const { service, prisma } = buildService([
      { userId: USER_ID, endpoint: THIS_DEVICE },
    ]);

    const result = await service.getSubscriptionStatus(USER_ID, {
      endpoint: THIS_DEVICE,
    });

    expect(Object.keys(result)).toEqual(['registered']);

    const select = (prisma.pushSubscription.findFirst as any).mock.calls[0][0]
      .select;
    expect(select).toEqual({ id: true });
  });
});

describe('subscription-status — validação do DTO', () => {
  it('B6: endpoint é obrigatório', async () => {
    const dto = plainToInstance(SubscriptionStatusDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('endpoint');
  });

  it('B6: endpoint precisa ser string', async () => {
    const dto = plainToInstance(SubscriptionStatusDto, { endpoint: 42 });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('B6: endpoint válido passa', async () => {
    const dto = plainToInstance(SubscriptionStatusDto, {
      endpoint: THIS_DEVICE,
    });

    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('subscription-status — autenticação (B7)', () => {
  it('a rota exige JwtAuthGuard, como subscribe/unsubscribe', () => {
    /**
     * A consulta responde sobre a inscrição do usuário autenticado. Sem guard,
     * qualquer um poderia sondar endpoints — e, como a resposta é booleana,
     * confirmaria a existência de inscrições de terceiros por força bruta.
     *
     * O teste lê os metadados do decorator: é o que de fato protege a rota,
     * não a presença do parâmetro `user` na assinatura.
     */
    const guards = Reflect.getMetadata(
      '__guards__',
      NotificationsController.prototype.subscriptionStatus,
    );

    expect(guards).toContain(JwtAuthGuard);
  });
});

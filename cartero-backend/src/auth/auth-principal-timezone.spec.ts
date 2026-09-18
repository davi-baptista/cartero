import { describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy';
import { JwtService } from '@nestjs/jwt';
import type { EnvService } from 'src/env/env.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { CommitmentsController } from 'src/commitments/commitments.controller';
import { CommitmentsService } from 'src/commitments/commitments.service';
import { SubscriptionsController } from 'src/subscriptions/subscriptions.controller';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Incidente de produção — `@CurrentUser()` nunca carregava `timeZone`
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `JwtStrategy.validate()` devolvia só `{ id: payload.sub }` — desde o
 * commit inicial, nada relacionado a timezone. `GET /commitments` e as
 * rotas de `/subscriptions` liam `user.timeZone` deste objeto e SEMPRE
 * recebiam `undefined`, para qualquer usuário, independente do que estava
 * persistido no banco. O bug ficou invisível enquanto existia um fallback
 * `timeZone === null` → UTC legado; a remoção desse fallback (3953ef5)
 * transformou o `undefined` silencioso em 500 real.
 *
 * A correção: `validate()` busca `{ id, timeZone }` no Prisma por
 * `payload.sub` a cada request — nunca do claim do JWT (editável pelo
 * usuário, um claim assinado ficaria stale até o token expirar).
 */

const SECRET = 'segredo-de-teste';

const env = { get: () => SECRET } as unknown as EnvService;

const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });

function signAccessToken(sub: string) {
  return jwt.sign({ sub, tokenUse: 'access' });
}

function buildPrisma(usersById: Record<string, { id: string; timeZone: string | null }>) {
  return {
    user: {
      findUnique: vi.fn(
        async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
          const row = usersById[where.id];
          if (!row) return null;
          if (!select) return row;
          return Object.fromEntries(
            Object.keys(select).map((key) => [key, row[key as keyof typeof row]]),
          );
        },
      ),
    },
  } as unknown as PrismaService;
}

describe('JwtStrategy — principal autenticado carrega a timezone persistida', () => {
  it('B1: o principal inclui a timeZone persistida do usuário', async () => {
    const prisma = buildPrisma({
      u1: { id: 'u1', timeZone: 'America/Fortaleza' },
    });
    const strategy = new JwtStrategy(env, prisma);

    const payload = jwt.verify(signAccessToken('u1'), { secret: SECRET });
    const principal = await strategy.validate(payload);

    expect(principal).toEqual({ id: 'u1', timeZone: 'America/Fortaleza' });
  });

  it('B2: a timeZone vem do BANCO — nunca do claim do JWT (que nem carrega o campo)', async () => {
    /*
      O payload assinado não tem `timeZone` nenhum — só `sub`/`tokenUse`/
      `iat`/`exp` (ver `CarteroJwtPayload`). Se `validate()` algum dia
      passasse a ler algo como `payload.timeZone`, este teste falharia:
      o valor teria que vir de algum lugar que a assinatura não carrega.
    */
    const prisma = buildPrisma({
      u1: { id: 'u1', timeZone: 'Asia/Tokyo' },
    });
    const strategy = new JwtStrategy(env, prisma);

    const payload = jwt.verify(signAccessToken('u1'), { secret: SECRET }) as Record<
      string,
      unknown
    >;
    expect(payload.timeZone).toBeUndefined();

    const principal = await strategy.validate(payload as never);
    expect(principal.timeZone).toBe('Asia/Tokyo');
  });

  it('B6: mudar a timeZone persistida reflete numa request posterior, SEM emitir novo JWT', async () => {
    const usersById: Record<string, { id: string; timeZone: string | null }> = {
      u1: { id: 'u1', timeZone: 'America/Fortaleza' },
    };
    const prisma = buildPrisma(usersById);
    const strategy = new JwtStrategy(env, prisma);

    const token = signAccessToken('u1');
    const payload = jwt.verify(token, { secret: SECRET });

    const before = await strategy.validate(payload);
    expect(before.timeZone).toBe('America/Fortaleza');

    // Usuário troca a timezone (`PATCH /users/me`) — o MESMO token continua valendo.
    usersById.u1.timeZone = 'Asia/Tokyo';

    const after = await strategy.validate(payload);
    expect(after.timeZone).toBe('Asia/Tokyo');
    expect(after.timeZone).not.toBe(before.timeZone);
  });

  it('B7: token referenciando usuário inexistente/deletado é rejeitado — nunca um principal fabricado', async () => {
    const prisma = buildPrisma({});
    const strategy = new JwtStrategy(env, prisma);

    const payload = jwt.verify(signAccessToken('deleted-user'), { secret: SECRET });

    await expect(strategy.validate(payload)).rejects.toThrow();
  });

  it('timeZone nula persistida propaga como null — nunca uma fabricação silenciosa', async () => {
    const prisma = buildPrisma({ u1: { id: 'u1', timeZone: null } });
    const strategy = new JwtStrategy(env, prisma);

    const payload = jwt.verify(signAccessToken('u1'), { secret: SECRET });
    const principal = await strategy.validate(payload);

    expect(principal).toEqual({ id: 'u1', timeZone: null });
  });

  it('P2 (mutação): se validate() lesse timeZone do payload/claim, o teste B2 falharia — prova negativa via leitura do payload real', () => {
    /*
      Prova estrutural complementar ao teste B2 em runtime: o payload que
      `JwtStrategy.validate` recebe nunca carrega `timeZone` — só é possível
      chegar até esse campo consultando `payload.sub` no Prisma.
    */
    const payload = jwt.verify(signAccessToken('u1'), { secret: SECRET }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload)).not.toContain('timeZone');
  });
});

describe('CommitmentsController — recebe a timezone do principal autenticado', () => {
  it('B3: o controller repassa user.timeZone (agora DB-backed) ao service', async () => {
    const service = { getCommitments: vi.fn().mockResolvedValue({ installments: [], subscriptions: [] }) };
    const controller = new CommitmentsController(service as unknown as CommitmentsService);

    await controller.getCommitments({ id: 'u1', timeZone: 'America/Fortaleza' });

    expect(service.getCommitments).toHaveBeenCalledWith('u1', 'America/Fortaleza');
  });

  it('timeZone ausente no principal (conta legada/null) NÃO regride para um fallback — propaga null explicitamente', async () => {
    const service = { getCommitments: vi.fn().mockResolvedValue({ installments: [], subscriptions: [] }) };
    const controller = new CommitmentsController(service as unknown as CommitmentsService);

    await controller.getCommitments({ id: 'u1', timeZone: null });

    expect(service.getCommitments).toHaveBeenCalledWith('u1', null);
  });
});

describe('SubscriptionsController — recebe a timezone do principal autenticado', () => {
  const service = {
    findAll: vi.fn().mockResolvedValue([]),
    previewFor: vi.fn().mockResolvedValue({}),
    findOne: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    runForUser: vi.fn().mockResolvedValue([]),
  };
  const controller = new SubscriptionsController(
    service as unknown as SubscriptionsService,
  );

  it('B4: GET /subscriptions (findAll) repassa a timezone persistida', async () => {
    await controller.findAll({ id: 'u1', timeZone: 'America/Fortaleza' });

    expect(service.findAll).toHaveBeenCalledWith(
      'u1',
      expect.any(Date),
      'America/Fortaleza',
    );
  });

  it('B5: GET /subscriptions/preview repassa a timezone persistida', async () => {
    await controller.preview(
      { id: 'u1', timeZone: 'Asia/Tokyo' },
      { bankId: 'b1', dayOfMonth: 10 } as never,
    );

    expect(service.previewFor).toHaveBeenCalledWith(
      'u1',
      'b1',
      10,
      undefined,
      undefined,
      expect.any(Date),
      'Asia/Tokyo',
    );
  });

  it('B5: GET /subscriptions/:id (findOne) repassa a timezone persistida', async () => {
    await controller.findOne('sub-1', { id: 'u1', timeZone: 'America/Fortaleza' });

    expect(service.findOne).toHaveBeenCalledWith(
      'sub-1',
      'u1',
      expect.any(Date),
      'America/Fortaleza',
    );
  });

  it('POST /subscriptions (create) repassa a timezone persistida', async () => {
    const dto = { title: 'Netflix' } as never;
    await controller.create({ id: 'u1', timeZone: 'America/Fortaleza' }, dto);

    expect(service.create).toHaveBeenCalledWith('u1', dto, 'America/Fortaleza');
  });

  it('PATCH /subscriptions/:id (update) repassa a timezone persistida', async () => {
    const dto = { title: 'Netflix Premium' } as never;
    await controller.update('sub-1', { id: 'u1', timeZone: 'America/Fortaleza' }, dto);

    expect(service.update).toHaveBeenCalledWith('sub-1', 'u1', dto, 'America/Fortaleza');
  });

  it('POST /subscriptions/run (runForUser) preservado — NÃO depende do principal para timezone (já re-consulta o Prisma)', async () => {
    await controller.run({ id: 'u1', timeZone: 'America/Fortaleza' });

    expect(service.runForUser).toHaveBeenCalledWith('u1');
    expect(service.runForUser).not.toHaveBeenCalledWith('u1', expect.anything());
  });
});

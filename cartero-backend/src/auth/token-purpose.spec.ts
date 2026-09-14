import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { EnvService } from 'src/env/env.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  type CarteroJwtPayload,
  ACCESS_TOKEN_TTL_SECONDS,
  LEGACY_REFRESH_MIN_LIFETIME_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  TOKEN_USE,
  canAuthenticateRequest,
  canMintSession,
} from './token-purpose';
import type { Response } from 'express';

/*
  ── Um token precisa dizer para que serve ──

  Access e refresh eram JWTs indistinguíveis: mesmos claims (`sub`, `iat`,
  `exp`) e a MESMA chave na prática — `JWT_SECRET` e `REFRESH_TOKEN_SECRET`
  são variáveis separadas que o `.env.example` do projeto manda preencher com
  o mesmo valor.

  Com a chave coincidindo, a separação existia só no nome da variável.
  Verificado contra o backend em execução, nos dois sentidos:

      access  → POST /auth/mobile/refresh   201   (e 201 no canal web)
      refresh → GET /users/me               200   (idem /banks, /categories)

  O primeiro converte um comprometimento de 15 minutos numa credencial de 30
  dias. O segundo dá poder de API a uma credencial que vive um mês guardada
  no dispositivo.

  Estes testes são os dois sentidos, mais a migração: um refresh token já
  emitido continua funcionando, e um access token já emitido não passa a
  funcionar.
*/

const SECRET = 'segredo-de-teste';

/** Reproduz a coincidência de chaves do ambiente real — o pior caso. */
const env = {
  get: (key: string) =>
    key === 'JWT_SECRET' || key === 'REFRESH_TOKEN_SECRET' ? SECRET : 'x',
} as unknown as EnvService;

const jwt = new JwtService({
  secret: SECRET,
  signOptions: { expiresIn: '15m' },
});

const USER = {
  id: 'u1',
  email: 'davi@cartero.app',
  name: 'Davi',
  password: 'hash',
};

function buildAuthService() {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(USER),
      create: vi.fn().mockResolvedValue(USER),
    },
  } as unknown as PrismaService;

  return new AuthService(prisma, jwt, env);
}

/** Um token como o Cartero emitia ANTES desta fase: sem `tokenUse`. */
function legacyToken(lifetimeSeconds: number) {
  /*
    `expiresIn` em vez de um `exp` literal: o serviço recusa payload com `exp`
    quando a opção global já define expiração. O token resultante é o mesmo —
    `iat` e `exp` assinados, e NENHUM `tokenUse`, que é o ponto.
  */
  return jwt.sign(
    { sub: USER.id },
    { secret: SECRET, expiresIn: lifetimeSeconds },
  );
}

/** Lê os claims usando o tipo canônico — o mesmo que a produção consome. */
function claimsOf(token: string): Required<Pick<CarteroJwtPayload, 'sub' | 'iat' | 'exp'>> &
  CarteroJwtPayload {
  return jwt.verify(token, { secret: SECRET });
}

/* ═══════════════ B1–B2: cada token na sua finalidade ═══════════════ */

describe('o caminho feliz permanece', () => {
  let auth: AuthService;

  beforeEach(() => {
    auth = buildAuthService();
  });

  it('B1: access token novo autentica rota protegida', () => {
    const strategy = new JwtStrategy(env);
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { access_token: string; refresh_token: string };

    const payload = claimsOf(tokens.access_token);
    expect(strategy.validate(payload)).toEqual({ id: USER.id });
  });

  it('B2: refresh token novo renova a sessão', async () => {
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { refresh_token: string };

    const renewed = await auth.refresh(tokens.refresh_token);

    expect(renewed.access_token).toBeTruthy();
    expect(renewed.refresh_token).toBeTruthy();
  });
});

/* ═══════════════ B3–B6: os dois sentidos do gap, fechados ═══════════════ */

describe('finalidade cruzada é recusada', () => {
  it('B3: access token NÃO renova sessão (401)', async () => {
    const auth = buildAuthService();
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { access_token: string };

    await expect(auth.refresh(tokens.access_token)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('B4: o canal WEB usa a mesma autoridade, então também recusa', async () => {
    /*
      `/auth/refresh` (cookie) e `/auth/mobile/refresh` (body) chamam o MESMO
      `AuthService.refresh`. Uma correção que valesse só para o mobile
      deixaria o navegador exposto — este teste fixa que a autoridade é uma.
    */
    const auth = buildAuthService();
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { access_token: string };

    const controller = new AuthController(auth);
    const res = { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
    const req = { cookies: { refresh_token: tokens.access_token } } as never;

    await expect(controller.refresh(req, res)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('B5/B6: refresh token NÃO autentica rotas protegidas', () => {
    const auth = buildAuthService();
    const strategy = new JwtStrategy(env);
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { refresh_token: string };

    const payload = claimsOf(tokens.refresh_token);

    /*
      A estratégia é única para TODAS as rotas com `JwtAuthGuard` — recusar
      aqui vale para `/users/me`, `/banks`, `/categories` e qualquer outra.
    */
    expect(() => strategy.validate(payload)).toThrowError();
  });
});

/* ═══════════════ B7–B8: claims e TTL preservados ═══════════════ */

describe('a forma dos tokens não mudou além da finalidade', () => {
  it('B7: access mantém sub e 15 minutos, agora com tokenUse', () => {
    const auth = buildAuthService();
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { access_token: string };

    const payload = claimsOf(tokens.access_token);

    expect(payload.sub).toBe(USER.id);
    expect(payload.tokenUse).toBe(TOKEN_USE.access);
    expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });

  it('B8: refresh mantém sub e 30 dias, agora com tokenUse', () => {
    const auth = buildAuthService();
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { refresh_token: string };

    const payload = claimsOf(tokens.refresh_token);

    expect(payload.sub).toBe(USER.id);
    expect(payload.tokenUse).toBe(TOKEN_USE.refresh);
    expect(payload.exp - payload.iat).toBe(REFRESH_TOKEN_TTL_SECONDS);
  });

  it('todo token emitido declara finalidade — nenhum sai sem ela', () => {
    const auth = buildAuthService();
    const tokens = (auth as never as { generateToken(id: string) })['generateToken'](
      USER.id,
    ) as { access_token: string; refresh_token: string };

    for (const token of [tokens.access_token, tokens.refresh_token]) {
      expect(claimsOf(token).tokenUse).toBeDefined();
    }
  });
});

/* ═══════════════ B9–B11: transporte intocado ═══════════════ */

describe('o transporte das credenciais não mudou', () => {
  const buildController = () => {
    const service = {
      login: vi.fn().mockResolvedValue({
        access_token: 'a',
        refresh_token: 'r',
        user: { id: 'u1' },
      }),
      register: vi.fn(),
      refresh: vi.fn(),
    } as unknown as AuthService;
    return new AuthController(service);
  };

  it('B9: login web continua sem refresh token no JSON', async () => {
    const res = { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
    const body = await buildController().login(
      { email: 'a@b.c', password: 'segredo123' },
      res,
    );

    expect(JSON.stringify(body)).not.toContain('"r"');
    expect(body).not.toHaveProperty('refreshToken');
  });

  it('B10: cookie web continua HttpOnly', async () => {
    const res = { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
    await buildController().login(
      { email: 'a@b.c', password: 'segredo123' },
      res,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'r',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('B11: login mobile continua devolvendo o refresh programaticamente', async () => {
    const body = await buildController().mobileLogin({
      email: 'a@b.c',
      password: 'segredo123',
    });

    expect(body).toMatchObject({ accessToken: 'a', refreshToken: 'r' });
  });
});

/* ═══════════════ L1–L4: migração dos tokens já emitidos ═══════════════ */

describe('tokens emitidos antes desta fase', () => {
  it('L1: access LEGADO (15 min, sem tokenUse) NÃO renova sessão', async () => {
    const auth = buildAuthService();
    const legacyAccess = legacyToken(ACCESS_TOKEN_TTL_SECONDS);

    /*
      O fallback legado não é `if (!tokenUse) aceita` — isso preservaria o bug
      inteiro para todo token antigo. Ele lê a vida ASSINADA: 900 segundos não
      é perfil de refresh.
    */
    await expect(auth.refresh(legacyAccess)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('L2: refresh LEGADO (30 dias, sem tokenUse) continua funcionando', async () => {
    const auth = buildAuthService();
    const legacyRefresh = legacyToken(REFRESH_TOKEN_TTL_SECONDS);

    const renewed = await auth.refresh(legacyRefresh);

    expect(renewed.access_token).toBeTruthy();
    // E o par devolvido já nasce com finalidade explícita.
    expect(claimsOf(renewed.refresh_token).tokenUse).toBe(TOKEN_USE.refresh);
  });

  it('L3: refresh LEGADO não ganha acesso de API', () => {
    const strategy = new JwtStrategy(env);
    const payload = claimsOf(legacyToken(REFRESH_TOKEN_TTL_SECONDS));

    /*
      Política escolhida: negar. O perfil de vida distingue o token, e
      conceder acesso de API a uma credencial de 30 dias é metade do problema
      que esta fase fecha — manter isso durante a janela de migração seria
      manter o buraco aberto justamente onde ele é mais grave.
    */
    expect(() => strategy.validate(payload)).toThrowError();
  });

  it('L3b: access LEGADO continua autenticando durante a migração', () => {
    const strategy = new JwtStrategy(env);
    const payload = claimsOf(legacyToken(ACCESS_TOKEN_TTL_SECONDS));

    // Sessão web aberta agora não quebra no deploy.
    expect(strategy.validate(payload)).toEqual({ id: USER.id });
  });

  it('L4: token NOVO nunca depende do caminho legado', () => {
    /*
      Um token novo declara `tokenUse`, e as duas funções decidem por ele
      antes de olhar qualquer TTL. Provado pela contrapositiva: um token com
      `tokenUse: access` e vida de 30 dias — que passaria no teste de perfil —
      continua recusado para renovar.
    */
    const enganoso = {
      sub: 'u1',
      tokenUse: TOKEN_USE.access,
      iat: 0,
      exp: REFRESH_TOKEN_TTL_SECONDS,
    };

    expect(canMintSession(enganoso)).toBe(false);
    expect(canAuthenticateRequest(enganoso)).toBe(true);
  });
});

/* ═══════════════ A regra de perfil, isolada ═══════════════ */

describe('canMintSession / canAuthenticateRequest', () => {
  it('a finalidade explícita decide, e é exclusiva', () => {
    const refresh = { sub: 'u1', tokenUse: TOKEN_USE.refresh };
    const access = { sub: 'u1', tokenUse: TOKEN_USE.access };

    expect(canMintSession(refresh)).toBe(true);
    expect(canAuthenticateRequest(refresh)).toBe(false);

    expect(canMintSession(access)).toBe(false);
    expect(canAuthenticateRequest(access)).toBe(true);
  });

  it('a fronteira de perfil legado fica longe dos dois conjuntos reais', () => {
    const abaixo = LEGACY_REFRESH_MIN_LIFETIME_SECONDS - 1;
    const acima = LEGACY_REFRESH_MIN_LIFETIME_SECONDS;

    expect(canMintSession({ sub: 'u1', iat: 0, exp: abaixo })).toBe(false);
    expect(canMintSession({ sub: 'u1', iat: 0, exp: acima })).toBe(true);

    /*
      Os perfis reais estão a quase três mil vezes de distância um do outro —
      900s contra 2.592.000s. A fronteira em 24h não separa vizinhos: ela cai
      num vazio entre os dois conjuntos.
    */
    expect(ACCESS_TOKEN_TTL_SECONDS).toBeLessThan(
      LEGACY_REFRESH_MIN_LIFETIME_SECONDS,
    );
    expect(REFRESH_TOKEN_TTL_SECONDS).toBeGreaterThan(
      LEGACY_REFRESH_MIN_LIFETIME_SECONDS,
    );
  });

  it('token legado sem iat/exp não renova sessão', () => {
    /*
      Sem evidência assinada de perfil, não há como afirmar que é refresh.
      Recusar custa um login; aceitar reabriria o buraco para qualquer token
      malformado.
    */
    expect(canMintSession({ sub: 'u1' })).toBe(false);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { Response } from 'express';

/*
  ── O contrato dos DOIS transportes ──

  A web e o app nativo obtêm a MESMA credencial por caminhos diferentes, e a
  diferença entre eles é a propriedade de segurança que este arquivo vigia:

    web    → refresh token SÓ em cookie HttpOnly, invisível ao JavaScript
    nativo → refresh token no corpo, porque não existe jar de cookie

  O risco real não é a rota nativa existir — é a rota WEB passar a devolver o
  refresh token no JSON "para unificar os clientes". Isso compila, passa em
  qualquer teste de login e destrói silenciosamente o benefício do HttpOnly:
  a partir daí um XSS lê a credencial de 30 dias. Nenhum teste anterior
  notaria, porque o login continuaria funcionando nos dois lados.
*/

const LOGIN = { email: 'user@cartero.app', password: 'segredo123' };

function buildResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
}

describe('transporte de credencial: web x nativo', () => {
  let authService: AuthService;
  let controller: AuthController;

  beforeEach(() => {
    authService = {
      login: vi.fn().mockResolvedValue({
        access_token: 'access-web',
        refresh_token: 'refresh-web',
        user: { id: 'u1', email: LOGIN.email, name: 'Davi' },
      }),
      register: vi.fn().mockResolvedValue({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        user: { id: 'u2', email: LOGIN.email, name: 'Davi' },
      }),
      refresh: vi.fn().mockResolvedValue({
        access_token: 'access-renovado',
        refresh_token: 'refresh-renovado',
      }),
    } as unknown as AuthService;

    controller = new AuthController(authService);
  });

  /* ────────────── B1: a regressão que mais importa ────────────── */
  it('B1: login WEB não devolve o refresh token no JSON', async () => {
    const res = buildResponse();
    const body = await controller.login(LOGIN, res);

    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('user');

    /*
      Asserção sobre a SERIALIZAÇÃO inteira, não sobre uma chave esperada.
      Checar `body.refreshToken === undefined` passaria se alguém aninhasse o
      token em `user.refreshToken` ou o renomeasse para `refresh_token` — que
      é exatamente como o vazamento aconteceria na prática.
    */
    expect(JSON.stringify(body)).not.toContain('refresh-web');
  });

  it('B1b: registro WEB também não devolve o refresh token no JSON', async () => {
    const res = buildResponse();
    const body = await controller.register({ ...LOGIN, name: 'Davi' }, res);

    expect(body).toHaveProperty('accessToken');
    expect(JSON.stringify(body)).not.toContain('refresh-new');
  });

  /* ────────────── B2 / B3: o cookie continua sendo o caminho da web ────────────── */
  it('B2: login WEB emite o refresh token como cookie HttpOnly', async () => {
    const res = buildResponse();
    await controller.login(LOGIN, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-web',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('B3: refresh WEB continua lendo o token do cookie', async () => {
    const res = buildResponse();
    const req = { cookies: { refresh_token: 'refresh-do-cookie' } } as never;

    const body = await controller.refresh(req, res);

    expect(authService.refresh).toHaveBeenCalledWith('refresh-do-cookie');
    expect(body).toEqual({ accessToken: 'access-renovado' });
    // O par renovado volta pelo cookie, nunca pelo corpo.
    expect(JSON.stringify(body)).not.toContain('refresh-renovado');
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-renovado',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  /* ────────────── B4 / B5: o transporte nativo ────────────── */
  it('B4: login NATIVO devolve o refresh token programaticamente, sem cookie', async () => {
    const body = await controller.mobileLogin(LOGIN);

    expect(body).toEqual({
      accessToken: 'access-web',
      refreshToken: 'refresh-web',
      user: expect.objectContaining({ id: 'u1' }),
    });
  });

  it('B5: refresh NATIVO aceita o token pelo corpo e devolve o par novo', async () => {
    const body = await controller.mobileRefresh({
      refreshToken: 'refresh-guardado-no-keychain',
    });

    expect(authService.refresh).toHaveBeenCalledWith(
      'refresh-guardado-no-keychain',
    );
    expect(body).toEqual({
      accessToken: 'access-renovado',
      refreshToken: 'refresh-renovado',
    });
  });

  it('B6: refresh NATIVO inválido é rejeitado, e não vira sessão', async () => {
    vi.mocked(authService.refresh).mockRejectedValueOnce(
      new Error('Credenciais ínvalidas'),
    );

    await expect(
      controller.mobileRefresh({ refreshToken: 'expirado' }),
    ).rejects.toThrow();
  });

  /* ────────────── B8: uma autoridade só ────────────── */
  it('B8: as rotas nativas reutilizam o AuthService, sem emissão própria', async () => {
    await controller.mobileLogin(LOGIN);
    await controller.mobileRefresh({ refreshToken: 'r' });

    /*
      Se alguém reimplementasse a assinatura do token dentro do controller
      nativo, o serviço deixaria de ser chamado e os dois caminhos poderiam
      divergir em TTL ou claim sem nenhum erro aparente.
    */
    expect(authService.login).toHaveBeenCalledWith(LOGIN);
    expect(authService.refresh).toHaveBeenCalledWith('r');
  });

  it('B8b: a rota nativa NÃO escreve cookie — ela não recebe o Response', () => {
    /*
      Garantia estrutural, não comportamental: os handlers nativos não têm
      acesso ao objeto de resposta, então é impossível que passem a setar
      cookie sem uma mudança visível de assinatura.
    */
    expect(controller.mobileLogin.length).toBe(1);
    expect(controller.mobileRefresh.length).toBe(1);
  });
});

/* ────────────── B7 / B9: forma do transporte e claims ────────────── */
describe('superfície do transporte nativo', () => {
  const source = () =>
    readFileSync(join(__dirname, 'auth.controller.ts'), 'utf-8');

  it('B7: o refresh token nativo trafega pelo BODY, nunca por query string', () => {
    const text = source();

    /*
      Query string vaza em log de servidor, em histórico de proxy e no header
      `Referer` — lugares onde ninguém procura por credencial e de onde ela
      não sai depois. O `@Body()` é a única entrada aceitável.
    */
    expect(text).toContain('mobileRefresh(@Body() dto: MobileRefreshDto)');
    expect(text).not.toMatch(/@Query\([^)]*\)\s*\w*[Rr]efresh/);
    expect(text).not.toMatch(/@Param\([^)]*\)\s*\w*[Rr]efresh/);
  });

  it('B9: TTL e claims permanecem no AuthService, fora do controller', () => {
    const text = source();

    /*
      Nenhum `expiresIn`, segredo ou `sign` no controller: mudar a validade do
      token por aqui produziria dois regimes de expiração — um por rota — e o
      bug apareceria só semanas depois, como sessão que cai sozinha.
    */
    expect(text).not.toContain('expiresIn');
    expect(text).not.toContain('jwt.sign');
    expect(text).not.toContain('REFRESH_TOKEN_SECRET');
  });
});

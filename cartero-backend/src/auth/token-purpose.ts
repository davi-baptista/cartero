/**
 * A finalidade de um token, assinada junto com ele.
 *
 * ── O problema que isto resolve ──
 *
 * Access e refresh eram JWTs indistinguíveis: mesmos claims (`sub`, `iat`,
 * `exp`) e, na prática, a MESMA chave — `JWT_SECRET` e `REFRESH_TOKEN_SECRET`
 * são variáveis separadas, mas o `.env.example` do projeto instrui o mesmo
 * valor para as duas, e era isso que valia no ambiente real.
 *
 * Com a chave coincidindo, a separação existia só no nome da variável. Foi
 * verificado contra o backend em execução, nos dois sentidos:
 *
 *   access  → POST /auth/mobile/refresh   201  (e 201 também no canal web)
 *   refresh → GET /users/me               200  (idem /banks, /categories)
 *
 * O primeiro converte um comprometimento de 15 minutos numa credencial de 30
 * dias. O segundo é o mais grave: o refresh token — que vive no Keychain do
 * celular e no cookie do navegador por um mês — autenticava qualquer rota da
 * API como se fosse um access token.
 *
 * ── Por que um claim, e não chaves distintas ──
 *
 * Separar as chaves resolveria, mas exige trocar um segredo em produção, e
 * toda sessão viva morre no deploy. O claim viaja DENTRO da assinatura: não
 * pode ser forjado sem a chave, e funciona mesmo que as duas continuem
 * iguais. Sem variável de ambiente nova, sem invalidar ninguém.
 */
export const TOKEN_USE = {
  access: 'access',
  refresh: 'refresh',
} as const;

export type TokenUse = (typeof TOKEN_USE)[keyof typeof TOKEN_USE];

/** Claims que o Cartero assina. `tokenUse` está ausente nos tokens legados. */
export interface CarteroJwtPayload {
  sub: string;
  tokenUse?: TokenUse;
  iat?: number;
  exp?: number;
}

/**
 * Vida de um refresh token, em segundos (30 dias).
 *
 * É o que `generateToken` assina, e o limite superior do que um access token
 * pode ter — a distinção que torna o fallback legado seguro.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Vida de um access token, em segundos (15 minutos). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Fronteira que separa os dois perfis históricos de token.
 *
 * Um token legado não diz para que serve, mas diz quanto tempo vale — e isso
 * está DENTRO da assinatura (`exp - iat`), portanto não é forjável sem a
 * chave. Os dois perfis emitidos pelo Cartero são 900s e 2.592.000s: uma
 * distância de quase três mil vezes, sem nada no meio.
 *
 * O limite fica em 24 horas: bem acima de qualquer access token já emitido
 * (15 min) e muito abaixo de qualquer refresh (30 dias). Não é heurística
 * frouxa — é a leitura de um campo assinado, num espaço onde os dois
 * conjuntos não chegam perto de se tocar.
 *
 * ── Por que isto NÃO é a arquitetura final ──
 *
 * TTL não descreve finalidade; ele apenas distingue o que o Cartero já
 * emitiu. Tokens novos carregam `tokenUse` e nunca passam por aqui. Este
 * caminho existe só para não deslogar quem tem sessão aberta, e deve ser
 * removido depois que o último refresh token pré-migração expirar — 30 dias
 * após o deploy.
 */
export const LEGACY_REFRESH_MIN_LIFETIME_SECONDS = 24 * 60 * 60;

/**
 * Este token pode renovar uma sessão?
 *
 * Aceita duas coisas, e nada além:
 *
 *   1. token novo com `tokenUse: 'refresh'` — a autoridade explícita;
 *   2. token legado SEM `tokenUse` cuja vida assinada seja de refresh.
 *
 * Um access token legado tem 900 segundos de vida e é recusado pelo segundo
 * caminho. Isso é o oposto de `if (!tokenUse) aceita`, que preservaria o bug
 * inteiro para todos os tokens antigos.
 */
export function canMintSession(payload: CarteroJwtPayload): boolean {
  if (payload.tokenUse === TOKEN_USE.refresh) return true;

  // Token novo com finalidade declarada de access: recusa imediata.
  if (payload.tokenUse !== undefined) return false;

  return hasLegacyRefreshLifetime(payload);
}

/**
 * Este token pode autenticar uma rota protegida?
 *
 * Um refresh token legado NÃO passa: ele tem vida de 30 dias e cai no mesmo
 * teste de perfil, só que com o sinal invertido. É deliberado — conceder
 * acesso de API a uma credencial de longa duração é justamente metade do
 * problema que esta fase fecha.
 */
export function canAuthenticateRequest(payload: CarteroJwtPayload): boolean {
  if (payload.tokenUse === TOKEN_USE.access) return true;
  if (payload.tokenUse !== undefined) return false;

  return !hasLegacyRefreshLifetime(payload);
}

/**
 * A vida assinada deste token corresponde ao perfil de um refresh?
 *
 * Sem `iat` ou `exp` não há evidência assinada de perfil nenhum, e a resposta
 * é `false`: na dúvida, o token não renova sessão. Recusar um token
 * malformado custa um login; aceitá-lo reabriria o buraco.
 */
function hasLegacyRefreshLifetime(payload: CarteroJwtPayload): boolean {
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    return false;
  }

  return payload.exp - payload.iat >= LEGACY_REFRESH_MIN_LIFETIME_SECONDS;
}

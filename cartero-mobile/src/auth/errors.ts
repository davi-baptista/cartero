import type { AuthErrorKind } from './types'

/** Erro de transporte: a requisição não chegou a receber resposta. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('network')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/** O servidor respondeu, e respondeu recusando. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`http_${status}`)
    this.name = 'HttpError'
  }
}

/**
 * A ÚNICA pergunta que autoriza apagar a credencial do dispositivo:
 * o servidor rejeitou DEFINITIVAMENTE este refresh token?
 *
 * ── Por que a decisão é positiva ──
 *
 * A versão anterior decidia por negação — "não é erro de rede, então a sessão
 * expirou" — e isso é falso para quase todo o espectro de falhas. Um HTTP 502
 * significa que o gateway não alcançou o backend: ele não diz absolutamente
 * nada sobre a validade da credencial. Mesmo assim bastava para o app apagar
 * o refresh token e exigir login de novo.
 *
 * O custo era real e assimétrico. Um deploy no Render, um cold start, um
 * restart do backend ou um 503 momentâneo deslogaria todo mundo que abrisse o
 * app naquele instante — e a credencial, uma vez apagada, não volta. Já
 * preservá-la num caso genuíno de expiração custa uma requisição a mais, que
 * o servidor recusa de novo com 401.
 *
 * ── O contrato, verificado contra o backend real ──
 *
 * `POST /auth/mobile/refresh` devolve:
 *
 *   401  assinatura inválida · token malformado · token expirado
 *   400  falha de forma do DTO (body vazio, tipo errado, string vazia)
 *   201  sucesso
 *
 * `AuthService.refresh` tem UM único `catch`, que lança
 * `UnauthorizedException` — 401 é, portanto, a totalidade da rejeição de
 * credencial. Nada mais no caminho produz esse significado.
 *
 * **403 não entra.** O backend não o emite nesta rota, e ele significa
 * "autenticado, mas sem permissão" — um fato sobre autorização, não sobre a
 * validade do token. Incluí-lo por precaução reintroduziria exatamente o
 * problema que esta função existe para eliminar.
 *
 * **400 não entra.** É erro de forma da requisição, gerado pelo
 * `ValidationPipe` antes de o token sequer ser verificado. Se o app enviasse
 * um corpo inválido por bug próprio, apagar a credencial converteria um
 * defeito de cliente em logout em massa — escondendo a causa e destruindo a
 * sessão de quem não tinha problema nenhum.
 */
export function isDefinitiveRefreshRejection(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401
}

/**
 * Traduz uma falha para o que a interface sabe explicar.
 *
 * O usuário nunca vê `AxiosError`, stack, status cru nem trecho de JWT. Mas a
 * distinção que importa não é de copy: cada categoria leva a uma DECISÃO
 * diferente sobre a credencial guardada — `network` e `serverUnavailable` a
 * preservam, `invalidCredentials`/`sessionExpired` a apagam.
 */
export function normalizeAuthError(error: unknown): AuthErrorKind {
  if (error instanceof NetworkError) return 'network'

  if (error instanceof HttpError) {
    if (error.status === 401) return 'invalidCredentials'

    /*
      5xx e 429 são do SERVIDOR, não da credencial: sobrecarga, deploy em
      andamento, upstream fora do ar, limite de taxa. Todos passam.
    */
    if (error.status >= 500 || error.status === 429) {
      return 'serverUnavailable'
    }

    return 'unknown'
  }

  return 'unknown'
}

/**
 * Mensagens exibíveis. Sem detalhe técnico, sem nome de campo da API.
 *
 * `serverUnavailable` não diz "502" nem "gateway": o número não ajuda quem lê
 * e, pior, sugere culpa do próprio aparelho. Diz o que é verdade — o problema
 * está do lado do Cartero — e que tentar de novo faz sentido, porque a sessão
 * continua guardada.
 */
export const AUTH_ERROR_MESSAGE: Record<AuthErrorKind, string> = {
  invalidCredentials: 'E-mail ou senha incorretos.',
  network: 'Sem conexão com o servidor. Verifique sua internet.',
  serverUnavailable:
    'Não foi possível conectar ao Cartero agora. Tente novamente.',
  sessionExpired: 'Sua sessão expirou. Entre novamente.',
  unknown: 'Não foi possível concluir. Tente de novo.',
}

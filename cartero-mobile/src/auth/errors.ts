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
 * Traduz qualquer falha para as quatro que a interface sabe explicar.
 *
 * O usuário nunca vê `AxiosError`, stack, status cru nem trecho de JWT. Mas a
 * distinção que realmente importa não é de copy: `network` e
 * `invalidCredentials` levam a DECISÕES opostas no bootstrap — uma preserva a
 * credencial guardada, a outra a apaga.
 */
export function normalizeAuthError(error: unknown): AuthErrorKind {
  if (error instanceof NetworkError) return 'network'

  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return 'invalidCredentials'
    }
    return 'unknown'
  }

  return 'unknown'
}

/** Mensagens exibíveis. Sem detalhe técnico, sem nome de campo da API. */
export const AUTH_ERROR_MESSAGE: Record<AuthErrorKind, string> = {
  invalidCredentials: 'E-mail ou senha incorretos.',
  network: 'Sem conexão com o servidor. Verifique sua internet.',
  sessionExpired: 'Sua sessão expirou. Entre novamente.',
  unknown: 'Não foi possível concluir. Tente de novo.',
}

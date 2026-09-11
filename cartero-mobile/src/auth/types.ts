/**
 * Estados possíveis da sessão.
 *
 * Um enum em vez de booleanos espalhados (`isLoading`, `isAuthenticated`,
 * `isRefreshing`) porque a combinação deles admite estados impossíveis — o
 * clássico `isLoading && isAuthenticated`, que a UI resolve por acidente de
 * ordem de `if`. O invariante que importa: enquanto `bootstrapping`, a tela
 * NÃO é nem a de login nem a autenticada, senão o app pisca a tela errada ao
 * abrir com sessão válida.
 */
export type SessionStatus =
  | 'bootstrapping'
  | 'signedOut'
  | 'authenticating'
  | 'signedIn'
  | 'refreshing'
  | 'error'

/** O usuário como o backend o devolve — sem `password`, que nunca sai da API. */
export interface AuthUser {
  id: string
  email: string
  name: string
}

export interface SessionState {
  status: SessionStatus
  user: AuthUser | null
  /**
   * Motivo legível de falha. Nunca carrega mensagem crua de exceção, status
   * HTTP ou payload de token — ver `normalizeAuthError`.
   */
  error: AuthErrorKind | null
}

/**
 * As únicas falhas que o usuário precisa distinguir.
 *
 * `network` existe separado de `invalidCredentials` por uma razão concreta do
 * bootstrap: se uma queda de rede fosse tratada como credencial inválida, o
 * app apagaria o refresh token do armazenamento seguro e exigiria login de
 * novo — perdendo a sessão por estar sem sinal no metrô.
 */
export type AuthErrorKind =
  | 'invalidCredentials'
  | 'network'
  | 'sessionExpired'
  | 'unknown'

/** Par de tokens como as rotas nativas do backend o devolvem. */
export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface MobileLoginResponse extends TokenPair {
  user: AuthUser
}

/**
 * Armazenamento da credencial de longa duração.
 *
 * Interface em vez de importar `expo-secure-store` direto: é o que permite
 * testar a máquina de sessão sem runtime nativo, e o que torna verificável a
 * regra de que o refresh token não pode ir para armazenamento comum.
 */
export interface SecureCredentialStore {
  getRefreshToken(): Promise<string | null>
  setRefreshToken(token: string): Promise<void>
  clear(): Promise<void>
}

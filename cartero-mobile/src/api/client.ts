import { HttpError, NetworkError } from '../auth/errors'
import type {
  MobileLoginResponse,
  SecureCredentialStore,
  TokenPair,
} from '../auth/types'

/**
 * Cliente HTTP mínimo do Cartero Mobile.
 *
 * Deliberadamente pequeno: o M1 precisa de auth e de UMA rota protegida para
 * provar o caminho. Portar as camadas de serviço do web (1432 linhas de DTO)
 * criaria uma segunda superfície para manter em sincronia antes de existir
 * uma tela que a use.
 *
 * `fetch` em vez de axios: é nativo no runtime do React Native, não adiciona
 * dependência e cobre o que precisamos. O interceptor do web existe por causa
 * do axios; aqui a coordenação de refresh é explícita.
 */

export interface ApiClientOptions {
  baseUrl: string
  store: SecureCredentialStore
  /** Injetável para teste; no app é o `fetch` global. */
  fetchFn?: typeof fetch
  /** Chamado quando a sessão se torna irrecuperável. */
  onSessionLost?: () => void
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

export class ApiClient {
  /**
   * Access token SÓ em memória.
   *
   * Ele vive 15 minutos e é reconstruível a partir do refresh token. Gravá-lo
   * em armazenamento comum acrescentaria uma credencial persistida ao
   * dispositivo sem comprar nada: o app já consegue recuperar a sessão pelo
   * refresh no armazenamento seguro.
   */
  private accessToken: string | null = null

  /**
   * O refresh em voo, compartilhado.
   *
   * Sem isto, cinco requisições que expiram juntas disparam cinco refreshes
   * concorrentes. Além do desperdício, os quatro últimos gravariam tokens
   * sobrepostos no armazenamento seguro, e o app terminaria com um par que
   * não é o da última resposta — sessão que cai sozinha minutos depois.
   */
  private refreshInFlight: Promise<string> | null = null

  private readonly baseUrl: string
  private readonly store: SecureCredentialStore
  private readonly fetchFn: typeof fetch
  private readonly onSessionLost?: () => void
  private readonly timeoutMs: number

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.store = options.store
    this.fetchFn = options.fetchFn ?? globalThis.fetch
    this.onSessionLost = options.onSessionLost
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  setAccessToken(token: string | null) {
    this.accessToken = token
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  /** Requisição crua, sem Authorization e sem recuperação de sessão. */
  private async raw<T>(
    path: string,
    init: RequestInit & { authorization?: string } = {},
  ): Promise<T> {
    const { authorization, ...rest } = init
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...rest,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
          ...(rest.headers ?? {}),
        },
      })
    } catch (cause) {
      /*
        Falha de transporte — DNS, timeout, offline. Distinta de uma recusa
        do servidor, e a diferença decide se a credencial guardada sobrevive.
      */
      throw new NetworkError(cause)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new HttpError(response.status)
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  /* ──────────────────────────── auth ──────────────────────────── */

  async login(
    email: string,
    password: string,
  ): Promise<MobileLoginResponse> {
    return this.raw<MobileLoginResponse>('/auth/mobile/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  /**
   * Troca o refresh token por um par novo e o persiste.
   *
   * O par novo SUBSTITUI o anterior no armazenamento seguro. Isso não revoga
   * o antigo — a arquitetura do backend é stateless, e afirmar revogação
   * aqui seria descrever uma garantia que não existe.
   */
  async refreshSession(): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = (async () => {
      const stored = await this.store.getRefreshToken()
      if (!stored) throw new HttpError(401)

      const pair = await this.raw<TokenPair>('/auth/mobile/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: stored }),
      })

      await this.store.setRefreshToken(pair.refreshToken)
      this.accessToken = pair.accessToken
      return pair.accessToken
    })()

    try {
      return await this.refreshInFlight
    } finally {
      // Liberado sempre — inclusive na falha, senão um erro transitório
      // deixaria a promessa rejeitada em cache e toda chamada seguinte
      // falharia sem nem tentar.
      this.refreshInFlight = null
    }
  }

  /* ─────────────────────── rotas protegidas ─────────────────────── */

  /**
   * Requisição autenticada com UM único ciclo de recuperação.
   *
   * O limite é estrutural, não um contador: `retried` é local à chamada e a
   * repetição usa `authorized: false`, então a segunda tentativa não tem como
   * disparar outro refresh. Um interceptor que reentra em si mesmo produz o
   * laço clássico — 401 → refresh → 401 → refresh — que só aparece quando o
   * backend recusa por outro motivo que não expiração.
   */
  async authorized<T>(path: string, init: RequestInit = {}): Promise<T> {
    const attempt = (token: string | null) =>
      this.raw<T>(path, {
        ...init,
        authorization: token ? `Bearer ${token}` : undefined,
      })

    try {
      return await attempt(this.accessToken)
    } catch (error) {
      /*
        Só 401 justifica renovar. Um 403 significa que a credencial é válida e
        mesmo assim não autoriza — renovar devolveria o mesmo 403, e tratar
        todo erro como expiração transformaria qualquer falha de permissão em
        logout.
      */
      if (!(error instanceof HttpError) || error.status !== 401) throw error

      try {
        const fresh = await this.refreshSession()
        return await attempt(fresh)
      } catch (refreshError) {
        /*
          Recuperação falhou. Se foi rede, a sessão continua válida — só está
          inalcançável, e derrubá-la faria o usuário perder a sessão por falta
          de sinal. Só a recusa do servidor encerra.
        */
        if (refreshError instanceof NetworkError) throw refreshError

        this.accessToken = null
        await this.store.clear()
        this.onSessionLost?.()
        throw refreshError
      }
    }
  }
}

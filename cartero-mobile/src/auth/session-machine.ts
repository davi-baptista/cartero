import type { ApiClient } from '../api/client'
import { HttpError, NetworkError, normalizeAuthError } from './errors'
import type {
  AuthUser,
  SecureCredentialStore,
  SessionState,
} from './types'

/**
 * As transições de sessão, isoladas de React e de React Native.
 *
 * Vive separada do provider por dois motivos: é a lógica onde um erro custa a
 * sessão do usuário (ou a credencial no dispositivo), e é testável sem montar
 * runtime nativo. O provider fica sendo só a ligação com o estado do React.
 */

export const INITIAL_SESSION: SessionState = {
  status: 'bootstrapping',
  user: null,
  error: null,
}

export interface SessionDeps {
  api: ApiClient
  store: SecureCredentialStore
  /** Publica cada estado novo. No app, um `setState`. */
  emit: (state: SessionState) => void
}

export class SessionMachine {
  private state: SessionState = INITIAL_SESSION

  constructor(private readonly deps: SessionDeps) {}

  getState(): SessionState {
    return this.state
  }

  private set(next: SessionState) {
    this.state = next
    this.deps.emit(next)
  }

  /**
   * Restauração na abertura do app.
   *
   * O ponto delicado é o tratamento da falha. Rede indisponível NÃO é
   * credencial inválida: apagar o refresh token por uma queda de sinal
   * forçaria login de novo e destruiria a única credencial que o app tem.
   * Por isso a limpeza acontece só quando o servidor RESPONDE recusando.
   */
  async bootstrap(): Promise<void> {
    this.set({ status: 'bootstrapping', user: null, error: null })

    const token = await this.deps.store.getRefreshToken()
    if (!token) {
      this.set({ status: 'signedOut', user: null, error: null })
      return
    }

    try {
      await this.deps.api.refreshSession()
      const user = await this.deps.api.authorized<AuthUser>('/users/me')
      this.set({ status: 'signedIn', user, error: null })
    } catch (error) {
      if (error instanceof NetworkError) {
        /*
          A credencial PERMANECE guardada. O app fica deslogado nesta abertura
          — não há como provar a sessão sem rede — mas a próxima tentativa com
          conexão restaura tudo sem novo login.
        */
        this.set({ status: 'signedOut', user: null, error: 'network' })
        return
      }

      await this.deps.store.clear()
      this.deps.api.setAccessToken(null)
      this.set({
        status: 'signedOut',
        user: null,
        error: error instanceof HttpError ? 'sessionExpired' : 'unknown',
      })
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    this.set({ status: 'authenticating', user: null, error: null })

    try {
      const result = await this.deps.api.login(email, password)

      /*
        Persistir ANTES de declarar a sessão ativa: se a escrita no
        armazenamento seguro falhar, o app não deve afirmar que está logado —
        seria uma sessão que desaparece no próximo lançamento sem explicação.
      */
      await this.deps.store.setRefreshToken(result.refreshToken)
      this.deps.api.setAccessToken(result.accessToken)

      this.set({ status: 'signedIn', user: result.user, error: null })
    } catch (error) {
      // Nada é persistido numa tentativa fracassada.
      this.deps.api.setAccessToken(null)
      this.set({
        status: 'signedOut',
        user: null,
        error: normalizeAuthError(error),
      })
    }
  }

  /**
   * Encerramento LOCAL.
   *
   * Limpa o que existe neste dispositivo: token em memória, credencial no
   * armazenamento seguro e estado do usuário. O refresh token continua
   * tecnicamente válido no servidor até expirar — a arquitetura é stateless e
   * não há lista de revogação. Dizer ao usuário que a sessão foi "encerrada
   * em todos os dispositivos" seria falso.
   *
   * Revogação de verdade exige modelo de sessão no backend, registrado como
   * release gate em `docs/RELEASE-GATES.md`.
   */
  async signOut(): Promise<void> {
    this.deps.api.setAccessToken(null)
    await this.deps.store.clear()
    this.set({ status: 'signedOut', user: null, error: null })
  }

  /** Chamado quando o cliente perde a sessão no meio de uma requisição. */
  handleSessionLost(): void {
    this.set({ status: 'signedOut', user: null, error: 'sessionExpired' })
  }
}

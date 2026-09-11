import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiClient } from '../api/client'
import { SessionMachine } from './session-machine'
import { HttpError, NetworkError } from './errors'
import type { SecureCredentialStore, SessionState } from './types'

/*
  ── O que este arquivo protege ──

  A sessão do Cartero Mobile tem duas propriedades que, se quebrarem, quebram
  em silêncio:

  1. A credencial de longa duração vive SÓ no armazenamento seguro, e o access
     token SÓ em memória. Uma regressão aqui não produz erro nenhum — o app
     continua funcionando, apenas com uma credencial a mais exposta no
     dispositivo.

  2. Falha de REDE e credencial INVÁLIDA levam a decisões opostas. Confundir
     as duas faz o app apagar a credencial de quem só estava sem sinal.
*/

/** Dublê do Keychain/Keystore: guarda de verdade, para o teste observar. */
function createStore(initial: string | null = null) {
  let token = initial
  const store: SecureCredentialStore & { peek(): string | null } = {
    getRefreshToken: vi.fn(async () => token),
    setRefreshToken: vi.fn(async (value: string) => {
      token = value
    }),
    clear: vi.fn(async () => {
      token = null
    }),
    peek: () => token,
  }
  return store
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function buildSession(options: {
  store: ReturnType<typeof createStore>
  fetchFn: typeof fetch
}) {
  const states: SessionState[] = []
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    store: options.store,
    fetchFn: options.fetchFn,
  })
  const machine = new SessionMachine({
    api,
    store: options.store,
    emit: (state) => states.push(state),
  })
  return { api, machine, states }
}

const USER = { id: 'u1', email: 'davi@cartero.app', name: 'Davi' }

describe('sessão do Cartero Mobile', () => {
  beforeEach(() => vi.clearAllMocks())

  /* ───────────────────────── M1 ───────────────────────── */
  it('M1: instalação nova começa deslogada, sem chamar a API', async () => {
    const store = createStore(null)
    const fetchFn = vi.fn()
    const { machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.bootstrap()

    expect(machine.getState().status).toBe('signedOut')
    // Sem credencial guardada não há o que restaurar — nem requisição a fazer.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  /* ───────────────────────── M2 / M11 ───────────────────────── */
  it('M2: login guarda o refresh token no armazenamento seguro e o access só em memória', async () => {
    const store = createStore(null)
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: USER,
      }),
    )
    const { api, machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.signIn(USER.email, 'segredo123')

    expect(machine.getState().status).toBe('signedIn')
    expect(machine.getState().user).toEqual(USER)
    expect(store.setRefreshToken).toHaveBeenCalledWith('refresh-1')
    expect(api.getAccessToken()).toBe('access-1')
  })

  it('M11: o access token NUNCA chega ao armazenamento seguro', async () => {
    const store = createStore(null)
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: USER,
      }),
    )
    const { machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.signIn(USER.email, 'segredo123')

    /*
      Asserção sobre TUDO que foi gravado, não sobre a chave esperada: um
      `setItem('cartero.accessToken', ...)` adicional passaria por qualquer
      verificação que olhasse só o refresh.
    */
    const written = vi
      .mocked(store.setRefreshToken)
      .mock.calls.map(([value]) => value)

    expect(written).toEqual(['refresh-1'])
    expect(written).not.toContain('access-1')
    expect(store.peek()).toBe('refresh-1')
  })

  it('M3: login recusado não persiste credencial nenhuma', async () => {
    const store = createStore(null)
    const fetchFn = vi.fn(async () => jsonResponse({}, 401))
    const { api, machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.signIn(USER.email, 'errada')

    expect(machine.getState()).toMatchObject({
      status: 'signedOut',
      error: 'invalidCredentials',
    })
    expect(store.setRefreshToken).not.toHaveBeenCalled()
    expect(store.peek()).toBeNull()
    expect(api.getAccessToken()).toBeNull()
  })

  /* ───────────────────────── M4 / M5 / M6 ───────────────────────── */
  it('M4: reabrir o app com refresh válido restaura a sessão sem novo login', async () => {
    const store = createStore('refresh-guardado')
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        return jsonResponse({
          accessToken: 'access-novo',
          refreshToken: 'refresh-novo',
        })
      }
      return jsonResponse(USER)
    })
    const { api, machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.bootstrap()

    expect(machine.getState()).toMatchObject({ status: 'signedIn', user: USER })
    // O par renovado substitui o anterior.
    expect(store.peek()).toBe('refresh-novo')
    expect(api.getAccessToken()).toBe('access-novo')
  })

  it('M5: refresh recusado pelo servidor limpa o armazenamento seguro', async () => {
    const store = createStore('refresh-expirado')
    const fetchFn = vi.fn(async () => jsonResponse({}, 401))
    const { api, machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.bootstrap()

    expect(machine.getState()).toMatchObject({
      status: 'signedOut',
      error: 'sessionExpired',
    })
    expect(store.clear).toHaveBeenCalled()
    expect(store.peek()).toBeNull()
    expect(api.getAccessToken()).toBeNull()
  })

  it('M6: falha de REDE no bootstrap preserva a credencial guardada', async () => {
    const store = createStore('refresh-valido')
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Network request failed')
    })
    const { machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.bootstrap()

    /*
      O app fica deslogado NESTA abertura — sem rede não há como provar a
      sessão. Mas a credencial sobrevive: tratá-la como inválida faria o
      usuário perder a sessão por estar sem sinal, e o login seguinte seria
      exigido sem que nada tivesse expirado.
    */
    expect(machine.getState()).toMatchObject({
      status: 'signedOut',
      error: 'network',
    })
    expect(store.clear).not.toHaveBeenCalled()
    expect(store.peek()).toBe('refresh-valido')
  })

  /* ───────────────────────── M10 ───────────────────────── */
  it('M10: logout limpa memória e armazenamento seguro', async () => {
    const store = createStore('refresh-1')
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: USER,
      }),
    )
    const { api, machine } = buildSession({ store, fetchFn: fetchFn as never })

    await machine.signIn(USER.email, 'segredo123')
    await machine.signOut()

    expect(machine.getState()).toMatchObject({ status: 'signedOut', user: null })
    expect(api.getAccessToken()).toBeNull()
    expect(store.peek()).toBeNull()
  })
})

/* ═══════════════ M7 / M8 / M9: recuperação de 401 ═══════════════ */

describe('recuperação de requisição expirada', () => {
  it('M7: 401 dispara UM refresh e repete a requisição original', async () => {
    const store = createStore('refresh-1')
    let protectedCalls = 0

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/auth/mobile/refresh')) {
        return jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
        })
      }
      protectedCalls += 1
      const auth = (init?.headers as Record<string, string>)?.Authorization
      // Expira na primeira; aceita quando o token renovado chega.
      return auth === 'Bearer access-2'
        ? jsonResponse({ ok: true })
        : jsonResponse({}, 401)
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-1')

    const result = await api.authorized<{ ok: boolean }>('/budget')

    expect(result).toEqual({ ok: true })
    expect(protectedCalls).toBe(2) // original + uma repetição
    expect(store.peek()).toBe('refresh-2')
  })

  it('M8: refresh recusado encerra a sessão e não repete indefinidamente', async () => {
    const store = createStore('refresh-expirado')
    const onSessionLost = vi.fn()
    let refreshCalls = 0

    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        refreshCalls += 1
        return jsonResponse({}, 401)
      }
      return jsonResponse({}, 401)
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
      onSessionLost,
    })
    api.setAccessToken('access-velho')

    await expect(api.authorized('/budget')).rejects.toBeInstanceOf(HttpError)

    /*
      UM ciclo de recuperação, não uma cadeia. O laço clássico
      401 → refresh → 401 → refresh só aparece quando a repetição pode
      disparar outro refresh — aqui ela não pode, por construção.
    */
    expect(refreshCalls).toBe(1)
    expect(onSessionLost).toHaveBeenCalledTimes(1)
    expect(store.peek()).toBeNull()
    expect(api.getAccessToken()).toBeNull()
  })

  it('M9: cinco 401 simultâneos compartilham UM único refresh', async () => {
    const store = createStore('refresh-1')
    let refreshCalls = 0

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/auth/mobile/refresh')) {
        refreshCalls += 1
        // Latência real: sem ela, cada chamada resolveria antes da próxima
        // começar e a concorrência não seria exercitada.
        await new Promise((resolve) => setTimeout(resolve, 10))
        return jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
        })
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization
      return auth === 'Bearer access-2'
        ? jsonResponse({ ok: true })
        : jsonResponse({}, 401)
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-1')

    const results = await Promise.all([
      api.authorized<{ ok: boolean }>('/budget'),
      api.authorized<{ ok: boolean }>('/invoices'),
      api.authorized<{ ok: boolean }>('/persons'),
      api.authorized<{ ok: boolean }>('/transactions'),
      api.authorized<{ ok: boolean }>('/users/me'),
    ])

    expect(results).toHaveLength(5)
    expect(results.every((r) => r.ok)).toBe(true)

    /*
      Cinco refreshes concorrentes não seriam só desperdício: cada um grava no
      armazenamento seguro, e o app terminaria com um par que não é o da
      última resposta — sessão que cai sozinha minutos depois.
    */
    expect(refreshCalls).toBe(1)
    expect(store.setRefreshToken).toHaveBeenCalledTimes(1)
  })

  it('refresh bem-sucedido com rota que segue recusando NÃO vira laço', async () => {
    const store = createStore('refresh-1')
    let refreshCalls = 0
    let protectedCalls = 0

    /*
      O cenário que expõe recursão: o refresh SEMPRE funciona, e a rota
      protegida SEMPRE devolve 401 (por autorização, não por expiração). Se a
      repetição puder disparar outro refresh, isto não termina — e o app
      trava girando, martelando o servidor.
    */
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        refreshCalls += 1
        return jsonResponse({
          accessToken: `access-${refreshCalls}`,
          refreshToken: `refresh-${refreshCalls}`,
        })
      }
      protectedCalls += 1
      return jsonResponse({}, 401)
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-0')

    await expect(api.authorized('/budget')).rejects.toBeInstanceOf(HttpError)

    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(2)
  })

  it('falha de rede durante o refresh NÃO apaga a credencial', async () => {
    const store = createStore('refresh-valido')
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        throw new TypeError('Network request failed')
      }
      return jsonResponse({}, 401)
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-1')

    await expect(api.authorized('/budget')).rejects.toBeInstanceOf(NetworkError)
    expect(store.peek()).toBe('refresh-valido')
  })

  it('403 não é tratado como expiração — renovar devolveria o mesmo 403', async () => {
    const store = createStore('refresh-1')
    let refreshCalls = 0

    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        refreshCalls += 1
        return jsonResponse({ accessToken: 'a', refreshToken: 'r' })
      }
      return jsonResponse({}, 403)
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-1')

    await expect(api.authorized('/admin')).rejects.toBeInstanceOf(HttpError)
    expect(refreshCalls).toBe(0)
    // A sessão continua: permissão negada não é credencial expirada.
    expect(store.peek()).toBe('refresh-1')
  })
})

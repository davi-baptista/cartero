import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../api/client'
import { SessionMachine } from './session-machine'
import { HttpError, isDefinitiveRefreshRejection } from './errors'
import type { SecureCredentialStore } from './types'

/*
  ── Falha transitória não é credencial rejeitada ──

  O runtime no emulador provou o defeito: com o backend derrubado atrás de um
  gateway, `POST /auth/mobile/refresh` devolveu 502. O app exibiu "Sua sessão
  expirou" e APAGOU o refresh token — por causa de um servidor reiniciando.

  A credencial apagada não volta. Um deploy no Render, um cold start ou um 503
  momentâneo deslogaria todo mundo que abrisse o app naquele instante, e cada
  um teria de digitar a senha de novo. O custo inverso — preservar a
  credencial num caso real de expiração — é uma requisição a mais, que o
  servidor recusa com 401.

  O contrato do backend foi verificado empiricamente:

      401  assinatura inválida · malformado · expirado   → rejeição
      400  body vazio · tipo errado · string vazia       → forma do DTO
      201  sucesso

  Só 401 autoriza apagar. Estes testes existem para que uma regressão para a
  decisão por negação ("não é erro de rede, logo expirou") falhe aqui.
*/

function createStore(initial: string | null = 'refresh-guardado') {
  let token = initial
  return {
    getRefreshToken: vi.fn(async () => token),
    setRefreshToken: vi.fn(async (v: string) => {
      token = v
    }),
    clear: vi.fn(async () => {
      token = null
    }),
    peek: () => token,
  } satisfies SecureCredentialStore & { peek(): string | null }
}

/** Resposta HTTP real — o servidor RESPONDEU, com este status. */
function httpStatus(status: number) {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
    }) as Response
}

/** Falha de TRANSPORTE — nenhuma resposta chegou. */
const transportFailure = async () => {
  throw new TypeError('Network request failed')
}

function buildBootstrap(fetchFn: typeof fetch, initial = 'refresh-guardado') {
  const store = createStore(initial)
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    store,
    fetchFn,
  })
  const machine = new SessionMachine({ api, store, emit: () => {} })
  return { store, api, machine }
}

/* ════════════════ T1–T8: o bootstrap e a credencial ════════════════ */

describe('bootstrap: o que apaga e o que preserva a credencial', () => {
  it('T1: refresh 401 (rejeição definitiva) apaga a credencial', async () => {
    const { store, machine } = buildBootstrap(httpStatus(401) as never)

    await machine.bootstrap()

    expect(store.peek()).toBeNull()
    expect(store.clear).toHaveBeenCalled()
    expect(machine.getState()).toMatchObject({
      status: 'signedOut',
      error: 'sessionExpired',
    })
  })

  it('T2: falha de rede (nenhuma resposta) preserva a credencial', async () => {
    const { store, machine } = buildBootstrap(transportFailure as never)

    await machine.bootstrap()

    expect(store.peek()).toBe('refresh-guardado')
    expect(store.clear).not.toHaveBeenCalled()
    expect(machine.getState().error).toBe('network')
  })

  /*
    T3-T7: o servidor RESPONDEU, mas falou de si mesmo — não da credencial.
    Tabela em vez de cinco blocos: a propriedade é idêntica, e escrevê-la uma
    vez deixa claro que nenhum destes status é especial.
  */
  const transientStatuses = [
    { status: 500, rotulo: 'T3: erro interno' },
    { status: 502, rotulo: 'T4: gateway sem upstream' },
    { status: 503, rotulo: 'T5: indisponível' },
    { status: 504, rotulo: 'T6: timeout do gateway' },
    { status: 429, rotulo: 'T7: limite de taxa' },
  ]

  for (const { status, rotulo } of transientStatuses) {
    it(`${rotulo} (${status}) preserva a credencial`, async () => {
      const { store, machine } = buildBootstrap(httpStatus(status) as never)

      await machine.bootstrap()

      expect(store.peek()).toBe('refresh-guardado')
      expect(store.clear).not.toHaveBeenCalled()
      expect(machine.getState().error).toBe('serverUnavailable')
      // Nunca a copy de expiração: nada aqui diz que a sessão acabou.
      expect(machine.getState().error).not.toBe('sessionExpired')
    })
  }

  it('T8: refresh 400 (forma do DTO) preserva a credencial', async () => {
    const { store, machine } = buildBootstrap(httpStatus(400) as never)

    await machine.bootstrap()

    /*
      400 é gerado pelo `ValidationPipe` ANTES de o token ser verificado —
      ele não diz nada sobre a credencial. Se o app enviasse um corpo inválido
      por bug próprio, apagar a credencial converteria um defeito de cliente
      em logout em massa, escondendo a causa.
    */
    expect(store.peek()).toBe('refresh-guardado')
    expect(store.clear).not.toHaveBeenCalled()
    expect(machine.getState().error).not.toBe('sessionExpired')
  })
})

/* ════════════════ T9–T11: rota protegida ════════════════ */

describe('rota protegida: quando renovar e quando desistir', () => {
  it('T9: 401 → refresh bem-sucedido → repete a original UMA vez', async () => {
    const store = createStore()
    let protectedCalls = 0

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            accessToken: 'access-novo',
            refreshToken: 'refresh-novo',
          }),
        } as Response
      }
      protectedCalls += 1
      const auth = (init?.headers as Record<string, string>)?.Authorization
      return {
        ok: auth === 'Bearer access-novo',
        status: auth === 'Bearer access-novo' ? 200 : 401,
        json: async () => ({ ok: true }),
      } as Response
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-velho')

    await expect(api.authorized('/budget')).resolves.toEqual({ ok: true })
    expect(protectedCalls).toBe(2)
    expect(store.peek()).toBe('refresh-novo')
  })

  it('T10: 401 → refresh 502 preserva a credencial e não entra em laço', async () => {
    const store = createStore()
    const onSessionLost = vi.fn()
    let refreshCalls = 0
    let protectedCalls = 0

    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        refreshCalls += 1
        return { ok: false, status: 502, json: async () => ({}) } as Response
      }
      protectedCalls += 1
      return { ok: false, status: 401, json: async () => ({}) } as Response
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
      onSessionLost,
    })
    api.setAccessToken('access-velho')

    await expect(api.authorized('/budget')).rejects.toBeInstanceOf(HttpError)

    expect(store.peek()).toBe('refresh-guardado')
    expect(store.clear).not.toHaveBeenCalled()
    // A sessão não foi perdida — o servidor é que estava indisponível.
    expect(onSessionLost).not.toHaveBeenCalled()
    // Um ciclo, não uma cadeia.
    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(1)
  })

  it('T11: 500 na rota protegida NÃO dispara refresh', async () => {
    const store = createStore()
    let refreshCalls = 0

    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/mobile/refresh')) {
        refreshCalls += 1
        return {
          ok: true,
          status: 201,
          json: async () => ({ accessToken: 'a', refreshToken: 'r' }),
        } as Response
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    api.setAccessToken('access-valido')

    await expect(api.authorized('/budget')).rejects.toBeInstanceOf(HttpError)

    /*
      Renovar não conserta um 500: o token estava válido, o servidor é que
      falhou. Disparar refresh aqui gastaria uma rotação de credencial por
      causa de um erro que não tem relação com ela.
    */
    expect(refreshCalls).toBe(0)
    expect(store.peek()).toBe('refresh-guardado')
  })
})

/* ════════════════ T12–T13: o caso que o runtime encontrou ════════════════ */

describe('o cenário exato observado no emulador', () => {
  it('T12: bootstrap com refresh 502 mantém a credencial no armazenamento', async () => {
    const { store, machine } = buildBootstrap(httpStatus(502) as never)

    await machine.bootstrap()

    /*
      ESTE é o teste discriminante. Antes da correção o app apagava a
      credencial aqui e exibia "Sua sessão expirou" — perdendo a sessão por
      causa de um gateway sem upstream.
    */
    expect(store.peek()).toBe('refresh-guardado')
    expect(store.clear).not.toHaveBeenCalled()
    expect(machine.getState().error).toBe('serverUnavailable')
  })

  it('T12b: e a sessão se recupera sozinha quando o servidor volta', async () => {
    const store = createStore()
    let servidorNoAr = false

    const fetchFn = vi.fn(async (url: string) => {
      if (!servidorNoAr) {
        return { ok: false, status: 502, json: async () => ({}) } as Response
      }
      if (String(url).endsWith('/auth/mobile/refresh')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            accessToken: 'access-novo',
            refreshToken: 'refresh-novo',
          }),
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'u1', email: 'a@b.c', name: 'Davi' }),
      } as Response
    })

    const api = new ApiClient({
      baseUrl: 'https://api.test',
      store,
      fetchFn: fetchFn as never,
    })
    const machine = new SessionMachine({ api, store, emit: () => {} })

    await machine.bootstrap()
    expect(machine.getState().status).toBe('signedOut')
    expect(store.peek()).toBe('refresh-guardado')

    // O backend volta; nenhum login novo acontece no meio.
    servidorNoAr = true
    await machine.bootstrap()

    expect(machine.getState().status).toBe('signedIn')
    expect(store.peek()).toBe('refresh-novo')
  })

  it('T13: bootstrap com refresh 401 remove a credencial', async () => {
    const { store, machine } = buildBootstrap(httpStatus(401) as never)

    await machine.bootstrap()

    // O hardening não tornou credencial inválida imortal.
    expect(store.peek()).toBeNull()
    expect(machine.getState().error).toBe('sessionExpired')
  })
})

/* ════════════════ A authority, isolada ════════════════ */

describe('isDefinitiveRefreshRejection: a decisão é positiva', () => {
  it('só 401 é rejeição definitiva', () => {
    expect(isDefinitiveRefreshRejection(new HttpError(401))).toBe(true)

    for (const status of [400, 403, 404, 408, 429, 500, 502, 503, 504]) {
      expect(isDefinitiveRefreshRejection(new HttpError(status))).toBe(false)
    }
  })

  it('erro de transporte nunca é rejeição de credencial', () => {
    expect(isDefinitiveRefreshRejection(new TypeError('falhou'))).toBe(false)
    expect(isDefinitiveRefreshRejection(undefined)).toBe(false)
    expect(isDefinitiveRefreshRejection(null)).toBe(false)
  })

  it('403 NÃO apaga credencial — é autorização, não autenticação', () => {
    /*
      O backend não emite 403 nesta rota, e o significado é outro:
      "autenticado, porém sem permissão". Incluí-lo por precaução
      reintroduziria a destruição de credencial por um fato que não fala dela.
    */
    expect(isDefinitiveRefreshRejection(new HttpError(403))).toBe(false)
  })
})

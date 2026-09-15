import { describe, expect, it, vi } from 'vitest'
import { InvoicesSync } from './invoices-sync'
import { parseInvoicesSnapshot, buildInvoicesSignedOutSnapshot } from './invoices-snapshot'
import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'

/*
  ── O que este arquivo protege ──

  O backend (GET /invoices/actionable) já decidiu tudo que é domínio
  financeiro. O único jeito de o mobile quebrar essa garantia é REIMPLEMENTAR
  parte da regra por acidente — ordenar, filtrar, deduplicar, recalcular
  dinheiro. Cada teste de "preservação" aqui é, na prática, um teste negativo:
  provar que uma operação que SERIA fácil de acrescentar não está acontecendo.
*/

function createStore(invoices: string | null = null, privacy: string | null = null) {
  let invContents = invoices
  let privContents = privacy

  const store: SnapshotStore & {
    peekInvoices(): string | null
  } = {
    write: vi.fn(async () => {}),
    read: vi.fn(async () => null),
    writePrivacy: vi.fn(async (value: string) => {
      privContents = value
    }),
    readPrivacy: vi.fn(async () => privContents),
    writeInvoices: vi.fn(async (value: string) => {
      invContents = value
    }),
    readInvoices: vi.fn(async () => invContents),
    refreshWidget: vi.fn(async () => {}),
    location: vi.fn(async () => '/no_backup/cartero-widget/invoices-v1.json'),
    peekInvoices: () => invContents,
  }

  return store
}

function readyInvoices(
  ownerId: string,
  generatedAt: string,
  invoices: unknown[] = [],
) {
  return JSON.stringify({
    version: 1,
    state: 'ready',
    generatedAt,
    ownerId,
    privacy: { hideAmounts: true },
    invoices,
  })
}

function build(options: {
  store: ReturnType<typeof createStore>
  fetchActionableInvoices?: () => Promise<unknown>
  ownerId?: string | null
  now?: Date
}) {
  const now = options.now ?? new Date('2026-09-15T12:00:00.000Z')

  return new InvoicesSync({
    store: options.store,
    fetchActionableInvoices: options.fetchActionableInvoices ?? (async () => ({ items: [] })),
    currentOwnerId: () => (options.ownerId === undefined ? 'user-a' : options.ownerId),
    now: () => now,
  })
}

const ITEM_A = { bankName: 'Banco A', status: 'OVERDUE', actionDate: '2026-08-10', ownAmountCents: 5000 }
const ITEM_B = { bankName: 'Banco B', status: 'CLOSED', actionDate: '2026-09-10', ownAmountCents: 3000 }
const ITEM_C = { bankName: 'Banco C', status: 'OPEN', actionDate: '2026-09-27', ownAmountCents: 1000 }

describe('§12: ordem preservada exatamente como o backend devolveu', () => {
  it('B, A, C na entrada → B, A, C no snapshot', async () => {
    const store = createStore()
    await build({
      store,
      fetchActionableInvoices: async () => ({ items: [ITEM_B, ITEM_A, ITEM_C] }),
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed?.state).toBe('ready')
    if (parsed?.state !== 'ready') throw new Error('esperado ready')

    expect(parsed.invoices.map((i) => i.bankName)).toEqual(['Banco B', 'Banco A', 'Banco C'])
  })

  it('não ordena alfabeticamente nem por status — mutação .sort() mataria este teste', async () => {
    const store = createStore()
    // Ordem deliberadamente "errada" se alguém alfabetizasse ou reordenasse
    // por urgência: C (OPEN) antes de A (OVERDUE).
    await build({
      store,
      fetchActionableInvoices: async () => ({ items: [ITEM_C, ITEM_A, ITEM_B] }),
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.invoices.map((i) => i.bankName)).toEqual(['Banco C', 'Banco A', 'Banco B'])
  })
})

describe('§13: sem reseleção/dedupe — mesmo bankName duplicado é preservado', () => {
  it('duas entradas com o mesmo bankName permanecem duas', async () => {
    const store = createStore()
    const duplicado = { ...ITEM_A, bankName: 'Banco X' }
    const outro = { ...ITEM_B, bankName: 'Banco X' }

    await build({
      store,
      fetchActionableInvoices: async () => ({ items: [duplicado, outro] }),
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.invoices).toHaveLength(2)
    expect(parsed.invoices.map((i) => i.bankName)).toEqual(['Banco X', 'Banco X'])
  })
})

describe('minimal surface — closeDate/dueDate nunca entram', () => {
  it('resposta com closeDate/dueDate extras não os propaga ao snapshot', async () => {
    const store = createStore()
    const itemComExtras = {
      ...ITEM_A,
      closeDate: '2026-08-03',
      dueDate: '2026-08-10',
      bankId: 'internal',
      invoiceId: 'internal-2',
    }

    await build({
      store,
      fetchActionableInvoices: async () => ({ items: [itemComExtras] }),
    }).sync()

    /*
      Verificação do JSON BRUTO gravado, não via parseInvoicesSnapshot: o
      parser filtra campos por construção, então uma mutação em `readInvoices`
      que gravasse o item cru (com closeDate/dueDate/bankId/invoiceId) passaria
      despercebida se a checagem só olhasse o resultado já filtrado do parse.
    */
    const rawWritten = JSON.parse(store.peekInvoices()!)
    expect(Object.keys(rawWritten.invoices[0]).sort()).toEqual(
      ['actionDate', 'bankName', 'ownAmountCents', 'status'].sort(),
    )
    expect(rawWritten.invoices[0]).not.toHaveProperty('closeDate')
    expect(rawWritten.invoices[0]).not.toHaveProperty('dueDate')
    expect(rawWritten.invoices[0]).not.toHaveProperty('bankId')
    expect(rawWritten.invoices[0]).not.toHaveProperty('invoiceId')

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(Object.keys(parsed.invoices[0]).sort()).toEqual(
      ['actionDate', 'bankName', 'ownAmountCents', 'status'].sort(),
    )
  })
})

describe('money — sem reconversão', () => {
  it('ownAmountCents chega e sai idêntico', async () => {
    const store = createStore()
    await build({
      store,
      fetchActionableInvoices: async () => ({ items: [{ ...ITEM_A, ownAmountCents: 12345 }] }),
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.invoices[0].ownAmountCents).toBe(12345)
  })

  it('ownAmountCents não-inteiro (12.34) é resposta malformada — last-good preservado', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))

    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({ items: [{ ...ITEM_B, ownAmountCents: 12.34 }] }),
    }).sync()

    expect(outcome).toEqual({ status: 'preserved', reason: 'malformedResponse' })
    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.invoices).toEqual([ITEM_A])
  })

  it('NaN em ownAmountCents é malformado', async () => {
    const store = createStore()
    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({
        items: [{ ...ITEM_A, ownAmountCents: NaN }],
      }),
    }).sync()
    expect(outcome.status).toBe('preserved')
  })

  it('string em ownAmountCents é malformado', async () => {
    const store = createStore()
    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({
        items: [{ ...ITEM_A, ownAmountCents: '5000' }],
      }),
    }).sync()
    expect(outcome.status).toBe('preserved')
  })
})

describe('civil date — sem reserialização', () => {
  it('actionDate chega e sai idêntico, independente do timezone do host', async () => {
    const original = process.env.TZ
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14, extremo oposto de Fortaleza
    try {
      const store = createStore()
      await build({
        store,
        fetchActionableInvoices: async () => ({ items: [ITEM_A] }),
      }).sync()

      const parsed = parseInvoicesSnapshot(store.peekInvoices())
      if (parsed?.state !== 'ready') throw new Error('esperado ready')
      expect(parsed.invoices[0].actionDate).toBe('2026-08-10')
    } finally {
      process.env.TZ = original
    }
  })
})

describe('status — só os 3 válidos; PAID é malformado', () => {
  it('PAID no actionable é resposta inesperada, não filtrada silenciosamente', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))

    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({
        items: [{ ...ITEM_B, status: 'PAID' }],
      }),
    }).sync()

    expect(outcome).toEqual({ status: 'preserved', reason: 'malformedResponse' })
  })

  it('status desconhecido é malformado', async () => {
    const store = createStore()
    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({
        items: [{ ...ITEM_A, status: 'INEXISTENTE' }],
      }),
    }).sync()
    expect(outcome.status).toBe('preserved')
  })
})

describe('last-good (§37)', () => {
  const READY_ANTIGO = readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A])

  it('502/erro de rede preserva o READY anterior', async () => {
    const store = createStore(READY_ANTIGO)
    const outcome = await build({
      store,
      fetchActionableInvoices: async () => {
        throw new Error('502')
      },
    }).sync()

    expect(outcome).toEqual({ status: 'preserved', reason: 'requestFailed' })
    expect(store.peekInvoices()).toBe(READY_ANTIGO)
  })

  it('items não é array é malformado, preserva last-good', async () => {
    const store = createStore(READY_ANTIGO)
    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({ items: 'não é lista' }),
    }).sync()

    expect(outcome).toEqual({ status: 'preserved', reason: 'malformedResponse' })
    expect(store.peekInvoices()).toBe(READY_ANTIGO)
  })

  it('payload não é objeto preserva last-good', async () => {
    const store = createStore(READY_ANTIGO)
    const outcome = await build({
      store,
      fetchActionableInvoices: async () => null,
    }).sync()

    expect(outcome).toEqual({ status: 'preserved', reason: 'malformedResponse' })
    expect(store.peekInvoices()).toBe(READY_ANTIGO)
  })
})

describe('§25: 200 com items=[] é sucesso válido', () => {
  it('escreve READY com invoices vazio e generatedAt novo', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))

    const outcome = await build({
      store,
      fetchActionableInvoices: async () => ({ items: [] }),
      now: new Date('2026-09-15T12:00:00.000Z'),
    }).sync()

    expect(outcome).toEqual({ status: 'written' })
    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed).toMatchObject({
      state: 'ready',
      generatedAt: '2026-09-15T12:00:00.000Z',
      invoices: [],
    })
  })
})

describe('account switch (§39, §40)', () => {
  it('snapshot de A é neutralizado ANTES do fetch de B', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))
    const order: string[] = []

    store.writeInvoices = vi.fn(async (value: string) => {
      order.push('write')
    })

    await build({
      store,
      ownerId: 'user-b',
      fetchActionableInvoices: async () => {
        order.push('fetch')
        return { items: [ITEM_B] }
      },
    }).sync()

    expect(order).toEqual(['write', 'fetch', 'write'])
  })

  it('se o fetch de B falhar, A não reaparece', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))

    await build({
      store,
      ownerId: 'user-b',
      fetchActionableInvoices: async () => {
        throw new Error('network')
      },
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed?.state).toBe('signedOut')
  })

  it('fetch de B com sucesso grava owner B', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))

    await build({
      store,
      ownerId: 'user-b',
      fetchActionableInvoices: async () => ({ items: [ITEM_B] }),
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.ownerId).toBe('user-b')
  })
})

describe('logout race (§42, owner recheck dentro do lock)', () => {
  it('resposta de A que chega DEPOIS do logout não recria READY', async () => {
    const store = createStore()
    let resolveFetch: (value: unknown) => void
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve
    })

    let currentOwner: string | null = 'user-a'
    const sync = new InvoicesSync({
      store,
      fetchActionableInvoices: () => pendingFetch,
      currentOwnerId: () => currentOwner,
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    const syncPromise = sync.sync()

    // Logout ocorre ENQUANTO o fetch está em voo.
    currentOwner = null
    await sync.scrub()

    // A resposta tardia finalmente chega.
    resolveFetch!({ items: [ITEM_A] })
    await syncPromise

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed?.state).toBe('signedOut')
  })

  it('resposta de A que chega depois de B ter ficado ativo é descartada (§36)', async () => {
    const store = createStore()
    let resolveFetch: (value: unknown) => void
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve
    })

    let currentOwner = 'user-a'
    const sync = new InvoicesSync({
      store,
      fetchActionableInvoices: () => pendingFetch,
      currentOwnerId: () => currentOwner,
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    const syncPromise = sync.sync()

    // B assume ANTES da resposta de A chegar — sem outro sync.sync(), só a
    // sessão muda de dono no meio da requisição em voo.
    currentOwner = 'user-b'

    resolveFetch!({ items: [ITEM_A] })
    const outcome = await syncPromise

    expect(outcome).toEqual({ status: 'preserved', reason: 'requestFailed' })
    // Nada de A foi escrito como se fosse de B.
    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed).toBeNull()
  })
})

describe('coalescing (single-flight)', () => {
  it('duas chamadas simultâneas fazem UMA única requisição', async () => {
    const store = createStore()
    let calls = 0
    const sync = build({
      store,
      fetchActionableInvoices: async () => {
        calls += 1
        return { items: [ITEM_A] }
      },
    })

    await Promise.all([sync.sync(), sync.sync(), sync.sync()])
    expect(calls).toBe(1)
  })

  it('depois de completar, uma nova chamada dispara nova requisição', async () => {
    const store = createStore()
    let calls = 0
    const sync = build({
      store,
      fetchActionableInvoices: async () => {
        calls += 1
        return { items: [ITEM_A] }
      },
    })

    await sync.sync()
    await sync.sync()
    expect(calls).toBe(2)
  })

  it('falha não deixa o single-flight preso', async () => {
    const store = createStore()
    let calls = 0
    const sync = build({
      store,
      fetchActionableInvoices: async () => {
        calls += 1
        throw new Error('falha')
      },
    })

    await sync.sync()
    await sync.sync()
    expect(calls).toBe(2)
  })
})

describe('sem sessão / sem store', () => {
  it('sem ownerId não faz fetch', async () => {
    const store = createStore()
    let called = false
    await build({
      store,
      ownerId: null,
      fetchActionableInvoices: async () => {
        called = true
        return { items: [] }
      },
    }).sync()

    expect(called).toBe(false)
  })

  it('store null é skipped', async () => {
    const sync = new InvoicesSync({
      store: null,
      fetchActionableInvoices: async () => ({ items: [] }),
      currentOwnerId: () => 'user-a',
    })
    expect(await sync.sync()).toEqual({ status: 'skipped', reason: 'noStore' })
  })
})

describe('privacy — lida DEPOIS do fetch, nunca antes (mesma race do M4/Budget)', () => {
  it('hideAmounts alterado DURANTE o fetch em voo é o que vale na escrita', async () => {
    /*
      Cenário: o sync começa com hideAmounts=false. Enquanto o fetch de
      /invoices/actionable está em voo, o usuário troca a preferência para
      true (via toggle, que grava direto no privacy-store). Se o sync
      capturasse hideAmounts ANTES do fetch (early), a escrita gravaria
      "false" — o ajuste ligado, mas o widget mascarado incorretamente.
      Lendo DEPOIS do fetch, dentro do que seria o lock, o sync vê o valor
      mais recente.
    */
    const store = createStore()
    let currentPreference = false
    let fetchStarted = false

    let resolveFetch: (value: unknown) => void
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve
    })

    const sync = new InvoicesSync({
      store,
      fetchActionableInvoices: () => {
        // Só aqui — genuinamente dentro da chamada de rede — sabemos que
        // qualquer leitura de hideAmounts anterior a este ponto já
        // aconteceu. Mudar a preferência SÓ agora prova a race de verdade,
        // em vez de mudar antes de o event loop ceder controle nenhum.
        fetchStarted = true
        return pendingFetch
      },
      currentOwnerId: () => 'user-a',
      hideAmounts: async () => currentPreference,
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    const syncPromise = sync.sync()

    // Espera até o fetch genuinamente começar (o sync já passou por
    // qualquer leitura de hideAmounts que aconteça ANTES da chamada de
    // rede) antes de mudar a preferência.
    await vi.waitFor(() => {
      if (!fetchStarted) throw new Error('fetch ainda não começou')
    })

    // A preferência muda ENQUANTO o fetch ainda está pendente.
    currentPreference = true

    resolveFetch!({ items: [] })
    await syncPromise

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.privacy.hideAmounts).toBe(true)
  })
})

describe('generatedAt independente do Budget', () => {
  it('sync bem-sucedido avança generatedAt', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', []))

    await build({
      store,
      fetchActionableInvoices: async () => ({ items: [ITEM_A] }),
      now: new Date('2026-09-15T12:00:00.000Z'),
    }).sync()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed?.generatedAt).toBe('2026-09-15T12:00:00.000Z')
  })
})

describe('scrub / logout', () => {
  it('scrub() escreve signedOut', async () => {
    const store = createStore(readyInvoices('user-a', '2026-09-01T00:00:00.000Z', [ITEM_A]))
    const sync = build({ store })
    await sync.scrub()

    const parsed = parseInvoicesSnapshot(store.peekInvoices())
    expect(parsed?.state).toBe('signedOut')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { SnapshotSync } from './snapshot-sync'
import { parseSnapshot, buildSignedOutSnapshot } from './snapshot'
import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'

/*
  ── O que este arquivo protege ──

  O snapshot é lido por um processo que não tem sessão e não chama a API: se o
  arquivo estiver errado, o widget mostra o número errado e ninguém percebe.
  Três propriedades quebram em silêncio:

  1. Falha transitória não pode apagar o que já era bom. Um 502 durante um
     deploy substituiria o saldo por zero — e zero é uma AFIRMAÇÃO financeira,
     não a ausência de uma.

  2. Uma troca de conta não pode deixar os números de A visíveis para B, nem
     por um instante nem para sempre.

  3. Login, restauração e foreground disparam quase juntos. Sem coalescência,
     três escritas disputam o arquivo e vence a que terminar por último.
*/

/** Dublê do armazenamento nativo, com escrita de fato observável. */
function createStore(initial: string | null = null, privacy: string | null = null) {
  let contents = initial
  let privacyContents = privacy
  let invoicesContents: string | null = null

  const store: SnapshotStore & {
    peek(): string | null
    peekPrivacy(): string | null
    corrupt(): void
  } = {
    write: vi.fn(async (value: string) => {
      contents = value
    }),
    read: vi.fn(async () => contents),
    writePrivacy: vi.fn(async (value: string) => {
      privacyContents = value
    }),
    readPrivacy: vi.fn(async () => privacyContents),
    writeInvoices: vi.fn(async (value: string) => {
      invoicesContents = value
    }),
    readInvoices: vi.fn(async () => invoicesContents),
    refreshWidget: vi.fn(async () => {}),
    location: vi.fn(async () => '/no_backup/cartero-widget/snapshot-v1.json'),
    peek: () => contents,
    peekPrivacy: () => privacyContents,
    corrupt: () => {
      contents = '{"version":1,"state":"rea'
    },
  }

  return store
}

const BUDGET_OK = { totalToPay: 757.24, totalPaid: 446.24, totalPending: 311 }

const readySnapshot = (ownerId: string, generatedAt: string) =>
  JSON.stringify({
    version: 1,
    state: 'ready',
    generatedAt,
    ownerId,
    privacy: { hideAmounts: true },
    budget: {
      month: 9,
      year: 2026,
      currency: 'BRL',
      totalToPayCents: 75724,
      totalPaidCents: 44624,
      totalPendingCents: 31100,
    },
  })

function build(options: {
  store: ReturnType<typeof createStore>
  fetchBudget?: SnapshotSync['deps']['fetchBudget']
  ownerId?: string | null
  now?: Date
  /** TZ4: `undefined` omite a dependência inteira (legado, sem sessão de timezone). */
  timeZone?: string | null
}) {
  const now = options.now ?? new Date('2026-09-14T12:00:00.000Z')

  return new SnapshotSync({
    store: options.store,
    fetchBudget: options.fetchBudget ?? (async () => BUDGET_OK),
    currentOwnerId: () =>
      options.ownerId === undefined ? 'user-a' : options.ownerId,
    currentTimeZone: () =>
      options.timeZone === undefined ? 'America/Fortaleza' : options.timeZone,
    now: () => now,
  })
}

/* ═══════════════ S18–S22: armazenamento ═══════════════ */

describe('armazenamento do snapshot', () => {
  it('S18: escreve e relê o mesmo conteúdo', async () => {
    const store = createStore()
    await build({ store }).sync()

    const parsed = parseSnapshot(store.peek())
    expect(parsed).toMatchObject({
      state: 'ready',
      ownerId: 'user-a',
      budget: { totalToPayCents: 75724, totalPaidCents: 44624 },
    })
  })

  it('S19: a segunda escrita substitui a primeira integralmente', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))

    await build({
      store,
      fetchBudget: async () => ({
        totalToPay: 10,
        totalPaid: 4,
        totalPending: 6,
      }),
    }).sync()

    const parsed = parseSnapshot(store.peek())!
    expect(parsed).toMatchObject({
      state: 'ready',
      generatedAt: '2026-09-14T12:00:00.000Z',
    })
    // Nenhum resíduo do conteúdo anterior.
    expect(store.peek()).not.toContain('75724')
  })

  it('S20: falha na nova escrita preserva o snapshot anterior', async () => {
    const anterior = readySnapshot('user-a', '2026-09-01T00:00:00.000Z')
    const store = createStore(anterior)

    /*
      Simula o que a escrita atômica garante no Android: se a gravação não
      completa, o arquivo continua sendo o último conteúdo íntegro — nunca um
      JSON pela metade.
    */
    store.write = vi.fn(async () => {
      throw new Error('disco indisponível')
    })

    await expect(build({ store }).sync()).rejects.toThrowError()
    expect(store.peek()).toBe(anterior)
    expect(parseSnapshot(store.peek())).toMatchObject({ state: 'ready' })
  })

  it('S21: o scrub deixa apenas o estado neutro', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))

    await build({ store }).scrub()

    const texto = store.peek()!
    expect(parseSnapshot(texto)).toMatchObject({ state: 'signedOut' })
    expect(texto).not.toContain('user-a')
    expect(texto).not.toContain('75724')
    expect(texto).not.toContain('budget')
    expect(texto).not.toContain('privacy')
  })

  it('S22: arquivo corrompido não impede a próxima escrita', async () => {
    const store = createStore()
    store.corrupt()

    await build({ store }).sync()

    expect(parseSnapshot(store.peek())).toMatchObject({ state: 'ready' })
  })
})

/* ═══════════════ S23–S31: sincronização ═══════════════ */

describe('sincronização', () => {
  it('S23/S24: com sessão ativa, busca a competência corrente', async () => {
    const store = createStore()
    const fetchBudget = vi.fn(async () => BUDGET_OK)

    await build({ store, fetchBudget }).sync()

    expect(fetchBudget).toHaveBeenCalledTimes(1)
    expect(fetchBudget).toHaveBeenCalledWith({ month: 9, year: 2026 })
    expect(parseSnapshot(store.peek())).toMatchObject({ state: 'ready' })
  })

  it('B1/B2: timezone da conta controla a MESMA competência de request e snapshot', async () => {
    /*
      16/09/2026 21:30 UTC: em Tóquio (UTC+9) já é dia 17 de setembro — mesmo
      mês, mas o boundary de DIA prova que a timezone da conta, não a de
      Fortaleza nem a do device, decide a competência aqui.

      O ponto central de B2 é a AUSÊNCIA de divergência: a mesma leitura
      resolve tanto o `fetchBudget` quanto o `snapshot.budget.month/year`.
    */
    const store = createStore()
    const fetchBudget = vi.fn(async () => BUDGET_OK)
    const now = new Date('2026-09-30T23:30:00.000Z') // boundary de MÊS

    await build({
      store,
      fetchBudget,
      timeZone: 'Asia/Tokyo',
      now,
    }).sync()

    // Fortaleza (legado) ainda estaria em setembro; Tóquio já em outubro.
    expect(fetchBudget).toHaveBeenCalledWith({ month: 10, year: 2026 })
    expect(parseSnapshot(store.peek())).toMatchObject({
      state: 'ready',
      budget: { month: 10, year: 2026 },
    })
  })

  it('B3: conta legada (timeZone ausente) preserva a competência histórica Fortaleza', async () => {
    const store = createStore()
    const fetchBudget = vi.fn(async () => BUDGET_OK)
    // 30/09 23h30 UTC = 20h30 em Fortaleza — ainda setembro lá.
    const now = new Date('2026-09-30T23:30:00.000Z')

    await build({ store, fetchBudget, now }).sync()

    expect(fetchBudget).toHaveBeenCalledWith({ month: 9, year: 2026 })
    expect(parseSnapshot(store.peek())).toMatchObject({
      budget: { month: 9, year: 2026 },
    })
  })

  it('B4: Tóquio no boundary produz competência diferente da legada, quando devido', async () => {
    const semTZ = createStore()
    const comTZ = createStore()
    const now = new Date('2026-09-30T23:30:00.000Z')

    await build({ store: semTZ, now }).sync()
    await build({ store: comTZ, timeZone: 'Asia/Tokyo', now }).sync()

    const legado = parseSnapshot(semTZ.peek())
    const tokyo = parseSnapshot(comTZ.peek())
    expect(legado?.state === 'ready' && legado.budget.month).toBe(9)
    expect(tokyo?.state === 'ready' && tokyo.budget.month).toBe(10)
  })

  it('B5: troca de dono não reaproveita a timezone da sessão anterior', async () => {
    /*
      `currentTimeZone` é lida a cada `sync()`, nunca capturada — o mesmo
      dublê já prova isso ao trocar o valor devolvido entre duas chamadas
      sobre o MESMO SnapshotSync.
    */
    const store = createStore()
    let timeZone: string | null = 'Asia/Tokyo'
    let ownerId: string | null = 'user-a'
    const now = new Date('2026-09-30T23:30:00.000Z')

    const sync = new SnapshotSync({
      store,
      fetchBudget: async () => BUDGET_OK,
      currentOwnerId: () => ownerId,
      currentTimeZone: () => timeZone,
      now: () => now,
    })

    await sync.sync()
    expect(parseSnapshot(store.peek())).toMatchObject({
      ownerId: 'user-a',
      budget: { month: 10 },
    })

    // Troca de conta: novo dono, sem timezone configurada.
    ownerId = 'user-b'
    timeZone = 'America/Fortaleza'
    await sync.sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      ownerId: 'user-b',
      budget: { month: 9 },
    })
  })

  it('B6: currentTimeZone ausente não inventa fallback além do legado', async () => {
    /*
      `currentTimeZone` opcional na dependência é o caminho de compatibilidade
      dos dublês existentes (pré-TZ4) — ausência deve produzir EXATAMENTE o
      resultado de `timeZone: null`, nunca UTC/device.
    */
    const comDep = createStore()
    const semDep = createStore()
    const now = new Date('2026-09-30T23:30:00.000Z')

    await expect(build({ store: comDep, timeZone: null, now }).sync()).rejects.toThrow(
      /Missing account timezone/,
    )
    await expect(new SnapshotSync({
      store: semDep,
      fetchBudget: async () => BUDGET_OK,
      currentOwnerId: () => 'user-a',
      now: () => now,
    }).sync()).rejects.toThrow(/Missing account timezone/)
  })

  it('S26: sem sessão, nenhuma requisição é feita', async () => {
    const store = createStore()
    const fetchBudget = vi.fn(async () => BUDGET_OK)

    const outcome = await build({ store, fetchBudget, ownerId: null }).sync()

    expect(fetchBudget).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'skipped', reason: 'noSession' })
  })

  it('S27: três disparos simultâneos produzem UMA requisição', async () => {
    const store = createStore()
    let chamadas = 0

    const fetchBudget = vi.fn(async () => {
      chamadas += 1
      // Latência real: sem ela cada chamada resolveria antes da próxima
      // começar, e a concorrência não seria exercitada.
      await new Promise((resolve) => setTimeout(resolve, 10))
      return BUDGET_OK
    })

    const sync = build({ store, fetchBudget })
    await Promise.all([sync.sync(), sync.sync(), sync.sync()])

    expect(chamadas).toBe(1)
    expect(store.write).toHaveBeenCalledTimes(1)
  })

  it('S27b: depois de concluir, um novo evento sincroniza normalmente', async () => {
    const store = createStore()
    const fetchBudget = vi.fn(async () => BUDGET_OK)
    const sync = build({ store, fetchBudget })

    await sync.sync()
    await sync.sync()

    // A coalescência é do voo em andamento, não um bloqueio permanente.
    expect(fetchBudget).toHaveBeenCalledTimes(2)
  })

  const transientes = [
    { rotulo: 'S28: 502', erro: new Error('http_502') },
    { rotulo: 'S29: falha de rede', erro: new TypeError('Network request failed') },
    { rotulo: '503', erro: new Error('http_503') },
    { rotulo: '429', erro: new Error('http_429') },
  ]

  for (const { rotulo, erro } of transientes) {
    it(`${rotulo} preserva o último snapshot bom`, async () => {
      const anterior = readySnapshot('user-a', '2026-09-01T00:00:00.000Z')
      const store = createStore(anterior)

      const outcome = await build({
        store,
        fetchBudget: async () => {
          throw erro
        },
      }).sync()

      expect(outcome).toEqual({ status: 'preserved', reason: 'requestFailed' })
      // O conteúdo antigo continua intacto, com seu generatedAt antigo — é o
      // que permite a um widget futuro dizer "atualizado há 2 h".
      expect(store.peek()).toBe(anterior)
      expect(store.write).not.toHaveBeenCalled()
    })
  }

  it('S30: resposta 2xx malformada não vira snapshot', async () => {
    const anterior = readySnapshot('user-a', '2026-09-01T00:00:00.000Z')
    const store = createStore(anterior)

    /*
      Campo ausente NÃO pode virar zero. Zero afirma "você não deve nada" — um
      fato financeiro falso é pior que um dado velho, porque o usuário
      acreditaria estar em dia.
    */
    const outcome = await build({
      store,
      fetchBudget: async () => ({ totalToPay: 757.24 }),
    }).sync()

    expect(outcome).toEqual({
      status: 'preserved',
      reason: 'malformedResponse',
    })
    expect(store.peek()).toBe(anterior)
  })

  it('S30b: valores não-finitos também preservam o anterior', async () => {
    const anterior = readySnapshot('user-a', '2026-09-01T00:00:00.000Z')
    const store = createStore(anterior)

    for (const ruim of [NaN, Infinity, null, '757.24']) {
      await build({
        store,
        fetchBudget: async () => ({
          totalToPay: ruim,
          totalPaid: 0,
          totalPending: 0,
        }),
      }).sync()
    }

    expect(store.peek()).toBe(anterior)
  })

  it('S31: um sucesso posterior atualiza o snapshot', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))
    let noAr = false

    const sync = build({
      store,
      fetchBudget: async () => {
        if (!noAr) throw new Error('http_502')
        return { totalToPay: 100, totalPaid: 40, totalPending: 60 }
      },
    })

    await sync.sync()
    expect(store.peek()).toContain('75724')

    noAr = true
    await sync.sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      budget: { totalToPayCents: 10000, totalPaidCents: 4000 },
      generatedAt: '2026-09-14T12:00:00.000Z',
    })
  })

  it('sem armazenamento nativo, o sync não quebra', async () => {
    /*
      iOS ainda não tem implementação, e o bundle não pode falhar por isso.
      A ausência é um estado previsto.
    */
    const sync = new SnapshotSync({
      store: null,
      fetchBudget: async () => BUDGET_OK,
      currentOwnerId: () => 'user-a',
    })

    await expect(sync.sync()).resolves.toEqual({
      status: 'skipped',
      reason: 'noStore',
    })
    await expect(sync.scrub()).resolves.toBeUndefined()
  })
})

/* ═══════════════ S32–S35: isolamento entre contas ═══════════════ */

describe('troca de conta', () => {
  it('S32: o snapshot de A é neutralizado ANTES do fetch de B', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))
    const ordem: string[] = []

    store.write = vi.fn(async (value: string) => {
      ordem.push(value.includes('signedOut') ? 'scrub' : 'write-b')
    })

    await build({
      store,
      ownerId: 'user-b',
      fetchBudget: async () => {
        ordem.push('fetch-b')
        return BUDGET_OK
      },
    }).sync()

    /*
      A ordem é a propriedade. Buscar primeiro deixaria os valores de A
      visíveis durante a requisição de B — e, se ela falhasse, para sempre.
    */
    expect(ordem).toEqual(['scrub', 'fetch-b', 'write-b'])
  })

  it('S33: se o fetch de B falha, A NÃO reaparece', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))

    await build({
      store,
      ownerId: 'user-b',
      fetchBudget: async () => {
        throw new Error('http_502')
      },
    }).sync()

    const texto = store.peek()!
    expect(parseSnapshot(texto)).toMatchObject({ state: 'signedOut' })
    expect(texto).not.toContain('user-a')
    expect(texto).not.toContain('75724')
  })

  it('S34: fetch de B bem-sucedido grava o dono B', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))

    await build({ store, ownerId: 'user-b' }).sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      state: 'ready',
      ownerId: 'user-b',
    })
    expect(store.peek()).not.toContain('user-a')
  })

  it('S35: logout de B não deixa dado de B', async () => {
    const store = createStore(readySnapshot('user-b', '2026-09-14T12:00:00.000Z'))

    await build({ store, ownerId: 'user-b' }).scrub()

    const texto = store.peek()!
    expect(parseSnapshot(texto)).toMatchObject({ state: 'signedOut' })
    expect(texto).not.toContain('user-b')
    expect(texto).not.toContain('Cents')
  })

  it('o mesmo dono não sofre scrub desnecessário', async () => {
    const store = createStore(readySnapshot('user-a', '2026-09-01T00:00:00.000Z'))
    const escritas: string[] = []

    store.write = vi.fn(async (value: string) => {
      escritas.push(value.includes('signedOut') ? 'scrub' : 'ready')
    })

    await build({ store, ownerId: 'user-a' }).sync()

    // Uma única escrita: neutralizar o próprio snapshot criaria um piscar
    // desnecessário no widget a cada sincronização.
    expect(escritas).toEqual(['ready'])
  })
})

/* ═══════════════ superfície gravada ═══════════════ */

describe('o que é gravado no disco', () => {
  it('nenhum campo além do contrato chega ao arquivo', async () => {
    const store = createStore()

    /*
      A resposta real de `GET /budget` traz 26 chaves — salário, faturas,
      dívidas, acertos por pessoa. Só três podem atravessar.
    */
    await build({
      store,
      fetchBudget: async () => ({
        ...BUDGET_OK,
        salary: 5000,
        salaryKnown: true,
        invoices: [{ id: 'inv-1', bank: { name: 'Banco X' } }],
        peopleSettlements: [{ personName: 'Eva', netBalance: 300 }],
        debtBreakdown: [{ title: 'Empréstimo' }],
      }),
    }).sync()

    const texto = store.peek()!
    for (const vazamento of [
      'salary',
      'invoices',
      'Banco X',
      'Eva',
      'peopleSettlements',
      'Empréstimo',
      'debtBreakdown',
    ]) {
      expect(texto, `vazou: ${vazamento}`).not.toContain(vazamento)
    }
  })

  it('o snapshot neutro é o mesmo em qualquer origem', async () => {
    const agora = new Date('2026-09-14T12:00:00.000Z')

    expect(buildSignedOutSnapshot(agora)).toEqual({
      version: 1,
      state: 'signedOut',
      generatedAt: '2026-09-14T12:00:00.000Z',
    })
  })
})

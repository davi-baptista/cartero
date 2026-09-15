import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HIDE_AMOUNTS,
  hideAmountsFor,
  parsePrivacyStore,
  withHideAmounts,
} from './privacy-store'
import { WidgetPrivacyService } from './privacy-service'
import { SnapshotMutationCoordinator } from './snapshot-mutations'
import { SnapshotSync } from './snapshot-sync'
import { parseSnapshot } from './snapshot'
import { parseInvoicesSnapshot } from './invoices-snapshot'
import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'

/*
  ── O que este arquivo protege ──

  "Mostrar valores nos widgets" é uma decisão sobre dinheiro exposto na tela
  inicial. Três propriedades falham em silêncio, e cada uma vaza de um jeito
  diferente:

  1. O padrão precisa ser OCULTAR — em toda dúvida. Arquivo ausente,
     corrompido, versão futura, conta sem escolha: revelar por engano expõe
     saldo para quem passa ao lado; ocultar por engano custa um toque.

  2. A escolha é POR CONTA. Global, a conta B nasceria revelando saldos porque
     A optou por isso, e B nunca escolheu nada.

  3. `generatedAt` NÃO muda num toggle. Ele responde "quão frescos são os
     números", não "quando o arquivo foi escrito" — atualizá-lo faria o rótulo
     de idade do M3 mentir.
*/

const OWNER_A = 'user-a'
const OWNER_B = 'user-b'

const readyFor = (
  ownerId: string,
  hideAmounts: boolean,
  generatedAt = '2026-09-14T09:00:00.000Z',
) =>
  JSON.stringify({
    version: 1,
    state: 'ready',
    generatedAt,
    ownerId,
    privacy: { hideAmounts },
    budget: {
      month: 9,
      year: 2026,
      currency: 'BRL',
      totalToPayCents: 75724,
      totalPaidCents: 44624,
      totalPendingCents: 31100,
    },
  })

function createStore(
  snapshot: string | null = null,
  privacy: string | null = null,
  invoices: string | null = null,
) {
  let snap = snapshot
  let pref = privacy
  let inv = invoices

  const store: SnapshotStore & {
    peek(): string | null
    peekPrivacy(): string | null
    peekInvoices(): string | null
  } = {
    write: vi.fn(async (value: string) => {
      snap = value
    }),
    read: vi.fn(async () => snap),
    writePrivacy: vi.fn(async (value: string) => {
      pref = value
    }),
    readPrivacy: vi.fn(async () => pref),
    writeInvoices: vi.fn(async (value: string) => {
      inv = value
    }),
    readInvoices: vi.fn(async () => inv),
    refreshWidget: vi.fn(async () => {}),
    location: vi.fn(async () => '/no_backup/cartero-widget/snapshot-v1.json'),
    peek: () => snap,
    peekPrivacy: () => pref,
    peekInvoices: () => inv,
  }

  return store
}

const buildService = (
  store: ReturnType<typeof createStore>,
  ownerId: string | null = OWNER_A,
  coordinator = new SnapshotMutationCoordinator(),
) =>
  new WidgetPrivacyService({
    store,
    coordinator,
    currentOwnerId: () => ownerId,
  })

/* ═══════════════ R1–R9: o padrão e o parser ═══════════════ */

describe('a preferência, lida do disco', () => {
  it('R1: sem arquivo, oculto', () => {
    const store = parsePrivacyStore(null)

    expect(hideAmountsFor(store, OWNER_A)).toBe(true)
    expect(DEFAULT_HIDE_AMOUNTS).toBe(true)
  })

  it('R2: conta sem entrada, oculto', () => {
    const store = parsePrivacyStore(
      JSON.stringify({ version: 1, entries: [{ ownerId: OWNER_B, hideAmounts: false }] }),
    )

    expect(hideAmountsFor(store, OWNER_A)).toBe(true)
  })

  it('R3: a escolha da conta é respeitada', () => {
    const store = parsePrivacyStore(
      JSON.stringify({ version: 1, entries: [{ ownerId: OWNER_A, hideAmounts: false }] }),
    )

    expect(hideAmountsFor(store, OWNER_A)).toBe(false)
  })

  it('R4/R5: cada conta recebe a SUA escolha', () => {
    /*
      A propriedade que impede o vazamento entre pessoas do mesmo aparelho:
      B não herda o opt-in de A.
    */
    const store = parsePrivacyStore(
      JSON.stringify({
        version: 1,
        entries: [{ ownerId: OWNER_A, hideAmounts: false }],
      }),
    )

    expect(hideAmountsFor(store, OWNER_A)).toBe(false)
    expect(hideAmountsFor(store, OWNER_B)).toBe(true)

    const ambos = withHideAmounts(store, OWNER_B, true)
    expect(hideAmountsFor(ambos, OWNER_A)).toBe(false)
    expect(hideAmountsFor(ambos, OWNER_B)).toBe(true)
  })

  it('R7: JSON corrompido resolve para oculto', () => {
    for (const ruim of ['{"version":1,"entr', '[]', 'texto', '']) {
      expect(hideAmountsFor(parsePrivacyStore(ruim), OWNER_A)).toBe(true)
    }
  })

  it('R8: versão futura resolve para oculto', () => {
    const futuro = JSON.stringify({
      version: 2,
      entries: [{ ownerId: OWNER_A, hideAmounts: false }],
    })

    expect(hideAmountsFor(parsePrivacyStore(futuro), OWNER_A)).toBe(true)
  })

  it('R9: entrada inválida é descartada sem derrubar as outras', () => {
    const misto = JSON.stringify({
      version: 1,
      entries: [
        { ownerId: OWNER_A, hideAmounts: 'false' },
        { ownerId: OWNER_B, hideAmounts: false },
        { hideAmounts: false },
        null,
      ],
    })

    const store = parsePrivacyStore(misto)

    // A tinha booleano inválido: volta ao padrão. B permanece.
    expect(hideAmountsFor(store, OWNER_A)).toBe(true)
    expect(hideAmountsFor(store, OWNER_B)).toBe(false)
  })
})

/* ═══════════════ R10–R13: persistência ═══════════════ */

describe('persistência da escolha', () => {
  it('R10/R12: grava e relê', async () => {
    const store = createStore()
    const service = buildService(store)

    await service.setHideAmounts(OWNER_A, false)
    expect(await service.getHideAmounts(OWNER_A)).toBe(false)

    await service.setHideAmounts(OWNER_A, true)
    expect(await service.getHideAmounts(OWNER_A)).toBe(true)
  })

  it('R11: um serviço novo lê o que ficou no disco', async () => {
    const store = createStore()

    await buildService(store).setHideAmounts(OWNER_A, false)

    // Instância nova, mesmo arquivo: equivale a reabrir o app.
    expect(await buildService(store).getHideAmounts(OWNER_A)).toBe(false)
  })

  it('R13: gravar para uma conta preserva as demais', async () => {
    const store = createStore()
    const service = buildService(store)

    await service.setHideAmounts(OWNER_A, false)
    await service.setHideAmounts(OWNER_B, false)
    await service.setHideAmounts(OWNER_A, true)

    expect(await service.getHideAmounts(OWNER_A)).toBe(true)
    expect(await service.getHideAmounts(OWNER_B)).toBe(false)
  })

  it('a preferência não guarda nada além do necessário', async () => {
    const store = createStore()
    await buildService(store).setHideAmounts(OWNER_A, false)

    const texto = store.peekPrivacy()!
    for (const proibido of ['@', 'token', 'Cents', 'budget', 'password']) {
      expect(texto, `vazou ${proibido}`).not.toContain(proibido)
    }
  })
})

/* ═══════════════ R14–R20: reescrita do snapshot ═══════════════ */

describe('aplicar a escolha ao snapshot', () => {
  it('R14/R15: o toggle muda a privacidade do READY', async () => {
    const store = createStore(readyFor(OWNER_A, true))
    const service = buildService(store)

    await service.setHideAmounts(OWNER_A, false)
    expect(parseSnapshot(store.peek())).toMatchObject({
      state: 'ready',
      privacy: { hideAmounts: false },
    })

    await service.setHideAmounts(OWNER_A, true)
    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: true },
    })
  })

  it('R16: tudo o mais permanece byte a byte', async () => {
    const original = parseSnapshot(readyFor(OWNER_A, true))!
    const store = createStore(readyFor(OWNER_A, true))

    await buildService(store).setHideAmounts(OWNER_A, false)

    const depois = parseSnapshot(store.peek())!
    expect(depois).toEqual({ ...original, privacy: { hideAmounts: false } })
  })

  it('R17/R34: reescrever privacidade não faz NENHUMA requisição', async () => {
    /*
      O toggle mexe na apresentação de números que JÁ estão no aparelho.
      Exigir rede para ocultar seria inaceitável: quem pede privacidade
      costuma precisar dela agora, não quando a conexão voltar.

      A verificação espiona o `fetch` GLOBAL, não só as dependências
      injetadas. Afirmar "o serviço não recebe cliente HTTP" não pega um
      `fetch` chamado direto lá dentro — e foi exatamente isso que a mutation
      probe expôs.
    */
    const store = createStore(readyFor(OWNER_A, false))
    const service = buildService(store)

    const fetchSpy = vi.fn(async () => new Response('{}'))
    const original = globalThis.fetch
    globalThis.fetch = fetchSpy as never

    try {
      await service.setHideAmounts(OWNER_A, true)
      await service.setHideAmounts(OWNER_A, false)
      await service.getHideAmounts(OWNER_A)
    } finally {
      globalThis.fetch = original
    }

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: false },
    })
  })

  it('R18/R19/R20: sem READY, o toggle não fabrica um', async () => {
    const semSnapshot = [
      { rotulo: 'R18 signedOut', conteudo: JSON.stringify({ version: 1, state: 'signedOut', generatedAt: 'x' }) },
      { rotulo: 'R19 ausente', conteudo: null },
      { rotulo: 'R20 corrompido', conteudo: '{"version":1,"state":"rea' },
    ]

    for (const { rotulo, conteudo } of semSnapshot) {
      const store = createStore(conteudo)
      const result = await buildService(store).setHideAmounts(OWNER_A, false)

      expect(result.status, rotulo).toBe('preferenceOnly')
      // Inventar um READY fabricaria números que ninguém calculou.
      expect(parseSnapshot(store.peek())?.state, rotulo).not.toBe('ready')
      // Mas a escolha ficou registrada para o próximo sync.
      expect(await buildService(store).getHideAmounts(OWNER_A), rotulo).toBe(false)
    }
  })
})

/* ═══════════════ R21–R24: segurança entre contas ═══════════════ */

describe('nunca revelar o snapshot de outra conta', () => {
  it('R21: B não consegue desmascarar o READY de A', async () => {
    /*
      Surge numa troca de conta com sync em andamento. Atender um "mostrar
      valores" de B sobre um arquivo de A exporia o saldo de A.
    */
    const store = createStore(readyFor(OWNER_A, true))

    await buildService(store, OWNER_B).setHideAmounts(OWNER_B, false)

    const depois = parseSnapshot(store.peek())
    expect(depois?.state).not.toBe('ready')
    expect(store.peek()).not.toContain('75724')
    expect(store.peek()).not.toContain(OWNER_A)
  })

  it('R22: a escolha de A não influencia B', async () => {
    const store = createStore()
    await buildService(store, OWNER_A).setHideAmounts(OWNER_A, false)

    expect(await buildService(store, OWNER_B).getHideAmounts(OWNER_B)).toBe(true)
  })

  it('R23/R24: cada conta recupera a própria escolha ao voltar', async () => {
    const store = createStore()

    await buildService(store, OWNER_A).setHideAmounts(OWNER_A, false)
    await buildService(store, OWNER_B).setHideAmounts(OWNER_B, true)

    // A volta: a decisão dele sobreviveu ao logout e à sessão de B.
    expect(await buildService(store, OWNER_A).getHideAmounts(OWNER_A)).toBe(false)
    expect(await buildService(store, OWNER_B).getHideAmounts(OWNER_B)).toBe(true)
  })
})

/* ═══════════════ R25–R29: o sync respeita a preferência ═══════════════ */

describe('o sync do Budget lê a preferência', () => {
  const BUDGET = { totalToPay: 757.24, totalPaid: 446.24, totalPending: 311 }

  const buildSync = (
    store: ReturnType<typeof createStore>,
    hideAmounts?: (ownerId: string) => Promise<boolean>,
    coordinator?: SnapshotMutationCoordinator,
  ) =>
    new SnapshotSync({
      store,
      fetchBudget: async () => BUDGET,
      currentOwnerId: () => OWNER_A,
      hideAmounts,
      coordinator,
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    })

  it('R25: conta sem escolha gera snapshot oculto', async () => {
    const store = createStore()
    const service = buildService(store)

    await buildSync(store, (id) => service.getHideAmounts(id)).sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: true },
    })
  })

  it('R26: opt-in explícito gera snapshot visível', async () => {
    const store = createStore()
    const service = buildService(store)
    await service.setHideAmounts(OWNER_A, false)

    await buildSync(store, (id) => service.getHideAmounts(id)).sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: false },
    })
  })

  it('R27: voltar a ocultar vale no próximo sync', async () => {
    const store = createStore()
    const service = buildService(store)
    const sync = buildSync(store, (id) => service.getHideAmounts(id))

    await service.setHideAmounts(OWNER_A, false)
    await sync.sync()

    await service.setHideAmounts(OWNER_A, true)
    await sync.sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: true },
    })
  })

  it('R28: falha do Budget não altera a preferência', async () => {
    const store = createStore(readyFor(OWNER_A, false))
    const service = buildService(store)
    await service.setHideAmounts(OWNER_A, false)

    const sync = new SnapshotSync({
      store,
      fetchBudget: async () => {
        throw new Error('http_502')
      },
      currentOwnerId: () => OWNER_A,
      hideAmounts: (id) => service.getHideAmounts(id),
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    })

    await sync.sync()

    expect(await service.getHideAmounts(OWNER_A)).toBe(false)
  })

  it('R29: falha ao LER a preferência resolve para oculto', async () => {
    /*
      O sync não pode revelar valores porque a leitura do ajuste falhou. A
      dúvida sempre resolve para oculto.
    */
    const store = createStore()

    await buildSync(store, async () => {
      throw new Error('disco indisponível')
    }).sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: true },
    })
  })
})

/* ═══════════════ R30–R32: generatedAt ═══════════════ */

describe('generatedAt responde pelos DADOS, não pelo arquivo', () => {
  const GERADO = '2026-09-14T09:00:00.000Z'

  it('R30/R31: o toggle não envelhece nem rejuvenesce o dado', async () => {
    /*
      Budget sincronizado às 09:00; às 18:00 alguém mexe no interruptor.
      Se `generatedAt` avançasse, o rótulo "Atualizado há Xh" do M3 diria que
      o número é recente — e ele continua sendo o das 09:00.
    */
    const store = createStore(readyFor(OWNER_A, true, GERADO))
    const service = buildService(store)

    await service.setHideAmounts(OWNER_A, false)
    expect(parseSnapshot(store.peek())).toMatchObject({ generatedAt: GERADO })

    await service.setHideAmounts(OWNER_A, true)
    expect(parseSnapshot(store.peek())).toMatchObject({ generatedAt: GERADO })
  })

  it('R32: um sync de Budget SIM atualiza generatedAt', async () => {
    const store = createStore(readyFor(OWNER_A, true, GERADO))

    await new SnapshotSync({
      store,
      fetchBudget: async () => ({
        totalToPay: 100,
        totalPaid: 40,
        totalPending: 60,
      }),
      currentOwnerId: () => OWNER_A,
      now: () => new Date('2026-09-14T18:00:00.000Z'),
    }).sync()

    expect(parseSnapshot(store.peek())).toMatchObject({
      generatedAt: '2026-09-14T18:00:00.000Z',
    })
  })
})

/* ═══════════════ R33–R35: offline ═══════════════ */

describe('offline', () => {
  it('R33/R34: ocultar funciona com o backend fora do ar', async () => {
    /*
      O principal requisito do M4. Quem pede privacidade precisa dela agora —
      não quando a conexão voltar.
    */
    const store = createStore(readyFor(OWNER_A, false))
    const service = buildService(store)

    const fetchSpy = vi.fn(async () => new Response('{}'))
    const original = globalThis.fetch
    globalThis.fetch = fetchSpy as never

    let result
    try {
      result = await service.setHideAmounts(OWNER_A, true)
    } finally {
      globalThis.fetch = original
    }

    expect(result).toEqual({ status: 'applied', hideAmounts: true })
    expect(fetchSpy, 'o toggle tentou usar a rede').not.toHaveBeenCalled()
    expect(parseSnapshot(store.peek())).toMatchObject({
      state: 'ready',
      privacy: { hideAmounts: true },
      // Os números permanecem: só a apresentação mudou.
      budget: { totalToPayCents: 75724 },
    })
  })

  it('R35: mostrar também funciona offline, para o próprio dono', async () => {
    const store = createStore(readyFor(OWNER_A, true))

    const result = await buildService(store).setHideAmounts(OWNER_A, false)

    expect(result).toEqual({ status: 'applied', hideAmounts: false })
    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: false },
    })
  })
})

/* ═══════════════ R36–R39: concorrência ═══════════════ */

describe('sync e toggle disputando o mesmo arquivo', () => {
  it('R36: o sync grava a preferência MAIS NOVA, não a do início', async () => {
    /*
      A corrida que motivou o coordenador:

        sync lê a preferência (oculto)
        → usuário ativa "mostrar"
        → toggle grava
        → sync TERMINA e sobrescreve com a preferência velha

      O usuário veria o ajuste ligado e o widget mascarado, sem nada errado
      aparecendo em lugar nenhum.
    */
    const store = createStore()
    const coordinator = new SnapshotMutationCoordinator()
    const service = buildService(store, OWNER_A, coordinator)

    let liberarFetch: () => void = () => {}
    const fetchLento = new Promise<void>((resolve) => {
      liberarFetch = resolve
    })

    const sync = new SnapshotSync({
      store,
      fetchBudget: async () => {
        await fetchLento
        return { totalToPay: 757.24, totalPaid: 446.24, totalPending: 311 }
      },
      currentOwnerId: () => OWNER_A,
      hideAmounts: (id) => service.getHideAmounts(id),
      coordinator,
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    })

    const emVoo = sync.sync()
    // Enquanto o HTTP está pendurado, o usuário muda de ideia.
    await service.setHideAmounts(OWNER_A, false)
    liberarFetch()
    await emVoo

    expect(parseSnapshot(store.peek())).toMatchObject({
      state: 'ready',
      privacy: { hideAmounts: false },
    })
  })

  it('R37: toggle seguido de logout termina em signedOut', async () => {
    const store = createStore(readyFor(OWNER_A, true))
    const coordinator = new SnapshotMutationCoordinator()
    const service = buildService(store, OWNER_A, coordinator)

    const sync = new SnapshotSync({
      store,
      fetchBudget: async () => ({ totalToPay: 1, totalPaid: 0, totalPending: 1 }),
      currentOwnerId: () => OWNER_A,
      coordinator,
    })

    await Promise.all([service.setHideAmounts(OWNER_A, false), sync.scrub()])

    expect(parseSnapshot(store.peek())).toMatchObject({ state: 'signedOut' })
  })

  it('R38: um toggle tardio não ressuscita o READY depois do logout', async () => {
    const store = createStore(readyFor(OWNER_A, true))
    const coordinator = new SnapshotMutationCoordinator()

    const sync = new SnapshotSync({
      store,
      fetchBudget: async () => ({ totalToPay: 1, totalPaid: 0, totalPending: 1 }),
      currentOwnerId: () => OWNER_A,
      coordinator,
    })

    await sync.scrub()
    await buildService(store, OWNER_A, coordinator).setHideAmounts(OWNER_A, false)

    /*
      O snapshot já era neutro quando o toggle chegou. Ele não tem de onde
      reconstruir valores — e não deve inventar.
    */
    expect(parseSnapshot(store.peek())).toMatchObject({ state: 'signedOut' })
    expect(store.peek()).not.toContain('75724')
  })

  it('R39: toggles rápidos são serializados, com resultado determinístico', async () => {
    const store = createStore(readyFor(OWNER_A, true))
    const coordinator = new SnapshotMutationCoordinator()
    const service = buildService(store, OWNER_A, coordinator)

    await Promise.all([
      service.setHideAmounts(OWNER_A, false),
      service.setHideAmounts(OWNER_A, true),
      service.setHideAmounts(OWNER_A, false),
    ])

    // O último a entrar na fila é o que vale, e disco e snapshot concordam.
    const persistido = await service.getHideAmounts(OWNER_A)
    expect(parseSnapshot(store.peek())).toMatchObject({
      privacy: { hideAmounts: persistido },
    })
  })
})

/* ═══════════════ R40–R44: atualização do widget ═══════════════ */

describe('o widget é avisado', () => {
  it('R40/R41/R42: toda reescrita bem-sucedida passa por store.write', async () => {
    /*
      O módulo nativo dispara o refresh DEPOIS do commit atômico — provado em
      `widget-surface.spec.ts`. Aqui basta afirmar que a reescrita ocorre.
    */
    const store = createStore(readyFor(OWNER_A, true))
    const service = buildService(store)

    await service.setHideAmounts(OWNER_A, false)
    expect(store.write).toHaveBeenCalledTimes(1)

    await service.setHideAmounts(OWNER_A, true)
    expect(store.write).toHaveBeenCalledTimes(2)
  })

  it('R43: escrita que falha ao OCULTAR não deixa valores visíveis', async () => {
    /*
      A combinação realmente ruim: a interface diz "oculto" e o widget segue
      exibindo. Perder o Budget da tela inicial é melhor que mostrar o que
      foi mandado esconder.
    */
    const store = createStore(readyFor(OWNER_A, false))
    let primeira = true

    store.write = vi.fn(async (value: string) => {
      if (primeira) {
        primeira = false
        throw new Error('disco indisponível')
      }
      // A segunda escrita é o scrub de emergência.
      expect(value).toContain('signedOut')
    })

    const result = await buildService(store).setHideAmounts(OWNER_A, true)

    expect(result.status).toBe('preferenceOnly')
    expect(store.write).toHaveBeenCalledTimes(2)
  })

  it('R44: em signedOut, o toggle não fabrica Budget', async () => {
    const store = createStore(
      JSON.stringify({ version: 1, state: 'signedOut', generatedAt: 'x' }),
    )

    const result = await buildService(store).setHideAmounts(OWNER_A, false)

    expect(result.status).toBe('preferenceOnly')
    expect(store.peek()).not.toContain('budget')
  })
})

/* ═══════════════ M5B: S10-S22 — privacidade compartilhada Budget + Invoices ═══════════════ */

const readyInvoicesFor = (
  ownerId: string,
  hideAmounts: boolean,
  generatedAt = '2026-09-15T09:00:00.000Z',
) =>
  JSON.stringify({
    version: 2,
    state: 'ready',
    generatedAt,
    ownerId,
    privacy: { hideAmounts },
    invoices: [
      {
        bankName: 'Banco X',
        status: 'OPEN',
        actionDate: '2026-09-20',
        totalAmountCents: 5000,
      },
    ],
  })

describe('M5B — privacy multi-snapshot', () => {
  it('S10: owner sem preferência resolve invoices hide=true (mesmo default do Budget)', async () => {
    const store = createStore()
    expect(await buildService(store).getHideAmounts(OWNER_A)).toBe(true)
  })

  it('S11: owner opt-in resolve hide=false para os dois widgets', async () => {
    const store = createStore()
    await buildService(store).setHideAmounts(OWNER_A, false)
    expect(await buildService(store).getHideAmounts(OWNER_A)).toBe(false)
  })

  it('S12: toggle OFF (esconder) reescreve Budget E Invoices para hideAmounts=true', async () => {
    const store = createStore(
      readyFor(OWNER_A, false),
      null,
      readyInvoicesFor(OWNER_A, false),
    )

    const result = await buildService(store).setHideAmounts(OWNER_A, true)

    expect(result).toEqual({ status: 'applied', hideAmounts: true })
    expect(parseSnapshot(store.peek())).toMatchObject({ privacy: { hideAmounts: true } })
    expect(parseInvoicesSnapshot(store.peekInvoices())).toMatchObject({
      privacy: { hideAmounts: true },
    })
  })

  it('S13: toggle ON (mostrar) reescreve Budget E Invoices para hideAmounts=false', async () => {
    const store = createStore(
      readyFor(OWNER_A, true),
      null,
      readyInvoicesFor(OWNER_A, true),
    )

    const result = await buildService(store).setHideAmounts(OWNER_A, false)

    expect(result).toEqual({ status: 'applied', hideAmounts: false })
    expect(parseSnapshot(store.peek())).toMatchObject({ privacy: { hideAmounts: false } })
    expect(parseInvoicesSnapshot(store.peekInvoices())).toMatchObject({
      privacy: { hideAmounts: false },
    })
  })

  it('S14: toggle não faz nenhuma chamada de rede', async () => {
    const store = createStore(readyFor(OWNER_A, false), null, readyInvoicesFor(OWNER_A, false))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await buildService(store).setHideAmounts(OWNER_A, true)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('S15: toggle preserva o generatedAt do Budget', async () => {
    const store = createStore(
      readyFor(OWNER_A, false, '2026-09-01T00:00:00.000Z'),
      null,
      readyInvoicesFor(OWNER_A, false),
    )

    await buildService(store).setHideAmounts(OWNER_A, true)

    expect(parseSnapshot(store.peek())).toMatchObject({
      generatedAt: '2026-09-01T00:00:00.000Z',
    })
  })

  it('S16: toggle preserva o generatedAt do Invoices', async () => {
    const store = createStore(
      readyFor(OWNER_A, false),
      null,
      readyInvoicesFor(OWNER_A, false, '2026-09-02T00:00:00.000Z'),
    )

    await buildService(store).setHideAmounts(OWNER_A, true)

    expect(parseInvoicesSnapshot(store.peekInvoices())).toMatchObject({
      generatedAt: '2026-09-02T00:00:00.000Z',
    })
  })

  it('S17: B não consegue unmask Invoices de A', async () => {
    const store = createStore(null, null, readyInvoicesFor(OWNER_A, true))

    const result = await buildService(store, OWNER_B).setHideAmounts(OWNER_B, false)

    expect(result.status).not.toBe('applied')
    // O snapshot de A é neutralizado, nunca revelado para B.
    expect(parseInvoicesSnapshot(store.peekInvoices())?.state).toBe('signedOut')
  })

  it('S18: signedOut invoices não vira READY por causa do toggle', async () => {
    const store = createStore(
      null,
      null,
      JSON.stringify({ version: 2, state: 'signedOut', generatedAt: 'x' }),
    )

    await buildService(store).setHideAmounts(OWNER_A, false)

    expect(parseInvoicesSnapshot(store.peekInvoices())?.state).toBe('signedOut')
  })

  it('S19: rewrite de Invoices falha → tenta neutralizar (scrub)', async () => {
    const store = createStore(readyFor(OWNER_A, false), null, readyInvoicesFor(OWNER_A, false))
    let primeiraInvoices = true

    store.writeInvoices = vi.fn(async (value: string) => {
      if (primeiraInvoices) {
        primeiraInvoices = false
        throw new Error('disco indisponível')
      }
      expect(value).toContain('signedOut')
    })

    const result = await buildService(store).setHideAmounts(OWNER_A, true)

    // Budget aplicou normalmente; Invoices precisou de scrub — resultado é
    // parcial, não um "applied" silencioso.
    expect(result.status).toBe('partial')
    expect(store.writeInvoices).toHaveBeenCalledTimes(2)
  })

  it('S20: Budget aplica com sucesso + Invoices falha → privacy continua hidden (persistida)', async () => {
    const store = createStore(readyFor(OWNER_A, false), null, readyInvoicesFor(OWNER_A, false))

    store.writeInvoices = vi.fn(async () => {
      throw new Error('falha total')
    })

    await buildService(store).setHideAmounts(OWNER_A, true)

    // A preferência persistida continua "true" — futuros syncs respeitarão.
    expect(await buildService(store).getHideAmounts(OWNER_A)).toBe(true)
  })

  it('S21: falha ao MOSTRAR em Invoices não faz scrub por causa do show', async () => {
    const store = createStore(readyFor(OWNER_A, true), null, readyInvoicesFor(OWNER_A, true))
    const originalInvoices = store.peekInvoices()

    store.writeInvoices = vi.fn(async () => {
      throw new Error('falha ao mostrar')
    })

    const result = await buildService(store).setHideAmounts(OWNER_A, false)

    expect(result.status).toBe('partial')
    // Invoices não foi neutralizado — mostrar que falhou não pode revelar
    // nem apagar; ele só continua com o dado antigo (que já estava oculto).
    expect(store.peekInvoices()).toBe(originalInvoices)
  })

  it('S22: UI (o resultado) não afirma sucesso integral quando um snapshot não pôde ser atualizado nem neutralizado', async () => {
    const store = createStore(readyFor(OWNER_A, false), null, readyInvoicesFor(OWNER_A, false))

    store.writeInvoices = vi.fn(async () => {
      throw new Error('sempre falha')
    })

    const result = await buildService(store).setHideAmounts(OWNER_A, true)

    expect(result.status).not.toBe('applied')
  })

  it('owner estrangeiro em Invoices é neutralizado sem afetar o Budget do owner correto', async () => {
    const store = createStore(readyFor(OWNER_A, false), null, readyInvoicesFor(OWNER_B, false))

    const result = await buildService(store, OWNER_A).setHideAmounts(OWNER_A, true)

    // Budget (de A) aplica normalmente; Invoices (de B) é neutralizado por
    // pertencer a outra conta — o mesmo tratamento que um Budget estrangeiro
    // já recebia no M4. Do ponto de vista de A, isso não é degradação: o
    // widget de Invoices simplesmente não tinha nada seu para atualizar.
    expect(parseSnapshot(store.peek())).toMatchObject({ privacy: { hideAmounts: true } })
    expect(parseInvoicesSnapshot(store.peekInvoices())?.state).toBe('signedOut')
    expect(result.status).toBe('applied')
  })
})

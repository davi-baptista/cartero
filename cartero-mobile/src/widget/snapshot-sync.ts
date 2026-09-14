import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'
import { currentCarteroCompetence, type Competence } from './competence'
import type { SnapshotMutationCoordinator } from './snapshot-mutations'
import {
  DEFAULT_HIDE_AMOUNTS,
  SNAPSHOT_CURRENCY,
  SNAPSHOT_VERSION,
  buildSignedOutSnapshot,
  parseSnapshot,
  toCents,
  type ReadySnapshot,
} from './snapshot'

/**
 * A única autoridade que escreve o Widget Snapshot.
 *
 * Centralizada de propósito: espalhar a escrita por telas e hooks produziria
 * snapshots concorrentes de competências diferentes, e o último a gravar
 * venceria por acidente de ordem.
 */

/**
 * O recorte de `GET /budget` que o Snapshot V1 consome.
 *
 * Três campos, não o objeto inteiro — que traz salário, faturas, dívidas,
 * acertos por pessoa e nomes de terceiros. Declarar só o que se usa é o que
 * impede o snapshot de crescer por inércia: para incluir mais, é preciso
 * editar este tipo primeiro.
 */
export interface BudgetSnapshotSource {
  totalToPay: number
  totalPaid: number
  totalPending: number
}

export interface SnapshotSyncDeps {
  store: SnapshotStore | null
  /** Rota protegida do cliente já autenticado. */
  fetchBudget: (competence: Competence) => Promise<unknown>
  /** Id do usuário da sessão corrente, ou `null` se não há sessão. */
  currentOwnerId: () => string | null
  /**
   * A preferência da conta, lida no momento da ESCRITA.
   *
   * Assíncrona de propósito: ela vem do disco, e consultá-la tarde é o que
   * impede o sync de gravar uma privacidade que o usuário já mudou enquanto
   * a requisição estava em voo.
   */
  hideAmounts?: (ownerId: string) => Promise<boolean>
  /** Serializa esta escrita com as do toggle de privacidade. */
  coordinator?: SnapshotMutationCoordinator
  now?: () => Date
}

export type SyncOutcome =
  | { status: 'written' }
  | { status: 'skipped'; reason: 'noSession' | 'noStore' }
  | { status: 'preserved'; reason: 'requestFailed' | 'malformedResponse' }

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * Valida a resposta antes de deixá-la virar snapshot.
 *
 * Um 2xx com campo ausente não pode virar zero. Zero é um fato financeiro —
 * "você não deve nada" — e inventá-lo na tela inicial é pior que não
 * atualizar: o usuário acreditaria estar em dia.
 */
function readBudget(payload: unknown): BudgetSnapshotSource | null {
  if (typeof payload !== 'object' || payload === null) return null

  const { totalToPay, totalPaid, totalPending } =
    payload as Record<string, unknown>

  if (
    !isFiniteNumber(totalToPay) ||
    !isFiniteNumber(totalPaid) ||
    !isFiniteNumber(totalPending)
  ) {
    return null
  }

  return { totalToPay, totalPaid, totalPending }
}

export class SnapshotSync {
  /*
    O sync em voo, compartilhado.

    Login, restauração de sessão e ida para foreground podem acontecer com
    milissegundos de diferença. Sem isto, três chamadas de `GET /budget`
    partiriam juntas e três escritas disputariam o mesmo arquivo — a última a
    terminar venceria, que não é necessariamente a mais recente.
  */
  private inFlight: Promise<SyncOutcome> | null = null

  constructor(private readonly deps: SnapshotSyncDeps) {}

  private get now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  sync(): Promise<SyncOutcome> {
    if (this.inFlight) return this.inFlight

    this.inFlight = this.run().finally(() => {
      // Liberado inclusive na falha: manter a promessa rejeitada em cache
      // faria todo evento seguinte falhar sem nem tentar.
      this.inFlight = null
    })

    return this.inFlight
  }

  private async run(): Promise<SyncOutcome> {
    const { store, currentOwnerId } = this.deps

    if (!store) return { status: 'skipped', reason: 'noStore' }

    const ownerId = currentOwnerId()
    if (!ownerId) return { status: 'skipped', reason: 'noSession' }

    /*
      ── Troca de conta: limpar ANTES de buscar ──

      Se o arquivo pertence a outra pessoa, ele é neutralizado agora, não
      depois. Buscar primeiro e sobrescrever depois deixaria os valores de A
      visíveis durante a requisição de B — e, se ela falhasse, para sempre.
      Falhar fechado é a única ordem aceitável aqui.
    */
    await this.scrubIfForeignOwner(ownerId)

    const competence = currentCarteroCompetence(this.now)

    let payload: unknown
    try {
      payload = await this.deps.fetchBudget(competence)
    } catch {
      /*
        Rede, 5xx, 429 — o servidor ou o caminho até ele falhou, e isso não
        diz nada sobre os números que já estão no arquivo. O último snapshot
        bom permanece, com seu `generatedAt` antigo, que é o que permite a um
        widget futuro dizer "atualizado há 2 h" em vez de ficar vazio.
      */
      return { status: 'preserved', reason: 'requestFailed' }
    }

    const budget = readBudget(payload)
    if (!budget) return { status: 'preserved', reason: 'malformedResponse' }

    /*
      ── A privacidade e a escrita entram no LOCK juntas ──

      A requisição acima ficou fora dele de propósito: segurar a fila durante
      uma chamada de rede bloquearia o toggle por segundos. Mas a preferência
      é lida AQUI DENTRO, imediatamente antes de gravar — se fosse capturada
      antes do fetch, um toggle ocorrido no meio seria sobrescrito pelo valor
      velho, e o usuário veria o ajuste ligado com o widget mascarado.
    */
    const write = async (): Promise<SyncOutcome> => {
      const hideAmounts = await this.resolveHideAmounts(ownerId)

      const snapshot: ReadySnapshot = {
        version: SNAPSHOT_VERSION,
        state: 'ready',
        generatedAt: this.now.toISOString(),
        ownerId,
        privacy: { hideAmounts },
        budget: {
          month: competence.month,
          year: competence.year,
          currency: SNAPSHOT_CURRENCY,
          totalToPayCents: toCents(budget.totalToPay),
          totalPaidCents: toCents(budget.totalPaid),
          totalPendingCents: toCents(budget.totalPending),
        },
      }

      await store.write(JSON.stringify(snapshot))
      return { status: 'written' }
    }

    return this.deps.coordinator ? this.deps.coordinator.run(write) : write()
  }

  /**
   * A preferência da conta, com o padrão seguro em qualquer falha.
   *
   * Um problema para ler o ajuste não pode revelar valores: a dúvida sempre
   * resolve para oculto.
   */
  private async resolveHideAmounts(ownerId: string): Promise<boolean> {
    if (!this.deps.hideAmounts) return DEFAULT_HIDE_AMOUNTS

    try {
      return await this.deps.hideAmounts(ownerId)
    } catch {
      return DEFAULT_HIDE_AMOUNTS
    }
  }

  /** Neutraliza o arquivo quando ele pertence a outra conta. */
  private async scrubIfForeignOwner(ownerId: string): Promise<void> {
    const store = this.deps.store
    if (!store) return

    const existing = parseSnapshot(await store.read())
    if (existing?.state === 'ready' && existing.ownerId !== ownerId) {
      await store.write(JSON.stringify(buildSignedOutSnapshot(this.now)))
    }
  }

  /**
   * Encerramento de sessão.
   *
   * Escreve o estado neutro em vez de apagar o arquivo. Apagar deixaria uma
   * janela em que o conteúdo antigo ainda está no disco, e a escrita atômica
   * garante que o que sobra é exatamente o snapshot sem dono e sem valores —
   * nunca um meio-termo.
   */
  async scrub(): Promise<void> {
    const store = this.deps.store
    if (!store) return

    await store.write(JSON.stringify(buildSignedOutSnapshot(this.now)))
  }
}

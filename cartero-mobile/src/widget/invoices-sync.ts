import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'
import type { SnapshotMutationCoordinator } from './snapshot-mutations'
import {
  INVOICES_DEFAULT_HIDE_AMOUNTS,
  INVOICES_SNAPSHOT_VERSION,
  buildInvoicesSignedOutSnapshot,
  parseInvoicesSnapshot,
  type ActionableInvoiceStatus,
  type InvoicesReadySnapshot,
  type SnapshotInvoiceItem,
} from './invoices-snapshot'

/**
 * A única autoridade que escreve o Invoices Snapshot.
 *
 * Mesmo desenho do `SnapshotSync` (Budget): single-flight, scrub por owner
 * estrangeiro ANTES do fetch, `generatedAt` próprio, e a preferência de
 * privacidade lida dentro do lock — não antes do HTTP. A duplicação de
 * ESTRUTURA entre os dois arquivos é deliberada por ora: são dois contratos
 * que hoje têm o mesmo formato de ciclo de vida, mas fontes, validação de
 * payload e status possíveis diferem o bastante para que uma classe genérica
 * teria de parametrizar quase tudo — o preço de uma abstração prematura.
 *
 * ── O que este arquivo NÃO faz ──
 *
 * `GET /invoices/actionable` já decidiu tudo que é domínio financeiro:
 * quais bancos, qual invoice representa cada um, a ordem, o status,
 * `actionDate`, o valor pessoal. Este sync PRESERVA a resposta — não
 * ordena, não filtra por status, não deduplica por nome, não recalcula
 * dinheiro. Reimplementar qualquer uma dessas regras aqui seria uma segunda
 * autoridade capaz de divergir da primeira.
 */

const VALID_STATUS = new Set<string>(['OVERDUE', 'CLOSED', 'OPEN'])

/**
 * Um item da resposta de `GET /invoices/actionable`, ainda não validado.
 *
 * O backend devolve `ownAmountCents` E `totalAmountCents` — o read model
 * serve mais de um consumidor em potencial. Este sync valida os DOIS (uma
 * resposta que não trouxer `ownAmountCents` estruturalmente correto é tão
 * malformada quanto uma sem `totalAmountCents`), mas só `totalAmountCents`
 * sobrevive ao `SnapshotInvoiceItem`: é o único valor que o Invoices Widget
 * lê (M6.2), e persistir o que nenhum código instalado consome seria
 * superfície financeira gratuita no arquivo.
 */
function readInvoiceItem(value: unknown): SnapshotInvoiceItem | null {
  if (typeof value !== 'object' || value === null) return null

  const { bankName, status, actionDate, ownAmountCents, totalAmountCents } =
    value as Record<string, unknown>

  if (typeof bankName !== 'string' || bankName === '') return null
  // PAID nunca deveria chegar aqui — o backend já exclui — mas um status
  // desconhecido (ou PAID por bug) invalida a resposta em vez de ser
  // silenciosamente aceito ou mapeado para outra coisa.
  if (typeof status !== 'string' || !VALID_STATUS.has(status)) return null
  if (typeof actionDate !== 'string' || !isCivilDateShape(actionDate)) {
    return null
  }
  // Validado por completude estrutural da resposta do backend — não persistido.
  if (typeof ownAmountCents !== 'number' || !Number.isInteger(ownAmountCents)) {
    return null
  }
  if (typeof totalAmountCents !== 'number' || !Number.isInteger(totalAmountCents)) {
    return null
  }

  return {
    bankName,
    status: status as ActionableInvoiceStatus,
    actionDate,
    totalAmountCents,
  }
}

/**
 * Só a FORMA (`YYYY-MM-DD`) é verificada aqui — não a validade civil, que o
 * parser do snapshot já garante na escrita. Duplicar a checagem completa
 * aqui não protegeria nada que a escrita não proteja de novo.
 */
function isCivilDateShape(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * Valida a resposta inteira antes de deixá-la virar snapshot.
 *
 * Um 2xx malformado (campo ausente, item com tipo errado, status impossível)
 * não pode virar uma lista vazia nem inventar dados — as duas maneiras de
 * mentir sobre o que o backend realmente disse.
 */
function readInvoices(payload: unknown): SnapshotInvoiceItem[] | null {
  if (typeof payload !== 'object' || payload === null) return null

  const { items } = payload as Record<string, unknown>
  if (!Array.isArray(items)) return null

  const invoices: SnapshotInvoiceItem[] = []
  for (const raw of items) {
    const parsed = readInvoiceItem(raw)
    if (!parsed) return null
    invoices.push(parsed)
  }

  return invoices
}

export interface InvoicesSyncDeps {
  store: SnapshotStore | null
  /** Rota protegida do cliente já autenticado: `GET /invoices/actionable`. */
  fetchActionableInvoices: () => Promise<unknown>
  currentOwnerId: () => string | null
  /** A preferência da conta, lida no momento da ESCRITA — ver `snapshot-sync.ts`. */
  hideAmounts?: (ownerId: string) => Promise<boolean>
  /** Serializa esta escrita com as do toggle de privacidade e do Budget. */
  coordinator?: SnapshotMutationCoordinator
  now?: () => Date
}

export type InvoicesSyncOutcome =
  | { status: 'written' }
  | { status: 'skipped'; reason: 'noSession' | 'noStore' }
  | { status: 'preserved'; reason: 'requestFailed' | 'malformedResponse' }

export class InvoicesSync {
  /** Mesma razão do Budget: login, restauração e foreground chegam quase juntos. */
  private inFlight: Promise<InvoicesSyncOutcome> | null = null

  constructor(private readonly deps: InvoicesSyncDeps) {}

  private get now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  sync(): Promise<InvoicesSyncOutcome> {
    if (this.inFlight) return this.inFlight

    this.inFlight = this.run().finally(() => {
      this.inFlight = null
    })

    return this.inFlight
  }

  private async run(): Promise<InvoicesSyncOutcome> {
    const { store, currentOwnerId } = this.deps

    if (!store) return { status: 'skipped', reason: 'noStore' }

    const ownerId = currentOwnerId()
    if (!ownerId) return { status: 'skipped', reason: 'noSession' }

    // Troca de conta: limpar ANTES de buscar — mesma ordem do Budget.
    await this.scrubIfForeignOwner(ownerId)

    let payload: unknown
    try {
      payload = await this.deps.fetchActionableInvoices()
    } catch {
      return { status: 'preserved', reason: 'requestFailed' }
    }

    const invoices = readInvoices(payload)
    if (!invoices) return { status: 'preserved', reason: 'malformedResponse' }

    /*
      ── Owner context, checado de novo DENTRO do lock ──

      Entre o fetch (que pode levar segundos) e a escrita, a sessão pode ter
      mudado — logout, ou troca para outra conta. Reconfirmar o owner aqui
      impede que uma resposta que já não corresponde a ninguém logado seja
      escrita como se fosse.
    */
    const write = async (): Promise<InvoicesSyncOutcome> => {
      const stillCurrentOwner = this.deps.currentOwnerId()
      if (stillCurrentOwner !== ownerId) {
        // A sessão mudou enquanto a requisição estava em voo. Esta resposta
        // pertence a uma conta que não é mais (ou ainda não é) a corrente —
        // descartá-la é o que impede A de vazar para B ou de sobrescrever o
        // signedOut que o logout já escreveu.
        return { status: 'preserved', reason: 'requestFailed' }
      }

      const hideAmounts = await this.resolveHideAmounts(ownerId)

      const snapshot: InvoicesReadySnapshot = {
        version: INVOICES_SNAPSHOT_VERSION,
        state: 'ready',
        generatedAt: this.now.toISOString(),
        ownerId,
        privacy: { hideAmounts },
        invoices,
      }

      await store.writeInvoices(JSON.stringify(snapshot))
      return { status: 'written' }
    }

    return this.deps.coordinator ? this.deps.coordinator.run(write) : write()
  }

  private async resolveHideAmounts(ownerId: string): Promise<boolean> {
    if (!this.deps.hideAmounts) return INVOICES_DEFAULT_HIDE_AMOUNTS

    try {
      return await this.deps.hideAmounts(ownerId)
    } catch {
      return INVOICES_DEFAULT_HIDE_AMOUNTS
    }
  }

  private async scrubIfForeignOwner(ownerId: string): Promise<void> {
    const store = this.deps.store
    if (!store) return

    const existing = parseInvoicesSnapshot(await store.readInvoices())
    if (existing?.state === 'ready' && existing.ownerId !== ownerId) {
      await store.writeInvoices(JSON.stringify(buildInvoicesSignedOutSnapshot(this.now)))
    }
  }

  /** Encerramento de sessão — escreve o estado neutro, nunca apaga o arquivo. */
  async scrub(): Promise<void> {
    const store = this.deps.store
    if (!store) return

    await store.writeInvoices(JSON.stringify(buildInvoicesSignedOutSnapshot(this.now)))
  }
}

import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'
import {
  DEFAULT_HIDE_AMOUNTS,
  hideAmountsFor,
  parsePrivacyStore,
  withHideAmounts,
} from './privacy-store'
import type { SnapshotMutationCoordinator } from './snapshot-mutations'
import { buildSignedOutSnapshot, parseSnapshot } from './snapshot'
import {
  buildInvoicesSignedOutSnapshot,
  parseInvoicesSnapshot,
} from './invoices-snapshot'

/**
 * A única autoridade sobre a privacidade dos widgets financeiros.
 *
 * A interface nunca grava JSON: ela pede uma mudança e recebe o estado que
 * ficou persistido. Espalhar leitura e escrita por telas produziria versões
 * divergentes da mesma preferência — e, neste caso, divergência significa a
 * tela dizendo "oculto" enquanto o saldo aparece na tela inicial.
 *
 * ── M5B: uma preferência, todos os snapshots financeiros ──
 *
 * "Mostrar valores nos widgets" nunca foi uma opção por widget — é uma
 * decisão sobre a conta. Quando o Invoices Snapshot passou a existir, o
 * toggle passou a reescrever OS DOIS: Budget e Invoices, na mesma operação,
 * sem tocar em rede. Não existe transação de filesystem entre eles — cada
 * rewrite é tentado independentemente, e a falha de um nunca desfaz a
 * preferência nem impede a tentativa no outro.
 */

export interface PrivacyServiceDeps {
  store: SnapshotStore | null
  coordinator: SnapshotMutationCoordinator
  /** Id da conta na sessão corrente, ou `null` se não há sessão. */
  currentOwnerId: () => string | null
}

export type PrivacyUpdateResult =
  | { status: 'applied'; hideAmounts: boolean }
  /** A preferência foi gravada, mas nenhum snapshot pôde ser atualizado. */
  | { status: 'preferenceOnly'; hideAmounts: boolean }
  /**
   * A preferência foi gravada e AO MENOS UM snapshot foi atualizado, mas
   * nem todos — a UI não pode declarar sucesso integral neste caso.
   */
  | { status: 'partial'; hideAmounts: boolean }
  | { status: 'failed' }

/** O resultado de tentar aplicar a preferência a UM snapshot. */
type SnapshotApplyResult = 'applied' | 'neutralized' | 'skipped' | 'failed'

export class WidgetPrivacyService {
  constructor(private readonly deps: PrivacyServiceDeps) {}

  /**
   * A escolha desta conta.
   *
   * Qualquer falha resolve para oculto — arquivo ausente, corrompido, versão
   * futura, leitura que falhou. O padrão nunca é "revelar".
   */
  async getHideAmounts(ownerId: string): Promise<boolean> {
    const store = this.deps.store
    if (!store) return DEFAULT_HIDE_AMOUNTS

    try {
      const raw = await store.readPrivacy()
      return hideAmountsFor(parsePrivacyStore(raw), ownerId)
    } catch {
      return DEFAULT_HIDE_AMOUNTS
    }
  }

  /**
   * Registra a escolha e aplica a TODOS os snapshots financeiros existentes.
   *
   * Não há requisição: o toggle mexe na apresentação de números que já estão
   * no aparelho. Exigir rede para OCULTAR seria inaceitável — quem pede
   * privacidade costuma precisar dela agora, não quando a conexão voltar.
   */
  async setHideAmounts(
    ownerId: string,
    hideAmounts: boolean,
  ): Promise<PrivacyUpdateResult> {
    const store = this.deps.store
    if (!store) return { status: 'failed' }

    return this.deps.coordinator.run(async () => {
      /*
        A preferência é gravada PRIMEIRO, e isso é deliberado.

        Se os passos seguintes falharem, o pedido do usuário já está
        registrado: o próximo sync de qualquer widget respeitará "ocultar"
        mesmo que a reescrita de agora não tenha dado certo. A ordem inversa
        perderia a intenção por completo.
      */
      try {
        const raw = await store.readPrivacy()
        const next = withHideAmounts(parsePrivacyStore(raw), ownerId, hideAmounts)
        await store.writePrivacy(JSON.stringify(next))
      } catch {
        return { status: 'failed' }
      }

      /*
        Cada snapshot é tentado INDEPENDENTEMENTE — não existe transação de
        filesystem entre `snapshot-v1.json` e `invoices-v1.json`. O resultado
        de um nunca impede a tentativa no outro, e a falha de um nunca reverte
        a preferência que acabou de ser persistida.
      */
      const budgetResult = await this.applyToBudget(ownerId, hideAmounts)
      const invoicesResult = await this.applyToInvoices(ownerId, hideAmounts)

      return this.combineResults(hideAmounts, budgetResult, invoicesResult)
    })
  }

  /**
   * Decide o `PrivacyUpdateResult` público a partir do resultado de cada
   * snapshot individual.
   *
   * `skipped` (sem READY para reescrever, ou de outro owner) NÃO é falha nem
   * degrada o resultado: não há nada errado em um widget ainda não ter
   * snapshot algum — é o caso comum quando só um dos dois já sincronizou
   * alguma vez.
   *
   * `neutralized` sozinho (nenhum `applied`) preserva a semântica que o M4
   * já testava para o Budget isolado: a preferência foi salva e o rewrite
   * falhou, mas o scrub de emergência apagou o dado visível — a UI trata
   * isso como `preferenceOnly`, não como uma degradação de um sucesso que
   * nunca aconteceu. `partial` existe só para o caso NOVO do M5B: um
   * snapshot terminou `applied` e o outro não (`neutralized` ou `failed`) —
   * aí sim há uma mistura que a UI não deve silenciar.
   */
  private combineResults(
    hideAmounts: boolean,
    budget: SnapshotApplyResult,
    invoices: SnapshotApplyResult,
  ): PrivacyUpdateResult {
    const results = [budget, invoices]
    const anyFailed = results.includes('failed')
    const anyApplied = results.includes('applied')
    const anyNeutralized = results.includes('neutralized')

    if (!anyApplied && !anyFailed && !anyNeutralized) {
      // Nenhum dos dois tinha READY para reescrever — preferência
      // registrada, nada mais a fazer agora. `skipped` em ambos.
      return { status: 'preferenceOnly', hideAmounts }
    }

    if (!anyApplied) {
      // Nenhum snapshot foi aplicado com sucesso — só neutralização e/ou
      // falha. Mesma classificação que o M4 já usava para o caso isolado.
      return anyFailed
        ? { status: 'failed' }
        : { status: 'preferenceOnly', hideAmounts }
    }

    if (anyFailed || anyNeutralized) {
      // Um foi aplicado, o outro não terminou limpo — sucesso, mas não
      // uniforme o bastante para a UI ficar em silêncio sobre isso.
      return { status: 'partial', hideAmounts }
    }

    return { status: 'applied', hideAmounts }
  }

  /** Reescreve apenas a privacidade do Budget Snapshot corrente. */
  private async applyToBudget(
    ownerId: string,
    hideAmounts: boolean,
  ): Promise<SnapshotApplyResult> {
    const store = this.deps.store!

    let current
    try {
      current = parseSnapshot(await store.read())
    } catch {
      return 'skipped'
    }

    if (!current || current.state !== 'ready') return 'skipped'

    if (current.ownerId !== ownerId) {
      try {
        await store.write(JSON.stringify(buildSignedOutSnapshot()))
      } catch {
        // O importante é não ter revelado. A preferência está gravada.
      }
      return 'skipped'
    }

    // `generatedAt` NÃO é tocado — ver a nota longa em versões anteriores
    // deste serviço: ele responde "quão frescos são os números", não "quando
    // o arquivo foi escrito por último".
    const next = { ...current, privacy: { hideAmounts } }

    try {
      await store.write(JSON.stringify(next))
      return 'applied'
    } catch {
      if (hideAmounts) {
        try {
          await store.write(JSON.stringify(buildSignedOutSnapshot()))
          return 'neutralized'
        } catch {
          return 'failed'
        }
      }
      return 'failed'
    }
  }

  /** Reescreve apenas a privacidade do Invoices Snapshot corrente. */
  private async applyToInvoices(
    ownerId: string,
    hideAmounts: boolean,
  ): Promise<SnapshotApplyResult> {
    const store = this.deps.store!

    let current
    try {
      current = parseInvoicesSnapshot(await store.readInvoices())
    } catch {
      return 'skipped'
    }

    if (!current || current.state !== 'ready') return 'skipped'

    if (current.ownerId !== ownerId) {
      try {
        await store.writeInvoices(JSON.stringify(buildInvoicesSignedOutSnapshot()))
      } catch {
        // Idem: o importante é não ter revelado dado de outra conta.
      }
      return 'skipped'
    }

    const next = { ...current, privacy: { hideAmounts } }

    try {
      await store.writeInvoices(JSON.stringify(next))
      return 'applied'
    } catch {
      if (hideAmounts) {
        try {
          await store.writeInvoices(JSON.stringify(buildInvoicesSignedOutSnapshot()))
          return 'neutralized'
        } catch {
          return 'failed'
        }
      }
      return 'failed'
    }
  }
}

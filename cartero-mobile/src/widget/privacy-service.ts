import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'
import {
  DEFAULT_HIDE_AMOUNTS,
  hideAmountsFor,
  parsePrivacyStore,
  withHideAmounts,
} from './privacy-store'
import type { SnapshotMutationCoordinator } from './snapshot-mutations'
import { buildSignedOutSnapshot, parseSnapshot } from './snapshot'

/**
 * A única autoridade sobre a privacidade dos widgets.
 *
 * A interface nunca grava JSON: ela pede uma mudança e recebe o estado que
 * ficou persistido. Espalhar leitura e escrita por telas produziria versões
 * divergentes da mesma preferência — e, neste caso, divergência significa a
 * tela dizendo "oculto" enquanto o saldo aparece na tela inicial.
 */

export interface PrivacyServiceDeps {
  store: SnapshotStore | null
  coordinator: SnapshotMutationCoordinator
  /** Id da conta na sessão corrente, ou `null` se não há sessão. */
  currentOwnerId: () => string | null
}

export type PrivacyUpdateResult =
  | { status: 'applied'; hideAmounts: boolean }
  /** A preferência foi gravada, mas o snapshot não pôde ser atualizado. */
  | { status: 'preferenceOnly'; hideAmounts: boolean }
  | { status: 'failed' }

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
   * Registra a escolha e aplica ao snapshot já existente.
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

        Se o passo seguinte falhar, o pedido do usuário já está registrado: o
        próximo sync respeitará "ocultar" mesmo que a reescrita de agora não
        tenha dado certo. A ordem inversa perderia a intenção por completo.
      */
      try {
        const raw = await store.readPrivacy()
        const next = withHideAmounts(parsePrivacyStore(raw), ownerId, hideAmounts)
        await store.writePrivacy(JSON.stringify(next))
      } catch {
        return { status: 'failed' }
      }

      return this.applyToSnapshot(ownerId, hideAmounts)
    })
  }

  /** Reescreve apenas a privacidade do snapshot corrente. */
  private async applyToSnapshot(
    ownerId: string,
    hideAmounts: boolean,
  ): Promise<PrivacyUpdateResult> {
    const store = this.deps.store!

    let current
    try {
      current = parseSnapshot(await store.read())
    } catch {
      return { status: 'preferenceOnly', hideAmounts }
    }

    /*
      Sem READY não há o que reescrever, e isso NÃO é falha.

      Estado neutro, logout ou arquivo ausente: inventar um READY aqui
      fabricaria números que ninguém calculou. A preferência fica registrada
      para o próximo sync.
    */
    if (!current || current.state !== 'ready') {
      return { status: 'preferenceOnly', hideAmounts }
    }

    /*
      ── Nunca revelar o snapshot de outra conta ──

      Se o arquivo pertence a A e quem está logado é B, atender um "mostrar
      valores" de B exporia o saldo de A. O caso surge numa troca de conta
      com sync ainda em andamento.

      Ocultar continua permitido: mascarar dado alheio não vaza nada. Mas o
      caminho seguro aqui é neutralizar — o M2 já trata snapshot estrangeiro
      como algo a limpar.
    */
    if (current.ownerId !== ownerId) {
      try {
        await store.write(JSON.stringify(buildSignedOutSnapshot()))
      } catch {
        // O importante é não ter revelado. A preferência está gravada.
      }
      return { status: 'preferenceOnly', hideAmounts }
    }

    /*
      `generatedAt` NÃO é tocado.

      Ele responde "quão frescos são os números do Budget", não "quando o
      arquivo foi escrito pela última vez". Atualizá-lo num toggle faria o
      rótulo de idade do M3 mentir: um dado de manhã pareceria recém-chegado
      porque alguém mexeu num interruptor à noite.
    */
    const next = {
      ...current,
      privacy: { hideAmounts },
    }

    try {
      await store.write(JSON.stringify(next))
    } catch {
      /*
        A reescrita falhou. Se o pedido era OCULTAR, os valores continuam
        visíveis no widget enquanto a interface afirma o contrário — a única
        combinação realmente ruim. Tentamos neutralizar o snapshot: perder o
        Budget da tela inicial é melhor que exibir o que foi mandado esconder.
      */
      if (hideAmounts) {
        try {
          await store.write(JSON.stringify(buildSignedOutSnapshot()))
          return { status: 'preferenceOnly', hideAmounts }
        } catch {
          return { status: 'failed' }
        }
      }

      return { status: 'failed' }
    }

    return { status: 'applied', hideAmounts }
  }
}

/**
 * Serializa TODA mutação do Snapshot V1.
 *
 * ── Por que isto existe ──
 *
 * Até o M3 havia um único escritor: o sync do Budget, já coalescido. O M4
 * acrescenta um segundo — o toggle de privacidade — e dois escritores sobre o
 * mesmo arquivo produzem uma corrida cujo resultado depende de latência de
 * rede:
 *
 *   sync lê a preferência (oculto)
 *   → usuário ativa "mostrar valores"
 *   → toggle grava e reescreve o snapshot
 *   → sync TERMINA e sobrescreve com a preferência velha
 *
 * O usuário veria o ajuste ligado e o widget mascarado, sem nada errado
 * aparecendo em lugar nenhum. Pior: o inverso — pedir para OCULTAR e o sync
 * atrasado revelar de novo — expõe saldo depois de um pedido explícito de
 * privacidade.
 *
 * A fila resolve por construção. A requisição HTTP acontece FORA do lock; só
 * a leitura da preferência mais recente, a montagem e a escrita entram — e
 * é por isso que a preferência nunca é capturada cedo demais.
 */
export class SnapshotMutationCoordinator {
  /** A cauda da fila. Cada mutação encadeia na anterior. */
  private tail: Promise<unknown> = Promise.resolve()

  /**
   * Executa `mutation` em exclusão mútua com as demais.
   *
   * A falha de uma não trava a fila: o `catch` mantém a cauda resolvida para
   * a próxima, e o erro segue para quem chamou.
   */
  run<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation, mutation)

    this.tail = result.catch(() => undefined)

    return result
  }
}

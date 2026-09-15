import { requireOptionalNativeModule } from 'expo'

/**
 * Ponte para o armazenamento nativo do snapshot.
 *
 * `requireOptionalNativeModule` em vez do obrigatório: o módulo existe só no
 * Android nesta fase, e um import incondicional quebraria o bundle em
 * qualquer outra plataforma — inclusive nos testes, que rodam em Node. A
 * ausência é um estado previsto, não um erro.
 *
 * O contrato do Snapshot V1 não muda quando o iOS chegar: será outra
 * implementação desta mesma interface, lendo de um App Group.
 */
export interface SnapshotStore {
  write(contents: string): Promise<void>
  read(): Promise<string | null>
  /**
   * A preferência de privacidade, em arquivo SEPARADO do snapshot.
   *
   * Separado porque os ciclos de vida diferem: o logout neutraliza o
   * snapshot, e a escolha de mostrar valores pertence à pessoa, não à
   * sessão. Juntos, cada logout apagaria a decisão.
   */
  writePrivacy(contents: string): Promise<void>
  readPrivacy(): Promise<string | null>
  /**
   * O snapshot de Invoices (M5B), em arquivo INDEPENDENTE do de Budget.
   *
   * Falha ou evolução de um contrato não pode corromper o outro — o mesmo
   * raciocínio que já separa `snapshot-v1.json` de `privacy-v1.json`. Slot
   * explícito, não um `writeFile(path, content)` genérico: a superfície
   * nativa continua uma allowlist, nunca um filesystem arbitrário.
   */
  writeInvoices(contents: string): Promise<void>
  readInvoices(): Promise<string | null>
  /** Pede o redesenho do widget sem reescrever nada. */
  refreshWidget(): Promise<void>
  /** Caminho real do arquivo — para inspeção, nunca para exibição. */
  location(): Promise<string>
}

const native = requireOptionalNativeModule<SnapshotStore>(
  'CarteroWidgetSnapshot',
)

/** `null` onde não há implementação nativa (iOS por enquanto, web, testes). */
export const snapshotStore: SnapshotStore | null = native

export const isSnapshotStoreAvailable = native !== null

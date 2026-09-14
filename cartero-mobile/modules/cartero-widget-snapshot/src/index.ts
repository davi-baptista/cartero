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
  /** Caminho real do arquivo — para inspeção, nunca para exibição. */
  location(): Promise<string>
}

const native = requireOptionalNativeModule<SnapshotStore>(
  'CarteroWidgetSnapshot',
)

/** `null` onde não há implementação nativa (iOS por enquanto, web, testes). */
export const snapshotStore: SnapshotStore | null = native

export const isSnapshotStoreAvailable = native !== null
